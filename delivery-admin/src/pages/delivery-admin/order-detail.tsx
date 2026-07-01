import { useQuery } from '@tanstack/react-query';
import { Card, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useParams } from 'react-router-dom';
import { getDeliveryOrder } from '@/api/delivery-management';
import type {
  DeliveryOrderDetail,
  DeliveryPayment,
  DeliveryPickupBatch,
  DeliveryPickupBatchItem,
  DeliveryShipment,
  DeliveryShippingCostLedger,
  JsonValue,
} from '@/types/delivery-management';
import {
  DetailDescriptions,
  JsonBlock,
  MoneyBreakdown,
  NotFoundPanel,
  PageHeader,
  StatusPill,
} from './components';
import {
  calcOrderPlatformDiff,
  calcOrderSettlementAmount,
  calcOrderSupplyAmount,
  calcSubOrderBuyerAmount,
  calcSubOrderPlatformDiff,
  calcSubOrderSettlementAmount,
  formatDateTime,
  formatMoney,
} from './utils';

const { Text } = Typography;

const pickupStatusText: Record<string, string> = {
  SINGLE: '单次提货',
  MULTI_BATCH: '多批次提货',
  NOT_STARTED: '未开始',
  PARTIAL_PICKED: '部分提货',
  ALL_PICKED: '全部提货',
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

const pickupStatusColor: Record<string, string> = {
  NOT_STARTED: 'default',
  PARTIAL_PICKED: 'processing',
  ALL_PICKED: 'success',
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

const costLedgerTypeText: Record<string, string> = {
  PREPAID_BY_USER: '用户预收',
  CARRIER_ESTIMATE: '承运报价',
  CARRIER_ACTUAL: '承运实际',
  MANUAL_ADJUSTMENT: '人工调整',
};

function PickupStatusTag({ value }: { value?: string | null }) {
  if (!value) {
    return <Tag>-</Tag>;
  }
  return <Tag color={pickupStatusColor[value] ?? 'default'}>{pickupStatusText[value] ?? value}</Tag>;
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

function getLatestCarrierOrder(batch: DeliveryPickupBatch) {
  return batch.latestCarrierOrder ?? batch.carrierOrders?.[0] ?? null;
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
  const type = cents > 0 ? 'danger' : cents < 0 ? 'success' : undefined;
  return <Text type={type}>{formatMoney(cents)}</Text>;
}

export default function DeliveryOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: ['delivery-order-detail', id],
    queryFn: () => getDeliveryOrder(id ?? ''),
    enabled: Boolean(id),
  });

  if (!id) {
    return <NotFoundPanel title="缺少订单编号" />;
  }

  if (query.isError) {
    return <NotFoundPanel title="配送订单不存在或无法加载" subtitle={(query.error as Error).message} />;
  }

  const data = query.data;
  const pickupBatches = data?.pickupBatches ?? [];
  const shippingCostLedgers = data?.shippingCostLedgers ?? [];

  const subOrderColumns: ColumnsType<DeliveryOrderDetail['subOrders'][number]> = [
    { title: '子订单编号', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '商家编号', dataIndex: 'merchantId', key: 'merchantId', width: 150, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (value: string) => <StatusPill value={value} />,
    },
    {
      title: '买家金额',
      key: 'totalAmountCents',
      width: 110,
      render: (_, record) => formatMoney(calcSubOrderBuyerAmount(record)),
    },
    {
      title: '商家供货',
      dataIndex: 'supplyAmountCents',
      key: 'supplyAmountCents',
      width: 130,
      render: (value: number) => formatMoney(value),
    },
    {
      title: '商家应结',
      key: 'settlementAmountCents',
      width: 110,
      render: (_, record) => formatMoney(calcSubOrderSettlementAmount(record)),
    },
    {
      title: '平台差额',
      key: 'margin',
      width: 110,
      render: (_, record) => formatMoney(calcSubOrderPlatformDiff(record)),
    },
    {
      title: '发货/签收',
      key: 'timing',
      width: 180,
      render: (_, record) => `${formatDateTime(record.shippedAt)} / ${formatDateTime(record.deliveredAt)}`,
    },
  ];

  const paymentColumns: ColumnsType<DeliveryPayment> = [
    { title: '支付单编号', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '渠道', dataIndex: 'channel', key: 'channel', width: 110 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: (value: string) => <StatusPill value={value} /> },
    { title: '金额', dataIndex: 'amountCents', key: 'amountCents', width: 110, render: (value: number) => formatMoney(value) },
    { title: '商户单号', dataIndex: 'merchantOrderNo', key: 'merchantOrderNo', width: 180, ellipsis: true },
    { title: '支付时间', dataIndex: 'paidAt', key: 'paidAt', width: 150, render: formatDateTime },
  ];

  const shipmentColumns: ColumnsType<DeliveryShipment> = [
    { title: '运单编号', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '子订单', dataIndex: 'subOrderId', key: 'subOrderId', width: 150, ellipsis: true },
    { title: '承运商', dataIndex: 'carrierName', key: 'carrierName', width: 140 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: (value: string) => <StatusPill value={value} /> },
    { title: '面单号', dataIndex: 'waybillNo', key: 'waybillNo', width: 140 },
    { title: '发货时间', dataIndex: 'shippedAt', key: 'shippedAt', width: 150, render: formatDateTime },
    { title: '签收时间', dataIndex: 'deliveredAt', key: 'deliveredAt', width: 150, render: formatDateTime },
  ];

  const pickupPlanColumns: ColumnsType<DeliveryPickupBatch> = [
    {
      title: '批次',
      key: 'batch',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text copyable={{ text: record.id }}>{record.id}</Text>
          <Text type="secondary">第 {record.batchNo} 批 / 子单 {record.subOrderId}</Text>
        </Space>
      ),
    },
    {
      title: '商家',
      key: 'merchant',
      width: 180,
      render: (_, record) => record.merchantName || record.merchant?.name || record.merchantId,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string) => <PickupStatusTag value={value} />,
    },
    {
      title: '商品与数量',
      key: 'items',
      width: 300,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          {record.items.map((item) => (
            <Text key={item.id}>
              {formatItemTitle(item)} x {item.quantity}{formatUnitName(item)}
              {item.pickedQuantity > 0 ? `，已提 ${item.pickedQuantity}${formatUnitName(item)}` : ''}
            </Text>
          ))}
        </Space>
      ),
    },
    { title: '计划提货', dataIndex: 'plannedPickupAt', key: 'plannedPickupAt', width: 150, render: formatDateTime },
  ];

  const pickupFulfillmentColumns: ColumnsType<DeliveryPickupBatch> = [
    {
      title: '批次',
      key: 'batchNo',
      width: 90,
      render: (_, record) => `第 ${record.batchNo} 批`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string) => <PickupStatusTag value={value} />,
    },
    {
      title: '货拉拉订单',
      key: 'carrierOrder',
      width: 190,
      render: (_, record) => {
        const carrierOrder = getLatestCarrierOrder(record);
        return (
          <Space direction="vertical" size={0}>
            <Text>{carrierOrder?.carrierOrderNo ?? '-'}</Text>
            {carrierOrder?.status ? <Text type="secondary">{carrierOrder.status}</Text> : null}
          </Space>
        );
      },
    },
    {
      title: '司机',
      key: 'driver',
      width: 160,
      render: (_, record) => formatDriver(getLatestCarrierOrder(record)?.driverSnapshot),
    },
    {
      title: '车辆',
      key: 'vehicle',
      width: 160,
      render: (_, record) => formatVehicle(getLatestCarrierOrder(record)?.vehicleSnapshot),
    },
    {
      title: '履约时间线',
      key: 'timeline',
      width: 360,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>备货 {formatDateTime(record.readyAt)}</Text>
          <Text>叫车 {formatDateTime(record.calledAt)} / 装车 {formatDateTime(record.loadedAt)}</Text>
          <Text type="secondary">
            完成 {formatDateTime(record.completedAt)} / 取消 {formatDateTime(record.canceledAt)}
          </Text>
        </Space>
      ),
    },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 150, render: formatDateTime },
  ];

  const costLedgerColumns: ColumnsType<DeliveryShippingCostLedger> = [
    { title: '流水号', dataIndex: 'id', key: 'id', width: 170, ellipsis: true },
    { title: '批次号', dataIndex: 'batchId', key: 'batchId', width: 170, ellipsis: true, render: (value) => value ?? '-' },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (value: string) => <Tag>{costLedgerTypeText[value] ?? value}</Tag>,
    },
    { title: '承运方', dataIndex: 'provider', key: 'provider', width: 100 },
    { title: '金额', dataIndex: 'amountCents', key: 'amountCents', width: 110, render: (value: number) => formatMoney(value) },
    { title: '来源', dataIndex: 'source', key: 'source', width: 180 },
    { title: '来源编号', dataIndex: 'sourceRefId', key: 'sourceRefId', width: 180, ellipsis: true, render: (value) => value ?? '-' },
    {
      title: '创建人',
      key: 'createdBy',
      width: 170,
      render: (_, record) => `${record.createdByType}${record.createdById ? ` / ${record.createdById}` : ''}`,
    },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 150, render: formatDateTime },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="订单详情" subtitle="订单层与子订单层都展示买家金额、商家供货、商家应结和平台差额边界。" />

      <Card loading={query.isLoading}>
        {data ? (
          <DetailDescriptions
            items={[
              { key: 'id', label: '订单编号', children: data.id },
              { key: 'status', label: '订单状态', children: <StatusPill value={data.status} /> },
              { key: 'buyer', label: '买家', children: data.user?.nickname || data.user?.phone || data.userId },
              { key: 'unit', label: '单位', children: data.unit?.name || data.unitId },
              {
                key: 'money',
                label: '金额拆分',
                children: (
                  <MoneyBreakdown
                    buyerAmountCents={data.totalAmountCents}
                    supplyAmountCents={calcOrderSupplyAmount(data)}
                    settlementAmountCents={calcOrderSettlementAmount(data)}
                    platformDiffAmountCents={calcOrderPlatformDiff(data)}
                  />
                ),
              },
              { key: 'goodsAmountCents', label: '货款', children: formatMoney(data.goodsAmountCents) },
              { key: 'shippingFeeCents', label: '预收提货运费', children: formatMoney(data.prepaidPickupShippingFeeCents ?? data.shippingFeeCents) },
              { key: 'totalAmountCents', label: '总支付', children: formatMoney(data.totalAmountCents) },
              { key: 'paidAt', label: '支付时间', children: formatDateTime(data.paidAt) },
              { key: 'shippedAt', label: '整单发货', children: formatDateTime(data.shippedAt) },
              { key: 'deliveredAt', label: '整单签收', children: formatDateTime(data.deliveredAt) },
              { key: 'completedAt', label: '整单完成', children: formatDateTime(data.completedAt) },
              { key: 'note', label: '备注', children: data.note ?? '-' },
            ]}
          />
        ) : null}
      </Card>

      <Card title="支付拆分" style={{ marginTop: 16 }}>
        <DetailDescriptions
          items={[
            { key: 'goods', label: '商品金额', children: formatMoney(data?.goodsAmountCents) },
            {
              key: 'prepaidFreight',
              label: '预收提货运费',
              children: formatMoney(data?.prepaidPickupShippingFeeCents ?? data?.shippingFeeCents),
            },
            { key: 'totalPaid', label: '总支付', children: formatMoney(data?.totalAmountCents) },
            { key: 'actualCost', label: '货拉拉实际成本', children: formatMoney(data?.actualCarrierCostCents) },
            { key: 'costDiff', label: '成本差额', children: formatDiff(data?.shippingCostDiffCents) },
          ]}
        />
      </Card>

      <Card title="子订单" style={{ marginTop: 16 }}>
        <Table rowKey="id" pagination={false} columns={subOrderColumns} dataSource={data?.subOrders ?? []} scroll={{ x: 1080 }} />
      </Card>

      <Card title="支付记录" style={{ marginTop: 16 }}>
        <Table rowKey="id" pagination={false} columns={paymentColumns} dataSource={data?.payments ?? []} scroll={{ x: 860 }} />
      </Card>

      <Card title="发货记录" style={{ marginTop: 16 }}>
        <Table rowKey="id" pagination={false} columns={shipmentColumns} dataSource={data?.shipments ?? []} scroll={{ x: 940 }} />
      </Card>

      <Card title="提货计划" style={{ marginTop: 16 }}>
        <DetailDescriptions
          items={[
            { key: 'pickupMode', label: '提货方式', children: pickupStatusText[data?.pickupMode ?? ''] ?? data?.pickupMode ?? '-' },
            { key: 'plannedPickupCount', label: '计划批次数', children: data?.plannedPickupCount ? `${data.plannedPickupCount} 批` : '-' },
            { key: 'pickupStatus', label: '整单提货状态', children: <PickupStatusTag value={data?.pickupStatus} /> },
          ]}
        />
        <Table
          rowKey="id"
          pagination={false}
          columns={pickupPlanColumns}
          dataSource={pickupBatches}
          scroll={{ x: 1020 }}
          style={{ marginTop: 16 }}
        />
      </Card>

      <Card title="批次履约记录" style={{ marginTop: 16 }}>
        <Table
          rowKey="id"
          pagination={false}
          columns={pickupFulfillmentColumns}
          dataSource={pickupBatches}
          scroll={{ x: 1240 }}
        />
      </Card>

      <Card title="提货成本记录" style={{ marginTop: 16 }}>
        {shippingCostLedgers.length > 0 ? (
          <Table
            rowKey="id"
            pagination={false}
            columns={costLedgerColumns}
            dataSource={shippingCostLedgers}
            scroll={{ x: 1350 }}
          />
        ) : (
          <DetailDescriptions
            items={[
              { key: 'prepaid', label: '预收提货运费', children: formatMoney(data?.prepaidPickupShippingFeeCents ?? data?.shippingFeeCents) },
              { key: 'actual', label: '货拉拉实际成本', children: formatMoney(data?.actualCarrierCostCents) },
              { key: 'diff', label: '成本差额', children: formatDiff(data?.shippingCostDiffCents) },
            ]}
          />
        )}
      </Card>

      <Card title="单位快照" style={{ marginTop: 16 }}>
        <JsonBlock value={data?.unitSnapshot} />
      </Card>

      <Card title="地址快照" style={{ marginTop: 16 }}>
        <JsonBlock value={data?.addressSnapshot} />
      </Card>

      <Card title="商品快照" style={{ marginTop: 16 }}>
        <JsonBlock value={data?.itemsSnapshot} />
      </Card>

      <Card title="定价快照" style={{ marginTop: 16 }}>
        <JsonBlock value={data?.pricingSnapshot} />
      </Card>
    </div>
  );
}
