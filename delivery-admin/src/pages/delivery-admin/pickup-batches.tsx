import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { App as AntdApp, Button, Form, Input, InputNumber, Modal, Space, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import type { ColumnsType } from 'antd/es/table';
import {
  adjustDeliveryPickupCost,
  cancelDeliveryCarrier,
  downloadDeliveryPickupWaybill,
  getDeliveryPickupBatches,
  reprintDeliveryPickupWaybill,
  syncDeliveryCarrier,
} from '@/api/delivery-management';
import type { DeliveryPickupBatch, DeliveryPickupBatchItem, JsonValue } from '@/types/delivery-management';
import { PageHeader } from './components';
import { downloadBlob, formatDateTime, formatMoney, getErrorMessage } from './utils';
import useAuthStore from '@/store/useAuthStore';

const { Text } = Typography;

const pickupBatchStatusOptions = [
  'PLANNED',
  'READY_TO_CALL',
  'CALLING_CARRIER',
  'WAITING_DRIVER',
  'DRIVER_ASSIGNED',
  'ARRIVED',
  'LOADED',
  'DELIVERING',
  'COMPLETED',
  'CANCELED',
  'EXCEPTION',
];

const pickupBatchStatusText: Record<string, string> = {
  PLANNED: '已计划',
  READY_TO_CALL: '待顺丰发货',
  CALLING_CARRIER: '顺丰下单中',
  WAITING_DRIVER: '待顺丰揽收',
  DRIVER_ASSIGNED: '顺丰已接单',
  ARRIVED: '快递员已到达',
  LOADED: '顺丰已揽收',
  DELIVERING: '运输中',
  COMPLETED: '已签收',
  CANCELED: '已取消',
  EXCEPTION: '异常',
};

const statusColor: Record<string, string> = {
  PLANNED: 'default',
  READY_TO_CALL: 'processing',
  CALLING_CARRIER: 'processing',
  WAITING_DRIVER: 'processing',
  DRIVER_ASSIGNED: 'blue',
  ARRIVED: 'cyan',
  LOADED: 'purple',
  DELIVERING: 'geekblue',
  COMPLETED: 'success',
  CANCELED: 'default',
  EXCEPTION: 'error',
};

type PickupBatchFilters = {
  keyword?: string;
  status?: string;
  merchantId?: string;
  unitId?: string;
  createdRange?: string[];
};

type CancelFormValues = {
  reason: string;
};

type AdjustFormValues = {
  amountCents: number;
  remark: string;
};

type BatchActionInput =
  | { type: 'sync'; batch: DeliveryPickupBatch }
  | { type: 'reprint'; batch: DeliveryPickupBatch }
  | { type: 'cancel'; batch: DeliveryPickupBatch; reason: string }
  | { type: 'adjust'; batch: DeliveryPickupBatch; amountCents: number; remark: string };

function pickupBatchValueEnum() {
  return Object.fromEntries(
    pickupBatchStatusOptions.map((status) => [status, { text: pickupBatchStatusText[status] }]),
  );
}

function PickupBatchStatusTag({ value }: { value?: string | null }) {
  if (!value) {
    return <Tag>-</Tag>;
  }
  return <Tag color={statusColor[value] ?? 'default'}>{pickupBatchStatusText[value] ?? value}</Tag>;
}

function asRecord(value: JsonValue | unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function formatItemTitle(item: DeliveryPickupBatchItem) {
  const snapshot = asRecord(item.productSnapshot);
  const productTitle =
    item.productTitle ||
    asString(snapshot.productTitle) ||
    asString(snapshot.title) ||
    item.skuId;
  const skuTitle = item.skuTitle || asString(snapshot.skuTitle);
  return skuTitle ? `${productTitle} / ${skuTitle}` : productTitle;
}

function formatUnitName(item: DeliveryPickupBatchItem) {
  const snapshot = asRecord(item.productSnapshot);
  return item.unitName || asString(snapshot.unitName) || '件';
}

function formatDiff(cents?: number | null) {
  if (cents === null || cents === undefined) {
    return '-';
  }
  const type = cents > 0 ? 'success' : cents < 0 ? 'danger' : undefined;
  return <Text type={type}>{formatMoney(cents)}</Text>;
}

function normalizeFilters(params: PickupBatchFilters & { current?: number; pageSize?: number }) {
  return {
    page: params.current,
    pageSize: params.pageSize,
    keyword: typeof params.keyword === 'string' ? params.keyword.trim() : undefined,
    status: typeof params.status === 'string' ? params.status : undefined,
    merchantId: typeof params.merchantId === 'string' ? params.merchantId.trim() : undefined,
    unitId: typeof params.unitId === 'string' ? params.unitId.trim() : undefined,
    from: Array.isArray(params.createdRange) ? params.createdRange[0] : undefined,
    to: Array.isArray(params.createdRange) ? params.createdRange[1] : undefined,
  };
}

function canCancel(batch: DeliveryPickupBatch) {
  return Boolean(batch.latestCarrierOrder?.carrierOrderNo)
    && !['LOADED', 'DELIVERING', 'COMPLETED', 'CANCELED'].includes(batch.status);
}

const itemColumns: ColumnsType<DeliveryPickupBatchItem> = [
  {
    title: '商品 / 规格',
    key: 'title',
    width: 260,
    render: (_, record) => formatItemTitle(record),
  },
  { title: 'SKU', dataIndex: 'skuId', key: 'skuId', width: 170, ellipsis: true },
  {
    title: '计划配送',
    key: 'quantity',
    width: 120,
    render: (_, record) => `${record.quantity}${formatUnitName(record)}`,
  },
  {
    title: '已配送',
    key: 'pickedQuantity',
    width: 120,
    render: (_, record) => `${record.pickedQuantity}${formatUnitName(record)}`,
  },
  { title: '订单明细', dataIndex: 'orderItemId', key: 'orderItemId', width: 170, ellipsis: true },
];

export default function DeliveryPickupBatchesPage() {
  const { message } = AntdApp.useApp();
  const canWrite = useAuthStore((state) => state.hasPermission('delivery:orders:write'));
  const actionRef = useRef<ActionType | undefined>(undefined);
  const [canceling, setCanceling] = useState<DeliveryPickupBatch | null>(null);
  const [adjusting, setAdjusting] = useState<DeliveryPickupBatch | null>(null);
  const [cancelForm] = Form.useForm<CancelFormValues>();
  const [adjustForm] = Form.useForm<AdjustFormValues>();

  const batchMutation = useMutation({
    mutationFn: async (input: BatchActionInput) => {
      if (input.type === 'sync') {
        return syncDeliveryCarrier(input.batch.id);
      }
      if (input.type === 'reprint') {
        const updated = await reprintDeliveryPickupWaybill(input.batch.id);
        const file = await downloadDeliveryPickupWaybill(input.batch.id);
        downloadBlob(file, `顺丰面单-${input.batch.id}.pdf`);
        return updated;
      }
      if (input.type === 'cancel') {
        return cancelDeliveryCarrier(input.batch.id, input.reason);
      }
      return adjustDeliveryPickupCost(input.batch.id, {
        amountCents: input.amountCents,
        remark: input.remark,
      });
    },
    onSuccess: (_, input) => {
      const successText = {
        sync: '顺丰状态已同步',
        reprint: '顺丰面单已重新生成',
        cancel: '顺丰运单已取消，批次可重新发货',
        adjust: '配送成本已调整',
      }[input.type];
      message.success(successText);
      setCanceling(null);
      setAdjusting(null);
      cancelForm.resetFields();
      adjustForm.resetFields();
      actionRef.current?.reload();
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const columns: ProColumns<DeliveryPickupBatch>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '订单、批次、子单、商家或运单号' },
    },
    {
      title: '订单 / 子单',
      key: 'order',
      width: 240,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text copyable={{ text: record.orderId }}>{record.orderId}</Text>
          <Text type="secondary" copyable={{ text: record.subOrderId }}>子单 {record.subOrderId}</Text>
          <Tag>第 {record.batchNo} 批</Tag>
        </Space>
      ),
      search: false,
    },
    {
      title: '批次状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      valueEnum: pickupBatchValueEnum(),
      render: (_, record) => <PickupBatchStatusTag value={record.status} />,
    },
    {
      title: '商家编号',
      dataIndex: 'merchantId',
      hideInTable: true,
      fieldProps: { placeholder: '输入商家编号' },
    },
    {
      title: '单位编号',
      dataIndex: 'unitId',
      hideInTable: true,
      fieldProps: { placeholder: '输入单位编号' },
    },
    {
      title: '创建时间',
      dataIndex: 'createdRange',
      hideInTable: true,
      valueType: 'dateRange',
    },
    {
      title: '商家',
      key: 'merchant',
      width: 180,
      render: (_, record) => record.merchantName || record.merchant?.name || record.merchantId,
      search: false,
    },
    {
      title: '配送商品',
      key: 'items',
      width: 260,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          {record.items.slice(0, 2).map((item) => (
            <Text key={item.id} ellipsis style={{ maxWidth: 240 }}>
              {formatItemTitle(item)} x {item.quantity}{formatUnitName(item)}
            </Text>
          ))}
          {record.items.length > 2 ? <Text type="secondary">另 {record.items.length - 2} 项</Text> : null}
        </Space>
      ),
      search: false,
    },
    {
      title: '计划配送',
      dataIndex: 'plannedPickupAt',
      key: 'plannedPickupAt',
      width: 150,
      render: (_, record) => formatDateTime(record.plannedPickupAt),
      search: false,
    },
    {
      title: '顺丰产品 / 运单',
      key: 'carrier',
      width: 230,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <span>{record.latestCarrierOrder?.expressTypeName ?? '顺丰速运'}</span>
          {(record.latestCarrierOrder?.waybills ?? []).map((waybill) => (
            <Text key={waybill.trackingNo} copyable={{ text: waybill.trackingNo }} type="secondary">
              {waybill.trackingNo} · {waybill.status}
            </Text>
          ))}
          {record.latestCarrierOrder?.status ? (
            <Text type="secondary">{record.latestCarrierOrder.status}</Text>
          ) : null}
        </Space>
      ),
      search: false,
    },
    {
      title: '成本',
      key: 'cost',
      width: 190,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <span>预收 {formatMoney(record.prepaidPickupShippingFeeCents ?? record.estimatedShippingFeeCents)}</span>
          <span>实际 {formatMoney(record.actualCarrierCostCents)}</span>
          <span>差额 {formatDiff(record.shippingCostDiffCents)}</span>
        </Space>
      ),
      search: false,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 150,
      render: (_, record) => formatDateTime(record.updatedAt),
      search: false,
    },
    {
      title: '操作',
      key: 'action',
      width: 230,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0} wrap>
          <Button
            type="link"
            size="small"
            disabled={!canWrite || !record.latestCarrierOrder}
            loading={batchMutation.isPending}
            onClick={() => batchMutation.mutate({ type: 'sync', batch: record })}
          >
            同步
          </Button>
          <Button
            type="link"
            size="small"
            disabled={!canWrite || !record.latestCarrierOrder?.carrierOrderNo}
            loading={batchMutation.isPending}
            onClick={() => batchMutation.mutate({ type: 'reprint', batch: record })}
          >
            重打面单
          </Button>
          <Button
            type="link"
            danger
            size="small"
            disabled={!canWrite || !canCancel(record)}
            loading={batchMutation.isPending}
            onClick={() => {
              setCanceling(record);
              cancelForm.resetFields();
            }}
          >
            取消
          </Button>
          <Button
            type="link"
            size="small"
            disabled={!canWrite}
            loading={batchMutation.isPending}
            onClick={() => {
              setAdjusting(record);
              adjustForm.resetFields();
            }}
          >
            调整成本
          </Button>
        </Space>
      ),
      search: false,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送批次"
        subtitle="配送中心创建顺丰运单；平台在此同步轨迹、重打或取消面单、处理异常并核对实际成本。"
      />

      <ProTable<DeliveryPickupBatch, PickupBatchFilters>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const result = await getDeliveryPickupBatches(normalizeFilters(params));
          return {
            data: result.items,
            success: true,
            total: result.total,
          };
        }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={{ labelWidth: 84 }}
        scroll={{ x: 1980 }}
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>
            刷新
          </Button>,
        ]}
        expandable={{
          expandedRowRender: (record) => (
            <Table<DeliveryPickupBatchItem>
              rowKey="id"
              size="small"
              pagination={false}
              columns={itemColumns}
              dataSource={record.items}
              scroll={{ x: 840 }}
            />
          ),
        }}
      />

      <Modal
        forceRender
        open={Boolean(canceling)}
        title="取消顺丰运单"
        okText="确认取消"
        okButtonProps={{ danger: true }}
        confirmLoading={batchMutation.isPending}
        onCancel={() => setCanceling(null)}
        onOk={async () => {
          const values = await cancelForm.validateFields();
          if (canceling) {
            batchMutation.mutate({ type: 'cancel', batch: canceling, reason: values.reason });
          }
        }}
      >
        <Form form={cancelForm} layout="vertical">
          <Form.Item label="批次号">
            <Input value={canceling?.id} readOnly />
          </Form.Item>
          <Form.Item
            label="取消原因"
            name="reason"
            rules={[{ required: true, message: '请输入取消原因' }]}
          >
            <Input.TextArea rows={3} maxLength={200} placeholder="请说明取消顺丰运单的原因；取消成功后配送中心可重新发货" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        forceRender
        open={Boolean(adjusting)}
        title="调整配送成本"
        okText="确认调整"
        confirmLoading={batchMutation.isPending}
        onCancel={() => setAdjusting(null)}
        onOk={async () => {
          const values = await adjustForm.validateFields();
          if (adjusting) {
            batchMutation.mutate({
              type: 'adjust',
              batch: adjusting,
              amountCents: values.amountCents,
              remark: values.remark,
            });
          }
        }}
      >
        <Form form={adjustForm} layout="vertical">
          <Form.Item label="当前实际成本">
            <Input value={formatMoney(adjusting?.actualCarrierCostCents)} readOnly />
          </Form.Item>
          <Form.Item
            label="调整金额（分，可正可负）"
            name="amountCents"
            rules={[
              { required: true, message: '请输入调整金额，单位为分' },
              {
                validator: (_, value) => (
                  Number.isSafeInteger(value) && value !== 0
                    ? Promise.resolve()
                    : Promise.reject(new Error('调整金额必须是非零整数分'))
                ),
              },
            ]}
          >
            <InputNumber precision={0} style={{ width: '100%' }} placeholder="例如 120 或 -80" />
          </Form.Item>
          <Form.Item
            label="调整备注"
            name="remark"
            rules={[{ required: true, message: '请输入调整备注' }]}
          >
            <Input.TextArea rows={3} maxLength={300} placeholder="说明人工调增或调减成本的原因" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
