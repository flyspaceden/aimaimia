import React, { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../src/components/feedback';
import { OrderItemRow } from '../src/components/cards/OrderItemRow';
import { AmountSummary } from '../src/components/orders/AmountSummary';
import { StickyCTABar } from '../src/components/orders/StickyCTABar';
import { Countdown } from '../src/components/ui/Countdown';
import { OrderRepo } from '../src/repos';
import { useTheme } from '../src/theme';
import { payWithAlipay } from '../src/utils/alipay';
import { hasCompleteWechatPayPayload, payWithWechat } from '../src/utils/wechat-pay';
import { useConfirmPayment } from '../src/hooks/useConfirmPayment';

import { paymentMethods } from '../src/constants/payment';
import { useAuthStore } from '../src/store/useAuthStore';
import { useCheckoutStore } from '../src/store/useCheckoutStore';

export default function CheckoutPendingScreen() {
  const { colors, spacing, typography } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const confirmPayment = useConfirmPayment();
  const route = useLocalSearchParams<{ sessionId?: string; bizType?: string }>();
  const targetId = typeof route.sessionId === 'string' ? route.sessionId : undefined;
  const isVip = route.bizType === 'VIP_PACKAGE';
  const userId = useAuthStore((state) => state.userId);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const scopeKey = JSON.stringify([isLoggedIn, userId, targetId, isVip]);
  const scope = useRef({ key: scopeKey, generation: 0, focused: false });
  if (scope.current.key !== scopeKey) {
    scope.current = { ...scope.current, key: scopeKey, generation: scope.current.generation + 1 };
  }
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    scope.current.focused = true;
    scope.current.generation += 1;
    busyRef.current = false; setBusy(false);
    return () => { scope.current.focused = false; scope.current.generation += 1; };
  }, [scopeKey]));
  // 在发起操作时捕获代次，页面失焦、换账号或换目标后旧请求不得再调 SDK。
  const captureCurrent = () => {
    const generation = scope.current.generation;
    return () => scope.current.focused && scope.current.generation === generation
      && useAuthStore.getState().isLoggedIn && useAuthStore.getState().userId === userId;
  };
  const exitRoute = isVip ? '/vip/gifts' as const : '/cart' as const;
  const [ctaBarHeight, setCtaBarHeight] = useState(96);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pending-checkout', isVip ? 'VIP_PACKAGE' : 'NORMAL_GOODS', userId, targetId],
    queryFn: () => isVip ? OrderRepo.getPendingVipCheckout() : OrderRepo.getPendingCheckout(),
    enabled: isLoggedIn && !!userId,
    staleTime: 0,
  });

  async function onPaid(isCurrent: () => boolean) {
    if (!isCurrent()) return;
    if (isVip) useCheckoutStore.getState().clearVipPackageSelection();
    await Promise.all(['bonus-member', 'bonus-wallet', 'bonus-ledger', 'pending-checkout', 'orders', 'me-order-counts', 'me-order-issue'].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] })));
    if (isCurrent()) router.replace('/orders');
  }

  async function queryPaymentResult(sessionId: string, isCurrent: () => boolean) {
    if (!isCurrent()) return;
    const result = await OrderRepo.activeQueryPayment(sessionId);
    if (!isCurrent()) return;
    if (!result.ok && result.error.retryable) {
      const status = await OrderRepo.getCheckoutSessionStatus(sessionId);
      if (!isCurrent()) return;
      if (status.ok && status.data.status === 'COMPLETED') { await onPaid(isCurrent); return; }
    }
    if (!isCurrent()) return;
    if (result.ok && result.data.status === 'COMPLETED') { await onPaid(isCurrent); return; }
    show({ message: result.ok
      ? result.data.status === 'ACTIVE' ? '原结算尚未完成支付，可继续原支付'
        : result.data.status === 'EXPIRED' || result.data.status === 'FAILED' ? '原结算已结束，请查看订单确认结果'
          : '支付处理中，请稍后重新查询'
      : result.error.displayMessage || '支付结果查询失败，请重试', type: 'info' });
  }

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="未完成订单" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={200} radius={8} />
        </View>
      </Screen>
    );
  }

  if (!isLoggedIn || !userId || !data?.ok || !data.data || (targetId && data.data.sessionId !== targetId)) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="未完成订单" />
        <ErrorState
          title={!data?.ok ? "暂时无法查询订单" : targetId ? "目标结算已不在待支付列表" : "暂无待支付订单"}
          description="请查询原支付结果，勿重复下单；不会切换到另一笔结算"
          onAction={async () => {
            const isCurrent = captureCurrent();
            if (busyRef.current || !isCurrent()) return;
            busyRef.current = true; setBusy(true);
            try {
              const refreshed = await refetch();
              if (!isCurrent()) return;
              if (targetId && !(refreshed.data?.ok && refreshed.data.data?.sessionId === targetId)) {
                await queryPaymentResult(targetId, isCurrent);
              }
            } finally { if (isCurrent()) { busyRef.current = false; setBusy(false); } }
          }}
          actionLabel={targetId ? '查询原支付结果' : '重新查询'}
        />
      </Screen>
    );
  }

  const pending = data.data;

  const canResume = pending.paymentScene !== 'MINI_PROGRAM' && pending.canResumeInCurrentScene !== false;
  const channelAvailable = pending.paymentChannel !== 'WECHAT_PAY' || paymentMethods.some((method) => method.value === 'wechat' && method.available);
  const handleResume = async () => {
    const isCurrent = captureCurrent();
    if (busyRef.current || !isCurrent() || !canResume || !channelAvailable) return;
    busyRef.current = true; setBusy(true);
    try {
      const r = await OrderRepo.resumeCheckout(pending.sessionId);
      if (!isCurrent()) return;
      if (!r.ok) {
        show({ message: r.error.displayMessage ?? '续付失败', type: 'error' });
        return;
      }
      const params = r.data.paymentParams;
      if (params?.channel === 'alipay' && params.orderStr) {
        const result = await payWithAlipay(params.orderStr);
        if (!isCurrent()) return;
        await confirmPayment({
          sessionId: pending.sessionId,
          sdkResultStatus: result.resultStatus === '6001' ? '' : result.resultStatus ?? '',
          isCurrent, onSuccess: () => onPaid(isCurrent),
        });
        return;
      }
      if (params?.channel === 'wechat' && !paymentMethods.some((method) => method.value === 'wechat' && method.available)) {
        show({ message: '当前设备暂不支持原订单的微信支付，请在支持的设备继续', type: 'info' });
        return;
      }
      if (params?.channel === 'wechat' && hasCompleteWechatPayPayload(params)) {
        const result = await payWithWechat(params);
        if (!isCurrent()) return;
        if (result.errStr === 'NATIVE_UNAVAILABLE') {
          show({ message: '支付组件不可用，请更新到最新版 App 后重试', type: 'error' });
          return;
        }
        if (result.errStr === 'WECHAT_NOT_INSTALLED') {
          show({ message: '请先安装微信 App 后再使用微信支付', type: 'error' });
          return;
        }
        await confirmPayment({
          sessionId: pending.sessionId,
          sdkResultStatus: result.resultStatus === '6001' ? '' : result.resultStatus,
          isCurrent, onSuccess: () => onPaid(isCurrent),
        });
        return;
      }
      show({ message: '支付参数获取失败，请重试', type: 'error' });
    } catch {
      if (!isCurrent()) return;
      show({ message: '支付结果暂未确认，请查询原支付结果', type: 'info' });
    } finally { if (isCurrent()) { busyRef.current = false; setBusy(false); } }
  };

  const handleCancel = () => {
    const isCurrent = captureCurrent();
    if (busyRef.current || !isCurrent() || !canResume) return;
    Alert.alert('确定取消？', '库存将释放，需要重新下单', [
      { text: '不取消' },
      {
        text: '取消订单',
        style: 'destructive',
        onPress: async () => {
          if (busyRef.current || !isCurrent()) return;
          busyRef.current = true; setBusy(true);
          try {
          const r = await OrderRepo.cancelCheckoutSession(pending.sessionId);
          if (!isCurrent()) return;
          if (!r.ok) {
            show({ message: r.error.displayMessage ?? '取消失败', type: 'error' });
            return;
          }
          await queryClient.invalidateQueries({ queryKey: ['pending-checkout'] });
          if (!isCurrent()) return;
          show({ message: '已取消', type: 'success' });
          router.replace(exitRoute);
          } catch { if (isCurrent()) show({ message: '取消结果未确认，请重新查询', type: 'error' }); }
          finally { if (isCurrent()) { busyRef.current = false; setBusy(false); } }
        },
      },
    ]);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="未完成订单" />
      <ScrollView contentContainerStyle={{ paddingBottom: ctaBarHeight + spacing.lg }}>
        <LinearGradient
          colors={['#FF6B35', '#FF8C42']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.hero}
        >
          <Text style={[typography.title3, { color: '#fff' }]}>订单未完成支付</Text>
          <Countdown
            expiresAt={pending.expiresAt}
            prefix="⏱ 剩"
            onExpire={refetch}
            style={[typography.caption, { color: 'rgba(255,255,255,0.9)', marginTop: 4 }]}
          />
          <Text style={[typography.caption, { color: 'rgba(255,255,255,0.85)', marginTop: 2 }]}>
            {pending.fulfillmentMode === 'PICKUP' ? '到店自提 · 恢复原结算' : '送货上门 · 恢复原结算'}
          </Text>
          <Text style={[typography.caption, { color: '#fff', marginTop: 6 }]}>
            {!canResume ? '请回微信小程序处理这笔结算' : !channelAvailable ? '当前设备不支持原微信支付渠道，请在支持的设备继续' : '继续使用原支付渠道，取消后需要重新下单'}
          </Text>
        </LinearGradient>

        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: 8 }]}>
            商品清单
          </Text>
          {pending.items.map((it, i) => (
            <OrderItemRow
              key={i}
              image={it.image}
              title={it.title}
              skuTitle={it.skuTitle}
              unitPrice={it.unitPrice}
              quantity={it.quantity}
            />
          ))}
        </View>

        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <AmountSummary
            goodsAmount={pending.goodsAmount}
            shippingFee={pending.shippingFee}
            totalPrice={pending.expectedTotal}
          />
        </View>
      </ScrollView>

      <StickyCTABar
        onHeightChange={setCtaBarHeight}
        primary={{ label: busy ? '处理中…' : `继续支付 ¥${pending.expectedTotal.toFixed(2)}`, onPress: handleResume, disabled: busy || !canResume || !channelAvailable }}
        secondary={[{ label: '查询支付结果', disabled: busy || !canResume, onPress: async () => {
          const isCurrent = captureCurrent();
          if (busyRef.current || !isCurrent()) return;
          busyRef.current = true; setBusy(true);
          try { await queryPaymentResult(pending.sessionId, isCurrent); }
          finally { if (isCurrent()) { busyRef.current = false; setBusy(false); } }
        } }, { label: '取消订单', onPress: handleCancel, disabled: busy || !canResume }]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 18 },
  section: { padding: 12, marginTop: 8 },
});
