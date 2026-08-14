import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Card, Descriptions, Table, Tag, Button, Spin, Breadcrumb, Steps, Alert, Typography, Modal, Form, Input, Space } from 'antd';
import { ArrowLeftOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { cancelPickupAndRefund, getOrder, getPickupEvents, retryRefund, retryWechatShipping, updateOrderReceiverInfo } from '@/api/orders';
import PermissionGate from '@/components/PermissionGate';
import BuyerIdentityText from '@/components/BuyerIdentityText';
import type { OrderItem, PickupFulfillmentEvent, Refund } from '@/types';
import { PERMISSIONS } from '@/constants/permissions';
import { orderStatusMap, refundStatusMap, shipmentStatusMap } from '@/constants/statusMaps';
import dayjs from 'dayjs';
import { formatPickupBusinessHours, pickupFullAddress, pickupStatusMap } from '@/utils/pickup';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';

// 订单生命周期状态步骤
const statusSteps = [
  { key: 'PAID', title: '已付款' },
  { key: 'SHIPPED', title: '已发货' },
  { key: 'DELIVERED', title: '已送达' },
  { key: 'RECEIVED', title: '已收货' },
];

// 支付方式枚举 → 中文显示（key 与后端 PaymentChannel enum 对齐）
const paymentChannelLabel: Record<string, string> = {
  ALIPAY: '支付宝',
  WECHAT_PAY: '微信支付',
  UNIONPAY: '银联支付',
  AGGREGATOR: '聚合支付',
};

const formatDateTime = (value?: string | null) =>
  value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-';

type ReceiverInfoFormValues = {
  recipientName: string;
  phone: string;
  regionCode: string;
  regionText: string;
  detail: string;
};

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
  const [receiverInfoForm] = Form.useForm<ReceiverInfoFormValues>();
  const [receiverInfoModalOpen, setReceiverInfoModalOpen] = useState(false);
  const [receiverInfoSaving, setReceiverInfoSaving] = useState(false);
  const [wechatShippingRetrying, setWechatShippingRetrying] = useState(false);
  const [pickupCanceling, setPickupCanceling] = useState(false);

  const { data: order, isLoading } = useQuery({
    queryKey: ['admin', 'order', id],
    queryFn: () => getOrder(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.wechatShipping?.status;
      const pickupStatus = query.state.data?.pickupFulfillment?.status;
      if (pickupStatus === 'PREPARING' || pickupStatus === 'READY') return 15_000;
      return status === 'PENDING' || status === 'PROCESSING' ? 5_000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const { data: pickupEventsResponse, isLoading: pickupEventsLoading } = useQuery({
    queryKey: ['admin', 'order', id, 'pickup-events'],
    queryFn: () => getPickupEvents(id!),
    enabled: Boolean(id && order?.fulfillmentMode === 'PICKUP'),
    refetchInterval: order?.pickupFulfillment?.status === 'PREPARING'
      || order?.pickupFulfillment?.status === 'READY'
      ? 15_000
      : false,
  });

  const handleWechatShippingRetry = async () => {
    if (!id || wechatShippingRetrying) return;
    if (order?.fulfillmentMode === 'PICKUP') {
      message.error('到店自提订单不进入微信物流发货上报');
      return;
    }
    setWechatShippingRetrying(true);
    try {
      await retryWechatShipping(id);
      message.success('已重新加入微信发货上报队列');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'order', id] });
    } catch (error: unknown) {
      message.error(getAdminErrorMessage(error, '重试失败'));
    } finally {
      setWechatShippingRetrying(false);
    }
  };

  if (isLoading) return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>;
  if (!order) return (
    <div style={{ padding: 24, textAlign: 'center', paddingTop: 100 }}>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>返回</Button>
      <div style={{ color: '#999' }}>订单不存在或加载失败</div>
    </div>
  );

  const status = orderStatusMap[order.status];
  const isPickup = order.fulfillmentMode === 'PICKUP';
  const pickup = order.pickupFulfillment;
  const pickupStatus = pickup ? pickupStatusMap[pickup.status] : null;
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
  const canEditReceiverInfo = !isPickup && Boolean(order.receiverInfoEditable);
  const openReceiverInfoModal = () => {
    receiverInfoForm.setFieldsValue({
      recipientName: recipientName === '-' ? '' : recipientName,
      phone: phone === '-' ? '' : phone,
      regionCode: String(address.regionCode || ''),
      regionText: regionText || legacyRegion,
      detail,
    });
    setReceiverInfoModalOpen(true);
  };
  const closeReceiverInfoModal = () => {
    setReceiverInfoModalOpen(false);
    receiverInfoForm.resetFields();
  };
  const handleUpdateReceiverInfo = async (values: ReceiverInfoFormValues) => {
    if (isPickup) {
      message.error('到店自提订单没有配送地址，不能修改收货信息');
      return;
    }
    setReceiverInfoSaving(true);
    try {
      await updateOrderReceiverInfo(order.id, {
        recipientName: values.recipientName.trim(),
        phone: values.phone.trim(),
        regionCode: values.regionCode.trim(),
        regionText: values.regionText.trim(),
        detail: values.detail.trim(),
      });
      message.success('配送信息已更新');
      closeReceiverInfoModal();
      queryClient.invalidateQueries({ queryKey: ['admin', 'order', id] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '配送信息更新失败');
    } finally {
      setReceiverInfoSaving(false);
    }
  };

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
  // 终态时间：从 statusHistory 找 CANCELED / REFUNDED 跃迁；没有就 fallback 到 updatedAt
  const terminalTime = (() => {
    if (isCanceled) {
      const entry = order.statusHistory?.find((h) => h.toStatus === 'CANCELED');
      return entry?.createdAt || order.updatedAt;
    }
    if (isRefunded) {
      const entry = order.statusHistory?.find((h) => h.toStatus === 'REFUNDED');
      return entry?.createdAt || order.refunds?.[0]?.createdAt || order.updatedAt;
    }
    return null;
  })();
  // 退款进行中（订单未 REFUNDED 但有 REFUNDING 退款单）—— 主线末尾追加橙色提示
  const refundInProgress =
    !isRefunded && (order.refunds?.some((r) => r.status === 'REFUNDING') ?? false);

  // 主线节点：根据状态裁剪 + 终态节点
  type TimelineNode = {
    label: string;
    time?: string | null;
    status: 'finish' | 'wait' | 'error' | 'process';
  };
  const timelineNodes: TimelineNode[] = (() => {
    const reached = (t?: string | null) => (t ? 'finish' : 'wait') as 'finish' | 'wait';
    if (isCanceled) {
      // 取消：保留下单 + 支付（支付前取消支付节点也用 wait）+ 已取消
      return [
        { label: '下单', time: order.createdAt, status: 'finish' },
        { label: '支付', time: order.paidAt, status: reached(order.paidAt) },
        { label: '已取消', time: terminalTime, status: 'error' },
      ];
    }
    const main: TimelineNode[] = isPickup
      ? pickup
        ? [
            { label: '下单', time: order.createdAt, status: 'finish' },
            { label: '支付', time: order.paidAt, status: reached(order.paidAt) },
            { label: '备货完成', time: pickup.readyAt, status: reached(pickup.readyAt) },
            { label: '核销取货', time: pickup.pickedUpAt, status: reached(pickup.pickedUpAt) },
          ]
        : [
            { label: '下单', time: order.createdAt, status: 'finish' },
            { label: '支付', time: order.paidAt, status: reached(order.paidAt) },
          ]
      : [
          { label: '下单', time: order.createdAt, status: 'finish' },
          { label: '支付', time: order.paidAt, status: reached(order.paidAt) },
          { label: '发货', time: shippedAt, status: reached(shippedAt) },
          { label: '送达', time: order.deliveredAt, status: reached(order.deliveredAt) },
          { label: '收货', time: order.receivedAt, status: reached(order.receivedAt) },
        ];
    if (isRefunded) {
      main.push({ label: '已退款', time: terminalTime, status: 'error' });
    } else if (refundInProgress) {
      main.push({ label: '退款处理中', time: undefined, status: 'process' });
    }
    return main;
  })();

  // 退货窗口剩余天数（用于提示标签）
  const returnWindowInfo = (() => {
    if (!order.returnWindowExpiresAt) return null;
    if (order.bizType === 'VIP_PACKAGE') return null; // VIP 礼包不退
    const expiresAt = dayjs(order.returnWindowExpiresAt);
    const now = dayjs();
    const expired = expiresAt.isBefore(now);
    const daysLeft = expiresAt.diff(now, 'day');
    return { expiresAt: order.returnWindowExpiresAt, expired, daysLeft };
  })();

  // 预计自动收货（仅未收货 + 未到期时提示，已收货后不再有意义）
  const autoReceiveInfo = (() => {
    if (isPickup) return null;
    if (!order.autoReceiveAt) return null;
    if (order.receivedAt) return null;
    if (isCanceled || isRefunded) return null;
    const at = dayjs(order.autoReceiveAt);
    if (at.isBefore(dayjs())) return null; // 已过期（按理已自动确认）
    return order.autoReceiveAt;
  })();
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

  const handlePickupCancelRefund = () => {
    let reason = '';
    modal.confirm({
      title: '受控取消自提订单并原路退款？',
      width: 560,
      okText: '确认取消并退款',
      cancelText: '返回检查',
      okButtonProps: { danger: true },
      content: (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Alert
            type="error"
            showIcon
            message="这是资金操作，提交后不能恢复"
            description="仅用于普通商品自提点闭店、缺货或平台确认的异常。同一结算会话含多商家时，为保证共享红包和积分一致，所有仍待履约的子订单可能一并取消并原路退款。"
          />
          <Input.TextArea
            rows={3}
            maxLength={500}
            showCount
            placeholder="必填：记录闭店、缺货或争议处理依据（至少 5 个字）"
            onChange={(event) => { reason = event.target.value; }}
          />
        </Space>
      ),
      onOk: async () => {
        if (reason.trim().length < 5) {
          message.error('请填写至少 5 个字的异常处理原因');
          return Promise.reject(new Error('reason_required'));
        }
        setPickupCanceling(true);
        try {
          const result = await cancelPickupAndRefund(order.id, reason.trim());
          const pendingRefunds = result.refunds?.filter((refund) => refund.status !== 'REFUNDED') ?? [];
          const acceptedCopy = result.affectedOrderIds && result.affectedOrderIds.length > 1
            ? `已受理 ${result.affectedOrderIds.length} 笔关联订单的原路退款`
            : '已取消订单并提交原路退款';
          if (pendingRefunds.length > 0) {
            message.warning(`${acceptedCopy}，其中 ${pendingRefunds.length} 笔仍在处理，请在退款记录中继续复核`);
          } else {
            message.success(`${acceptedCopy}，渠道已全部确认成功`);
          }
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['admin', 'order', id] }),
            queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] }),
            queryClient.invalidateQueries({ queryKey: ['admin', 'order', id, 'pickup-events'] }),
          ]);
        } catch (error) {
          message.error(getAdminErrorMessage(error, '受控取消退款失败'));
          throw error;
        } finally {
          setPickupCanceling(false);
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

      {isPickup && !pickup && (
        <Alert
          type="error"
          showIcon
          message="自提履约记录缺失"
          description="该订单已标记为到店自提，但没有可读取的自提履约记录。发货、微信物流上报和改地址操作已保持禁用，请检查支付建单和数据一致性。"
          style={{ marginBottom: 16 }}
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
        ) : isPickup ? (
          pickup ? (
            <Steps
              current={pickup.status === 'PICKED_UP' ? 2 : pickup.status === 'READY' ? 1 : 0}
              items={[
                { title: '备货中', description: formatDateTime(order.paidAt) },
                { title: '待自提', description: formatDateTime(pickup.readyAt) },
                { title: '已取货', description: formatDateTime(pickup.pickedUpAt) },
              ]}
            />
          ) : (
            <Alert type="error" showIcon message="无法展示自提进度：履约记录缺失" />
          )
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
          <Descriptions.Item label="履约方式">
            <Tag color={isPickup ? 'green' : 'blue'}>{isPickup ? '到店自提' : '送货上门'}</Tag>
            {pickupStatus && <Tag color={pickupStatus.color}>{pickupStatus.text}</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="用户">
            <BuyerIdentityText
              buyerNo={order.user?.buyerNo}
              userId={order.user?.id || order.userId}
              nickname={order.user?.nickname || order.user?.phone || '-'}
              compact
            />
          </Descriptions.Item>
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
        <Steps
          size="small"
          labelPlacement="vertical"
          items={timelineNodes.map((node) => ({
            title: node.label,
            description: (
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#888' }}>
                {node.time ? formatDateTime(node.time) : '—'}
              </span>
            ),
            status: node.status,
          }))}
        />

        {/* Deadline 区：退货窗口 + 预计自动收货（不混在主线节点里） */}
        {(returnWindowInfo || autoReceiveInfo) && (
          <div
            style={{
              marginTop: 24,
              paddingTop: 16,
              borderTop: '1px dashed #f0f0f0',
              display: 'flex',
              gap: 32,
              flexWrap: 'wrap',
              fontSize: 13,
            }}
          >
            {returnWindowInfo && (
              <div>
                <span style={{ color: '#888', marginRight: 8 }}>退货窗口截止：</span>
                <span style={{ fontFamily: 'monospace', marginRight: 8 }}>
                  {formatDateTime(returnWindowInfo.expiresAt)}
                </span>
                {returnWindowInfo.expired ? (
                  <Tag color="default">已过期</Tag>
                ) : (
                  <Tag color="orange">还剩 {returnWindowInfo.daysLeft} 天</Tag>
                )}
              </div>
            )}
            {autoReceiveInfo && (
              <div>
                <span style={{ color: '#888', marginRight: 8 }}>预计自动收货：</span>
                <span style={{ fontFamily: 'monospace' }}>
                  {formatDateTime(autoReceiveInfo)}
                </span>
              </div>
            )}
          </div>
        )}
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

      {!isPickup && order.paymentMethod === 'WECHAT_PAY' && order.paymentScene === 'MINI_PROGRAM' && (
        <Card title="微信小程序交易发货" style={{ marginBottom: 16 }}>
          {order.wechatShipping ? (
            <Descriptions bordered column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="上报状态">
                <Tag color={{ PENDING: 'processing', PROCESSING: 'blue', SUCCEEDED: 'success', FAILED: 'error' }[order.wechatShipping.status]}>
                  {{ PENDING: '待上报', PROCESSING: '上报中', SUCCEEDED: '已上报', FAILED: '失败' }[order.wechatShipping.status]}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="尝试次数">{order.wechatShipping.attemptCount}</Descriptions.Item>
              <Descriptions.Item label="最后更新">{formatDateTime(order.wechatShipping.updatedAt)}</Descriptions.Item>
              <Descriptions.Item label="成功时间">{formatDateTime(order.wechatShipping.succeededAt)}</Descriptions.Item>
              {order.wechatShipping.lastError && (
                <Descriptions.Item label="最近错误" span={2}>
                  <Alert
                    type="error"
                    showIcon
                    message={order.wechatShipping.lastErrorCode || '微信平台返回失败'}
                    description={order.wechatShipping.lastError}
                    action={order.wechatShipping.status === 'FAILED' ? (
                      <PermissionGate permission={PERMISSIONS.ORDERS_SHIP}>
                        <Button
                          size="small"
                          icon={<ReloadOutlined />}
                          loading={wechatShippingRetrying}
                          onClick={handleWechatShippingRetry}
                        >
                          重新上报
                        </Button>
                      </PermissionGate>
                    ) : undefined}
                  />
                </Descriptions.Item>
              )}
            </Descriptions>
          ) : (
            <Alert type="info" showIcon message="订单发货后将自动创建微信发货上报任务" />
          )}
        </Card>
      )}

      {isPickup && pickup && (
        <Card
          title="自提履约信息"
          style={{ marginBottom: 16 }}
          extra={order.bizType === 'NORMAL_GOODS'
            && order.status === 'PAID'
            && (pickup.status === 'PREPARING' || pickup.status === 'READY') ? (
              <PermissionGate permission={PERMISSIONS.ORDERS_REFUND}>
                <Button danger loading={pickupCanceling} onClick={handlePickupCancelRefund}>
                  异常取消并退款
                </Button>
              </PermissionGate>
            ) : null}
        >
          <Alert
            type="info"
            showIcon
            message="管理端只读展示履约凭证状态"
            description="明文取货码和二维码 token 不会返回管理后台；核销由订单所属商家完成。"
            style={{ marginBottom: 16 }}
          />
          {(order.bizType === 'VIP_PACKAGE' || order.bizType === 'GROUP_BUY') && order.status === 'PAID' ? (
            <Alert
              type="warning"
              showIcon
              message="当前业务类型不开放在线异常退款"
              description="团购与 VIP 礼包继续遵守各自取消规则；如自提点无法履约，请由客服登记并走专项人工处理，不能直接回滚团购资格或 VIP 身份。"
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <Descriptions bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="履约状态">
              <Tag color={pickupStatus?.color}>{pickupStatus?.text || pickup.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="自提点">{pickup.pickupPoint.name}</Descriptions.Item>
            <Descriptions.Item label="地址" span={2}>
              {pickupFullAddress(pickup.pickupPoint)}
            </Descriptions.Item>
            <Descriptions.Item label="营业时间">
              {formatPickupBusinessHours(pickup.pickupPoint.businessHours)}
            </Descriptions.Item>
            <Descriptions.Item label="自提人">
              {pickup.recipient?.name || '-'} / {pickup.recipient?.phoneMasked || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="备货完成时间">{formatDateTime(pickup.readyAt)}</Descriptions.Item>
            <Descriptions.Item label="核销时间">{formatDateTime(pickup.pickedUpAt)}</Descriptions.Item>
            <Descriptions.Item label="核销员工" span={2}>
              {pickup.pickedUpByStaffId ? (
                <Typography.Text copyable>{pickup.pickedUpByStaffId}</Typography.Text>
              ) : '-'}
            </Descriptions.Item>
            {pickup.pickupPoint.pickupNotice && (
              <Descriptions.Item label="取货须知" span={2}>
                {pickup.pickupPoint.pickupNotice}
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>
      )}

      {isPickup && (
        <Card title="自提核销审计" style={{ marginBottom: 16 }}>
          <Table<PickupFulfillmentEvent>
            rowKey="id"
            loading={pickupEventsLoading}
            pagination={false}
            size="small"
            dataSource={pickupEventsResponse?.items || []}
            locale={{ emptyText: '暂无自提履约事件' }}
            columns={[
              { title: '事件', dataIndex: 'eventType', render: (value: string) => value || '-' },
              {
                title: '状态变化',
                render: (_value, event) => (
                  <span>
                    {event.fromStatus ? pickupStatusMap[event.fromStatus]?.text || event.fromStatus : '-'}
                    {' → '}
                    {pickupStatusMap[event.toStatus]?.text || event.toStatus}
                  </span>
                ),
              },
              {
                title: '操作主体',
                render: (_value, event) => (
                  <Space direction="vertical" size={0}>
                    <span>{event.actorType}</span>
                    {event.actorId && <Typography.Text type="secondary" copyable>{event.actorId}</Typography.Text>}
                  </Space>
                ),
              },
              {
                title: '原因 / 详情',
                render: (_value, event) => {
                  const meta = event.meta && typeof event.meta === 'object'
                    ? event.meta as Record<string, unknown>
                    : null;
                  const reason = typeof meta?.reason === 'string' ? meta.reason : null;
                  return reason || (meta ? <Typography.Text code>{JSON.stringify(meta)}</Typography.Text> : '-');
                },
              },
              { title: '时间', dataIndex: 'createdAt', render: (value: string) => formatDateTime(value) },
            ]}
          />
        </Card>
      )}

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
      {!isPickup && shipments.length > 0 && (
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
                // 顺丰下单时传给 SF 的客户订单号（${bizNo}_${companyId}），调
                // EXP_RECE_UPDATE_ORDER / SEARCH_ORDER_RESP 时填这个，不是 Order.id
                title: '顺丰订单号',
                render: (_value, record) => {
                  const sfOrderId = record.sfOrderId;
                  if (!sfOrderId) return '-';
                  return (
                    <Typography.Text copyable={{ text: sfOrderId }} style={{ fontFamily: 'monospace' }}>
                      {sfOrderId}
                    </Typography.Text>
                  );
                },
              },
              {
                title: '状态',
                dataIndex: 'status',
                render: (value: string | undefined) => {
                  const s = value ? shipmentStatusMap[value] : undefined;
                  return s ? <Tag color={s.color}>{s.text}</Tag> : value || '-';
                },
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

      {/* 配送信息 */}
      {!isPickup && order.address && (
        <Card
          title="配送信息"
          extra={(
            <PermissionGate permission={PERMISSIONS.ORDERS_SHIP}>
              <Button
                size="small"
                icon={<EditOutlined />}
                disabled={!canEditReceiverInfo}
                title={canEditReceiverInfo ? undefined : '仅已付款且未生成电子面单的配送订单可修改'}
                onClick={openReceiverInfoModal}
              >
                修改配送信息
              </Button>
            </PermissionGate>
          )}
        >
          <Descriptions bordered column={1}>
            <Descriptions.Item label="收件人">{recipientName}</Descriptions.Item>
            <Descriptions.Item label="电话">{phone}</Descriptions.Item>
            <Descriptions.Item label="地址">{fullAddress}</Descriptions.Item>
            <Descriptions.Item label="地区编码">{String(address.regionCode || '-')}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      <Modal
        title="修改配送信息"
        open={receiverInfoModalOpen}
        onCancel={closeReceiverInfoModal}
        onOk={() => receiverInfoForm.submit()}
        confirmLoading={receiverInfoSaving}
        okText="保存修改"
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          message="只修改当前订单的配送信息，不同步买家地址簿或账号手机号。已生成电子面单后不能修改。"
          style={{ marginBottom: 16 }}
        />
        <Form form={receiverInfoForm} layout="vertical" onFinish={handleUpdateReceiverInfo}>
          <Form.Item
            name="recipientName"
            label="收件人"
            rules={[
              { required: true, message: '请输入收件人' },
              { max: 50, message: '收件人不能超过 50 个字符' },
            ]}
          >
            <Input placeholder="请输入收件人" maxLength={50} />
          </Form.Item>
          <Form.Item
            name="phone"
            label="手机号"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的 11 位手机号' },
            ]}
          >
            <Input placeholder="请输入 11 位手机号" maxLength={11} />
          </Form.Item>
          <Form.Item
            name="regionText"
            label="省市区"
            rules={[
              { required: true, message: '请输入省市区' },
              { max: 120, message: '省市区不能超过 120 个字符' },
            ]}
            extra="例如：广西壮族自治区/梧州市/岑溪市"
          >
            <Input placeholder="省/市/区" maxLength={120} />
          </Form.Item>
          <Form.Item
            name="regionCode"
            label="地区编码"
            rules={[
              { required: true, message: '请输入地区编码' },
              { max: 32, message: '地区编码不能超过 32 个字符' },
            ]}
            extra="使用订单原地区编码；历史订单没有编码时需补充 6 位行政区划码"
          >
            <Input placeholder="如：450481" maxLength={32} />
          </Form.Item>
          <Form.Item
            name="detail"
            label="详细地址"
            rules={[
              { required: true, message: '请输入详细地址' },
              { max: 200, message: '详细地址不能超过 200 个字符' },
            ]}
          >
            <Input.TextArea placeholder="街道/小区/门牌号" maxLength={200} rows={3} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
