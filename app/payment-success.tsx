import React, { useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../src/components/layout';
import { useTheme } from '../src/theme';

/**
 * 支付成功页（P5 第三轮 Commit C）
 *
 * 路由参数（从 checkout.tsx 跳转时传入）：
 * - sessionId: 总订单（CheckoutSession）id，必传
 * - totalOrderNo: 总订单号（CheckoutSession.merchantOrderNo），即支付宝小票上的 out_trade_no
 * - amount: 总金额（元，字符串保留两位小数）
 * - firstOrderId: 子订单的第一个 id，单商户场景跳订单详情用
 * - orderCount: 子订单总数（多商户时显示"已为您创建 X 笔商家订单"）
 * - isVip: '0' 普通购物 / '1' VIP 礼包
 *
 * 设计原则：
 * - router.replace 进入（防 back 回 checkout 重复下单）
 * - 拦截系统返回键 / 手势返回（同上理由）
 * - 多商户：当 orderCount > 1 时显示提示语 + 主按钮跳订单列表
 * - 单商户：跳子订单详情页
 * - VIP：标题 + 主按钮文案不同，跳 /me/vip
 */
export default function PaymentSuccessScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    sessionId?: string;
    totalOrderNo?: string;
    amount?: string;
    firstOrderId?: string;
    orderCount?: string;
    isVip?: string;
  }>();

  const isVip = params.isVip === '1';
  const orderCount = Math.max(1, parseInt(params.orderCount ?? '1', 10) || 1);
  const amountStr = params.amount ?? '0.00';
  const totalOrderNo = params.totalOrderNo ?? '-';
  const firstOrderId = params.firstOrderId;
  const paidAt = new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  // 拦截系统返回键（Android）：禁止从成功页 back
  useFocusEffect(
    React.useCallback(() => {
      const onBack = () => true; // 吞掉返回事件
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, []),
  );

  // 主按钮跳转
  const handlePrimaryAction = () => {
    if (isVip) {
      router.replace('/me/vip');
      return;
    }
    if (orderCount > 1) {
      // 多商户：跳订单列表，带"待发货"筛选直达刚下的订单
      router.replace('/orders?status=pendingShip');
      return;
    }
    if (firstOrderId) {
      // 单商户：跳子订单详情
      router.replace({ pathname: '/orders/[id]', params: { id: firstOrderId } });
      return;
    }
    // 兜底
    router.replace('/orders');
  };

  // 次按钮：返回首页
  const handleBackHome = () => {
    router.replace('/(tabs)/home');
  };

  const titleText = isVip ? 'VIP 开通成功' : '支付成功';
  const subtitleText = isVip
    ? 'VIP 礼包订单已生成'
    : orderCount > 1
    ? `已为您创建 ${orderCount} 笔商家订单`
    : '订单已生成';
  const primaryBtnText = isVip ? '查看 VIP 中心' : orderCount > 1 ? '查看全部订单' : '查看订单';

  return (
    <Screen contentStyle={{ flex: 1 }}>
      {/* 顶部不放 AppHeader（无返回按钮，防回 checkout） */}
      <View style={{ flex: 1, padding: spacing.xl, paddingTop: spacing['3xl'] }}>
        {/* 大对勾动画 */}
        <Animated.View
          entering={ZoomIn.duration(600)}
          style={[styles.checkWrap, { alignSelf: 'center', marginTop: spacing['2xl'] }]}
        >
          <LinearGradient
            colors={[colors.brand.primary, colors.ai.end]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.checkCircle, shadow.lg]}
          >
            <MaterialCommunityIcons name="check" size={96} color="#FFFFFF" />
          </LinearGradient>
        </Animated.View>

        {/* 标题 */}
        <Animated.View entering={FadeInDown.duration(400).delay(200)}>
          <Text
            style={[
              typography.title1,
              {
                color: colors.brand.primary,
                textAlign: 'center',
                marginTop: spacing.xl,
                fontSize: 24,
                fontWeight: '700',
              },
            ]}
          >
            {titleText}
          </Text>
          <Text
            style={[
              typography.body,
              {
                color: colors.text.secondary,
                textAlign: 'center',
                marginTop: spacing.sm,
              },
            ]}
          >
            {subtitleText}
          </Text>
        </Animated.View>

        {/* 金额卡片 */}
        <Animated.View entering={FadeInDown.duration(400).delay(300)}>
          <View
            style={[
              styles.card,
              shadow.md,
              { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing['2xl'] },
            ]}
          >
            <Text style={[typography.captionSm, { color: colors.text.secondary }]}>支付金额</Text>
            <Text
              style={[
                {
                  color: colors.brand.primary,
                  marginTop: spacing.xs,
                  fontSize: 32,
                  fontWeight: '700',
                  fontVariant: ['tabular-nums'],
                },
              ]}
            >
              ¥ {amountStr}
            </Text>

            <View style={[styles.divider, { backgroundColor: colors.divider, marginTop: spacing.md }]} />

            {/* 元数据 */}
            <View style={[styles.metaRow, { marginTop: spacing.md }]}>
              <Text style={[typography.captionSm, { color: colors.text.secondary }]}>支付方式</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MaterialCommunityIcons
                  name="alpha-a-circle"
                  size={14}
                  color="#1677FF"
                  style={{ marginRight: 4 }}
                />
                <Text style={[typography.captionSm, { color: colors.text.primary }]}>支付宝（沙箱）</Text>
              </View>
            </View>

            <View style={[styles.metaRow, { marginTop: spacing.sm }]}>
              <Text style={[typography.captionSm, { color: colors.text.secondary }]}>总订单号</Text>
              <Text
                style={[
                  typography.captionSm,
                  {
                    color: colors.text.primary,
                    fontFamily: 'monospace',
                    maxWidth: '60%',
                  },
                ]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {totalOrderNo}
              </Text>
            </View>

            <View style={[styles.metaRow, { marginTop: spacing.sm }]}>
              <Text style={[typography.captionSm, { color: colors.text.secondary }]}>支付时间</Text>
              <Text style={[typography.captionSm, { color: colors.text.primary }]}>{paidAt}</Text>
            </View>
          </View>
        </Animated.View>

        {/* 占位让按钮往下推 */}
        <View style={{ flex: 1 }} />

        {/* 主按钮：查看订单 / VIP 中心 / 全部订单 */}
        <Animated.View entering={FadeInDown.duration(400).delay(400)}>
          <Pressable onPress={handlePrimaryAction}>
            <LinearGradient
              colors={[colors.brand.primary, colors.ai.end]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.primaryBtn, { borderRadius: radius.pill }]}
            >
              <Text style={[typography.bodyStrong, { color: '#FFFFFF' }]}>{primaryBtnText}</Text>
            </LinearGradient>
          </Pressable>
        </Animated.View>

        {/* 次按钮：返回首页 */}
        <Animated.View entering={FadeInDown.duration(400).delay(500)}>
          <Pressable
            onPress={handleBackHome}
            style={[
              styles.secondaryBtn,
              { borderColor: colors.border, borderRadius: radius.pill, marginTop: spacing.md },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>返回首页</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  checkWrap: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    padding: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  primaryBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
