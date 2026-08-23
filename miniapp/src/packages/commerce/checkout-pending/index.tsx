import { Button, Image, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { formatMoney, isUserCancelledPayment } from '@/components/commerce-utils';
import { miniProgramCashierFailureMessage, requestMiniProgramPayment } from '@/platform/payment';
import { ensureWechatMiniProgramSession } from '@/platform/auth';
import { CheckoutRepo } from '@/repos';
import { queryClient } from '@/query/client';
import { captureAuthSession, useAuthStore } from '@/store/auth';
import type { CheckoutStatusResult } from '@/types';
import './index.scss';

function remainingText(expiresAt?: string): string {
  if (!expiresAt) return '正在读取支付有效期';
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  return seconds > 0 ? `剩余 ${minutes}:${String(seconds % 60).padStart(2, '0')}` : '支付窗口已结束';
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForCompleted(sessionId: string): Promise<CheckoutStatusResult | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = attempt % 4 === 0
      ? await CheckoutRepo.activeQuery(sessionId)
      : await CheckoutRepo.getStatus(sessionId);
    if (result.ok && ['COMPLETED', 'EXPIRED', 'FAILED'].includes(result.data.status)) return result.data;
    await wait(1_500);
  }
  return null;
}

export default function CheckoutPendingPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const router = useRouter();
  const requestedId = typeof router.params.sessionId === 'string' ? router.params.sessionId : '';
  const paymentReturnUrl = requestedId ? `/packages/commerce/checkout-pending/index?sessionId=${encodeURIComponent(requestedId)}` : '/packages/commerce/checkout-pending/index';
  const cashierFailure = useRef<string>();
  const [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick((value) => value + 1), 1_000); return () => clearInterval(timer); }, []);
  const pendingQuery = useQuery({ queryKey: ['commerce', 'pending-checkout'], queryFn: CheckoutRepo.getPending, enabled: hydrated && loggedIn, refetchInterval: 10_000 });
  const pending = pendingQuery.data?.ok ? pendingQuery.data.data : null;
  const sessionId = requestedId || pending?.sessionId || '';
  const belongsToRequested = !requestedId || !pending || pending.sessionId === requestedId;
  const title = useMemo(() => pending?.preview.firstItemTitle || 'AI爱买买订单', [pending]);

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
        if (!isUserCancelledPayment(error)) cashierFailure.current = miniProgramCashierFailureMessage(error);
      }
      if (!useAuthStore.getState().isCurrentSessionGeneration(authGuard)) {
        return { ok: false as const, error: { code: 'AUTH_SESSION_CHANGED', message: 'auth session changed during payment', displayMessage: '登录状态已变更，请切回原账户核对支付结果', retryable: true } };
      }
      return CheckoutRepo.activeQuery(sessionId);
    },
    onSuccess: async (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '暂时无法继续支付', icon: 'none' }); return; }
      if ('recheckoutRequired' in result.data) {
        if (result.data.status === 'COMPLETED') {
          await Taro.redirectTo({ url: `/packages/orders/payment-success/index?orderIds=${encodeURIComponent(result.data.orderIds.join(','))}` });
        } else if (result.data.status === 'PAID') {
          const settled = await waitForCompleted(sessionId);
          if (settled?.status === 'COMPLETED') {
            await Taro.redirectTo({ url: `/packages/orders/payment-success/index?orderIds=${encodeURIComponent(settled.orderIds.join(','))}&amount=${settled.expectedTotal}` });
          } else {
            Taro.showToast({ title: '微信已付款，订单生成确认中', icon: 'none' });
            void pendingQuery.refetch();
          }
        } else if (result.data.recheckoutRequired) {
          Taro.showToast({ title: '原支付已安全关闭，请重新确认订单', icon: 'none' });
          await Taro.redirectTo({ url: '/packages/commerce/checkout/index' });
        }
        return;
      }
      if (result.data.status === 'COMPLETED') {
        await Promise.all([queryClient.invalidateQueries({ queryKey: ['orders'] }), queryClient.invalidateQueries({ queryKey: ['commerce', 'cart'] })]);
        await Taro.redirectTo({ url: `/packages/orders/payment-success/index?orderIds=${encodeURIComponent(result.data.orderIds.join(','))}&amount=${result.data.expectedTotal}` });
      } else if (result.data.status === 'PAID') {
        const settled = await waitForCompleted(sessionId);
        if (settled?.status === 'COMPLETED') {
          await Taro.redirectTo({ url: `/packages/orders/payment-success/index?orderIds=${encodeURIComponent(settled.orderIds.join(','))}&amount=${settled.expectedTotal}` });
        } else {
          Taro.showToast({ title: '微信已付款，订单生成确认中', icon: 'none' });
          void pendingQuery.refetch();
        }
      } else {
        Taro.showToast({ title: result.data.status === 'EXPIRED' ? '支付已超时，请重新结算' : cashierFailure.current || '支付结果确认中，请稍后查看', icon: 'none' });
        void pendingQuery.refetch();
      }
    },
    onError: () => Taro.showToast({ title: '网络开小差了，请重试', icon: 'none' }),
  });
  const cancelMutation = useMutation({
    mutationFn: () => CheckoutRepo.cancel(sessionId),
    onSuccess: async (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '暂时无法取消', icon: 'none' }); return; }
      Taro.showToast({ title: '已取消待支付订单', icon: 'none' });
      await Taro.redirectTo({ url: '/packages/commerce/cart/index' });
    },
  });

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后才能查询和处理待支付订单' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(requestedId ? `/packages/commerce/checkout-pending/index?sessionId=${encodeURIComponent(requestedId)}` : '/packages/commerce/checkout-pending/index')}` })} /></View>;
  if (pendingQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!pendingQuery.data?.ok) return <View className='aim-page'><CatalogFeedback kind='error' title='待支付信息加载失败' description={pendingQuery.data && !pendingQuery.data.ok ? pendingQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => pendingQuery.refetch()} /></View>;
  if (!pending && !requestedId) return <View className='aim-page'><CatalogFeedback kind='empty' title='暂无待支付订单' description='已完成的订单可在订单中心查看' onRetry={() => Taro.redirectTo({ url: '/packages/orders/order-list/index' })} /></View>;

  return (
    <View className='pending-page aim-page'>
      <View className='pending-orb'><View className='pending-orb__ring' /><Text>待</Text></View>
      <Text className='pending-title'>等待完成微信支付</Text>
      <Text className='pending-time'>{remainingText(pending?.expiresAt)}</Text>
      <View className='pending-card aim-card'>
        {pending?.preview.firstItemImage ? <Image className='pending-card__image' src={pending.preview.firstItemImage} mode='aspectFill' /> : null}
        <View className='pending-card__copy'><Text className='pending-card__title'>{title}</Text><Text className='pending-card__meta'>{pending ? `共 ${pending.itemCount} 件${pending.preview.extraCount ? ` · 另有 ${pending.preview.extraCount} 件` : ''}` : '正在查询支付状态'}</Text></View>
        {pending ? <Text className='pending-card__price'>¥{formatMoney(pending.expectedTotal)}</Text> : null}
      </View>
      {!belongsToRequested ? <Text className='pending-hint'>当前另有一笔待支付订单，请先处理后再重试。</Text> : null}
      {pending && !pending.canResumeInCurrentScene ? <View className='pending-cross aim-card'><Text>这笔支付从 App 发起</Text><Text>小程序不能直接复用 App 的支付参数。系统会先查单、确认未支付并关单，再允许在小程序重新结算。</Text></View> : null}
      <Button className='pending-primary' loading={resumeMutation.isPending} disabled={!sessionId || !belongsToRequested || resumeMutation.isPending} onClick={async () => { if (!await ensureWechatMiniProgramSession(paymentReturnUrl)) return; resumeMutation.mutate(); }}>{pending && !pending.canResumeInCurrentScene ? '安全切换到小程序支付' : '继续微信支付'}</Button>
      <Button className='pending-secondary' loading={cancelMutation.isPending} disabled={!sessionId || !belongsToRequested || cancelMutation.isPending} onClick={async () => { const modal = await Taro.showModal({ title: '取消待支付订单', content: '系统会先向支付渠道确认未付款并安全关单。', confirmText: '确认取消', confirmColor: '#A04B42' }); if (modal.confirm) cancelMutation.mutate(); }}>取消支付</Button>
      <Text className='pending-orders' onClick={() => Taro.redirectTo({ url: '/packages/orders/order-list/index' })}>查看我的订单 ›</Text>
    </View>
  );
}
