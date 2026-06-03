import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
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

export default function CheckoutPendingScreen() {
  const { colors, spacing, typography } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const confirmPayment = useConfirmPayment();
  const [ctaBarHeight, setCtaBarHeight] = useState(96);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pending-checkout'],
    queryFn: () => OrderRepo.getPendingCheckout(),
  });

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

  if (!data?.ok || !data.data) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="未完成订单" />
        <ErrorState
          title="该订单已过期"
          description="未完成订单可能已自动取消，库存已释放"
          onAction={() => router.replace('/cart')}
          actionLabel="去购物车"
        />
      </Screen>
    );
  }

  const pending = data.data;

  const handleResume = async () => {
    const r = await OrderRepo.resumeCheckout(pending.sessionId);
    if (!r.ok) {
      show({ message: r.error.displayMessage ?? '续付失败', type: 'error' });
      return;
    }
    const params = r.data.paymentParams;
    if (params?.channel === 'alipay' && params.orderStr) {
      const result = await payWithAlipay(params.orderStr);
      await confirmPayment({
        sessionId: pending.sessionId,
        sdkResultStatus: result.resultStatus ?? '',
        onSuccess: () => router.replace('/orders'),
      });
      return;
    }
    if (params?.channel === 'wechat' && hasCompleteWechatPayPayload(params)) {
      const result = await payWithWechat(params);
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
        sdkResultStatus: result.resultStatus,
        onSuccess: () => router.replace('/orders'),
      });
      return;
    }
    show({ message: '支付参数获取失败，请重试', type: 'error' });
  };

  const handleCancel = () => {
    Alert.alert('确定取消？', '库存将释放，需要重新下单', [
      { text: '不取消' },
      {
        text: '取消订单',
        style: 'destructive',
        onPress: async () => {
          const r = await OrderRepo.cancelCheckoutSession(pending.sessionId);
          if (!r.ok) {
            show({ message: r.error.displayMessage ?? '取消失败', type: 'error' });
            return;
          }
          await queryClient.invalidateQueries({ queryKey: ['pending-checkout'] });
          show({ message: '已取消', type: 'success' });
          router.replace('/cart');
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
            取消后库存将释放，需要重新下单
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
        primary={{ label: `继续支付 ¥${pending.expectedTotal.toFixed(2)}`, onPress: handleResume }}
        secondary={[{ label: '取消订单', onPress: handleCancel }]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 18 },
  section: { padding: 12, marginTop: 8 },
});
