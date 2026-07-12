import { useMemo, useRef, useState } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CheckOutlined, CloseOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  formatProfitWorkflowError,
  getCaptainIdFromSnapshot,
  getProfitReconciliation,
  getProfitReconciliations,
  getProfitSnapshotModel,
  recalculateProfit,
  rejectProfitReconciliation,
} from '@/api/profit-reconciliation';
import type {
  OrderProfitSnapshot,
  ProfitOrderItem,
  ProfitReconciliationStatus,
  ProfitReconciliationTask,
} from '@/api/profit-reconciliation';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';

const { Text } = Typography;

const STATUS_META: Record<ProfitReconciliationStatus, { text: string; color: string }> = {
  PENDING: { text: '待纠错', color: 'gold' },
  RESOLVED: { text: '已解决', color: 'green' },
  REJECTED: { text: '已驳回', color: 'red' },
};

const ERROR_LABELS: Record<string, string> = {
  ORDER_PROFIT_COST_MISSING: '商品成本缺失',
  ORDER_PROFIT_CONSERVATION_FAILED: '利润守恒校验失败',
};

const getErrorLabel = (errorCode: string) => ERROR_LABELS[errorCode] ?? '利润核算异常，请联系平台管理员';

const money = (value?: number | null) =>
  value == null || !Number.isFinite(Number(value)) ? '-' : `¥${Number(value).toFixed(2)}`;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const itemName = (item: ProfitOrderItem) => {
  const snapshot = asRecord(item.productSnapshot);
  for (const key of ['productName', 'name', 'title']) {
    if (typeof snapshot?.[key] === 'string' && snapshot[key]) return snapshot[key] as string;
  }
  return item.skuId;
};

const missingCostIds = (snapshot?: OrderProfitSnapshot | null) => {
  const meta = asRecord(snapshot?.errorMeta);
  return Array.isArray(meta?.orderItemIds)
    ? meta.orderItemIds.filter((id): id is string => typeof id === 'string')
    : [];
};

function StatusTag({ status }: { status: ProfitReconciliationStatus }) {
  const meta = STATUS_META[status];
  return <Tag color={meta?.color ?? 'default'}>{meta?.text ?? status}</Tag>;
}

function ProfitModelTag({ snapshot }: { snapshot?: OrderProfitSnapshot | null }) {
  const isV3 = getProfitSnapshotModel(snapshot) === 'PROFIT_V3';
  return <Tag color={isV3 ? 'blue' : 'default'}>{isV3 ? '利润规则 V3' : '历史模型'}</Tag>;
}

function SnapshotDescriptions({ snapshot }: { snapshot?: OrderProfitSnapshot | null }) {
  if (!snapshot) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无目标快照" />;
  return (
    <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
      <Descriptions.Item label="修订版本">
        <Space size={4}>
          <Text strong>R{snapshot.revision}</Text>
          <ProfitModelTag snapshot={snapshot} />
          {snapshot.isCurrent ? <Tag color="green">当前</Tag> : null}
        </Space>
      </Descriptions.Item>
      <Descriptions.Item label="快照状态">{snapshot.status}</Descriptions.Item>
      <Descriptions.Item label="计算版本">{snapshot.calculationVersion || '-'}</Descriptions.Item>
      <Descriptions.Item label="商品原价">{money(snapshot.grossGoodsAmount)}</Descriptions.Item>
      <Descriptions.Item label="优惠后收入">{money(snapshot.netGoodsRevenue)}</Descriptions.Item>
      <Descriptions.Item label="商品成本">{money(snapshot.productCostAmount)}</Descriptions.Item>
      <Descriptions.Item label="可分润利润 D">
        <Text strong>{money(snapshot.distributableProfitAmount)}</Text>
      </Descriptions.Item>
      <Descriptions.Item label="团长利润 C">{money(snapshot.captainEligibleProfitAmount)}</Descriptions.Item>
      <Descriptions.Item label="VIP 折扣">{money(snapshot.vipDiscountAmount)}</Descriptions.Item>
      <Descriptions.Item label="平台红包">{money(snapshot.couponDiscountAmount)}</Descriptions.Item>
      <Descriptions.Item label="消费积分">{money(snapshot.rewardDeductionAmount)}</Descriptions.Item>
      <Descriptions.Item label="其他商品优惠">{money(snapshot.otherGoodsDiscountAmount)}</Descriptions.Item>
    </Descriptions>
  );
}

