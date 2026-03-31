import React, { useEffect } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AiDivider } from '../../src/components/ui';
import { orderStatusLabels } from '../../src/constants/statuses';
import { OrderRepo } from '../../src/repos';
import { USE_MOCK } from '../../src/repos/http/config';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AppError } from '../../src/types';

const afterSaleLabels: Record<string, string> = {
  applying: '申请中',
  reviewing: '审核中',
  approved: '已同意换货',
  shipped: '卖家已补发',
  refunding: '售后处理中',
  completed: '已完成',
  rejected: '已驳回',
  failed: '处理失败',
};

// 售后当前节点脉动
function PulsingDot({ color }: { color: string }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.4, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [scale]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.afterSaleDot,
        { backgroundColor: color },
        pulseStyle,
      ]}
    />
  );
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id ?? '');
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => OrderRepo.getById(orderId),
    enabled: isLoggedIn && Boolean(orderId),
  });
  const refreshing = isFetching;

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="订单详情" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={160} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={200} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1, paddingHorizontal: spacing.xl }}>
        <AppHeader title="订单详情" />
        <ErrorState
          title="订单加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={refetch}
        />
      </Screen>
    );
  }

  const order = data.data;
  const afterSaleTimeline = order.afterSaleTimeline ?? [];

  const handlePay = async () => {
    if (!USE_MOCK) {
      show({ message: '旧支付入口已停用，请重新下单', type: 'error' });
      return;
    }
    const result = await OrderRepo.payOrder(order.id, order.paymentMethod ?? 'wechat');
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '支付失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    show({ message: '支付成功', type: 'success' });
    refetch();
  };

  // 确认收货
  const handleConfirmReceive = async () => {
    const result = await OrderRepo.confirmReceive(order.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '确认收货失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    show({ message: '已确认收货', type: 'success' });
    refetch();
  };

  // 取消订单
  const handleCancelOrder = async () => {
    const result = await OrderRepo.cancelOrder(order.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '取消失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    show({ message: '订单已取消', type: 'success' });
    refetch();
  };

  const handleAdvanceAfterSale = async () => {
    const result = await OrderRepo.advanceAfterSale(order.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '更新失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-issue'] });
    show({ message: '售后进度已更新', type: 'success' });
    refetch();
  };

  const handleConfirmReplacement = async () => {
    const result = await OrderRepo.confirmReplacement(order.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '确认换货失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    show({ message: '已确认收到换货商品', type: 'success' });
    refetch();
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="订单详情" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} />}
      >
        {/* VIP 礼包订单标签 */}
        {order.bizType === 'VIP_PACKAGE' && (
          <Animated.View entering={FadeInDown.duration(200)}>
            <View style={[{ backgroundColor: 'rgba(201,169,110,0.12)', borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center' }]}>
              <Text style={[typography.caption, { color: '#C9A96E', fontWeight: '600' }]}>VIP 开通礼包 · 不支持退款</Text>
            </View>
          </Animated.View>
        )}

        {/* 摘要卡片 — 装饰条 + 动画入场 */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <View style={[{ borderRadius: radius.lg, overflow: 'hidden' }, shadow.md]}>
            <LinearGradient
              colors={order.bizType === 'VIP_PACKAGE' ? ['#C9A96E', '#E8D5A3'] : [colors.brand.primary, colors.ai.start]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ height: 3 }}
            />
            <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{order.id}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                {orderStatusLabels[order.status]} · {order.createdAt}
              </Text>
              {order.logisticsStatus ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                  物流：{order.logisticsStatus}
                </Text>
              ) : null}
              {order.tracePreview ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                  预计送达：{order.tracePreview}
                </Text>
              ) : null}
              {order.afterSaleStatus ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                  售后进度：{afterSaleLabels[order.afterSaleStatus] ?? '处理中'}
                </Text>
              ) : null}
            </View>
          </View>
        </Animated.View>

        {/* 操作按钮 */}
        <View style={[styles.actionRow, { borderColor: colors.border }]}>
          {order.status === 'pendingPay' ? (
            <>
              {USE_MOCK ? (
                <Pressable onPress={handlePay}>
                  <LinearGradient
                    colors={[colors.brand.primary, colors.ai.start]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.actionButton, { borderRadius: radius.pill }]}
                  >
                    <Text style={[typography.caption, { color: colors.text.inverse }]}>立即支付</Text>
                  </LinearGradient>
                </Pressable>
              ) : (
                <View
                  style={[
                    styles.legacyPayHint,
                    { borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surface },
                  ]}
                >
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>历史待支付订单请重新下单</Text>
                </View>
              )}
              <Pressable
                onPress={handleCancelOrder}
                style={[styles.actionButtonOutline, { borderColor: colors.border, borderRadius: radius.pill }]}
              >
                <Text style={[typography.caption, { color: colors.text.secondary }]}>取消订单</Text>
              </Pressable>
            </>
          ) : null}
          {order.status === 'shipping' || order.status === 'delivered' ? (
            <>
              <Pressable onPress={handleConfirmReceive}>
                <LinearGradient
                  colors={[colors.brand.primary, colors.ai.start]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.actionButton, { borderRadius: radius.pill }]}
                >
                  <Text style={[typography.caption, { color: colors.text.inverse }]}>确认收货</Text>
                </LinearGradient>
              </Pressable>
              <Pressable
                onPress={() => router.push({ pathname: '/orders/track', params: { orderId: order.id } })}
                style={[styles.actionButtonOutline, { borderColor: colors.border, borderRadius: radius.pill }]}
              >
                <Text style={[typography.caption, { color: colors.text.secondary }]}>查看物流</Text>
              </Pressable>
            </>
          ) : null}
          {order.bizType !== 'VIP_PACKAGE'
            && (order.status === 'delivered' || order.status === 'completed')
            && (!order.afterSaleStatus || order.afterSaleStatus === 'rejected' || order.afterSaleStatus === 'failed') ? (
            <Pressable
              onPress={() => router.push({ pathname: '/orders/after-sale/[id]', params: { id: order.id } })}
              style={[styles.actionButtonOutline, { borderColor: colors.border, borderRadius: radius.pill }]}
            >
              <Text style={[typography.caption, { color: colors.text.secondary }]}>申请售后</Text>
            </Pressable>
          ) : null}
          {/* 查看售后记录入口 */}
          {order.afterSaleStatus && order.afterSaleStatus !== 'rejected' && order.afterSaleStatus !== 'failed' ? (
            <Pressable
              onPress={() => router.push('/orders/after-sale')}
              style={[styles.actionButtonOutline, { borderColor: colors.brand.primary, borderRadius: radius.pill }]}
            >
              <Text style={[typography.caption, { color: colors.brand.primary }]}>查看售后</Text>
            </Pressable>
          ) : null}
          {order.status === 'afterSale' && order.afterSaleStatus === 'shipped' ? (
            <Pressable onPress={handleConfirmReplacement}>
              <LinearGradient
                colors={[colors.brand.primary, colors.ai.start]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.actionButton, { borderRadius: radius.pill }]}
              >
                <Text style={[typography.caption, { color: colors.text.inverse }]}>确认收到换货</Text>
              </LinearGradient>
            </Pressable>
          ) : null}
        </View>

        {/* 售后时间线 — 脉动当前节点 + 渐变连接线 */}
        {order.afterSaleStatus ? (
          <Animated.View entering={FadeInDown.duration(300).delay(80)}>
            <View style={{ marginTop: spacing.lg }}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>售后进度</Text>
              <View style={[styles.afterSaleCard, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
                {afterSaleTimeline.length === 0 ? (
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>暂无售后节点</Text>
                ) : (
                  afterSaleTimeline.map((step, index) => {
                    const isCurrent = step.status === order.afterSaleStatus;
                    return (
                      <View key={`${step.status}-${index}`} style={styles.afterSaleRow}>
                        <View style={styles.afterSaleLeft}>
                          {isCurrent ? (
                            <PulsingDot color={colors.brand.primary} />
                          ) : (
                            <View style={[styles.afterSaleDot, { backgroundColor: colors.border }]} />
                          )}
                          {index < afterSaleTimeline.length - 1 ? (
                            <LinearGradient
                              colors={[colors.brand.primary, colors.ai.start]}
                              style={styles.afterSaleLine}
                            />
                          ) : null}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{step.title}</Text>
                          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                            {step.time}
                          </Text>
                          {step.note ? (
                            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                              {step.note}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })
                )}
                {USE_MOCK ? (
                  <Pressable
                    onPress={handleAdvanceAfterSale}
                    style={[styles.afterSaleAction, { borderRadius: radius.pill, borderColor: colors.border }]}
                  >
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>模拟推进售后</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </Animated.View>
        ) : null}

        {/* 商品清单 */}
        <Animated.View entering={FadeInDown.duration(300).delay(160)}>
          <View style={{ marginTop: spacing.lg }}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>商品清单</Text>
            {order.items.length === 0 ? (
              <View style={{ marginTop: spacing.md }}>
                <EmptyState title="暂无商品" description="订单中没有商品记录" />
              </View>
            ) : (
              order.items.map((item) => {
                // 退换政策提示文案
                const policyHint = item.isPrize
                  ? '不支持退换'
                  : order.bizType === 'VIP_PACKAGE'
                    ? '不支持退换'
                    : item.isPostReplacement
                      ? '签收后24小时内如有质量问题可申请售后'
                      : order.returnWindowExpiresAt && new Date(order.returnWindowExpiresAt) > new Date()
                        ? '支持7天无理由退换'
                        : '签收后24小时内如有质量问题可申请售后';
                const policyColor = (item.isPrize || order.bizType === 'VIP_PACKAGE')
                  ? colors.muted
                  : policyHint.includes('7天')
                    ? colors.brand.primary
                    : colors.text.tertiary;

                return (
                  <View
                    key={item.id}
                    style={[styles.itemRow, { borderBottomColor: colors.border }]}
                  >
                    <View style={styles.itemInfo}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{item.title}</Text>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                        数量 x{item.quantity}
                      </Text>
                      <Text style={[{ fontSize: 11, lineHeight: 16, color: policyColor, marginTop: 2 }]}>
                        {policyHint}
                      </Text>
                    </View>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                      ¥{item.price.toFixed(2)}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        </Animated.View>

        {/* 合计行 — AiDivider 分隔 */}
        <AiDivider style={{ marginTop: spacing.md }} />
        {order.goodsAmount != null && (
          <View style={[styles.totalRow, { marginTop: 8, paddingTop: 8 }]}>
            <Text style={[typography.bodySm, { color: colors.text.secondary }]}>商品金额</Text>
            <Text style={[typography.bodySm, { color: colors.text.primary }]}>¥{order.goodsAmount.toFixed(2)}</Text>
          </View>
        )}
        <View style={[styles.totalRow, { marginTop: 8, paddingTop: 8 }]}>
          <Text style={[typography.bodySm, { color: colors.text.secondary }]}>运费</Text>
          <Text style={[typography.bodySm, { color: (order.shippingFee ?? 0) === 0 ? colors.brand.primary : colors.text.primary }]}>
            {(order.shippingFee ?? 0) === 0 ? '免运费' : `¥${(order.shippingFee ?? 0).toFixed(2)}`}
          </Text>
        </View>
        {order.vipDiscountAmount && order.vipDiscountAmount > 0 ? (
          <View style={[styles.totalRow, { marginTop: 8, paddingTop: 8 }]}>
            <Text style={[typography.bodySm, { color: colors.text.secondary }]}>VIP折扣</Text>
            <Text style={[typography.bodySm, { color: colors.brand.primary }]}>-¥{order.vipDiscountAmount.toFixed(2)}</Text>
          </View>
        ) : null}
        {order.discountAmount && order.discountAmount > 0 ? (
          <View style={[styles.totalRow, { marginTop: 8, paddingTop: 8 }]}>
            <Text style={[typography.bodySm, { color: colors.text.secondary }]}>红包抵扣</Text>
            <Text style={[typography.bodySm, { color: colors.danger }]}>-¥{order.discountAmount.toFixed(2)}</Text>
          </View>
        ) : null}
        <View style={[styles.totalRow]}>
          <Text style={[typography.body, { color: colors.text.secondary }]}>合计</Text>
          <Text style={[typography.title3, { color: colors.text.primary }]}>¥{order.totalPrice.toFixed(2)}</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    padding: 16,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 10,
  },
  actionButtonOutline: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    marginRight: 10,
  },
  legacyPayHint: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    marginRight: 10,
    justifyContent: 'center',
  },
  afterSaleCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginTop: 12,
  },
  afterSaleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  afterSaleLeft: {
    width: 24,
    alignItems: 'center',
    marginRight: 10,
  },
  afterSaleDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  afterSaleLine: {
    width: 2,
    flex: 1,
    marginTop: 4,
    borderRadius: 1,
    minHeight: 20,
  },
  afterSaleAction: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  itemInfo: {
    flex: 1,
    marginRight: 12,
  },
  totalRow: {
    marginTop: 12,
    paddingTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
