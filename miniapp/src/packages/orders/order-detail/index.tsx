import { Button, Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { MiniAfterSaleRepo } from '@/packages/after-sales/repo';
import { OrderRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import type { Order, RepurchaseResult, Result } from '@/types';
import {
  ORDER_STATUS_META,
  canCancelPaidOrder,
  canConfirmReplacementOrder,
  canConfirmOrder,
  canRepurchaseOrder,
  formatMoney,
  formatOrderTime,
  groupOrderItems,
  repurchasePresentation,
} from '../_components/order-utils';
import './index.scss';

const INVOICE_STATUS_LABELS: Record<NonNullable<Order['invoiceStatus']>, string> = {
  REQUESTED: '开票处理中',
  ISSUED: '发票已开具',
  FAILED: '开票未成功',
  CANCELED: '开票申请已取消',
};

function refundStatusText(refund: NonNullable<Order['refundSummary']>): string {
  const amount = formatMoney(refund.amount);
  const labels: Record<typeof refund.status, string> = {
    REQUESTED: '退款申请已提交，等待审核',
    APPROVED: `退款已同意，处理中 ¥${amount}`,
    REJECTED: '退款申请被拒绝，请联系客服',
    REFUNDING: `退款处理中 ¥${amount}，预计 1-3 个工作日到账`,
    REFUNDED: `已原路退回 ¥${amount}`,
    FAILED: '退款失败，请联系客服处理',
  };
  return labels[refund.status];
}

function Section({ index, title, children, action }: { index: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <View className='order-detail-section aim-card'><View className='order-detail-section__head'><View className='order-detail-section__index'>{index}</View><Text className='order-detail-section__title'>{title}</Text>{action}</View>{children}</View>;
}

function addressText(order: Order): { name: string; phone: string; line: string } | null {
  if (order.address) return { name: order.address.recipientName, phone: order.address.recipientPhone, line: order.address.fullAddress };
  const snapshot = order.addressSnapshot;
  if (!snapshot) return null;
  return {
    name: snapshot.recipientName || snapshot.receiverName || '收货人',
    phone: snapshot.phone || '',
    line: `${snapshot.regionText?.replace(/\//g, ' ') || [snapshot.province, snapshot.city, snapshot.district].filter(Boolean).join('') || ''} ${snapshot.detail || ''}`.trim(),
  };
}

export default function OrderDetailPage() {
  const router = useRouter();
  const orderId = typeof router.params.id === 'string' ? router.params.id : '';
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const queryClient = useQueryClient();
  const orderQuery = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => OrderRepo.getById(orderId),
    enabled: hydrated && loggedIn && Boolean(orderId),
    refetchInterval: (query) => {
      const result = query.state.data;
      return result?.ok && !['RECEIVED', 'CANCELED', 'REFUNDED', 'PENDING_PAYMENT'].includes(result.data.status) ? 30_000 : false;
    },
  });
  useDidShow(() => { if (orderId && useAuthStore.getState().accessToken) void orderQuery.refetch(); });
  const order = orderQuery.data?.ok ? orderQuery.data.data : undefined;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
  };
  const confirmMutation = useMutation({
    mutationFn: () => OrderRepo.confirmReceive(orderId),
    onSuccess: async (result) => { if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '确认失败', icon: 'none' }); return; } await refresh(); Taro.showToast({ title: '已确认收货', icon: 'success' }); },
    onError: () => Taro.showToast({ title: '网络开小差了', icon: 'none' }),
  });
  const cancelMutation = useMutation({
    mutationFn: () => OrderRepo.cancelPaidUnshipped(orderId),
    onSuccess: async (result) => { if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '取消失败', icon: 'none' }); return; } await refresh(); Taro.showToast({ title: '已取消，退款将原路处理', icon: 'none', duration: 2200 }); },
    onError: () => Taro.showToast({ title: '网络开小差了', icon: 'none' }),
  });
  const repurchaseMutation = useMutation({
    mutationFn: (): Promise<Result<RepurchaseResult>> => OrderRepo.repurchase(orderId),
    onSuccess: async (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '再次购买失败', icon: 'none' }); return; }
      queryClient.setQueryData(['commerce', 'cart'], { ok: true, data: result.data.cart });
      const presentation = repurchasePresentation(result.data);
      const modal = await Taro.showModal({ title: presentation.title, content: presentation.lines.join('\n') || '原订单商品当前不可购买', showCancel: presentation.canOpenCart, cancelText: '留在本页', confirmText: presentation.canOpenCart ? '去购物车' : '知道了', confirmColor: '#2E7D32' });
      if (presentation.canOpenCart && modal.confirm) void Taro.navigateTo({ url: '/packages/commerce/cart/index' });
    },
    onError: () => Taro.showToast({ title: '网络开小差了', icon: 'none' }),
  });
  const confirmReplacementMutation = useMutation({
    mutationFn: (afterSaleId: string) => MiniAfterSaleRepo.confirmReceive(afterSaleId),
    onSuccess: async (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '确认失败', icon: 'none' }); return; }
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['after-sales'] });
      await queryClient.invalidateQueries({ queryKey: ['after-sale', result.data.id] });
      Taro.showToast({ title: '已确认收到换货', icon: 'success' });
    },
    onError: () => Taro.showToast({ title: '网络开小差了', icon: 'none' }),
  });

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后才能查看订单详情' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(`/packages/orders/order-detail/index?id=${orderId}`)}` })} /></View>;
  if (!orderId) return <View className='aim-page'><CatalogFeedback kind='error' title='订单信息缺失' description='请从订单列表重新进入' /></View>;
  if (orderQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!order) return <View className='aim-page'><CatalogFeedback kind='error' title='订单加载失败' description={orderQuery.data && !orderQuery.data.ok ? orderQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => orderQuery.refetch()} /></View>;

  const meta = ORDER_STATUS_META[order.status];
  const address = addressText(order);
  const itemGroups = groupOrderItems(order.items);
  const logistics = order.logisticsSummary;
  const existingInvoice = order.invoice;
  const invoiceStatus = existingInvoice?.status ?? order.invoiceStatus ?? null;
  const existingAfterSale = order.afterSaleSummary;
  const refund = order.refundSummary;
  const replacementConfirmable = canConfirmReplacementOrder(order);
  const repurchaseAllowed = canRepurchaseOrder(order) && !replacementConfirmable;
  const busy = confirmMutation.isPending || cancelMutation.isPending || repurchaseMutation.isPending || confirmReplacementMutation.isPending;
  const confirmReceive = async () => { const modal = await Taro.showModal({ title: '确认收货', content: '请确认商品已收到且无异常。', confirmText: '确认收货', confirmColor: '#2E7D32' }); if (modal.confirm && !busy) confirmMutation.mutate(); };
  const cancelOrder = async () => { const modal = await Taro.showModal({ title: '取消已付款订单', content: '取消后将申请原路退款，到账时间以原支付渠道的实际处理结果为准。', confirmText: '确认取消', confirmColor: '#A04B42' }); if (modal.confirm && !busy) cancelMutation.mutate(); };

  return <View className='order-detail-page'>
    <ScrollView className='order-detail-scroll' scrollY enhanced refresherEnabled refresherTriggered={orderQuery.isRefetching} onRefresherRefresh={() => orderQuery.refetch()}>
      <View className={`order-detail-hero order-detail-hero--${meta.tone}`}><Text className='order-detail-hero__eyebrow'>订单履约进度</Text><Text className='order-detail-hero__status'>{meta.label}</Text><Text className='order-detail-hero__hint'>{meta.hint}</Text>{order.status === 'PENDING_PAYMENT' ? <View className='order-detail-hero__history'>历史待支付记录不支持续付，请重新选购商品</View> : null}</View>
      <View className='order-detail-content'>
        {refund ? <View className={refund.status === 'FAILED' || refund.status === 'REJECTED' ? 'order-refund-card order-refund-card--alert aim-card' : 'order-refund-card aim-card'}><View className='order-refund-card__icon'>退</View><View><Text className='order-refund-card__title'>{refundStatusText(refund)}</Text><Text className='order-refund-card__reason'>{refund.reason || '退款进度以原支付渠道实际处理结果为准'}</Text></View></View> : null}
        <Section index='01' title='物流进度' action={logistics ? <Text className='order-detail-section__link' onClick={() => Taro.navigateTo({ url: `/packages/orders/order-track/index?orderId=${encodeURIComponent(order.id)}` })}>全部轨迹 ›</Text> : null}>
          {logistics?.latestEventMessage ? <View className='order-logistics-brief' onClick={() => Taro.navigateTo({ url: `/packages/orders/order-track/index?orderId=${encodeURIComponent(order.id)}` })}><View className='order-logistics-brief__dot' /><View><Text>{logistics.latestEventMessage}</Text><Text>{formatOrderTime(logistics.latestEventTime)}</Text></View></View> : <Text className='order-detail-empty-line'>{order.status === 'PAID' ? '商家备货中，暂无物流轨迹' : '暂无物流信息'}</Text>}
        </Section>
        <Section index='02' title='收货信息' action={order.receiverInfoEditable && order.status === 'PAID' ? <Text className='order-detail-section__link' onClick={() => Taro.navigateTo({ url: `/packages/orders/receiver-info/index?id=${encodeURIComponent(order.id)}` })}>发货前修改 ›</Text> : null}>
          {address ? <View className='order-address'><Text className='order-address__name'>{address.name} 　{address.phone}</Text><Text className='order-address__line'>{address.line}</Text></View> : <Text className='order-detail-empty-line'>暂无收货信息</Text>}
        </Section>
        <Section index='03' title='商品明细'>
          {itemGroups.map((group) => <View className='order-shop' key={group.key}><Text className='order-shop__name'>{group.companyName}</Text>{group.items.map((item) => <View className='order-detail-item' key={item.id}><Image className='order-detail-item__image' src={item.image || ''} mode='aspectFill' /><View className='order-detail-item__copy'><Text className='order-detail-item__title'>{item.title}</Text><Text className='order-detail-item__sku'>{item.isPrize ? '赠品' : item.skuTitle || '默认规格'}</Text></View><View className='order-detail-item__price'><Text>{order.bizType === 'VIP_PACKAGE' ? '赠品' : `¥${formatMoney(item.price)}`}</Text><Text>×{item.quantity}</Text></View></View>)}</View>)}
        </Section>
        <Section index='04' title='金额明细'>
          <View className='order-amount-row'><Text>商品金额</Text><Text>¥{formatMoney(order.goodsAmount ?? order.items.reduce((sum, item) => sum + item.price * item.quantity, 0))}</Text></View>
          <View className='order-amount-row'><Text>运费</Text><Text>{order.shippingFee ? `¥${formatMoney(order.shippingFee)}` : '免运费'}</Text></View>
          {order.vipDiscountAmount ? <View className='order-amount-row order-amount-row--discount'><Text>VIP 折扣</Text><Text>-¥{formatMoney(order.vipDiscountAmount)}</Text></View> : null}
          {order.discountAmount ? <View className='order-amount-row order-amount-row--discount'><Text>消费积分抵扣</Text><Text>-¥{formatMoney(order.discountAmount)}</Text></View> : null}
          {order.totalCouponDiscount ? <View className='order-amount-row order-amount-row--coupon'><Text>平台红包抵扣</Text><Text>-¥{formatMoney(order.totalCouponDiscount)}</Text></View> : null}
          <View className='order-amount-row order-amount-row--total'><Text>实付金额</Text><Text>¥{formatMoney(order.totalPrice)}</Text></View>
        </Section>
        <Section index='05' title='订单信息'>
          <View className='order-info-row'><Text>订单号</Text><Text className='order-info-row__copy' onClick={() => Taro.setClipboardData({ data: order.id })}>{order.id} 复制</Text></View>
          <View className='order-info-row'><Text>创建时间</Text><Text>{formatOrderTime(order.createdAt)}</Text></View>
          {order.paidAt ? <View className='order-info-row'><Text>付款时间</Text><Text>{formatOrderTime(order.paidAt)}</Text></View> : null}
          {order.shippedAt ? <View className='order-info-row'><Text>发货时间</Text><Text>{formatOrderTime(order.shippedAt)}</Text></View> : null}
          <View className='order-info-row'><Text>支付方式</Text><Text>{order.paymentMethod === 'wechat' ? '微信支付' : order.paymentMethod === 'other' ? '其他历史支付渠道' : '—'}</Text></View>
        </Section>
        <Section index='06' title='买家留言'><Text className='order-buyer-note'>{order.buyerNote || '未填写留言'}</Text></Section>
        <Section index='07' title='可用操作'>
          <Text className='order-detail-empty-line'>{replacementConfirmable ? '换货商品已发出，请收货后确认' : existingAfterSale ? '该订单已有售后记录，可进入查看处理进度' : invoiceStatus ? INVOICE_STATUS_LABELS[invoiceStatus] : order.status === 'PENDING_PAYMENT' ? '仅可查看历史记录' : canCancelPaidOrder(order) ? '发货前可修收货信息或取消并申请退款' : canConfirmOrder(order) ? '可查看物流并确认收货' : repurchaseAllowed ? '可按当前库存和价格再次购买' : '当前没有可执行的订单操作'}</Text>
          {order.status !== 'PENDING_PAYMENT' ? <View className='order-detail-service-actions'>
            {existingAfterSale ? <Button onClick={() => Taro.navigateTo({ url: `/packages/after-sales/after-sale-detail/index?id=${encodeURIComponent(existingAfterSale.id)}` })}>查看售后</Button> : order.bizType !== 'VIP_PACKAGE' && order.bizType !== 'GROUP_BUY' && ['DELIVERED', 'RECEIVED'].includes(order.status) && order.items.some((item) => !item.isPrize) ? <Button onClick={() => Taro.navigateTo({ url: `/packages/after-sales/after-sale-apply/index?orderId=${encodeURIComponent(order.id)}` })}>申请售后</Button> : null}
            <Button onClick={() => Taro.navigateTo({ url: '/packages/after-sales/after-sale-list/index' })}>售后记录</Button>
            {invoiceStatus ? <Button onClick={() => Taro.navigateTo({ url: existingInvoice?.id ? `/packages/invoices/invoice-detail/index?id=${encodeURIComponent(existingInvoice.id)}` : '/packages/invoices/invoice-list/index' })}>查看发票</Button> : order.invoiceEligible === true ? <Button onClick={() => Taro.navigateTo({ url: `/packages/invoices/invoice-request/index?orderId=${encodeURIComponent(order.id)}` })}>申请发票</Button> : null}
            <Button onClick={() => Taro.navigateTo({ url: `/packages/customer-service/chat/index?source=ORDER_DETAIL&sourceId=${encodeURIComponent(order.id)}` })}>订单客服</Button>
          </View> : null}
        </Section>
      </View>
    </ScrollView>
    {canCancelPaidOrder(order) || canConfirmOrder(order) || repurchaseAllowed || replacementConfirmable ? <View className='order-detail-bar'>
      {canCancelPaidOrder(order) ? <><Button className='order-detail-bar__secondary' disabled={busy} onClick={cancelOrder}>{cancelMutation.isPending ? '取消中...' : '取消订单'}</Button>{order.receiverInfoEditable ? <Button className='order-detail-bar__primary' onClick={() => Taro.navigateTo({ url: `/packages/orders/receiver-info/index?id=${encodeURIComponent(order.id)}` })}>修收货信息</Button> : null}</> : null}
      {canConfirmOrder(order) ? <><Button className='order-detail-bar__secondary' onClick={() => Taro.navigateTo({ url: `/packages/orders/order-track/index?orderId=${encodeURIComponent(order.id)}` })}>查看物流</Button><Button className='order-detail-bar__primary' disabled={busy} onClick={confirmReceive}>{confirmMutation.isPending ? '处理中...' : '确认收货'}</Button></> : null}
      {replacementConfirmable ? <Button className='order-detail-bar__primary order-detail-bar__primary--wide' disabled={busy} onClick={() => confirmReplacementMutation.mutate(existingAfterSale!.id)}>{confirmReplacementMutation.isPending ? '处理中...' : '确认收到换货'}</Button> : null}
      {repurchaseAllowed ? <Button className='order-detail-bar__primary order-detail-bar__primary--wide' disabled={busy} onClick={() => repurchaseMutation.mutate()}>{repurchaseMutation.isPending ? '加入中...' : '再次购买'}</Button> : null}
    </View> : null}
  </View>;
}
