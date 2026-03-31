import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { orderStatusLabels } from '../../src/constants/statuses';
import { OrderRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AppError, OrderStatus } from '../../src/types';

const statusOptions: Array<{ id: OrderStatus | 'afterSaleList'; label: string }> = [
  { id: 'pendingPay', label: '待付款' },
  { id: 'pendingShip', label: '待发货' },
  { id: 'shipping', label: '待收货' },
  { id: 'afterSaleList', label: '售后' },
  { id: 'completed', label: '已完成' },
];

const afterSaleStatusLabels: Record<string, string> = {
  applying: '申请中',
  reviewing: '审核中',
  approved: '已同意换货',
  shipped: '卖家已补发',
  completed: '已完成',
  rejected: '已驳回',
  failed: '处理失败',
  // 兼容历史退款状态
  refunding: '售后处理中',
};

const isOrderStatus = (value?: string): value is OrderStatus =>
  value === 'pendingPay' ||
  value === 'pendingShip' ||
  value === 'shipping' ||
  value === 'delivered' ||
  value === 'afterSale' ||
  value === 'completed';

// 根据订单状态返回左边框颜色
const getStatusBorderColor = (status: OrderStatus, colors: any): string | undefined => {
  switch (status) {
    case 'pendingPay': return colors.warning;
    case 'shipping': return colors.brand.primary;
    case 'afterSale': return colors.danger;
    default: return undefined;
  }
};

export default function OrdersScreen() {
  const params = useLocalSearchParams<{ status?: string }>();
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const selectedStatus = isOrderStatus(params.status) ? params.status : undefined;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['orders', selectedStatus ?? 'all'],
    queryFn: () => OrderRepo.list(selectedStatus),
    enabled: isLoggedIn,
  });
  const refreshing = isFetching;

  const listError = data && !data.ok ? data.error : null;
  // 从分页结果中提取订单列表（PaginationResult<Order>.items）
  const orders = data?.ok ? data.data.items : [];

  const title = useMemo(() => {
    if (!selectedStatus) {
      return '全部订单';
    }
    return orderStatusLabels[selectedStatus] ?? '订单';
  }, [selectedStatus]);

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title={title} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} />}
      >
        {/* 筛选芯片 — 选中态微渐变 */}
        <View style={styles.filterRow}>
          <Pressable
            onPress={() => router.replace('/orders')}
            style={[styles.filterChip, { borderRadius: radius.pill, overflow: 'hidden' }]}
          >
            {!selectedStatus ? (
              <LinearGradient
                colors={[colors.brand.primarySoft, colors.ai.soft]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.filterChipInner, { borderRadius: radius.pill }]}
              >
                <Text style={[typography.caption, { color: colors.brand.primary }]}>全部</Text>
              </LinearGradient>
            ) : (
              <View style={[styles.filterChipInner, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill }]}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>全部</Text>
              </View>
            )}
          </Pressable>
          {statusOptions.map((option) => {
            // "售后" 选项导航到独立售后列表页
            if (option.id === 'afterSaleList') {
              return (
                <Pressable
                  key={option.id}
                  onPress={() => router.push('/orders/after-sale')}
                  style={[styles.filterChip, { borderRadius: radius.pill, overflow: 'hidden' }]}
                >
                  <View style={[styles.filterChipInner, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill }]}>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>{option.label}</Text>
                  </View>
                </Pressable>
              );
            }
            const active = option.id === selectedStatus;
            return (
              <Pressable
                key={option.id}
                onPress={() => router.replace({ pathname: '/orders', params: { status: option.id } })}
                style={[styles.filterChip, { borderRadius: radius.pill, overflow: 'hidden' }]}
              >
                {active ? (
                  <LinearGradient
                    colors={[colors.brand.primarySoft, colors.ai.soft]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.filterChipInner, { borderRadius: radius.pill }]}
                  >
                    <Text style={[typography.caption, { color: colors.brand.primary }]}>{option.label}</Text>
                  </LinearGradient>
                ) : (
                  <View style={[styles.filterChipInner, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill }]}>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>{option.label}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {isLoading ? (
          <View style={{ marginTop: spacing.md }}>
            <Skeleton height={120} radius={radius.lg} />
            <View style={{ height: spacing.md }} />
            <Skeleton height={120} radius={radius.lg} />
          </View>
        ) : (listError as AppError | null) ? (
          <View style={{ marginTop: spacing.md }}>
            <ErrorState
              title="订单加载失败"
              description={listError?.displayMessage ?? '请稍后重试'}
              onAction={refetch}
            />
          </View>
        ) : orders.length === 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <EmptyState title="暂无订单" description="去首页看看新鲜好物" />
          </View>
        ) : (
          orders.map((order, index) => {
            const borderColor = getStatusBorderColor(order.status, colors);
            return (
              <Animated.View key={order.id} entering={FadeInDown.duration(300).delay(50 + index * 30)}>
                <Pressable
                  onPress={() => router.push({ pathname: '/orders/[id]', params: { id: order.id } })}
                  style={[
                    styles.orderCard,
                    shadow.md,
                    {
                      backgroundColor: colors.surface,
                      borderRadius: radius.lg,
                      borderLeftWidth: borderColor ? 2 : 0,
                      borderLeftColor: borderColor,
                    },
                  ]}
                >
                  <View style={styles.orderHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{order.id}</Text>
                      {order.bizType === 'VIP_PACKAGE' && (
                        <View style={{ backgroundColor: 'rgba(201,169,110,0.15)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 }}>
                          <Text style={{ fontSize: 10, color: '#C9A96E', fontWeight: '600' }}>VIP礼包</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>
                      {orderStatusLabels[order.status]}
                    </Text>
                  </View>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                    {order.createdAt} · {order.items.length} 件商品
                  </Text>
                  {order.afterSaleStatus ? (
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                      售后进度：{afterSaleStatusLabels[order.afterSaleStatus] ?? '处理中'}
                    </Text>
                  ) : null}
                  <View style={styles.orderFooter}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                      合计 ¥{order.totalPrice.toFixed(2)}
                    </Text>
                    <View style={styles.actionRow}>
                      {order.status === 'pendingPay' ? (
                        <Text style={[typography.caption, { color: colors.brand.primary, fontWeight: '600' }]}>去支付</Text>
                      ) : null}
                      <Text
                        style={[
                          typography.caption,
                          { color: colors.accent.blue, marginLeft: order.status === 'pendingPay' ? 10 : 0 },
                        ]}
                      >
                        查看详情
                      </Text>
                    </View>
                  </View>
                </Pressable>
              </Animated.View>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  filterChip: {
    marginRight: 8,
    marginBottom: 8,
  },
  filterChipInner: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  orderCard: {
    padding: 14,
    marginBottom: 12,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderFooter: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
