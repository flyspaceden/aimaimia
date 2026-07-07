import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import type { TabsProps } from 'antd';
import type { SortOrder } from 'antd/es/table/interface';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Col,
  Form,
  InputNumber,
  Popover,
  QRCode,
  Row,
  Skeleton,
  Space,
  Statistic,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  CrownOutlined,
  NodeIndexOutlined,
  RiseOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import BuyerIdentityText from '@/components/BuyerIdentityText';
import { BuyerSuggestInput } from '@/components/BuyerSuggestInput';
import PermissionGate from '@/components/PermissionGate';
import { useResizableColumns } from '@/components/table/useResizableColumns';
import { usePermission } from '@/hooks/usePermission';
import { getMembers, getVipMembersStats } from '@/api/bonus';
import {
  getGrowthDashboard,
  getGrowthLedgers,
  getGrowthSettings,
  getNormalShareBindings,
  updateGrowthSettings,
} from '@/api/growth';
import { PERMISSIONS } from '@/constants/permissions';
import type {
  AdminGrowthLedger,
  AdminGrowthLedgerQueryParams,
  AdminGrowthSettings,
  AdminGrowthUserSummary,
  AdminNormalShareBinding,
  BonusMember,
} from '@/types';

const rewardStatusMap: Record<string, { text: string; color: string }> = {
  PENDING: { text: '已绑定', color: 'default' },
  REGISTER_REWARDED: { text: '注册已奖', color: 'blue' },
  FIRST_ORDER_PENDING: { text: '待首单', color: 'orange' },
  ISSUED: { text: '首单已奖', color: 'green' },
  REVERSED: { text: '已冲正', color: 'red' },
  VOIDED: { text: '已作废', color: 'default' },
};

const relationStatusMap: Record<string, { text: string; color: string }> = {
  ACTIVE: { text: '有效', color: 'green' },
  SUPERSEDED_BY_VIP_TREE: { text: '转入 VIP 关系', color: 'gold' },
  INVALIDATED_BY_INVITEE_VIP_UPGRADE: { text: '已因对方升级 VIP 解绑', color: 'orange' },
  ADMIN_VOIDED: { text: '后台作废', color: 'red' },
};

const invalidReasonLabels: Record<string, string> = {
  INVITER_NOT_VIP_AT_INVITEE_UPGRADE: '被推荐人成为 VIP 时，原推荐人仍是普通用户',
};

function renderUser(user: AdminGrowthUserSummary | null | undefined) {
  if (!user) return <Typography.Text type="secondary">-</Typography.Text>;
  return (
    <Space>
      <Avatar src={user.avatarUrl ?? undefined} icon={<UserOutlined />} size="small" />
      <BuyerIdentityText
        buyerNo={user.buyerNo}
        userId={user.id}
        nickname={user.nickname || user.phone || '-'}
        compact
      />
    </Space>
  );
}

function renderRelationStatus(status?: string | null) {
  if (!status) return <Typography.Text type="secondary">-</Typography.Text>;
  const meta = relationStatusMap[status] ?? { text: status, color: 'default' };
  return <Tag color={meta.color}>{meta.text}</Tag>;
}

function renderInvalidReason(reason?: string | null) {
  if (!reason) return <Typography.Text type="secondary">-</Typography.Text>;
  return invalidReasonLabels[reason] ?? reason;
}

