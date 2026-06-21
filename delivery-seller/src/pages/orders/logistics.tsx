import { useState } from 'react';
import { App, Button, Descriptions, Modal, Space, Table, Tag, Timeline, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { getOrders } from '@/api/orders';
import { getOrderShipments } from '@/api/shipments';
import { getStatusDisplay, orderStatusMap, shipmentStatusMap } from '@/constants/statusMaps';
import type { Order, Shipment } from '@/types';
import dayjs from 'dayjs';

const logisticsStatuses = 'SHIPPED,DELIVERED,COMPLETED';

export default function LogisticsPage() {
  const { message } = App.useApp();
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loadingShipments, setLoadingShipments] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-logistics-orders'],
    queryFn: () => getOrders({ page: 1, pageSize: 100, status: logisticsStatuses }),
  });

  const openShipments = async (order: Order) => {
    setActiveOrder(order);
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
        subTitle="查看已发货、已签收和已完成订单的面单与轨迹"
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
                <Button type="link" icon={<SearchOutlined />} onClick={() => openShipments(row)}>
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
      </Modal>
    </Space>
  );
}
