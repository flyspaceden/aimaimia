import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Avatar,
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Radio,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import type { SortOrder } from 'antd/es/table/interface';
import {
  DeleteOutlined,
  ExportOutlined,
  PlusOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  adjustDigitalAssetAccount,
  exportDigitalAssetAccounts,
  getDigitalAssetAccount,
  getDigitalAssetAccounts,
  getDigitalAssetLedgers,
  getDigitalAssetOverview,
  getDigitalAssetRules,
  updateDigitalAssetRules,
} from '@/api/digital-assets';
import PermissionGate from '@/components/PermissionGate';
import BuyerIdentityText from '@/components/BuyerIdentityText';
import { PERMISSIONS } from '@/constants/permissions';
import { usePermission } from '@/hooks/usePermission';
import { getDigitalAssetLedgerStatusMeta } from './ledgerDisplay';
import type {
  DigitalAssetAccountSortField,
  DigitalAssetAccountRow,
  DigitalAssetAdjustPayload,
  DigitalAssetCreditTier,
  DigitalAssetLedger,
  DigitalAssetRules,
  DigitalAssetSubjectType,
} from '@/types';

const vipStatusMap: Record<'NORMAL' | 'VIP', { text: string; color: string }> = {
  NORMAL: { text: '普通', color: 'default' },
  VIP: { text: 'VIP', color: 'gold' },
};

const digitalAssetSortableFields: DigitalAssetAccountSortField[] = [
  'totalAssetBalance',
  'seedAssetBalance',
  'creditAssetBalance',
  'frozenCreditAssetBalance',
  'cumulativeSpendAmount',
  'updatedAt',
];

const subjectMap: Record<DigitalAssetSubjectType, { text: string; color: string }> = {
  CUMULATIVE_SPEND: { text: '累计消费', color: 'blue' },
  SEED_ASSET: { text: '种子资产', color: 'purple' },
  CREDIT_ASSET: { text: '消费资产', color: 'cyan' },
};

const sourceMap: Record<string, { text: string; color: string }> = {
  ORDER_RECEIVED: { text: '确认收货', color: 'green' },
  CONSUMPTION_CONFIRMED: { text: '确认消费', color: 'green' },
  CONSUMPTION_PAID_FROZEN: { text: '付款冻结', color: 'cyan' },
  CONSUMPTION_FROZEN_RELEASED: { text: '确认释放', color: 'green' },
  CONSUMPTION_FROZEN_VOIDED: { text: '冻结作废', color: 'red' },
  REFUND_REVERSAL: { text: '退款扣回', color: 'red' },
  SELF_VIP_PURCHASE: { text: '自购 VIP', color: 'gold' },
  REFERRAL_VIP_PURCHASE: { text: '推荐 VIP', color: 'orange' },
  HISTORICAL_CONSUMPTION_GRANT: { text: '历史消费转入', color: 'geekblue' },
  ADMIN_ADJUSTMENT: { text: '后台调整', color: 'magenta' },
  BACKFILL: { text: '历史补数', color: 'default' },
};

function formatCurrency(value: number) {
  return `¥${value.toFixed(2)}`;
}

