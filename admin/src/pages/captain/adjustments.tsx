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
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CheckOutlined, CloseOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  approveAndApplyProfitAdjustment,
  formatProfitWorkflowError,
  getAdjustmentComponents,
  getCaptainIdFromSnapshot,
  getProfitAdjustment,
  getProfitAdjustments,
  getProfitSnapshotModel,
  rejectProfitAdjustment,
} from '@/api/profit-reconciliation';
import type {
  OrderProfitSnapshot,
  ProfitAdjustmentComponent,
  ProfitAdjustmentDraft,
  ProfitAdjustmentStatus,
} from '@/api/profit-reconciliation';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';

const { Text } = Typography;

const STATUS_META: Record<ProfitAdjustmentStatus, { text: string; color: string }> = {
  PENDING: { text: '待审批', color: 'gold' },
  APPLIED: { text: '已应用', color: 'green' },
  REJECTED: { text: '已驳回', color: 'red' },
  SUPERSEDED: { text: '已被替代', color: 'default' },
};

const KIND_META = {
  REWARD: { text: '会员奖励账户', color: 'blue' },
  CAPTAIN: { text: '团长账户', color: 'cyan' },
  FUNDING: { text: '平台利润资金', color: 'purple' },
} as const;

const FUNDING_LABELS: Record<string, string> = {
  PLATFORM_RETAINED_CREDIT: '平台留存利润',
  CAPTAIN_DIRECT_HOLD: '团长逐单奖励占用',
  CAPTAIN_MONTHLY_HOLD: '团长月度奖励占用',
  CAPTAIN_MONTHLY_RELEASE: '团长月度奖励释放',
  REFUND_ADJUSTMENT: '退款调整',
};

const centsMoney = (value?: number | null, showPlus = false) => {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  const amount = Number(value) / 100;
  const sign = showPlus && amount > 0 ? '+' : '';
  return `${sign}¥${amount.toFixed(2)}`;
};

const yuanMoney = (value?: number | null) =>
  value == null || !Number.isFinite(Number(value)) ? '-' : `¥${Number(value).toFixed(2)}`;

function StatusTag({ status }: { status: ProfitAdjustmentStatus }) {
  const meta = STATUS_META[status];
  return <Tag color={meta?.color ?? 'default'}>{meta?.text ?? status}</Tag>;
}

function ProfitModelTag({ snapshot }: { snapshot?: OrderProfitSnapshot | null }) {
  const isV3 = getProfitSnapshotModel(snapshot) === 'PROFIT_V3';
  return <Tag color={isV3 ? 'blue' : 'default'}>{isV3 ? '利润规则 V3' : '历史模型'}</Tag>;
}

const componentTarget = (component: ProfitAdjustmentComponent) => {
  if (component.kind === 'FUNDING') {
    return FUNDING_LABELS[component.fundingType ?? ''] ?? '平台利润资金项';
  }
  return component.userId
    ? `${component.userId} / ${component.accountType ?? '-'}`
    : `待创建 ${component.accountType ?? ''} 账户`;
};

const totalDelta = (draft: Pick<ProfitAdjustmentDraft, 'adjustments'>) =>
  getAdjustmentComponents(draft.adjustments).reduce((sum, component) => sum + component.deltaCents, 0);

