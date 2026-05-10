import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Card, Descriptions, Table, Tag, Button, Spin, Breadcrumb, Steps, Alert, Typography, Timeline } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { getOrder, retryRefund } from '@/api/orders';
import PermissionGate from '@/components/PermissionGate';
import type { OrderItem, Refund } from '@/types';
import { PERMISSIONS } from '@/constants/permissions';
import { orderStatusMap, refundStatusMap } from '@/constants/statusMaps';
import dayjs from 'dayjs';

// 订单生命周期状态步骤
const statusSteps = [
  { key: 'PAID', title: '已付款' },
  { key: 'SHIPPED', title: '已发货' },
  { key: 'DELIVERED', title: '已送达' },
  { key: 'RECEIVED', title: '已收货' },
];

// 支付方式枚举 → 中文显示
const paymentChannelLabel: Record<string, string> = {
  ALIPAY: '支付宝',
  WECHAT: '微信',
  WALLET: '钱包',
};

const formatDateTime = (value?: string | null) =>
  value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-';

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
  const { message, modal } = App.useApp();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  // 金额拆分：分润奖励 / 平台红包 / VIP 折扣 三笔独立优惠
  const totalAmount = order.totalAmount ?? 0;
  const paymentAmount = order.paymentAmount ?? totalAmount;
  const rewardDiscount = order.discountAmount ?? 0;          // 分润奖励抵扣
  const couponDiscount = order.totalCouponDiscount ?? 0;     // 平台红包抵扣
  const vipDiscount = order.vipDiscountAmount ?? 0;          // VIP 折扣（平台补贴）
  const totalDiscount = rewardDiscount + couponDiscount + vipDiscount;
  const hasDiscount = totalDiscount > 0;
  // 取首个 shipment 的发货时间作为订单维度的 shippedAt（1 Order = 1 Company）
  const shippedAt = order.shippedAt || shipments[0]?.shippedAt || null;
  const buildTreeLink = (path: '/bonus/vip-tree' | '/bonus/normal-tree') => {
    const params = new URLSearchParams({
      userId: order.userId,
      source: 'order-detail',
      sourceLabel: '订单详情',
    });
    return `${path}?${params.toString()}`;
  };
  const handleRetryRefund = (refund: Refund) => {
    modal.confirm({
      title: '确认重试退款？',
      content: `将按原退款单号重试退款 ¥${refund.amount.toFixed(2)}，不会新建退款单。`,
      okText: '重试退款',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await retryRefund(order.id, refund.id);
          message.success('已提交退款重试');
          queryClient.invalidateQueries({ queryKey: ['admin', 'order', id] });
        } catch (err) {
          message.error(err instanceof Error ? err.message : '退款重试失败');
        }
      },
    });
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
            <Descriptions.Item label="优惠合计">
              <span style={{ color: '#f5222d' }}>-¥{totalDiscount.toFixed(2)}</span>
            </Descriptions.Item>
          )}
          {/* 优惠拆分：分润奖励 / 平台红包 / VIP 折扣 各自独立显示，便于对账 */}
          {rewardDiscount > 0 && (
            <Descriptions.Item label="分润奖励抵扣">
              <span style={{ color: '#f5222d' }}>-¥{rewardDiscount.toFixed(2)}</span>
            </Descriptions.Item>
          )}
          {couponDiscount > 0 && (
            <Descriptions.Item label="平台红包抵扣">
              <span style={{ color: '#f5222d' }}>-¥{couponDiscount.toFixed(2)}</span>
            </Descriptions.Item>
          )}
          {vipDiscount > 0 && (
            <Descriptions.Item label="VIP 折扣">
              <span style={{ color: '#f5222d' }}>-¥{vipDiscount.toFixed(2)}</span>
            </Descriptions.Item>
          )}
          {/* 运费（如果存在） */}
          {order.shippingFee != null && (
            <Descriptions.Item label="运费">¥{Number(order.shippingFee).toFixed(2)}</Descriptions.Item>
          )}
          <Descriptions.Item label="下单时间">{formatDateTime(order.createdAt)}</Descriptions.Item>
          {/* 买家留言（结算页填写，<= 200 字） */}
          {order.buyerNote && (
            <Descriptions.Item label="买家留言" span={3}>{order.buyerNote}</Descriptions.Item>
          )}
          {/* 备注（如果存在） */}
          {order.remark && (
            <Descriptions.Item label="备注" span={3}>{order.remark}</Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* 时间线（关键时间节点，售后争议时一目了然） */}
      <Card title="时间线" style={{ marginBottom: 16 }}>
        <Timeline
          mode="left"
          items={[
            { label: '下单', time: order.createdAt },
            { label: '支付', time: order.paidAt },
            { label: '发货', time: shippedAt },
            { label: '送达', time: order.deliveredAt },
            { label: '收货', time: order.receivedAt },
            { label: '自动收货', time: order.autoReceiveAt },
            { label: '退货窗口截止', time: order.returnWindowExpiresAt, deadline: true },
          ].map((node) => {
            const reached = !!node.time;
            const labelColor = reached ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.35)';
            const dotColor = node.deadline
              ? '#fa8c16'                         // 退货窗口截止 = 橙色（deadline 高亮）
              : reached
                ? (isCanceled || isRefunded ? '#ff4d4f' : '#52c41a')
                : '#d9d9d9';
            return {
              color: dotColor,
              label: (
                <span style={{ color: labelColor, fontFamily: 'monospace', fontSize: 13 }}>
                  {reached ? formatDateTime(node.time) : '—'}
                </span>
              ),
              children: (
                <span style={{ color: labelColor, fontWeight: reached ? 500 : 400 }}>
                  {node.label}
                </span>
              ),
            };
          })}
        />
      </Card>

      {/* 支付信息 */}
      <Card title="支付信息" style={{ marginBottom: 16 }}>
        <Descriptions bordered column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="支付方式">
            {order.paymentMethod
              ? (paymentChannelLabel[order.paymentMethod] || order.paymentMethod)
              : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="支付时间">{formatDateTime(order.paidAt)}</Descriptions.Item>
          <Descriptions.Item label="交易号" span={2}>
            {order.transactionId
              ? (
                <Typography.Text copyable={{ text: order.transactionId }} style={{ fontFamily: 'monospace' }}>
                  {order.transactionId}
                </Typography.Text>
              )
              : '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {order.refunds?.length ? (
        <Card title="退款信息" style={{ marginBottom: 16 }}>
          <Table<Refund>
            rowKey="id"
            pagination={false}
            size="small"
            dataSource={order.refunds}
            expandable={{
              expandedRowRender: (refund) => (
                refund.statusHistory?.length ? (
                  <Table
                    rowKey="createdAt"
                    size="small"
                    pagination={false}
                    dataSource={refund.statusHistory}
                    columns={[
                      { title: '原状态', dataIndex: 'fromStatus', render: (value: string | null) => value || '-' },
                      { title: '目标状态', dataIndex: 'toStatus' },
                      { title: '备注', dataIndex: 'remark', render: (value: string | null) => value || '-' },
                      { title: '操作人', dataIndex: 'operatorId', render: (value: string | null) => value || 'SYSTEM' },
                      {
                        title: '时间',
                        dataIndex: 'createdAt',
                        render: (value: string) => value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-',
                      },
                    ]}
                  />
                ) : (
                  <Typography.Text type="secondary">暂无退款状态历史</Typography.Text>
                )
              ),
            }}
            columns={[
              {
                title: '退款单号',
                dataIndex: 'merchantRefundNo',
                render: (value: string | undefined) => value ? (
                  <Typography.Text copyable={{ text: value }} style={{ fontFamily: 'monospace' }}>
                    {value}
                  </Typography.Text>
                ) : '-',
              },
              { title: '金额', dataIndex: 'amount', render: (value: number) => `¥${value.toFixed(2)}` },
              {
                title: '状态',
                dataIndex: 'status',
                render: (value: string) => (
                  <Tag color={refundStatusMap[value]?.color}>
                    {refundStatusMap[value]?.text || value}
                  </Tag>
                ),
              },
              { title: '原因', dataIndex: 'reason' },
              {
                title: '更新时间',
                dataIndex: 'updatedAt',
                render: (value: string) => value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-',
              },
              {
                title: '操作',
                key: 'action',
                render: (_: unknown, refund) => (
                  ['FAILED', 'REFUNDING'].includes(refund.status) ? (
                    <PermissionGate permission={PERMISSIONS.ORDERS_REFUND}>
                      <Button size="small" danger onClick={() => handleRetryRefund(refund)}>
                        重试退款
                      </Button>
                    </PermissionGate>
                  ) : null
                ),
              },
            ]}
          />
        </Card>
      ) : null}

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
              {
                title: '运单号',
                render: (_value, record) => {
                  // admin 是信任用户，显示完整运单号 + 一键复制（不 mask）
                  const no = record.waybillNo || record.trackingNo;
                  if (!no) return '-';
                  return (
                    <Typography.Text copyable={{ text: no }} style={{ fontFamily: 'monospace' }}>
                      {no}
                    </Typography.Text>
                  );
                },
              },
              {
                title: '状态',
                dataIndex: 'status',
                render: (value: string | undefined) => value || '-',
              },
            ]}
          />
        </Card>
      )}

      {/* 状态历史（订单生命周期审计） */}
      {order.statusHistory && order.statusHistory.length > 0 && (
        <Card title="状态历史" style={{ marginBottom: 16 }}>
          <Table
            rowKey="id"
            pagination={false}
            size="small"
            dataSource={order.statusHistory}
            columns={[
              {
                title: '原状态',
                dataIndex: 'fromStatus',
                width: 120,
                render: (value: string | null) => {
                  if (!value) return '-';
                  const s = orderStatusMap[value];
                  return s ? <Tag color={s.color}>{s.text}</Tag> : value;
                },
              },
              {
                title: '目标状态',
                dataIndex: 'toStatus',
                width: 120,
                render: (value: string) => {
                  const s = orderStatusMap[value];
                  return s ? <Tag color={s.color}>{s.text}</Tag> : value;
                },
              },
              {
                title: '原因',
                dataIndex: 'reason',
                render: (value: string | null) => value || '-',
              },
              {
                title: '时间',
                dataIndex: 'createdAt',
                width: 180,
                render: (value: string) => formatDateTime(value),
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