function getLedgerMetaNumber(record: AdminGrowthLedger, key: string) {
  const value = record.meta?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getNormalShareSortParams(sort: Record<string, SortOrder | undefined>) {
  const selected = Object.entries(sort ?? {}).find(([, order]) => order === 'ascend' || order === 'descend');
  if (!selected) return {};
  const [field, order] = selected;
  if (!['boundAt', 'rewardIssuedAt', 'updatedAt'].includes(field)) return {};
  return {
    sortField: field as 'boundAt' | 'rewardIssuedAt' | 'updatedAt',
    sortOrder: order as 'ascend' | 'descend',
  };
}

function getBonusMemberSortParams(sort: Record<string, SortOrder | undefined>) {
  const selected = Object.entries(sort ?? {}).find(([, order]) => order === 'ascend' || order === 'descend');
  if (!selected) return {};
  const [field, order] = selected;
  if (!['vipPurchasedAt', 'selfPurchaseCount', 'createdAt'].includes(field)) return {};
  return {
    sortField: field as 'vipPurchasedAt' | 'selfPurchaseCount' | 'createdAt',
    sortOrder: order as 'ascend' | 'descend',
  };
}

function getLedgerSortParams(sort: Record<string, SortOrder | undefined>): {
  sortBy?: AdminGrowthLedgerQueryParams['sortBy'];
  sortOrder?: AdminGrowthLedgerQueryParams['sortOrder'];
} {
  const selected = Object.entries(sort ?? {}).find(([, order]) => order === 'ascend' || order === 'descend');
  if (!selected) return {};
  const [field, order] = selected;
  if (field !== 'createdAt') return {};
  return {
    sortBy: 'createdAt',
    sortOrder: order as AdminGrowthLedgerQueryParams['sortOrder'],
  };
}

type AutoVipSettingsForm = Pick<AdminGrowthSettings, 'autoVipBySpendEnabled' | 'autoVipCumulativeSpendThreshold'>;

export default function ReferralsPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const shareActionRef = useRef<ActionType>(null);
  const vipActionRef = useRef<ActionType>(null);
  const autoVipActionRef = useRef<ActionType>(null);
  const [settingsForm] = Form.useForm<AutoVipSettingsForm>();
  const canReadNormalShare = hasPermission(PERMISSIONS.NORMAL_SHARE_READ);
  const canReadBonus = hasPermission(PERMISSIONS.BONUS_READ);
  const canReadGrowth = hasPermission(PERMISSIONS.GROWTH_READ);

  const dashboardQuery = useQuery({
    queryKey: ['admin', 'growth', 'dashboard'],
    queryFn: getGrowthDashboard,
    enabled: canReadGrowth,
  });
  const vipStatsQuery = useQuery({
    queryKey: ['admin', 'vip-members-stats'],
    queryFn: getVipMembersStats,
    enabled: canReadBonus,
    staleTime: 30_000,
  });
  const settingsQuery = useQuery({
    queryKey: ['admin', 'growth', 'settings'],
    queryFn: getGrowthSettings,
    enabled: canReadGrowth,
  });

  useEffect(() => {
    if (settingsQuery.data) {
      settingsForm.setFieldsValue({
        autoVipBySpendEnabled: settingsQuery.data.autoVipBySpendEnabled,
        autoVipCumulativeSpendThreshold: settingsQuery.data.autoVipCumulativeSpendThreshold,
      });
    }
  }, [settingsForm, settingsQuery.data]);

  const saveAutoVipSettingsMutation = useMutation({
    mutationFn: (values: AutoVipSettingsForm) => updateGrowthSettings(values),
    onSuccess: (settings) => {
      message.success('VIP 转化设置已保存');
      settingsForm.setFieldsValue({
        autoVipBySpendEnabled: settings.autoVipBySpendEnabled,
        autoVipCumulativeSpendThreshold: settings.autoVipCumulativeSpendThreshold,
      });
      queryClient.invalidateQueries({ queryKey: ['admin', 'growth', 'settings'] });
    },
    onError: (error: Error) => message.error(error.message || '保存失败'),
  });

  const normalShareColumns: ProColumns<AdminNormalShareBinding>[] = [
    {
      title: '推荐人',
      dataIndex: 'keyword',
      width: 260,
      renderFormItem: () => (
        <BuyerSuggestInput placeholder="搜索买家编号、手机号或昵称" />
      ),
      render: (_: unknown, record) => renderUser(record.inviter),
    },
    {
      title: '被推荐人',
      dataIndex: 'inviteeUserId',
      search: false,
      width: 260,
      render: (_: unknown, record) => renderUser(record.invitee),
    },
    {
      title: '分享码',
      dataIndex: 'code',
      width: 120,
      render: (_: unknown, record) => <Typography.Text code>{record.code}</Typography.Text>,
    },
    {
      title: '奖励状态',
      dataIndex: 'rewardStatus',
      width: 130,
      valueType: 'select',
      fieldProps: {
        options: Object.entries(rewardStatusMap).map(([value, meta]) => ({
          label: meta.text,
          value,
        })),
      },
      render: (_: unknown, record) => {
        const meta = rewardStatusMap[record.rewardStatus] ?? {
          text: record.rewardStatus,
          color: 'default',
        };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '关系状态',
      dataIndex: 'relationStatus',
      search: false,
      width: 150,
      render: (_: unknown, record) => renderRelationStatus(record.relationStatus),
    },
    {
      title: '有效推荐人',
      dataIndex: 'effectiveInviterUserId',
      search: false,
      width: 240,
      render: (_: unknown, record) =>
        record.effectiveInviter ? (
          renderUser(record.effectiveInviter)
        ) : record.effectiveInviterUserId ? (
          <Typography.Text code>{record.effectiveInviterUserId}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">无有效推荐人</Typography.Text>
        ),
    },
    {
      title: '失效原因',
      dataIndex: 'relationInvalidReason',
      search: false,
      width: 260,
      render: (_: unknown, record) => renderInvalidReason(record.relationInvalidReason),
    },
    {
      title: '首单',
      dataIndex: 'firstOrderId',
      search: false,
      width: 170,
      render: (_: unknown, record) => record.firstOrderId ?? <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: '绑定时间',
      dataIndex: 'boundAt',
      search: false,
      sorter: true,
      defaultSortOrder: 'descend',
      width: 170,
      render: (_: unknown, record) => dayjs(record.boundAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '奖励发放时间',
      dataIndex: 'rewardIssuedAt',
      search: false,
      sorter: true,
      width: 170,
      render: (_: unknown, record) =>
        record.rewardIssuedAt ? dayjs(record.rewardIssuedAt).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      search: false,
      sorter: true,
      width: 170,
      render: (_: unknown, record) => dayjs(record.updatedAt).format('YYYY-MM-DD HH:mm'),
    },
  ];
  const resizableTable = useResizableColumns(normalShareColumns, {
    storageKey: 'admin:referrals:normal-share:columns',
    defaultWidth: 140,
  });

  const vipColumns: ProColumns<BonusMember>[] = [
    {
      title: 'VIP 用户',
      dataIndex: 'keyword',
      width: 240,
      renderFormItem: () => (
        <BuyerSuggestInput tier="VIP" placeholder="搜索 VIP 买家编号、手机号或昵称" />
      ),
      render: (_: unknown, record) => (
        <BuyerIdentityText
          buyerNo={record.buyerNo || record.user?.buyerNo}
          userId={record.userId}
          nickname={record.user?.profile?.nickname || '-'}
          compact
        />
      ),
    },
    {
      title: 'VIP 推荐码',
      dataIndex: 'referralCode',
      width: 160,
      render: (_: unknown, record) => {
        if (!record.referralCode) return '-';
        const inviteUrl = `https://app.ai-maimai.com/r/${record.referralCode}`;
        return (
          <Popover
            placement="right"
            content={
              <Space direction="vertical" align="center" size={8} style={{ width: 200 }}>
                <QRCode value={inviteUrl} size={150} bordered={false} />
                <Typography.Text copyable={{ text: inviteUrl }} style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  {inviteUrl}
                </Typography.Text>
              </Space>
            }
          >
            <Typography.Text copyable={{ text: record.referralCode }}>
              <Tag color="gold" style={{ fontFamily: 'monospace', cursor: 'pointer' }}>
                {record.referralCode}
              </Tag>
            </Typography.Text>
          </Popover>
        );
      },
    },
    {
      title: 'VIP 推荐人',
      dataIndex: 'inviterNickname',
      search: false,
      width: 160,
      render: (_: unknown, record) =>
        record.inviterUserId ? (
          <Button type="link" size="small" onClick={() => navigate(`/bonus/members/${record.inviterUserId}`)}>
            {record.inviterNickname || `…${record.inviterUserId.slice(-8)}`}
          </Button>
        ) : (
          '-'
        ),
    },
    {
      title: '直邀 VIP',
      dataIndex: 'inviteeVipCount',
      search: false,
      width: 100,
      align: 'right',
      render: (_: unknown, record) => <Typography.Text strong>{record.inviteeVipCount}</Typography.Text>,
    },
    {
      title: '自购次数',
      dataIndex: 'selfPurchaseCount',
      search: false,
      sorter: true,
      width: 110,
      align: 'right',
      render: (_: unknown, record) => record.selfPurchaseCount,
    },
    {
      title: 'VIP 开通时间',
      dataIndex: 'vipPurchasedAt',
      search: false,
      sorter: true,
      defaultSortOrder: 'descend',
      width: 170,
      render: (_: unknown, record) =>
        record.vipPurchasedAt ? dayjs(record.vipPurchasedAt).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      search: false,
      sorter: true,
      width: 170,
      render: (_: unknown, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
    },
  ];
  const vipResizableTable = useResizableColumns(vipColumns, {
    storageKey: 'admin:referrals:vip-codes:columns',
    defaultWidth: 140,
  });

  const autoVipColumns: ProColumns<AdminGrowthLedger>[] = [
    {
      title: '升级用户',
      dataIndex: 'userId',
      width: 260,
      render: (_: unknown, record) => renderUser(record.user),
    },
    {
      title: '触发订单',
      dataIndex: 'refId',
      search: false,
      width: 180,
      render: (_: unknown, record) => (
        <Typography.Text copyable={record.refId ? { text: record.refId } : false}>
          {record.refId ?? '-'}
        </Typography.Text>
      ),
    },
    {
      title: '累计消费',
      search: false,
      width: 130,
      render: (_: unknown, record) => {
        const amount = getLedgerMetaNumber(record, 'cumulativeSpendAmount');
        return amount === null ? '-' : `¥${amount.toFixed(2)}`;
      },
    },
    {
      title: '升级门槛',
      search: false,
      width: 130,
      render: (_: unknown, record) => {
        const threshold = getLedgerMetaNumber(record, 'threshold');
        return threshold === null ? '-' : `¥${threshold.toFixed(2)}`;
      },
    },
    {
      title: '进入的 VIP 上级',
      search: false,
      width: 260,
      render: (_: unknown, record) => renderUser(record.autoVipTreeInviter),
    },
    {
      title: '升级时间',
      dataIndex: 'createdAt',
      search: false,
      sorter: true,
      defaultSortOrder: 'descend',
      width: 170,
      render: (_: unknown, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
    },
  ];
  const autoVipResizableTable = useResizableColumns(autoVipColumns, {
    storageKey: 'admin:referrals:auto-vip:columns',
    defaultWidth: 140,
  });

  return (
    <div style={{ padding: 24 }}>
      <Alert
        showIcon
        type="info"
        message="推荐与拉新只管理推荐关系、分享码和 VIP 转化"
        description="积分、成长值、等级、兑换和流水仍在“积分成长”页面管理；普通系统配置和 VIP 系统配置继续管理对应直推佣金比例。"
        style={{ marginBottom: 16 }}
      />

      {canReadGrowth || canReadBonus ? (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          {canReadGrowth ? (
            <>
              <Col xs={24} sm={12} xl={6}>
                <Card>
                  <Statistic
                    loading={dashboardQuery.isLoading}
                    title="成长账户总数"
                    value={dashboardQuery.data?.accountCount ?? 0}
                    prefix={<TeamOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={24} sm={12} xl={6}>
                <Card>
                  <Statistic
                    loading={dashboardQuery.isLoading}
                    title="待首单推荐奖励"
                    value={dashboardQuery.data?.pendingShareRewardCount ?? 0}
                    prefix={<NodeIndexOutlined />}
                  />
                </Card>
              </Col>
            </>
          ) : null}
          {canReadBonus ? (
            <>
              <Col xs={24} sm={12} xl={6}>
                <Card>
                  {vipStatsQuery.isLoading ? (
                    <Skeleton paragraph={false} active />
                  ) : (
                    <Statistic
                      title="VIP 用户"
                      value={vipStatsQuery.data?.totalVips ?? 0}
                      prefix={<CrownOutlined />}
                    />
                  )}
                </Card>
              </Col>
              <Col xs={24} sm={12} xl={6}>
                <Card>
                  {vipStatsQuery.isLoading ? (
                    <Skeleton paragraph={false} active />
                  ) : (
                    <Statistic
                      title="本月新增 VIP"
                      value={vipStatsQuery.data?.newThisMonth ?? 0}
                      prefix={<RiseOutlined />}
                    />
                  )}
                </Card>
              </Col>
            </>
          ) : null}
        </Row>
      ) : null}

      {canReadNormalShare || canReadBonus || canReadGrowth ? (
        <Tabs
          items={[
            canReadNormalShare ? {
            key: 'normal-relations',
            label: '普通推荐关系',
            children: (
              <Card>
                <Alert
                  showIcon
                  type="info"
                  message="普通推荐关系一旦绑定不能更换"
                  description="普通用户推荐新人注册后立即产生注册奖励；被推荐人首单确认收货后可继续发首单奖励。若被推荐人成为 VIP，系统会按推荐人当时身份决定是否转入 VIP 关系或解绑。"
                  style={{ marginBottom: 16 }}
                />
                <ProTable<AdminNormalShareBinding>
                  actionRef={shareActionRef}
                  rowKey="id"
                  columns={resizableTable.columns}
                  components={resizableTable.components}
                  request={async (params, sort) => {
                    const sortParams = getNormalShareSortParams(sort as Record<string, SortOrder | undefined>);
                    const res = await getNormalShareBindings({
                      page: params.current,
                      pageSize: params.pageSize,
                      keyword: params.keyword as string | undefined,
                      rewardStatus: params.rewardStatus as string | undefined,
                      sortField: sortParams.sortField,
                      sortOrder: sortParams.sortOrder,
                    });
                    return { data: res.items, total: res.total, success: true };
                  }}
                  pagination={{ defaultPageSize: 20, showSizeChanger: true }}
                  options={false}
                  search={{ labelWidth: 'auto' }}
                  scroll={{ x: resizableTable.tableWidth }}
                />
              </Card>
            ),
          } : null,
            canReadBonus ? {
            key: 'vip-codes',
            label: 'VIP 推荐码',
            children: (
              <Card>
                <Alert
                  showIcon
                  type="info"
                  message="VIP 推荐码仍由 VIP 会员体系生成和使用"
                  description="这里用于快速查看 VIP 推荐码、VIP 推荐人和直邀 VIP 情况；具体 VIP 树位置和奖励流水仍到 VIP 会员页查看。"
                  style={{ marginBottom: 16 }}
                />
                <ProTable<BonusMember>
                  actionRef={vipActionRef}
                  rowKey="id"
                  columns={vipResizableTable.columns}
                  components={vipResizableTable.components}
                  request={async (params, sort) => {
                    const sortParams = getBonusMemberSortParams(sort as Record<string, SortOrder | undefined>);
                    const res = await getMembers({
                      page: params.current,
                      pageSize: params.pageSize,
                      tier: 'VIP',
                      keyword: params.keyword ? String(params.keyword).trim() : undefined,
                      sortField: sortParams.sortField,
                      sortOrder: sortParams.sortOrder,
                    });
                    return { data: res.items, total: res.total, success: true };
                  }}
                  pagination={{ defaultPageSize: 20, showSizeChanger: true }}
                  options={false}
                  search={{ labelWidth: 'auto' }}
                  scroll={{ x: vipResizableTable.tableWidth }}
                />
              </Card>
            ),
          } : null,
            canReadGrowth ? {
            key: 'auto-vip-records',
            label: '自动升级 VIP',
            children: (
              <Card>
                <Alert
                  showIcon
                  type="info"
                  message="自动升级记录用于核查用户因累计消费达标成为 VIP"
                  description="这里只展示自动升级记录；用户主动购买 VIP 礼包仍在 VIP 会员详情和订单链路中查看。"
                  style={{ marginBottom: 16 }}
                />
                <ProTable<AdminGrowthLedger>
                  actionRef={autoVipActionRef}
                  rowKey="id"
                  columns={autoVipResizableTable.columns}
                  components={autoVipResizableTable.components}
                  request={async (params, sort) => {
                    const sortParams = getLedgerSortParams(sort as Record<string, SortOrder | undefined>);
                    const res = await getGrowthLedgers({
                      page: params.current,
                      pageSize: params.pageSize,
                      userId: params.userId as string | undefined,
                      behaviorCode: 'AUTO_VIP_UPGRADE',
                      sortBy: sortParams.sortBy,
                      sortOrder: sortParams.sortOrder,
                    });
                    return { data: res.items, total: res.total, success: true };
                  }}
                  pagination={{ defaultPageSize: 20, showSizeChanger: true }}
                  options={false}
                  search={{ labelWidth: 'auto' }}
                  scroll={{ x: autoVipResizableTable.tableWidth }}
                />
              </Card>
            ),
          } : null,
            canReadGrowth ? {
            key: 'auto-vip-settings',
            label: 'VIP 转化设置',
            forceRender: true,
            children: (
              <Card loading={settingsQuery.isLoading}>
                <Alert
                  showIcon
                  type="warning"
                  message="这里控制累计消费自动成为 VIP"
                  description="门槛只用于普通商品有效消费的自动升级，不改变用户主动购买 VIP 的原有流程。普通/VIP 直推佣金比例仍分别在普通系统配置和 VIP 系统配置里设置。"
                  style={{ marginBottom: 16 }}
                />
                <Form<AutoVipSettingsForm>
                  form={settingsForm}
                  layout="vertical"
                  onFinish={(values) => saveAutoVipSettingsMutation.mutate(values)}
                >
                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="autoVipBySpendEnabled"
                        label="累计消费自动成为 VIP"
                        valuePropName="checked"
                        extra="关闭后用户仍可主动购买 VIP。"
                      >
                        <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="autoVipCumulativeSpendThreshold"
                        label="自动成为 VIP 门槛（元）"
                        rules={[{ required: true }]}
                        extra="只统计普通商品有效消费，确认收货后入账。"
                      >
                        <InputNumber min={1} precision={2} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <PermissionGate permission={PERMISSIONS.GROWTH_MANAGE_RULES}>
                    <Button type="primary" htmlType="submit" loading={saveAutoVipSettingsMutation.isPending}>
                      保存设置
                    </Button>
                  </PermissionGate>
                </Form>
              </Card>
            ),
          } : null,
          ].filter(Boolean) as TabsProps['items']}
        />
      ) : (
        <Alert
          showIcon
          type="warning"
          message="暂无可查看的推荐与拉新模块"
          description="当前管理员缺少普通推荐、VIP 会员或积分成长的读取权限。"
        />
      )}
    </div>
  );
}
