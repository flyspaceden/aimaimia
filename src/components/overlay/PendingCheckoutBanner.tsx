/**
 * 未完成订单横幅（PendingCheckoutBanner）
 *
 * 用途：
 * - 在首页 / 购物车顶部展示当前用户最新一条 ACTIVE CheckoutSession（未支付订单）
 * - 显示倒计时 + 商品预览 + "继续支付" 按钮
 * - 点击横幅跳转到未完成订单详情页 `/checkout-pending`
 * - 点击"继续支付"按钮调用 OrderRepo.resumeCheckout 重新拉起支付宝
 *
 * 行为：
 * - 未登录时不渲染（useQuery enabled 控制）
 * - 没有未完成订单时返回 null（组件总是 mount，但条件性渲染）
 * - 30 秒轮询一次，倒计时归零自动 refetch
 */
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { OrderRepo } from '../../repos';
import { useAuthStore } from '../../store';
import { useTheme } from '../../theme';
import { useToast } from '../feedback';
import { Countdown } from '../ui/Countdown';
import { payWithAlipay } from '../../utils/alipay';
import { useConfirmPayment } from '../../hooks/useConfirmPayment';

export function PendingCheckoutBanner() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const { colors, radius, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const confirmPayment = useConfirmPayment();

  const { data, refetch } = useQuery({
    queryKey: ['pending-checkout'],
    queryFn: () => OrderRepo.getPendingCheckout(),
    enabled: isLoggedIn,
    refetchInterval: 30_000,
  });

  if (!data?.ok || !data.data) return null;
  const pending = data.data;

  const handleResume = async () => {
    const r = await OrderRepo.resumeCheckout(pending.sessionId);
    if (!r.ok) {
      show({ message: r.error.displayMessage ?? '续付失败', type: 'error' });
      return;
    }
    const orderStr = r.data.paymentParams?.orderStr;
    if (!orderStr) {
      show({ message: '支付参数获取失败', type: 'error' });
      return;
    }
    const result = await payWithAlipay(orderStr);
    await confirmPayment({
      sessionId: pending.sessionId,
      sdkResultStatus: result.resultStatus ?? '',
      onSuccess: () => router.push('/orders'),
    });
  };

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/checkout-pending', params: { sessionId: pending.sessionId } })}
      style={[styles.banner, { backgroundColor: '#FFF8E1', borderRadius: radius.md }]}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[typography.caption, { color: '#FF6B35', fontWeight: '600' }]}>⏱ 你有未完成的订单 </Text>
          <Countdown
            expiresAt={pending.expiresAt}
            format="mm:ss"
            onExpire={refetch}
            style={[typography.caption, { color: '#FF6B35', fontWeight: '600' }]}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          {pending.preview.firstItemImage ? (
            <Image source={{ uri: pending.preview.firstItemImage }} style={{ width: 24, height: 24, borderRadius: 4 }} />
          ) : null}
          <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 6, flex: 1 }]} numberOfLines={1}>
            {pending.preview.firstItemTitle}{pending.preview.extraCount > 0 ? ` 等共 ${pending.preview.extraCount + 1} 件` : ''} · ¥{pending.expectedTotal.toFixed(2)}
          </Text>
        </View>
      </View>
      <Pressable onPress={handleResume} style={[styles.cta, { backgroundColor: '#FF6B35', borderRadius: radius.pill }]}>
        <Text style={[typography.caption, { color: '#fff', fontWeight: '600' }]}>继续支付</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', padding: 10, marginHorizontal: 12, marginTop: 8 },
  cta: { paddingHorizontal: 14, paddingVertical: 6, marginLeft: 8 },
});