export default function ProfitAdjustmentsPage() {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [selectedId, setSelectedId] = useState<string>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REJECT'>();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['profit-adjustment', selectedId],
    queryFn: () => getProfitAdjustment(selectedId!),
    enabled: Boolean(selectedId && drawerOpen),
  });
  const detail = detailQuery.data;
  const components = useMemo(() => getAdjustmentComponents(detail?.adjustments), [detail]);

  const openDetail = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['profit-adjustment'] });
    actionRef.current?.reload();
  };

  const openReview = (action: 'APPROVE' | 'REJECT') => {
    setNote('');
    setReviewAction(action);
  };

  const submitReview = async () => {
    if (!detail || !reviewAction) return;
    if (!note.trim()) {
      message.error(reviewAction === 'APPROVE' ? '请输入审批备注' : '请输入驳回备注');
      return;
    }
    setSubmitting(true);
    try {
      if (reviewAction === 'APPROVE') {
        await approveAndApplyProfitAdjustment(detail.id, note.trim());
        message.success('调整单已批准并原子应用');
      } else {
        await rejectProfitAdjustment(detail.id, note.trim());
        message.success('调整单已驳回');
      }
      setReviewAction(undefined);
      await refresh();
    } catch (error) {
      message.error({ content: formatProfitWorkflowError(error), duration: 8 });
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ProColumns<ProfitAdjustmentDraft>[] = [
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 110,
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
      render: (_, record) => getCaptainIdFromSnapshot(record.targetSnapshot) ?? '无团长归因',
    },
    {
      title: '模型',
      search: false,
      width: 125,
      render: (_, record) => <ProfitModelTag snapshot={record.targetSnapshot} />,
    },
    {
      title: '快照修订',
      search: false,
      width: 125,
      render: (_, record) => `R${record.sourceSnapshot?.revision ?? '?'} → R${record.targetSnapshot?.revision ?? '?'}`,
    },
    {
      title: '影响来源',
      search: false,
      width: 260,
      render: (_, record) => {
        const kinds = [...new Set(getAdjustmentComponents(record.adjustments).map((component) => component.kind))];
        return kinds.length > 0
          ? <Space size={[4, 4]} wrap>{kinds.map((kind) => <Tag key={kind} color={KIND_META[kind].color}>{KIND_META[kind].text}</Tag>)}</Space>
          : '-';
      },
    },
    {
      title: '调整项',
      search: false,
      width: 90,
      render: (_, record) => `${getAdjustmentComponents(record.adjustments).length} 项`,
    },
    {
      title: '净变动',
      search: false,
      width: 120,
      render: (_, record) => {
        const value = totalDelta(record);
        return <Text strong type={value < 0 ? 'danger' : value > 0 ? 'success' : undefined}>{centsMoney(value, true)}</Text>;
      },
    },
    {
      title: '替代关系',
      search: false,
      width: 130,
      render: (_, record) => record.supersededByDraftId ? <Tag>有后续调整单</Tag> : '-',
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
      width: 100,
      render: (_, record) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(record.id)}>
          详情
        </Button>
      ),
    },
  ];

  const componentColumns = [
    {
      title: '资金来源',
      dataIndex: 'kind',
      width: 130,
      render: (kind: ProfitAdjustmentComponent['kind']) => <Tag color={KIND_META[kind].color}>{KIND_META[kind].text}</Tag>,
    },
    {
      title: '账户 / 资金项',
      key: 'target',
      width: 260,
      render: (_: unknown, component: ProfitAdjustmentComponent) => (
        <Space direction="vertical" size={0}>
          <Text>{componentTarget(component)}</Text>
          <Text type="secondary">{component.bucket === 'frozen' ? '冻结余额' : component.bucket === 'balance' ? '可用余额' : component.sourceLedgerId ?? '新资金项'}</Text>
        </Space>
      ),
    },
    {
      title: 'Before',
      dataIndex: 'beforeCents',
      width: 120,
      align: 'right' as const,
      render: (beforeCents: number) => centsMoney(beforeCents),
    },
    {
      title: 'Target',
      dataIndex: 'targetCents',
      width: 120,
      align: 'right' as const,
      render: (targetCents: number) => centsMoney(targetCents),
    },
    {
      title: 'Delta',
      dataIndex: 'deltaCents',
      width: 125,
      align: 'right' as const,
      render: (deltaCents: number) => <Text strong type={deltaCents < 0 ? 'danger' : deltaCents > 0 ? 'success' : undefined}>{centsMoney(deltaCents, true)}</Text>,
    },
    { title: '来源流水', dataIndex: 'sourceLedgerId', width: 190, render: (value: string | null) => value ? <Text copyable>{value}</Text> : '新建' },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<ProfitAdjustmentDraft>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        request={async (params) => {
          try {
            const result = await getProfitAdjustments({
              status: params.status as ProfitAdjustmentStatus | undefined,
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
        headerTitle="利润调整单"
        scroll={{ x: 1490 }}
      />

      <Drawer
        title="利润调整单详情"
        width="min(1120px, 96vw)"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={detail?.status === 'PENDING' ? (
          <PermissionGate permission={PERMISSIONS.CAPTAIN_SETTLEMENT}>
            <Space>
              <Button icon={<CloseOutlined />} onClick={() => openReview('REJECT')}>驳回</Button>
              <Button type="primary" icon={<CheckOutlined />} onClick={() => openReview('APPROVE')}>批准并应用</Button>
            </Space>
          </PermissionGate>
        ) : null}
      >
        {detailQuery.isLoading ? <Text type="secondary">正在加载...</Text> : null}
        {detailQuery.error ? <Alert type="error" showIcon message={formatProfitWorkflowError(detailQuery.error)} /> : null}
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {detail.status === 'SUPERSEDED' ? (
              <Alert type="warning" showIcon message="该调整单已被退款后的新草稿替代，只能查看，不能批准。" />
            ) : null}
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
              <Descriptions.Item label="状态"><StatusTag status={detail.status} /></Descriptions.Item>
              <Descriptions.Item label="订单号"><Text copyable>{detail.orderId}</Text></Descriptions.Item>
              <Descriptions.Item label="模型"><ProfitModelTag snapshot={detail.targetSnapshot} /></Descriptions.Item>
              <Descriptions.Item label="直接团长">{getCaptainIdFromSnapshot(detail.targetSnapshot) ?? '无'}</Descriptions.Item>
              <Descriptions.Item label="源快照">R{detail.sourceSnapshot?.revision ?? '?'} / {yuanMoney(detail.sourceSnapshot?.distributableProfitAmount)}</Descriptions.Item>
              <Descriptions.Item label="目标快照">R{detail.targetSnapshot?.revision ?? '?'} / {yuanMoney(detail.targetSnapshot?.distributableProfitAmount)}</Descriptions.Item>
              <Descriptions.Item label="净变动"><Text strong>{centsMoney(totalDelta(detail), true)}</Text></Descriptions.Item>
              <Descriptions.Item label="审核人">{detail.reviewedByAdminId || '-'}</Descriptions.Item>
              <Descriptions.Item label="审核时间">{detail.reviewedAt ? dayjs(detail.reviewedAt).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
              <Descriptions.Item label="审核备注">{detail.reviewNote || '-'}</Descriptions.Item>
            </Descriptions>

            <Divider orientation="left" style={{ marginBlock: 4 }}>Before / Target / Delta</Divider>
            <Table<ProfitAdjustmentComponent>
              rowKey="key"
              size="small"
              pagination={false}
              scroll={{ x: 980 }}
              columns={componentColumns}
              dataSource={components}
              summary={(rows) => {
                const before = rows.reduce((sum, row) => sum + row.beforeCents, 0);
                const target = rows.reduce((sum, row) => sum + row.targetCents, 0);
                const delta = rows.reduce((sum, row) => sum + row.deltaCents, 0);
                return (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={2}><Text strong>合计</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">{centsMoney(before)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">{centsMoney(target)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right"><Text strong>{centsMoney(delta, true)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={5} />
                  </Table.Summary.Row>
                );
              }}
            />

            <Divider orientation="left" style={{ marginBlock: 4 }}>Replacement chain</Divider>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              columns={[
                { title: '调整单', dataIndex: 'id', render: (value: string) => value === detail.id ? <Text strong copyable>{value}</Text> : <Text copyable>{value}</Text> },
                { title: '状态', dataIndex: 'status', width: 110, render: (value: ProfitAdjustmentStatus) => <StatusTag status={value} /> },
                { title: '调整项', dataIndex: 'adjustments', width: 90, render: (value: unknown) => `${getAdjustmentComponents(value).length} 项` },
                { title: '净变动', dataIndex: 'adjustments', width: 120, render: (value: unknown) => centsMoney(getAdjustmentComponents(value).reduce((sum, row) => sum + row.deltaCents, 0), true) },
                { title: '后续草稿', dataIndex: 'supersededByDraftId', render: (value: string | null) => value || '-' },
                { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm') },
              ]}
              dataSource={detail.replacementChain ?? []}
            />
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title={reviewAction === 'APPROVE' ? '批准并应用利润调整单' : '驳回利润调整单'}
        open={Boolean(reviewAction)}
        confirmLoading={submitting}
        okText={reviewAction === 'APPROVE' ? '批准并原子应用' : '确认驳回'}
        okButtonProps={{ danger: reviewAction === 'REJECT' }}
        onOk={submitReview}
        onCancel={() => setReviewAction(undefined)}
      >
        {reviewAction === 'APPROVE' ? (
          <Alert
            type="warning"
            showIcon
            message="批准后，全部奖励账户、团长账户和平台资金差额会在一个事务中应用；此操作不可撤销。"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form layout="vertical">
          <Form.Item required label={reviewAction === 'APPROVE' ? '审批备注' : '驳回备注'}>
            <Input.TextArea
              value={note}
              maxLength={500}
              showCount
              rows={4}
              placeholder={reviewAction === 'APPROVE' ? '记录复核依据和资金调整结论' : '记录驳回原因和后续处理要求'}
              onChange={(event) => setNote(event.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
