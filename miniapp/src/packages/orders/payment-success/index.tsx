import { Button, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { formatMoney } from '@/components/commerce-utils';
import { OrderRepo } from '@/repos';
import { MiniSubscriptionRepo, requestMiniProgramSubscriptions } from '@/platform/subscriptions';
import { useAuthStore } from '@/store/auth';
import { formatOrderTime, parsePaymentSuccessOrderIds, paymentSuccessPresentation } from '../_components/order-utils';
import './index.scss';

export default function PaymentSuccessPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const router = useRouter();
  const orderIds = parsePaymentSuccessOrderIds(
    typeof router.params.orderIds === 'string' ? router.params.orderIds : undefined,
  );
  const ordersQuery = useQuery({
    queryKey: ['orders', 'payment-success', orderIds],
    queryFn: async () => Promise.all(orderIds.map((id) => OrderRepo.getById(id))),
    enabled: hydrated && loggedIn && orderIds.length > 0,
    retry: false,
  });
  const templatesQuery = useQuery({
    queryKey: ['mini-program', 'subscription-templates'],
    queryFn: MiniSubscriptionRepo.templates,
    enabled: hydrated && loggedIn,
    staleTime: 5 * 60_000,
  });
  const verifiedOrders = ordersQuery.data?.every((result) => result.ok && result.data.paymentMethod === 'wechat')
    ? ordersQuery.data.flatMap((result) => result.ok ? [result.data] : [])
    : null;
  const amount = verifiedOrders?.reduce((total, order) => total + order.totalPrice, 0) ?? 0;
  const merchantOrderNo = verifiedOrders?.map((order) => order.merchantOrderNo).find((value): value is string => Boolean(value)) || null;
  const paidAt = verifiedOrders?.map((order) => order.paidAt).find((value): value is string => Boolean(value)) || null;
  const presentation = verifiedOrders ? paymentSuccessPresentation(verifiedOrders) : null;
  const openVerifiedDestination = async () => {
    if (!verifiedOrders?.length || !presentation) return;
    if (presentation.destination === 'VIP_CENTER') {
      await Taro.redirectTo({ url: '/packages/benefits/vip-center/index' });
      return;
    }
    if (presentation.destination === 'ORDER_DETAIL') {
      await Taro.redirectTo({ url: `/packages/orders/order-detail/index?id=${encodeURIComponent(verifiedOrders[0].id)}` });
      return;
    }
    await Taro.redirectTo({ url: '/packages/orders/order-list/index' });
  };
  const requestShippingReminder = async () => {
    const templates = templatesQuery.data?.ok ? templatesQuery.data.data : undefined;
    if (!templates) {
      Taro.showToast({ title: '提醒配置尚未加载，请稍后重试', icon: 'none' });
      return;
    }
    const result = await requestMiniProgramSubscriptions(['ORDER_SHIPPED'], templates);
    Taro.showToast({
      title: result.ok && result.data.accepted.length ? '已授权一次发货提醒' : result.ok ? '未开启发货提醒' : result.error.displayMessage || '订阅失败',
      icon: 'none',
    });
  };

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后才能核验微信支付结果' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(`/packages/orders/payment-success/index?orderIds=${encodeURIComponent(orderIds.join(','))}`)}` })} /></View>;
  if (!orderIds.length) return <View className='aim-page'><CatalogFeedback kind='error' title='缺少订单信息' description='请到订单中心查看实际支付和订单状态' actionLabel='查看订单' onRetry={() => Taro.redirectTo({ url: '/packages/orders/order-list/index' })} /></View>;
  if (ordersQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!verifiedOrders) return <View className='aim-page'><CatalogFeedback kind='error' title='支付结果仍在确认' description='请到订单中心刷新查看，已完成的订单会自动显示。' actionLabel='查看订单' onRetry={() => Taro.redirectTo({ url: '/packages/orders/order-list/index' })} /></View>;
  return (
    <View className='payment-success-page aim-page'>
      <View className='payment-success-mark'><Text>✓</Text><View /></View>
      <Text className='payment-success-title'>{presentation!.title}</Text>
      <Text className='payment-success-copy'>{presentation!.copy}</Text>
      {amount > 0 ? <Text className='payment-success-amount'>¥{formatMoney(amount)}</Text> : null}
      <View className='payment-success-receipt aim-card'>
        <View><Text>支付方式</Text><Text className='payment-success-receipt__wechat'>微信支付</Text></View>
        <View><Text>总订单号</Text><Text className={merchantOrderNo ? 'payment-success-receipt__copy' : ''} onClick={() => { if (merchantOrderNo) void Taro.setClipboardData({ data: merchantOrderNo }); }}>{merchantOrderNo || '—'}{merchantOrderNo ? '　复制' : ''}</Text></View>
        <View><Text>支付时间</Text><Text>{paidAt ? formatOrderTime(paidAt) : '刚刚'}</Text></View>
        <View><Text>订单数量</Text><Text>{verifiedOrders.length} 笔</Text></View>
      </View>
      <Button className='payment-success-secondary' onClick={() => { void requestShippingReminder(); }}>授权一次发货微信提醒</Button>
      <Text className='payment-success-subscription-hint'>一次授权会用于当前账号最先发生的一笔发货事件；多笔订单待发时请按需再次授权。</Text>
      <Button className='payment-success-primary' onClick={() => { void openVerifiedDestination(); }}>{presentation!.primaryLabel}</Button>
      <Button className='payment-success-secondary' onClick={() => Taro.switchTab({ url: '/pages/home/index' })}>返回首页</Button>
    </View>
  );
}
