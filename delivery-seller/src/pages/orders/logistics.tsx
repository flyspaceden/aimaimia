import { useState } from 'react';
import { App, Button, Descriptions, Modal, Space, Table, Tag, Timeline, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { getOrders } from '@/api/orders';
import { getOrderShipments } from '@/api/shipments';
import { getStatusDisplay, orderStatusMap, shipmentStatusMap } from '@/constants/statusMaps';
import type { Order, PickupBatch, PickupBatchCarrierOrder, Shipment } from '@/types';
import dayjs from 'dayjs';

const logisticsStatuses = 'PENDING_SHIPMENT,SHIPPED,DELIVERED,COMPLETED';

const pickupBatchStatusText: Record<string, string> = {
  PLANNED: '已计划',
  READY_TO_CALL: '待叫车',
  CALLING_CARRIER: '叫车中',
  WAITING_DRIVER: '待接单',
  DRIVER_ASSIGNED: '司机已接单',
  ARRIVED: '司机已到达',
  LOADED: '已交货',
  DELIVERING: '配送中',
  COMPLETED: '已完成',
  CANCELED: '已取消',
  EXCEPTION: '异常',
};

const pickupBatchStatusColor: Record<string, string> = {
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

function PickupBatchStatusTag({ value }: { value?: string | null }) {
  if (!value) {
    return <Tag>-</Tag>;
  }
  return <Tag color={pickupBatchStatusColor[value] ?? 'default'}>{pickupBatchStatusText[value] ?? value}</Tag>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function getCarrierOrder(batch: PickupBatch): PickupBatchCarrierOrder {
  return batch.latestCarrierOrder ?? {
    carrierOrderNo: batch.carrierOrderNo,
    driverSnapshot: batch.driverSnapshot,
    vehicleSnapshot: batch.vehicleSnapshot,
  };
}

function formatDriver(snapshot?: unknown) {
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

function formatVehicle(snapshot?: unknown) {
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

function formatDateTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
}

export default function LogisticsPage() {
  const { message } = App.useApp();
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loadingShipments, setLoadingShipments] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-logistics-orders'],
    queryFn: () => getOrders({ page: 1, pageSize: 100, status: logisticsStatuses }),
  });

  const openLogistics = async (order: Order) => {
    setActiveOrder(order);
    if (!order.shipment) {
      setShipments([]);
      setLoadingShipments(false);
      return;
    }
    setLoadingShipments(true);
    try {
      setShipments(await getOrderShipments(order.id));
    } catch (err) {
      message.error(err instanceof Error ? err.message : '物流记录加载失败');
    } finally {
      setLoadingShipments(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <ProCard
        title="物流跟踪"
        subTitle="查看提货批次、司机车辆和旧快递面单轨迹"
        headerBordered
        style={{ borderTop: '3px solid #EA580C' }}
      >
        <Table<Order>
          rowKey="id"
          loading={isLoading}
          dataSource={data?.items || []}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          size="middle"
          columns={[
            {
              title: '子订单号',
              dataIndex: 'id',
              render: (value: string) => <Typography.Text copyable>{value}</Typography.Text>,
            },
            {
              title: '商品',
              render: (_, row) => row.items[0]?.title || '-',
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 120,
              render: (value: string) => {
                const item = getStatusDisplay(orderStatusMap, value);
                return <Tag color={item.color}>{item.text}</Tag>;
              },
            },
            {
              title: '物流',
              render: (_, row) => {
                const pickupBatches = row.pickupBatches ?? [];
                if (pickupBatches.length > 0) {
                  const firstBatch = pickupBatches[0];
                  const carrier = getCarrierOrder(firstBatch);
                  return (
                    <Space direction="vertical" size={0}>
                      <Space size={4}>
                        <Tag color="orange">货拉拉</Tag>
                        <PickupBatchStatusTag value={firstBatch.status} />
                      </Space>
                      <Typography.Text type="secondary">
                        {pickupBatches.length > 1 ? `共 ${pickupBatches.length} 批` : carrier.carrierOrderNo || '待生成运单'}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {formatDriver(carrier.driverSnapshot)} / {formatVehicle(carrier.vehicleSnapshot)}
                      </Typography.Text>
                    </Space>
                  );
                }
                const item = row.shipment ? getStatusDisplay(shipmentStatusMap, row.shipment.status) : null;
                return row.shipment ? (
                  <Space direction="vertical" size={0}>
                    <Tag color={item?.color}>{item?.text}</Tag>
                    <Typography.Text type="secondary">{row.shipment.trackingNo || row.shipment.waybillNo || '-'}</Typography.Text>
                  </Space>
                ) : '-';
              },
            },
            {
              title: '发货时间',
              render: (_, row) => row.shipment?.shippedAt ? dayjs(row.shipment.shippedAt).format('YYYY-MM-DD HH:mm') : '-',
            },
            {
              title: '操作',
              width: 120,
              render: (_, row) => (
                <Button type="link" icon={<SearchOutlined />} onClick={() => openLogistics(row)}>
                  查看物流
                </Button>
              ),
            },
          ]}
        />
      </ProCard>

      <Modal
        title="物流记录"
        open={!!activeOrder}
        onCancel={() => setActiveOrder(null)}
        footer={null}
        width={760}
        destroyOnClose
      >
        <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="子订单号">{activeOrder?.id}</Descriptions.Item>
          <Descriptions.Item label="商品">{activeOrder?.items[0]?.title || '-'}</Descriptions.Item>
        </Descriptions>
        {(activeOrder?.pickupBatches?.length ?? 0) > 0 && (
          <Table<PickupBatch>
            rowKey="id"
            dataSource={activeOrder?.pickupBatches ?? []}
            pagination={false}
            size="small"
            style={{ marginBottom: 16 }}
            columns={[
              { title: '批次号', dataIndex: 'id', render: (value: string) => <Typography.Text copyable>{value}</Typography.Text> },
              {
                title: '货拉拉状态',
                render: (_, record) => {
                  const carrier = getCarrierOrder(record);
                  return (
                    <Space direction="vertical" size={0}>
                      <PickupBatchStatusTag value={record.status} />
                      <Typography.Text type="secondary">{carrier.status ? pickupBatchStatusText[carrier.status] ?? carrier.status : carrier.carrierOrderNo || '-'}</Typography.Text>
                    </Space>
                  );
                },
              },
              {
                title: '司机',
                render: (_, record) => formatDriver(getCarrierOrder(record).driverSnapshot),
              },
              {
                title: '车辆',
                render: (_, record) => formatVehicle(getCarrierOrder(record).vehicleSnapshot),
              },
              {
                title: '更新时间',
                render: (_, record) => formatDateTime(getCarrierOrder(record).updatedAt ?? record.updatedAt),
              },
            ]}
          />
        )}
        {activeOrder?.shipment && (
          <Table<Shipment>
            rowKey="id"
            loading={loadingShipments}
            dataSource={shipments}
            pagination={false}
            size="small"
            expandable={{
              expandedRowRender: (record) => (
                <Timeline
                  items={(record.trackingEvents || []).map((event) => ({
                    children: (
                      <Space direction="vertical" size={0}>
                        <Typography.Text>{event.description}</Typography.Text>
                        <Typography.Text type="secondary">{dayjs(event.occurredAt).format('YYYY-MM-DD HH:mm')}</Typography.Text>
                      </Space>
                    ),
                  }))}
                />
              ),
              rowExpandable: (record) => (record.trackingEvents?.length || 0) > 0,
            }}
            columns={[
              { title: '承运商', dataIndex: 'carrierName' },
              { title: '运单号', dataIndex: 'trackingNo', render: (value) => value || '-' },
              {
                title: '状态',
                dataIndex: 'status',
                render: (value) => {
                  const item = getStatusDisplay(shipmentStatusMap, value);
                  return <Tag color={item.color}>{item.text}</Tag>;
                },
              },
              {
                title: '发货时间',
                dataIndex: 'shippedAt',
                render: (value) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-',
              },
            ]}
          />
        )}
      </Modal>
    </Space>
  );
}
