import { Button, Image, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { CheckoutRepo } from '@/repos';
import { miniProgramCashierFailureMessage, requestMiniProgramPayment } from '@/platform/payment';
import { ensureWechatMiniProgramSession } from '@/platform/auth';
import { queryClient } from '@/query/client';
import { captureAuthSession, useAuthStore } from '@/store/auth';
import type { CheckoutStatusResult } from '@/types';
import { GroupBuyAuthGate } from '../_components/group-buy-shared';
import { formatGroupBuyMoney, isUserCancelledGroupBuyPayment } from '../utils';
import './index.scss';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForGroupBuyOrder(sessionId: string): Promise<CheckoutStatusResult | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = attempt % 4 === 0 ? await CheckoutRepo.activeQuery(sessionId) : await CheckoutRepo.getStatus(sessionId);
    if (result.ok && ['COMPLETED', 'EXPIRED', 'FAILED'].includes(result.data.status)) return result.data;
    await wait(1_500);
  }
  return null;
}

function remainingText(expiresAt?: string): string {
  if (!expiresAt) return '正在确认支付状态';
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1_000));
  return seconds > 0 ? `支付窗口剩余 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '支付窗口已结束';
}

export default function GroupBuyCheckoutPendingPage() {
  const router = useRouter();
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const requestedId = typeof router.params.sessionId === 'string' ? router.params.sessionId : '';
  const paymentReturnUrl = requestedId ? `/packages/group-buy/checkout-pending/index?sessionId=${encodeURIComponent(requestedId)}` : '/packages/group-buy/checkout-pending/index';
  const cashierFailure = useRef<string>();
  const [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick((value) => value + 1), 1_000); return () => clearInterval(timer); }, []);
  const pendingQuery = useQuery({ queryKey: ['commerce', 'pending-checkout'], queryFn: CheckoutRepo.getPending, enabled: hydrated && loggedIn, refetchInterval: 10_000 });
  const pending = pendingQuery.data?.ok ? pendingQuery.data.data : null;
  const sessionId = requestedId || pending?.sessionId || '';
  const matchesRequested = !requestedId || !pending || pending.sessionId === requestedId;
  const isGroupBuy = !pending || pending.bizType === 'GROUP_BUY';

  const finish = async (status: CheckoutStatusResult | null, paymentWasConfirmed = false) => {
    if (status?.status === 'COMPLETED') {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['group-buy', 'current'] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
      ]);
      await Taro.redirectTo({ url: `/packages/orders/payment-success/index?orderIds=${encodeURIComponent(status.orderIds.join(','))}&amount=${status.expectedTotal}` });
      return;
    }
    if (status?.status === 'EXPIRED' || status?.status === 'FAILED') {
      Taro.showToast({ title: status.status === 'EXPIRED' ? '支付已超时，请重新选择团购' : '支付未成功，请重新选择团购', icon: 'none' });
      await Taro.redirectTo({ url: '/packages/group-buy/activity-list/index' });
      return;
    }
    Taro.showToast({ title: paymentWasConfirmed ? '微信已付款，订单生成确认中' : cashierFailure.current || '支付结果确认中，可稍后继续', icon: 'none' });
    void pendingQuery.refetch();
  };

  const resumeMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('NO_SESSION');
      cashierFailure.current = undefined;
      const authGuard = captureAuthSession();
      if (!pending) {
        const current = await CheckoutRepo.getStatus(sessionId);
        if (!current.ok || current.data.status !== 'ACTIVE') return current;
      }
      if (pending && !pending.canResumeInCurrentScene) return CheckoutRepo.switchFromApp(sessionId);
      const resumed = await CheckoutRepo.resume(sessionId);
      if (!resumed.ok) return resumed;
      try { await requestMiniProgramPayment(resumed.data.paymentParams); } catch (error) {
        // 收银台错误和用户取消都不能作为最终支付结果，仍要主动查单；
        // 非取消错误必须准确反馈，不能伪装成“确认中”。
        if (!isUserCancelledGroupBuyPayment(error)) cashierFailure.current = miniProgramCashierFailureMessage(error);
      }
      if (!useAuthStore.getState().isCurrentSessionGeneration(authGuard)) {
        return { ok: false as const, error: { code: 'AUTH_SESSION_CHANGED', message: 'auth session changed during payment', displayMessage: '登录状态已变更，请切回原账户核对支付结果', retryable: true } };
      }
      return CheckoutRepo.activeQuery(sessionId);
    },
    onSuccess: async (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '暂时无法继续支付', icon: 'none' }); return; }
      if ('recheckoutRequired' in result.data) {
        if (result.data.status === 'COMPLETED') { await finish({ status: 'COMPLETED', orderIds: result.data.orderIds, expectedTotal: pending?.expectedTotal || 0 }); return; }
        if (result.data.status === 'PAID') { await finish(await waitForGroupBuyOrder(sessionId), true); return; }
        if (result.data.recheckoutRequired) {
          Taro.showToast({ title: '原支付已安全关闭，请重新选择团购', icon: 'none' });
          await Taro.redirectTo({ url: '/packages/group-buy/activity-list/index' });
        }
        if (result.data.canResume) Taro.showToast({ title: '支付状态已更新，请再次点击继续支付', icon: 'none' });
        return;
      }
      if (result.data.status === 'COMPLETED') { await finish(result.data); return; }
      if (result.data.status === 'PAID') { await finish(await waitForGroupBuyOrder(sessionId), true); return; }
      await finish(result.data.status === 'EXPIRED' || result.data.status === 'FAILED' ? result.data : null);
    },
    onError: () => Taro.showToast({ title: '网络结果不确定，请稍后重试', icon: 'none' }),
  });
  const cancelMutation = useMutation({
    mutationFn: () => CheckoutRepo.cancel(sessionId),
    onSuccess: async (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '暂时无法取消', icon: 'none' }); return; }
      await Taro.redirectTo({ url: '/packages/group-buy/activity-list/index' });
    },
    onError: () => Taro.showToast({ title: '取消结果不确定，请稍后重试', icon: 'none' }),
  });

  if (!hydrated) return <View className='group-buy-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <GroupBuyAuthGate returnUrl={requestedId ? `/packages/group-buy/checkout-pending/index?sessionId=${encodeURIComponent(requestedId)}` : '/packages/group-buy/checkout-pending/index'} description='登录后才能确认团购支付状态' />;
  if (pendingQuery.isLoading) return <View className='group-buy-page'><CatalogFeedback kind='loading' /></View>;
  if (!pendingQuery.data?.ok) return <View className='group-buy-page'><CatalogFeedback kind='error' title='团购待支付信息加载失败' description={pendingQuery.data && !pendingQuery.data.ok ? pendingQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => pendingQuery.refetch()} /></View>;
  if (!pending && !requestedId) return <View className='group-buy-page'><CatalogFeedback kind='empty' title='暂无待支付团购' description='可以返回团购列表重新选择商品' actionLabel='查看团购商品' onRetry={() => Taro.redirectTo({ url: '/packages/group-buy/activity-list/index' })} /></View>;
  if (!isGroupBuy) return <View className='group-buy-page'><CatalogFeedback kind='error' title='这不是团购待支付订单' description='请到普通订单待支付页面处理，避免混用结算流程' onRetry={() => Taro.redirectTo({ url: '/packages/commerce/checkout-pending/index' })} /></View>;

  return <View className='group-buy-page group-buy-pending'>
    <View className='group-buy-pending__orb'>待</View><Text className='group-buy-pending__title'>等待完成微信支付</Text><Text className='group-buy-pending__time'>{remainingText(pending?.expiresAt)}</Text>
    <View className='group-buy-pending__card aim-card'>{pending?.preview.firstItemImage ? <Image className='group-buy-pending__image' src={pending.preview.firstItemImage} mode='aspectFill' /> : <View className='group-buy-pending__placeholder'>团</View>}<View className='group-buy-pending__copy'><Text>{pending?.preview.firstItemTitle || 'AI爱买买团购订单'}</Text><Text>{pending ? `共 ${pending.itemCount} 件 · ${pending.paymentScene === 'MINI_PROGRAM' ? '小程序发起' : 'App 发起'}` : '正在确认支付状态'}</Text></View>{pending ? <Text className='group-buy-pending__amount'>¥{formatGroupBuyMoney(pending.expectedTotal)}</Text> : null}</View>
    {!matchesRequested ? <Text className='group-buy-pending__hint'>当前另有一笔待支付订单，请先处理后再重试。</Text> : pending && !pending.canResumeInCurrentScene ? <Text className='group-buy-pending__hint'>这笔团购支付从 App 发起，不能直接在小程序继续。确认原支付未完成后，即可重新选择团购。</Text> : <Text className='group-buy-pending__hint'>继续支付会重新确认订单与金额；付款后请以本页最终结果为准，避免重复支付。</Text>}
    <Button className='group-buy-primary' loading={resumeMutation.isPending} disabled={!sessionId || !matchesRequested || resumeMutation.isPending} onClick={async () => { if (!await ensureWechatMiniProgramSession(paymentReturnUrl)) return; resumeMutation.mutate(); }}>{pending && !pending.canResumeInCurrentScene ? '安全切换到小程序' : '继续微信支付'}</Button>
    <Button className='group-buy-danger' loading={cancelMutation.isPending} disabled={!sessionId || !matchesRequested || cancelMutation.isPending} onClick={async () => { const modal = await Taro.showModal({ title: '取消团购支付', content: '系统会先向微信确认未付款并安全关单；结果不确定时不会强行取消。', confirmText: '确认取消', confirmColor: '#A04B42' }); if (modal.confirm) cancelMutation.mutate(); }}>取消支付</Button>
    <Text className='group-buy-pending__orders' onClick={() => Taro.navigateTo({ url: '/packages/orders/order-list/index' })}>查看我的订单 ›</Text>
  </View>;
}
