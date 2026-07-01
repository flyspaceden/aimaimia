import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { App as AntdApp, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Space, Statistic, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Link } from 'react-router-dom';
import {
  adjustDeliveryPickupCost,
  cancelDeliveryCarrier,
  getDeliveryFreightBatches,
  getDeliveryFreightDashboard,
  syncDeliveryCarrier,
} from '@/api/delivery-management';
import type { DeliveryFreightDashboard, DeliveryPickupBatch, JsonValue } from '@/types/delivery-management';
import { PageHeader } from './components';
import { formatDateTime, formatMoney, getErrorMessage } from './utils';

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
  READY_TO_CALL: '待叫车',
  CALLING_CARRIER: '叫车中',
  WAITING_DRIVER: '待接单',
  DRIVER_ASSIGNED: '司机已接单',
  ARRIVED: '司机已到达',
  LOADED: '已装车',
  DELIVERING: '配送中',
  COMPLETED: '已完成',
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

type FreightFilters = {
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

function formatDriver(snapshot?: JsonValue | null) {
  const record = asRecord(snapshot);
  const name =
    asString(record.name) ||
    asString(record.driverName) ||
    asString(record.driver_name);
  const phone =
    asString(record.phone) ||
    asString(record.mobile) ||
    asString(record.driverPhone) ||
    asString(record.driver_phone);
  if (name && phone) {
    return `${name} / ${phone}`;
  }
  return name || phone || '-';
}

function formatVehicle(snapshot?: JsonValue | null) {
  const record = asRecord(snapshot);
  const plate =
    asString(record.plateNo) ||
    asString(record.vehicleNo) ||
    asString(record.carNo) ||
    asString(record.licensePlate) ||
    asString(record.plate_no);
  const model =
    asString(record.model) ||
    asString(record.vehicleTypeName) ||
    asString(record.vehicleType) ||
    asString(record.vehicle_type);
  if (plate && model) {
    return `${plate} / ${model}`;
  }
  return plate || model || '-';
}

function formatDiff(cents?: number | null) {
  if (cents === null || cents === undefined) {
    return '-';
  }
  const type = cents > 0 ? 'success' : cents < 0 ? 'danger' : undefined;
  return <Text type={type}>{formatMoney(cents)}</Text>;
}

function normalizeFilters(params: FreightFilters & { current?: number; pageSize?: number }) {
  return {
    page: params.current,
    pageSize: params.pageSize,
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

export default function DeliveryFreightCenterPage() {
  const { message } = AntdApp.useApp();
  const actionRef = useRef<ActionType | undefined>(undefined);
  const [dashboard, setDashboard] = useState<DeliveryFreightDashboard | null>(null);
  const [canceling, setCanceling] = useState<DeliveryPickupBatch | null>(null);
  const [adjusting, setAdjusting] = useState<DeliveryPickupBatch | null>(null);
  const [cancelForm] = Form.useForm<CancelFormValues>();
  const [adjustForm] = Form.useForm<AdjustFormValues>();

  const batchMutation = useMutation({
    mutationFn: async (input: BatchActionInput) => {
      if (input.type === 'sync') {
        return syncDeliveryCarrier(input.batch.id);
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
        sync: '货拉拉状态已同步',
        cancel: '货拉拉订单已取消',
        adjust: '提货成本已调整',
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
    { title: '订单号', dataIndex: 'orderId', key: 'orderId', width: 170, ellipsis: true, copyable: true, search: false },
    { title: '批次号', dataIndex: 'id', key: 'id', width: 170, ellipsis: true, copyable: true, search: false },
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
      title: '预计/预收运费',
      key: 'prepaid',
      width: 150,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <span>{formatMoney(record.prepaidPickupShippingFeeCents ?? record.estimatedShippingFeeCents)}</span>
          {record.latestCarrierOrder?.estimatedFeeCents !== undefined ? (
            <Text type="secondary">报价 {formatMoney(record.latestCarrierOrder.estimatedFeeCents)}</Text>
          ) : null}
        </Space>
      ),
      search: false,
    },
    {
      title: '实际成本',
      dataIndex: 'actualCarrierCostCents',
      key: 'actualCarrierCostCents',
      width: 120,
      render: (_, record) => formatMoney(record.actualCarrierCostCents),
      search: false,
    },
    {
      title: '差额',
      dataIndex: 'shippingCostDiffCents',
      key: 'shippingCostDiffCents',
      width: 110,
      render: (_, record) => formatDiff(record.shippingCostDiffCents),
      search: false,
    },
    {
      title: '货拉拉订单号',
      key: 'carrierOrderNo',
      width: 150,
      render: (_, record) => record.latestCarrierOrder?.carrierOrderNo ?? record.carrierOrderNo ?? '-',
      search: false,
    },
    {
      title: '司机',
      key: 'driver',
      width: 150,
      render: (_, record) => formatDriver(record.latestCarrierOrder?.driverSnapshot ?? record.driverSnapshot),
      search: false,
    },
    {
      title: '车辆',
      key: 'vehicle',
      width: 150,
      render: (_, record) => formatVehicle(record.latestCarrierOrder?.vehicleSnapshot ?? record.vehicleSnapshot),
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
      width: 220,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0} wrap>
          <Button
            type="link"
            size="small"
            disabled={!record.latestCarrierOrder}
            loading={batchMutation.isPending}
            onClick={() => batchMutation.mutate({ type: 'sync', batch: record })}
          >
            同步
          </Button>
          <Button
            type="link"
            danger
            size="small"
            disabled={!canCancel(record)}
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
            loading={batchMutation.isPending}
            onClick={() => {
              setAdjusting(record);
              adjustForm.resetFields();
            }}
          >
            调整成本
          </Button>
          <Link to={`/orders/${record.orderId}`}>
            <Button type="link" size="small">
              查看订单
            </Button>
          </Link>
        </Space>
      ),
      search: false,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="运费中心"
        subtitle="查看配送订单预收提货运费、货拉拉实际成本、成本差额和异常批次；差额按“预收运费 - 实际成本”展示，正数为结余，负数为超支。"
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="预收运费" prefix="¥" value={((dashboard?.prepaidPickupShippingFeeCents ?? 0) / 100).toFixed(2)} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="货拉拉实际成本" prefix="¥" value={((dashboard?.actualCarrierCostCents ?? 0) / 100).toFixed(2)} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="运费差额"
              prefix="¥"
              value={((dashboard?.shippingCostDiffCents ?? 0) / 100).toFixed(2)}
              valueStyle={{ color: (dashboard?.shippingCostDiffCents ?? 0) >= 0 ? '#389e0d' : '#cf1322' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="异常批次" value={dashboard?.exceptionBatchCount ?? 0} suffix="批" />
          </Card>
        </Col>
      </Row>

      <ProTable<DeliveryPickupBatch, FreightFilters>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const queryParams = normalizeFilters(params);
          const [dashboardResult, tableResult] = await Promise.all([
            getDeliveryFreightDashboard(queryParams),
            getDeliveryFreightBatches(queryParams),
          ]);
          setDashboard(dashboardResult);
          return {
            data: tableResult.items,
            success: true,
            total: tableResult.total,
          };
        }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={{ labelWidth: 84 }}
        scroll={{ x: 1780 }}
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>
            刷新
          </Button>,
        ]}
      />

      <Modal
        open={Boolean(canceling)}
        title="取消货拉拉订单"
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
            <Input.TextArea rows={3} maxLength={200} placeholder="请说明取消货拉拉订单的原因" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(adjusting)}
        title="调整提货成本"
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