export default function ProfitReconciliationsPage() {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [selectedId, setSelectedId] = useState<string>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [costs, setCosts] = useState<Record<string, number | null>>({});
  const [submitting, setSubmitting] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['profit-reconciliation', selectedId],
    queryFn: () => getProfitReconciliation(selectedId!),
    enabled: Boolean(selectedId && drawerOpen),
  });
  const detail = detailQuery.data;
  const nonPrizeItems = useMemo(
    () => detail?.order?.items?.filter((item) => !item.isPrize) ?? [],
    [detail],
  );

  const openDetail = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };

  const openCorrection = () => {
    if (!detail) return;
    const breakdown = Array.isArray(detail.sourceSnapshot.itemBreakdown)
      ? detail.sourceSnapshot.itemBreakdown
      : [];
    const unitCostByItem = new Map(
      breakdown.map((row) => [row.orderItemId, row.unitCostCents > 0 ? row.unitCostCents / 100 : null]),
    );
    setCosts(Object.fromEntries(nonPrizeItems.map((item) => [item.id, unitCostByItem.get(item.id) ?? null])));
    setReason('');
    setCorrectionOpen(true);
  };

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['profit-reconciliation'] });
    actionRef.current?.reload();
  };

  const submitCorrection = async () => {
    if (!detail) return;
    const costCorrections = nonPrizeItems.map((item) => {
      const yuan = costs[item.id];
      const unitCostCents = typeof yuan === 'number' ? Math.round(yuan * 100) : 0;
      return { orderItemId: item.id, unitCostCents };
    });
    if (!reason.trim()) {
      message.error('请输入纠错原因');
      return;
    }
    if (
      costCorrections.length === 0
      || costCorrections.some(({ unitCostCents }) => !Number.isSafeInteger(unitCostCents) || unitCostCents <= 0)
    ) {
      message.error('必须为每个非奖品订单项填写大于 0 的成本，最多保留两位小数');
      return;
    }
    setSubmitting(true);
    try {
      const result = await recalculateProfit(detail.id, {
        reason: reason.trim(),
        costCorrections,
      });
      message.success(result.adjustmentDraft ? '利润快照已修订，已生成待审核调整单' : '利润快照已修订，归因已自动恢复');
      setCorrectionOpen(false);
      await refresh();
    } catch (error) {
      message.error({ content: formatProfitWorkflowError(error), duration: 8 });
    } finally {
      setSubmitting(false);
    }
  };

  const submitReject = async () => {
    if (!detail) return;
    if (!reason.trim()) {
      message.error('请输入驳回备注');
      return;
    }
    setSubmitting(true);
    try {
      await rejectProfitReconciliation(detail.id, reason.trim());
      message.success('利润纠错任务已驳回');
      setRejectOpen(false);
      await refresh();
    } catch (error) {
      message.error({ content: formatProfitWorkflowError(error), duration: 8 });
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ProColumns<ProfitReconciliationTask>[] = [
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 105,
      initialValue: 'PENDING',
      valueEnum: Object.fromEntries(Object.entries(STATUS_META).map(([key, value]) => [key, { text: value.text }])),
      render: (_, record) => <StatusTag status={record.status} />,
    },
    {
      title: '订单 / 买家',
      search: false,
      width: 210,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text copyable>{record.orderId}</Text>
          <Text type="secondary">{record.order?.userId ?? '-'}</Text>
        </Space>
      ),
    },
    {
      title: '月份',
      search: false,
      width: 100,
      render: (_, record) => record.order?.paidAt ? dayjs(record.order.paidAt).format('YYYY-MM') : '-',
    },
    {
      title: '直接团长',
      search: false,
      width: 180,
      render: (_, record) => getCaptainIdFromSnapshot(record.sourceSnapshot) ?? '无团长归因',
    },
    {
      title: '模型',
      search: false,
      width: 125,
      render: (_, record) => <ProfitModelTag snapshot={record.resolvedSnapshot ?? record.sourceSnapshot} />,
    },
    {
      title: '错误 / 缺失成本',
      search: false,
      width: 240,
      render: (_, record) => {
        const missing = missingCostIds(record.sourceSnapshot);
        return (
          <Space direction="vertical" size={2}>
            <Text>{getErrorLabel(record.errorCode)}</Text>
            {missing.length > 0 ? <Text type="danger">缺失 {missing.length} 个订单项成本</Text> : null}
          </Space>
        );
      },
    },
    {
      title: '修订链',
      search: false,
      width: 120,
      render: (_, record) => record.resolvedSnapshot
        ? `R${record.sourceSnapshot.revision} → R${record.resolvedSnapshot.revision}`
        : `R${record.sourceSnapshot.revision} 待处理`,
    },
    {
      title: '资金影响',
      search: false,
      width: 130,
      render: (_, record) => record.status === 'PENDING'
        ? <Tag>处理后判定</Tag>
        : <Button type="link" size="small" onClick={() => openDetail(record.id)}>查看详情</Button>,
    },
    {
      title: '创建时间',
      search: false,
      width: 165,
      render: (_, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      valueType: 'option',
      fixed: 'right',
      width: 110,
      render: (_, record) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(record.id)}>
          详情
        </Button>
      ),
    },
  ];

  const orderItemColumns = [
    { title: '商品 / SKU', key: 'name', render: (_: unknown, item: ProfitOrderItem) => <Space direction="vertical" size={0}><Text>{itemName(item)}</Text><Text type="secondary">{item.skuId}</Text></Space> },
    { title: '数量', dataIndex: 'quantity', width: 70 },
    { title: '成交单价', dataIndex: 'unitPrice', width: 110, render: (value: number) => money(value) },
    { title: '类型', dataIndex: 'isPrize', width: 90, render: (value: boolean) => value ? <Tag>奖品</Tag> : <Tag color="blue">普通商品</Tag> },
    { title: '成本状态', key: 'cost', width: 130, render: (_: unknown, item: ProfitOrderItem) => missingCostIds(detail?.sourceSnapshot).includes(item.id) ? <Tag color="red">缺失</Tag> : <Tag color="green">已记录</Tag> },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<ProfitReconciliationTask>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        request={async (params) => {
          try {
            const result = await getProfitReconciliations({
              status: params.status as ProfitReconciliationStatus | undefined,
              page: params.current,
              pageSize: params.pageSize,
            });
            return { data: result.items, total: result.total, success: true };
          } catch (error) {
            message.error(formatProfitWorkflowError(error));
            return { data: [], total: 0, success: false };
          }
        }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        options={false}
        headerTitle="利润纠错"
        scroll={{ x: 1530 }}
      />

      <Drawer
        title="利润纠错详情"
        width="min(1040px, 96vw)"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={detail?.status === 'PENDING' ? (
          <Space>
            <PermissionGate permission={PERMISSIONS.CAPTAIN_MANAGE}>
              <Button icon={<CloseOutlined />} onClick={() => { setReason(''); setRejectOpen(true); }}>驳回</Button>
              <Button type="primary" icon={<EditOutlined />} onClick={openCorrection}>修正成本并重算</Button>
            </PermissionGate>
          </Space>
        ) : null}
      >
        {detailQuery.isLoading ? <Text type="secondary">正在加载...</Text> : null}
        {detailQuery.error ? <Alert type="error" showIcon message={formatProfitWorkflowError(detailQuery.error)} /> : null}
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
              <Descriptions.Item label="任务状态"><StatusTag status={detail.status} /></Descriptions.Item>
              <Descriptions.Item label="订单号"><Text copyable>{detail.orderId}</Text></Descriptions.Item>
              <Descriptions.Item label="付款月份">{detail.order?.paidAt ? dayjs(detail.order.paidAt).format('YYYY-MM') : '-'}</Descriptions.Item>
              <Descriptions.Item label="错误类型">{getErrorLabel(detail.errorCode)}</Descriptions.Item>
              <Descriptions.Item label="直接团长">{getCaptainIdFromSnapshot(detail.sourceSnapshot) ?? '无'}</Descriptions.Item>
              <Descriptions.Item label="处理备注">{detail.resolutionNote || '-'}</Descriptions.Item>
            </Descriptions>

            <Divider orientation="left" style={{ marginBlock: 4 }}>利润快照修订链</Divider>
            <SnapshotDescriptions snapshot={detail.sourceSnapshot} />
            {detail.resolvedSnapshot ? (
              <>
                <div style={{ textAlign: 'center' }}><Tag icon={<CheckOutlined />} color="green">不可变修订 R{detail.sourceSnapshot.revision} → R{detail.resolvedSnapshot.revision}</Tag></div>
                <SnapshotDescriptions snapshot={detail.resolvedSnapshot} />
              </>
            ) : null}

            <Divider orientation="left" style={{ marginBlock: 4 }}>订单项</Divider>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ x: 760 }}
              columns={orderItemColumns}
              dataSource={detail.order?.items ?? []}
            />

            <Divider orientation="left" style={{ marginBlock: 4 }}>资金处理</Divider>
            {detail.adjustmentDrafts?.length ? (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                columns={[
                  { title: '调整单', dataIndex: 'id', render: (value: string) => <Text copyable>{value}</Text> },
                  { title: '状态', dataIndex: 'status', width: 110, render: (value: string) => <Tag>{value}</Tag> },
                  { title: '目标修订', dataIndex: 'targetSnapshotId', render: (value: string) => value || '-' },
                  { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm') },
                ]}
                dataSource={detail.adjustmentDrafts}
              />
            ) : (
              <Alert type="info" showIcon message={detail.status === 'RESOLVED' ? '未生成资金调整单，归因已按新快照自动恢复。' : '纠错完成后，系统会根据是否已产生资金决定自动恢复归因或生成调整单。'} />
            )}
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title="修正全部非奖品商品成本"
        width={720}
        open={correctionOpen}
        confirmLoading={submitting}
        okText="创建不可变修订"
        onOk={submitCorrection}
        onCancel={() => setCorrectionOpen(false)}
      >
        <Alert
          type="warning"
          showIcon
          message="必须填写本订单全部非奖品订单项的单位成本。提交后保留原快照，并创建下一修订版本。"
          style={{ marginBottom: 16 }}
        />
        <Form layout="vertical">
          {nonPrizeItems.filter((item) => !item.isPrize).map((item) => (
            <Form.Item key={item.id} required label={`${itemName(item)} × ${item.quantity}`} extra={`订单项 ${item.id}；成交单价 ${money(item.unitPrice)}`}>
              <InputNumber
                min={0.01}
                precision={2}
                step={0.01}
                addonAfter="元 / 件"
                value={costs[item.id]}
                onChange={(value) => setCosts((current) => ({ ...current, [item.id]: value }))}
                style={{ width: '100%' }}
              />
            </Form.Item>
          ))}
          <Form.Item required label="纠错原因">
            <Input.TextArea
              value={reason}
              maxLength={500}
              showCount
              rows={4}
              placeholder="说明成本来源、原数据问题和本次修订依据"
              onChange={(event) => setReason(event.target.value)}
            />
          </Form.Item>
        </Form>
        <Text type="secondary">金额提交单位为分，例如 ¥12.34 将提交为 1234 分。</Text>
      </Modal>

      <Modal
        title="驳回利润纠错任务"
        open={rejectOpen}
        confirmLoading={submitting}
        okButtonProps={{ danger: true }}
        okText="确认驳回"
        onOk={submitReject}
        onCancel={() => setRejectOpen(false)}
      >
        <Form layout="vertical">
          <Form.Item required label="驳回备注">
            <Input.TextArea value={reason} maxLength={500} showCount rows={4} onChange={(event) => setReason(event.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
