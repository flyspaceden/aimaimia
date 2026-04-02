import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { orderStatusLabels } from '../../src/constants/statuses';
import { OrderRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AppError, OrderStatus } from '../../src/types';

const statusOptions: Array<{ id: OrderStatus; label: string }> = [
  { id: 'pendingPay', label: '待付款' },
  { id: 'pendingShip', label: '待发货' },
  { id: 'shipping', label: '待收货' },
  { id: 'afterSale', label: '退款/售后' },
  { id: 'completed', label: '已完成' },
];

const isOrderStatus = (value?: string): value is OrderStatus =>
  value === 'pendingPay' ||
  value === 'pendingShip' ||
  value === 'shipping' ||
  value === 'afterSale' ||
  value === 'completed';

export default function OrdersScreen() {
  const params = useLocalSearchParams<{ status?: string }>();
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const selectedStatus = isOrderStatus(params.status) ? params.status : undefined;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['orders', selectedStatus ?? 'all'],
    queryFn: () => OrderRepo.list(selectedStatus),
  });
  const refreshing = isFetching;

  const listError = data && !data.ok ? data.error : null;
  const orders = data?.ok ? data.data : [];

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
        <View style={styles.filterRow}>
          <Pressable
            onPress={() => router.replace('/orders')}
            style={[
              styles.filterChip,
              {
                borderColor: !selectedStatus ? colors.brand.primary : colors.border,
                backgroundColor: !selectedStatus ? colors.brand.primarySoft : colors.surface,
                borderRadius: radius.pill,
              },
            ]}
          >
            <Text style={[typography.caption, { color: !selectedStatus ? colors.brand.primary : colors.text.secondary }]}>
              全部
            </Text>
          </Pressable>
          {statusOptions.map((option) => {
            const active = option.id === selectedStatus;
            return (
              <Pressable
                key={option.id}
                onPress={() => router.replace({ pathname: '/orders', params: { status: option.id } })}
                style={[
                  styles.filterChip,
                  {
                    borderColor: active ? colors.brand.primary : colors.border,
                    backgroundColor: active ? colors.brand.primarySoft : colors.surface,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text style={[typography.caption, { color: active ? colors.brand.primary : colors.text.secondary }]}>
                  {option.label}
                </Text>
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
          orders.map((order) => (
            <Pressable
              key={order.id}
              onPress={() => router.push({ pathname: '/orders/[id]', params: { id: order.id } })}
              style={[
                styles.orderCard,
                shadow.sm,
                { backgroundColor: colors.surface, borderRadius: radius.lg, borderColor: colors.border },
              ]}
            >
              <View style={styles.orderHeader}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{order.id}</Text>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  {orderStatusLabels[order.status]}
                </Text>
              </View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                {order.createdAt} · {order.items.length} 件商品
              </Text>
              {order.afterSaleStatus ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                  售后进度：{order.afterSaleStatus}
                </Text>
              ) : null}
              <View style={styles.orderFooter}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                  合计 ¥{order.totalPrice.toFixed(2)}
                </Text>
                <View style={styles.actionRow}>
                  {order.status === 'pendingPay' ? (
                    <Text style={[typography.caption, { color: colors.brand.primary }]}>去支付</Text>
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
          ))
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
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  orderCard: {
    borderWidth: 1,
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
