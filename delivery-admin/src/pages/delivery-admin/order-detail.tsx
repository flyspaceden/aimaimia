import { useQuery } from '@tanstack/react-query';
import { Card, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useParams } from 'react-router-dom';
import { getDeliveryOrder } from '@/api/delivery-management';
import type {
  DeliveryOrderDetail,
  DeliveryPayment,
  DeliveryShipment,
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

export default function DeliveryOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: ['delivery-order-detail', id],
    queryFn: () => getDeliveryOrder(id ?? ''),
    enabled: Boolean(id),
  });

  if (!id) {
    return <NotFoundPanel title="缺少订单 ID" />;
  }

  if (query.isError) {
    return <NotFoundPanel title="配送订单不存在或无法加载" subtitle={(query.error as Error).message} />;
  }

  const data = query.data;

  const subOrderColumns: ColumnsType<DeliveryOrderDetail['subOrders'][number]> = [
    { title: '子订单 ID', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '商家 ID', dataIndex: 'merchantId', key: 'merchantId', width: 150, ellipsis: true },
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
    { title: '支付单 ID', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '渠道', dataIndex: 'channel', key: 'channel', width: 110 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: (value: string) => <StatusPill value={value} /> },
    { title: '金额', dataIndex: 'amountCents', key: 'amountCents', width: 110, render: (value: number) => formatMoney(value) },
    { title: '商户单号', dataIndex: 'merchantOrderNo', key: 'merchantOrderNo', width: 180, ellipsis: true },
    { title: '支付时间', dataIndex: 'paidAt', key: 'paidAt', width: 150, render: formatDateTime },
  ];

  const shipmentColumns: ColumnsType<DeliveryShipment> = [
    { title: '运单 ID', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '子订单', dataIndex: 'subOrderId', key: 'subOrderId', width: 150, ellipsis: true },
    { title: '承运商', dataIndex: 'carrierName', key: 'carrierName', width: 140 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: (value: string) => <StatusPill value={value} /> },
    { title: '面单号', dataIndex: 'waybillNo', key: 'waybillNo', width: 140 },
    { title: '发货时间', dataIndex: 'shippedAt', key: 'shippedAt', width: 150, render: formatDateTime },
    { title: '签收时间', dataIndex: 'deliveredAt', key: 'deliveredAt', width: 150, render: formatDateTime },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="订单详情" subtitle="订单层与子订单层都展示买家金额、商家供货、商家应结和平台差额边界。" />

      <Card loading={query.isLoading}>
        {data ? (
          <DetailDescriptions
            items={[
              { key: 'id', label: '订单 ID', children: data.id },
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
              { key: 'shippingFeeCents', label: '运费', children: formatMoney(data.shippingFeeCents) },
              { key: 'paidAt', label: '支付时间', children: formatDateTime(data.paidAt) },
              { key: 'shippedAt', label: '整单发货', children: formatDateTime(data.shippedAt) },
              { key: 'deliveredAt', label: '整单签收', children: formatDateTime(data.deliveredAt) },
              { key: 'completedAt', label: '整单完成', children: formatDateTime(data.completedAt) },
              { key: 'note', label: '备注', children: data.note ?? '-' },
            ]}
          />
        ) : null}
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
