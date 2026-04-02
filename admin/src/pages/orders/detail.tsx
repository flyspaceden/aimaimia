import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Descriptions, Table, Tag, Button, Spin, Breadcrumb, Steps, Alert } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { getOrder } from '@/api/orders';
import type { OrderItem } from '@/types';
import { orderStatusMap } from '@/constants/statusMaps';
import dayjs from 'dayjs';

// 订单生命周期状态步骤
const statusSteps = [
  { key: 'PAID', title: '已付款' },
  { key: 'SHIPPED', title: '已发货' },
  { key: 'DELIVERED', title: '已送达' },
  { key: 'RECEIVED', title: '已收货' },
];

const itemColumns = [
  {
    title: '图片',
    dataIndex: 'productImage',
    key: 'productImage',
    width: 64,
    render: (url: string | null) =>
      url ? (
        <img
          src={url}
          alt="商品图"
          style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }}
        />
      ) : (
        <div
          style={{
            width: 48,
            height: 48,
            background: '#f5f5f5',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ccc',
            fontSize: 12,
          }}
        >
          暂无
        </div>
      ),
  },
  { title: '商品', dataIndex: 'productTitle', key: 'productTitle' },
  { title: '规格', dataIndex: 'skuName', key: 'skuName', render: (v: string | null) => v || '-' },
  { title: '单价', dataIndex: 'unitPrice', key: 'unitPrice', render: (v: number | null) => v != null ? `¥${v.toFixed(2)}` : '-' },
  { title: '数量', dataIndex: 'quantity', key: 'quantity' },
  {
    title: '小计',
    key: 'subtotal',
    render: (_: unknown, record: OrderItem) => {
      const price = record.unitPrice ?? 0;
      const qty = record.quantity ?? 0;
      return `¥${(price * qty).toFixed(2)}`;
    },
  },
];

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: order, isLoading } = useQuery({
    queryKey: ['admin', 'order', id],
    queryFn: () => getOrder(id!),
    enabled: !!id,
  });

  if (isLoading) return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>;
  if (!order) return (
    <div style={{ padding: 24, textAlign: 'center', paddingTop: 100 }}>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>返回</Button>
      <div style={{ color: '#999' }}>订单不存在或加载失败</div>
    </div>
  );

  const status = orderStatusMap[order.status];
  const shipments = order.shipments?.length
    ? order.shipments
    : order.shipment
      ? [order.shipment]
      : [];
  const address = (order.address || {}) as Record<string, unknown>;
  const recipientName = String(address.recipientName || address.receiverName || '-');
  const phone = String(address.phone || '-');
  const regionText = String(address.regionText || '').trim();
  const legacyRegion = `${String(address.province || '')} ${String(address.city || '')} ${String(address.district || '')}`.trim();
  const detail = String(address.detail || '').trim();
  const fullAddress = `${regionText || legacyRegion} ${detail}`.trim() || '-';

  // 状态流转计算
  const currentStepIndex = statusSteps.findIndex(s => s.key === order.status);
  const isCanceled = order.status === 'CANCELED';
  const isRefunded = order.status === 'REFUNDED';

  // 优惠金额计算（总金额 - 实付金额）
  const totalAmount = order.totalAmount ?? 0;
  const paymentAmount = order.paymentAmount ?? totalAmount;
  const discountAmount = totalAmount - paymentAmount;
  const hasDiscount = discountAmount > 0;
  const buildTreeLink = (path: '/bonus/vip-tree' | '/bonus/normal-tree') => {
    const params = new URLSearchParams({
      userId: order.userId,
      source: 'order-detail',
      sourceLabel: '订单详情',
    });
    return `${path}?${params.toString()}`;
  };

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <a onClick={() => navigate('/')}>首页</a> },
          { title: <a onClick={() => navigate('/orders')}>订单管理</a> },
          { title: '订单详情' },
        ]}
      />
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>
        返回
      </Button>

      {/* VIP 礼包订单提示 */}
      {order.bizType === 'VIP_PACKAGE' && (
        <Alert
          message="VIP 开通礼包 · 不支持退款"
          type="warning"
          showIcon
          banner
          style={{
            marginBottom: 16,
            background: 'linear-gradient(90deg, #FDF6EC 0%, #FFF9F0 100%)',
            border: '1px solid #C9A96E',
            borderRadius: 6,
            color: '#8B6914',
          }}
          icon={<Tag color="#C9A96E" style={{ fontWeight: 600, fontSize: 13, margin: 0 }}>VIP礼包</Tag>}
        />
      )}

      {/* 订单状态流转时间线 */}
      <Card style={{ marginBottom: 16 }}>
        {isCanceled || isRefunded ? (
          <Steps
            current={0}
            status="error"
            items={[
              {
                title: isCanceled ? '已取消' : '已退款',
                description: dayjs(order.updatedAt).format('YYYY-MM-DD HH:mm'),
              },
            ]}
          />
        ) : (
          <Steps
            current={currentStepIndex}
            items={statusSteps.map(s => ({ title: s.title }))}
          />
        )}
      </Card>

      {/* 订单基本信息 */}
      <Card title="订单信息" style={{ marginBottom: 16 }}>
        <Descriptions bordered column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="订单号">{order.orderNo}</Descriptions.Item>
          <Descriptions.Item label="状态"><Tag color={status?.color}>{status?.text}</Tag></Descriptions.Item>
          <Descriptions.Item label="用户">{order.user?.phone || order.userId}</Descriptions.Item>
          <Descriptions.Item label="奖励树" span={3}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button size="small" onClick={() => navigate(buildTreeLink('/bonus/vip-tree'))}>
                查看 VIP 树
              </Button>
              <Button size="small" onClick={() => navigate(buildTreeLink('/bonus/normal-tree'))}>
                查看普通树
              </Button>
            </div>
          </Descriptions.Item>
          {/* 商家名称（如果存在） */}
          {order.company?.name && (
            <Descriptions.Item label="商家">{order.company.name}</Descriptions.Item>
          )}
          <Descriptions.Item label="总金额">¥{totalAmount.toFixed(2)}</Descriptions.Item>
          <Descriptions.Item label="实付金额">¥{paymentAmount.toFixed(2)}</Descriptions.Item>
          {/* 优惠金额（仅在有优惠时显示） */}
          {hasDiscount && (
            <Descriptions.Item label="优惠金额">
              <span style={{ color: '#f5222d' }}>-¥{discountAmount.toFixed(2)}</span>
            </Descriptions.Item>
          )}
          {/* 运费（如果存在） */}
          {order.shippingFee != null && (
            <Descriptions.Item label="运费">¥{Number(order.shippingFee).toFixed(2)}</Descriptions.Item>
          )}
          <Descriptions.Item label="下单时间">{dayjs(order.createdAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
          {/* 备注（如果存在） */}
          {order.remark && (
            <Descriptions.Item label="备注" span={3}>{order.remark}</Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* 支付信息 */}
      <Card title="支付信息" style={{ marginBottom: 16 }}>
        <Descriptions bordered column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="支付方式">{order.paymentMethod || '-'}</Descriptions.Item>
          <Descriptions.Item label="支付时间">
            {order.paidAt ? dayjs(order.paidAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="交易号">{order.transactionId || '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 商品明细 */}
      <Card title="商品明细" style={{ marginBottom: 16 }}>
        <Table<OrderItem>
          columns={itemColumns}
          dataSource={order.items || []}
          rowKey="id"
          pagination={false}
          size="small"
          scroll={{ x: 600 }}
        />
      </Card>

      {/* 物流信息 */}
      {shipments.length > 0 && (
        <Card title="物流信息" style={{ marginBottom: 16 }}>
          <Table
            rowKey="id"
            pagination={false}
            size="small"
            dataSource={shipments}
            columns={[
              { title: '包裹', render: (_value, _record, index) => `包裹 ${index + 1}` },
              { title: '快递公司', dataIndex: 'carrierName', render: (value: string | undefined) => value || '-' },
              { title: '运单号', render: (_value, record) => record.trackingNoMasked || record.trackingNo || '-' },
              {
                title: '状态',
                dataIndex: 'status',
                render: (value: string | undefined) => value || '-',
              },
            ]}
          />
        </Card>
      )}

      {/* 收货地址 */}
      {order.address && (
        <Card title="收货地址">
          <Descriptions bordered column={1}>
            <Descriptions.Item label="收件人">{recipientName}</Descriptions.Item>
            <Descriptions.Item label="电话">{phone}</Descriptions.Item>
            <Descriptions.Item label="地址">{fullAddress}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}
    </div>
  );
}