function formatAsset(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

function formatLedgerAmount(record: DigitalAssetLedger) {
  if (record.subjectType === 'CUMULATIVE_SPEND') {
    return formatCurrency(record.amount);
  }
  return formatAsset(record.assetAmount ?? record.amount);
}

function formatLedgerBalance(record: DigitalAssetLedger) {
  if (record.subjectType === 'CUMULATIVE_SPEND') {
    return formatCurrency(record.balanceAfter);
  }
  if (record.status === 'FROZEN' || record.status === 'VOIDED') {
    return formatAsset(record.frozenCreditAssetBalanceAfter ?? record.balanceAfter);
  }
  return formatAsset(record.balanceAfter);
}

function validateCreditTiers(tiers: DigitalAssetCreditTier[]) {
  if (tiers.length === 0) {
    throw new Error('消费资产倍率档位不能为空');
  }

  const sorted = [...tiers].sort((a, b) => a.minAmount - b.minAmount);

  sorted.forEach((tier, index) => {
    if (!Number.isFinite(tier.minAmount)) {
      throw new Error(`第${index + 1}个档位minAmount必须是有限数字`);
    }
    if (!Number.isFinite(tier.multiplier)) {
      throw new Error(`第${index + 1}个档位multiplier必须是有限数字`);
    }
    if (tier.maxAmount !== null) {
      if (!Number.isFinite(tier.maxAmount)) {
        throw new Error(`第${index + 1}个档位maxAmount必须是有限数字`);
      }
      if (tier.maxAmount <= tier.minAmount) {
        throw new Error('消费资产倍率档位上限必须大于下限');
      }
    }
    if (tier.multiplier <= 0) {
      throw new Error('消费资产倍率必须大于0');
    }
  });

  if (sorted[0].minAmount !== 0) {
    throw new Error('消费资产倍率首档必须从0开始');
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    if (current.maxAmount === null) {
      throw new Error('只有最后一个消费资产倍率档位可以无上限');
    }
    if (current.maxAmount !== next.minAmount) {
      throw new Error('消费资产倍率档位不能断档');
    }
  }

  return sorted;
}

function getCurrentTierInfo(cumulativeSpendAmount: number, tiers: DigitalAssetCreditTier[]) {
  return [...tiers].reverse().find((item) => cumulativeSpendAmount >= item.minAmount) ?? tiers[0] ?? null;
}

function getNextTierInfo(cumulativeSpendAmount: number, tiers: DigitalAssetCreditTier[]) {
  return tiers.find((item) => item.minAmount > cumulativeSpendAmount) ?? null;
}

function buildDefaultRuleRow(previous?: DigitalAssetCreditTier): DigitalAssetCreditTier {
  if (!previous) {
    return { minAmount: 0, maxAmount: null, multiplier: 1 };
  }
  const nextMinAmount = previous.maxAmount ?? previous.minAmount;
  return {
    minAmount: nextMinAmount,
    maxAmount: null,
    multiplier: previous.multiplier,
  };
}

function getDigitalAssetSortParams(sort: Record<string, SortOrder | undefined>) {
  const selectedSort = Object.entries(sort ?? {}).find(([, order]) => order === 'ascend' || order === 'descend');
  if (!selectedSort) return {};

  const [field, order] = selectedSort;
  if (!digitalAssetSortableFields.includes(field as DigitalAssetAccountSortField)) {
    return {};
  }

  return {
    sortField: field as DigitalAssetAccountSortField,
    sortOrder: order as 'ascend' | 'descend',
  };
}

export default function DigitalAssetsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const actionRef = useRef<ActionType>(null);
  const { hasPermission, isSuperAdmin } = usePermission();
  const canReadRules = hasPermission(PERMISSIONS.DIGITAL_ASSETS_READ);
  const canManageRules = hasPermission(PERMISSIONS.DIGITAL_ASSETS_SETTINGS);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<DigitalAssetAccountRow | null>(null);
  const [form] = Form.useForm<DigitalAssetAdjustPayload>();
  const [ruleDrafts, setRuleDrafts] = useState<DigitalAssetCreditTier[]>([]);

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin', 'digital-assets', 'overview'],
    queryFn: getDigitalAssetOverview,
  });

  const rulesQuery = useQuery({
    queryKey: ['admin', 'digital-assets', 'rules'],
    queryFn: getDigitalAssetRules,
    enabled: canReadRules || canManageRules,
  });

  useEffect(() => {
    if (rulesQuery.data?.tiers) {
      setRuleDrafts(rulesQuery.data.tiers);
    }
  }, [rulesQuery.data]);

  const effectiveTiers = useMemo(
    () => (rulesQuery.data?.tiers?.length ? rulesQuery.data.tiers : []),
    [rulesQuery.data],
  );

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['admin', 'digital-assets', 'account', selectedUserId],
    queryFn: () => getDigitalAssetAccount(selectedUserId!),
    enabled: !!selectedUserId,
  });

  const { data: ledgers, isLoading: ledgerLoading } = useQuery({
    queryKey: ['admin', 'digital-assets', 'ledgers', selectedUserId],
    queryFn: () => getDigitalAssetLedgers(selectedUserId!, { page: 1, pageSize: 20 }),
    enabled: !!selectedUserId,
  });

  const adjustMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: DigitalAssetAdjustPayload }) =>
      adjustDigitalAssetAccount(userId, data),
    onSuccess: () => {
      message.success('调整成功');
      setAdjusting(null);
      form.resetFields();
      actionRef.current?.reload();
      queryClient.invalidateQueries({ queryKey: ['admin', 'digital-assets'] });
    },
    onError: (err: Error) => message.error(err.message || '调整失败'),
  });

  const updateRulesMutation = useMutation({
    mutationFn: (data: DigitalAssetRules) => updateDigitalAssetRules(data),
    onSuccess: (data) => {
      message.success('规则已保存');
      setRuleDrafts(data.tiers);
      queryClient.invalidateQueries({ queryKey: ['admin', 'digital-assets', 'rules'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'digital-assets', 'account'] });
    },
    onError: (err: Error) => message.error(err.message || '规则保存失败'),
  });

  const handleExport = async () => {
    try {
      const blob = await exportDigitalAssetAccounts();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `digital-assets-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      message.success('导出已开始');
    } catch (err: any) {
      message.error(err?.message || '导出失败');
    }
  };

  const handleRuleFieldChange = (
    index: number,
    field: keyof DigitalAssetCreditTier,
    value: number | null,
  ) => {
    setRuleDrafts((current) =>
      current.map((item, currentIndex) => {
        if (currentIndex !== index) return item;
        return {
          ...item,
          [field]: value,
        };
      }),
    );
  };

  const handleSaveRules = async () => {
    if (!rulesQuery.data) return;
    try {
      const normalized = validateCreditTiers(
        ruleDrafts.map((tier) => ({
          minAmount: Number(tier.minAmount ?? 0),
          maxAmount: tier.maxAmount === null || tier.maxAmount === undefined ? null : Number(tier.maxAmount),
          multiplier: Number(tier.multiplier ?? 0),
        })),
      );
      await updateRulesMutation.mutateAsync({
        tiers: normalized,
        modules: rulesQuery.data.modules,
      });
    } catch (error: any) {
      message.error(error?.message || '规则校验失败');
    }
  };

  const columns: ProColumns<DigitalAssetAccountRow>[] = [
    {
      title: '用户',
      dataIndex: 'keyword',
      width: 260,
      render: (_: unknown, record) => (
        <Space>
          <Avatar src={record.user.avatarUrl} icon={<UserOutlined />} />
          <Button
            type="link"
            style={{ padding: 0, height: 'auto', textAlign: 'left' }}
            onClick={() => setSelectedUserId(record.userId)}
          >
            <BuyerIdentityText
              buyerNo={record.user.buyerNo}
              userId={record.userId}
              nickname={record.user.nickname || record.user.phone || '-'}
              compact
            />
          </Button>
        </Space>
      ),
    },
    {
      title: 'VIP 状态',
      dataIndex: ['user', 'vipStatus'],
      search: false,
      width: 110,
      render: (_: unknown, record) => {
        const meta = vipStatusMap[record.user.vipStatus];
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '数字资产总额',
      dataIndex: 'totalAssetBalance',
      search: false,
      sorter: true,
      width: 140,
      render: (_: unknown, record) => <Typography.Text strong>{formatAsset(record.totalAssetBalance)}</Typography.Text>,
    },
    {
      title: '种子资产',
      dataIndex: 'seedAssetBalance',
      search: false,
      sorter: true,
      width: 120,
      render: (_: unknown, record) => formatAsset(record.seedAssetBalance),
    },
    {
      title: '消费资产',
      dataIndex: 'creditAssetBalance',
      search: false,
      sorter: true,
      width: 120,
      render: (_: unknown, record) => formatAsset(record.creditAssetBalance),
    },
    {
      title: '冻结资产',
      dataIndex: 'frozenCreditAssetBalance',
      search: false,
      sorter: true,
      width: 120,
      render: (_: unknown, record) => formatAsset(record.frozenCreditAssetBalance),
    },
    {
      title: '累计消费',
      dataIndex: 'cumulativeSpendAmount',
      search: false,
      sorter: true,
      defaultSortOrder: 'descend',
      width: 140,
      render: (_: unknown, record) => <Typography.Text>{formatCurrency(record.cumulativeSpendAmount)}</Typography.Text>,
    },
    {
      title: '最低累计消费',
      dataIndex: 'minAmount',
      hideInTable: true,
      valueType: 'digit',
    },
    {
      title: '最高累计消费',
      dataIndex: 'maxAmount',
      hideInTable: true,
      valueType: 'digit',
    },
    {
      title: '账户更新时间',
      dataIndex: 'updatedAt',
      search: false,
      sorter: true,
      width: 170,
      render: (_: unknown, record) => dayjs(record.updatedAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 180,
      render: (_: unknown, record) => [
        <Button key="detail" type="link" onClick={() => setSelectedUserId(record.userId)}>
          明细
        </Button>,
        <PermissionGate key="adjust" permission={PERMISSIONS.DIGITAL_ASSETS_ADJUST}>
          <Button
            type="link"
            disabled={!isSuperAdmin()}
            onClick={() => {
              setAdjusting(record);
              form.setFieldsValue({
                direction: 'CREDIT',
                subjectType: 'SEED_ASSET',
                amount: 1,
                reason: '',
              });
            }}
          >
            调整
          </Button>
        </PermissionGate>,
      ],
    },
  ];

  const ruleColumns = [
    {
      title: '起始累计消费',
      dataIndex: 'minAmount',
      width: 180,
      render: (value: number, _: DigitalAssetCreditTier, index: number) => (
        <InputNumber
          min={0}
          precision={2}
          value={value}
          style={{ width: '100%' }}
          onChange={(nextValue) => handleRuleFieldChange(index, 'minAmount', nextValue)}
        />
      ),
    },
    {
      title: '结束累计消费',
      dataIndex: 'maxAmount',
      width: 180,
      render: (value: number | null, _: DigitalAssetCreditTier, index: number) => (
        <InputNumber
          min={0}
          precision={2}
          value={value ?? undefined}
          placeholder="留空表示无上限"
          style={{ width: '100%' }}
          onChange={(nextValue) => handleRuleFieldChange(index, 'maxAmount', nextValue ?? null)}
        />
      ),
    },
    {
      title: '倍率',
      dataIndex: 'multiplier',
      width: 160,
      render: (value: number, _: DigitalAssetCreditTier, index: number) => (
        <InputNumber
          min={0.0001}
          precision={4}
          value={value}
          addonAfter="x"
          style={{ width: '100%' }}
          onChange={(nextValue) => handleRuleFieldChange(index, 'multiplier', nextValue)}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: unknown, __: DigitalAssetCreditTier, index: number) => (
        <Button
          type="link"
          danger
          icon={<DeleteOutlined />}
          disabled={ruleDrafts.length <= 1}
          onClick={() => {
            setRuleDrafts((current) => current.filter((_, currentIndex) => currentIndex !== index));
          }}
        >
          删除
        </Button>
      ),
    },
  ];

  const currentTier = detail && effectiveTiers.length > 0
    ? getCurrentTierInfo(detail.account.cumulativeSpendAmount, effectiveTiers)
    : null;
  const nextTier = detail && effectiveTiers.length > 0
    ? getNextTierInfo(detail.account.cumulativeSpendAmount, effectiveTiers)
    : null;
  const nextTierPercent = detail && nextTier
    ? Math.min(100, Math.max(0, (detail.account.cumulativeSpendAmount / nextTier.minAmount) * 100))
    : 100;

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={overviewLoading}
              title="数字资产总额"
              value={overview?.totalAssetBalance ?? 0}
              formatter={(value) => formatAsset(Number(value ?? 0))}
              prefix={<WalletOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={overviewLoading}
              title="种子资产总额"
              value={overview?.totalSeedAssetBalance ?? 0}
              formatter={(value) => formatAsset(Number(value ?? 0))}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={overviewLoading}
              title="消费资产总额"
              value={overview?.totalCreditAssetBalance ?? 0}
              formatter={(value) => formatAsset(Number(value ?? 0))}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={overviewLoading}
              title="冻结资产总额"
              value={overview?.totalFrozenCreditAssetBalance ?? 0}
              formatter={(value) => formatAsset(Number(value ?? 0))}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={overviewLoading}
              title="累计消费总额"
              value={overview?.totalCumulativeSpendAmount ?? 0}
              precision={2}
              prefix="¥"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={overviewLoading}
              title="今日资产入账"
              value={overview?.todayAssetCreditAmount ?? 0}
              formatter={(value) => formatAsset(Number(value ?? 0))}
              valueStyle={{ color: '#16a34a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={overviewLoading}
              title="今日冻结入账"
              value={overview?.todayFrozenCreditAssetCreditAmount ?? 0}
              formatter={(value) => formatAsset(Number(value ?? 0))}
              valueStyle={{ color: '#0891b2' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={overviewLoading}
              title="今日资产扣回"
              value={overview?.todayAssetDebitAmount ?? 0}
              formatter={(value) => formatAsset(Number(value ?? 0))}
              valueStyle={{ color: '#dc2626' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={overviewLoading}
              title="今日累计消费入账"
              value={overview?.todayCumulativeSpendCreditAmount ?? 0}
              precision={2}
              prefix="¥"
              valueStyle={{ color: '#16a34a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={overviewLoading}
              title="今日累计消费扣回"
              value={overview?.todayCumulativeSpendDebitAmount ?? 0}
              precision={2}
              prefix="¥"
              valueStyle={{ color: '#dc2626' }}
            />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <ProTable<DigitalAssetAccountRow>
          actionRef={actionRef}
          columns={columns}
          rowKey="id"
          request={async (params, sort) => {
            const sortParams = getDigitalAssetSortParams(sort as Record<string, SortOrder | undefined>);
            const res = await getDigitalAssetAccounts({
              page: params.current,
              pageSize: params.pageSize,
              keyword: params.keyword as string | undefined,
              minAmount: params.minAmount as number | undefined,
              maxAmount: params.maxAmount as number | undefined,
              sortField: sortParams.sortField,
              sortOrder: sortParams.sortOrder,
            });
            return { data: res.items, total: res.total, success: true };
          }}
          pagination={{ defaultPageSize: 20 }}
          options={false}
          search={{ labelWidth: 'auto' }}
          toolBarRender={() => [
            <PermissionGate key="export" permission={PERMISSIONS.DIGITAL_ASSETS_EXPORT}>
              <Button icon={<ExportOutlined />} onClick={handleExport}>导出 CSV</Button>
            </PermissionGate>,
          ]}
        />
      </Card>

      <PermissionGate permission={PERMISSIONS.DIGITAL_ASSETS_SETTINGS}>
        <Card
          title="消费资产倍率规则"
          loading={rulesQuery.isLoading && ruleDrafts.length === 0}
          extra={(
            <Space>
              <Button
                icon={<PlusOutlined />}
                onClick={() => {
                  setRuleDrafts((current) => [...current, buildDefaultRuleRow(current[current.length - 1])]);
                }}
              >
                新增档位
              </Button>
              <Button
                type="primary"
                loading={updateRulesMutation.isPending}
                onClick={handleSaveRules}
              >
                保存规则
              </Button>
            </Space>
          )}
        >
          <Table<DigitalAssetCreditTier>
            rowKey={(_, index) => String(index)}
            size="small"
            pagination={false}
            columns={ruleColumns}
            dataSource={ruleDrafts}
          />
        </Card>
      </PermissionGate>

      <Drawer
        title="数字资产明细"
        width={760}
        open={!!selectedUserId}
        onClose={() => setSelectedUserId(null)}
      >
        {detailLoading ? null : detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small">
              <Space align="center" style={{ marginBottom: 16 }}>
                <Avatar src={detail.user.avatarUrl} icon={<UserOutlined />} size={48} />
                <div>
                  <BuyerIdentityText
                    buyerNo={detail.user.buyerNo}
                    userId={detail.user.id}
                    nickname={detail.user.nickname || detail.user.phone || '-'}
                  />
                  <div style={{ marginTop: 4 }}>
                    <Tag color={vipStatusMap[detail.user.vipStatus].color}>
                      {vipStatusMap[detail.user.vipStatus].text}
                    </Tag>
                  </div>
                </div>
              </Space>
              <Row gutter={[12, 12]}>
                <Col xs={24} sm={12}>
                  <Statistic title="数字资产总额" value={detail.account.totalAssetBalance} formatter={(value) => formatAsset(Number(value ?? 0))} />
                </Col>
                <Col xs={24} sm={12}>
                  <Statistic title="种子资产" value={detail.account.seedAssetBalance} formatter={(value) => formatAsset(Number(value ?? 0))} />
                </Col>
                <Col xs={24} sm={12}>
                  <Statistic title="消费资产" value={detail.account.creditAssetBalance} formatter={(value) => formatAsset(Number(value ?? 0))} />
                </Col>
                <Col xs={24} sm={12}>
                  <Statistic title="冻结资产" value={detail.account.frozenCreditAssetBalance} formatter={(value) => formatAsset(Number(value ?? 0))} />
                </Col>
                <Col xs={24} sm={12}>
                  <Statistic title="累计消费" value={detail.account.cumulativeSpendAmount} precision={2} prefix="¥" />
                </Col>
              </Row>
            </Card>

            <Card size="small" title="消费资产倍率">
              {effectiveTiers.length > 0 ? (
                <Row gutter={[12, 12]} align="middle">
                  <Col xs={24} sm={8}>
                    <Statistic
                      title="当前档位"
                      value={currentTier ? `${currentTier.multiplier}x` : '-'}
                    />
                  </Col>
                  <Col xs={24} sm={16}>
                    {nextTier ? (
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Typography.Text>
                          下一档：满 {formatCurrency(nextTier.minAmount)} 后变为 {nextTier.multiplier}x
                        </Typography.Text>
                        <Progress
                          percent={Number(nextTierPercent.toFixed(1))}
                          strokeColor="#1677ff"
                          format={() => `还差 ${formatCurrency(nextTier.minAmount - detail.account.cumulativeSpendAmount)}`}
                        />
                      </Space>
                    ) : (
                      <Typography.Text type="secondary">已处于最高倍率档</Typography.Text>
                    )}
                  </Col>
                </Row>
              ) : (
                <Typography.Text type="secondary">暂无可用的消费资产倍率规则</Typography.Text>
              )}
            </Card>

            <Table<DigitalAssetLedger>
              rowKey="id"
              loading={ledgerLoading}
              dataSource={ledgers?.items ?? []}
              pagination={false}
              size="small"
              columns={[
                {
                  title: '资产科目',
                  dataIndex: 'subjectType',
                  width: 110,
                  render: (value: DigitalAssetSubjectType) => {
                    const meta = subjectMap[value];
                    return <Tag color={meta.color}>{meta.text}</Tag>;
                  },
                },
                {
                  title: '来源',
                  dataIndex: 'sourceType',
                  width: 130,
                  render: (value: string) => {
                    const meta = sourceMap[value] || { text: value, color: 'default' };
                    return <Tag color={meta.color}>{meta.text}</Tag>;
                  },
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 120,
                  render: (_: unknown, record) => {
                    const meta = getDigitalAssetLedgerStatusMeta(record);
                    if (!meta) return <Typography.Text type="secondary">-</Typography.Text>;
                    return (
                      <Space direction="vertical" size={0}>
                        <Tag color={meta.color}>{meta.text}</Tag>
                        {meta.description ? (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {meta.description}
                          </Typography.Text>
                        ) : null}
                      </Space>
                    );
                  },
                },
                {
                  title: '变动',
                  dataIndex: 'amount',
                  width: 120,
                  render: (_: unknown, record) => (
                    <Typography.Text type={record.direction === 'DEBIT' ? 'danger' : 'success'}>
                      {record.direction === 'DEBIT' ? '-' : '+'}
                      {formatLedgerAmount(record)}
                    </Typography.Text>
                  ),
                },
                {
                  title: '余额',
                  dataIndex: 'balanceAfter',
                  width: 120,
                  render: (_: unknown, record) => formatLedgerBalance(record),
                },
                {
                  title: '说明',
                  dataIndex: 'title',
                  ellipsis: true,
                  render: (_: unknown, record) => (
                    <Space direction="vertical" size={0}>
                      <Typography.Text>{record.title}</Typography.Text>
                      {record.description ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {record.description}
                        </Typography.Text>
                      ) : null}
                    </Space>
                  ),
                },
                {
                  title: '时间',
                  dataIndex: 'createdAt',
                  width: 150,
                  render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
                },
              ]}
            />
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title="手动调整数字资产"
        open={!!adjusting}
        onCancel={() => setAdjusting(null)}
        onOk={() => form.submit()}
        okButtonProps={{ loading: adjustMutation.isPending, disabled: !isSuperAdmin() }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => {
            if (!adjusting) return;
            adjustMutation.mutate({ userId: adjusting.userId, data: values });
          }}
        >
          <Form.Item label="调整方向" name="direction" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { label: '增加', value: 'CREDIT' },
                { label: '扣减', value: 'DEBIT' },
              ]}
            />
          </Form.Item>
          <Form.Item label="调整科目" name="subjectType" rules={[{ required: true, message: '请选择调整科目' }]}>
            <Radio.Group
              options={[
                { label: '种子资产', value: 'SEED_ASSET' },
                { label: '消费资产', value: 'CREDIT_ASSET' },
              ]}
            />
          </Form.Item>
          <Form.Item label="数量" name="amount" rules={[{ required: true, message: '请输入数量' }]}>
            <InputNumber min={1} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="原因" name="reason" rules={[{ required: true, min: 5, message: '请输入至少 5 个字的原因' }]}>
            <Input.TextArea rows={3} placeholder="例如：历史数据人工校正" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
