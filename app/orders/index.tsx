import React, { useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { OrderCard } from '../../src/components/cards/OrderCard';
import { orderStatusLabels } from '../../src/constants/statuses';
import { OrderRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useBottomInset, useTheme } from '../../src/theme';
import { AppError, Order, OrderStatus } from '../../src/types';

const statusOptions: Array<{ id: OrderStatus | 'afterSaleList'; label: string }> = [
  { id: 'pendingShip', label: '待发货' },
  { id: 'shipping', label: '待收货' },
  { id: 'afterSaleList', label: '售后' },
  { id: 'completed', label: '已完成' },
];

const isOrderStatus = (v?: string): v is OrderStatus =>
  v === 'pendingShip' || v === 'shipping' || v === 'delivered' || v === 'afterSale' || v === 'completed';

function useOrderActions() {
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();

  return (order: Order) => {
    switch (order.status) {
      case 'pendingShip':
        return {
          primaryLabel: '联系客服',
          primaryAction: () => router.push(`/cs?source=ORDER_DETAIL&sourceId=${order.id}`),
        } as const;
      case 'shipping':
      case 'delivered':
        return {
          primaryLabel: '确认收货',
          primaryAction: async () => {
            const r = await OrderRepo.confirmReceive(order.id);
            if (!r.ok) {
              show({ message: r.error.displayMessage ?? '失败', type: 'error' });
              return;
            }
            await queryClient.invalidateQueries({ queryKey: ['orders'] });
            await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
            show({ message: '已确认收货', type: 'success' });
          },
          secondaryLabel: '查看物流',
          secondaryAction: () => router.push({ pathname: '/orders/track', params: { orderId: order.id } }),
        } as const;
      case 'completed':
        return {
          primaryLabel: '再次购买',
          primaryAction: () => show({ message: '功能即将上线', type: 'info' }),
        } as const;
      default:
        return {} as const;
    }
  };
}

export default function OrdersScreen() {
  const params = useLocalSearchParams<{ status?: string }>();
  const { colors, radius, spacing, typography } = useTheme();
  const router = useRouter();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const selectedStatus = isOrderStatus(params.status) ? params.status : undefined;
  const getActions = useOrderActions();
  // R-RS07: FlatList paddingBottom 吃 safe area inset + Android OEM 兜底
  const safeBottom = useBottomInset(spacing['3xl']);

  // Phase 3 Review Fix 3：useInfiniteQuery 替代 useQuery，FlatList 触底加载下一页
  const PAGE_SIZE = 20;
  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['orders', selectedStatus ?? 'all'],
    queryFn: async ({ pageParam = 1 }) => {
      const r = await OrderRepo.list(selectedStatus, { page: pageParam as number, pageSize: PAGE_SIZE });
      if (!r.ok) throw r.error;
      return r.data;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const page = lastPage.page ?? 1;
      const pageSize = lastPage.pageSize ?? PAGE_SIZE;
      const total = lastPage.total ?? 0;
      const loaded = page * pageSize;
      return loaded < total ? page + 1 : undefined;
    },
    enabled: isLoggedIn,
  });

  const listError = isError ? (error as unknown as AppError) : null;
  const orders: Order[] = data?.pages.flatMap((p) => p.items) ?? [];
  const title = useMemo(() => selectedStatus ? (orderStatusLabels[selectedStatus] ?? '订单') : '全部订单', [selectedStatus]);

  const renderHeader = () => (
    <View style={styles.filterRow}>
      <FilterChip active={!selectedStatus} label="全部" onPress={() => router.replace('/orders')} colors={colors} radius={radius} typography={typography} />
      {statusOptions.map((opt) => {
        if (opt.id === 'afterSaleList') {
          return <FilterChip key={opt.id} active={false} label={opt.label} onPress={() => router.push('/orders/after-sale')} colors={colors} radius={radius} typography={typography} />;
        }
        return <FilterChip key={opt.id} active={opt.id === selectedStatus} label={opt.label} onPress={() => router.replace({ pathname: '/orders', params: { status: opt.id } })} colors={colors} radius={radius} typography={typography} />;
      })}
    </View>
  );

  const renderItem = ({ item }: { item: Order }) => {
    const ctas = getActions(item);
    return (
      <OrderCard
        order={item}
        onPress={() => router.push({ pathname: '/orders/[id]', params: { id: item.id } })}
        primaryLabel={'primaryLabel' in ctas ? ctas.primaryLabel : undefined}
        onPrimaryAction={'primaryAction' in ctas ? ctas.primaryAction : undefined}
        secondaryLabel={'secondaryLabel' in ctas ? ctas.secondaryLabel : undefined}
        onSecondaryAction={'secondaryAction' in ctas ? ctas.secondaryAction : undefined}
      />
    );
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title={title} />
      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={140} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={140} radius={radius.lg} />
        </View>
      ) : listError ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState title="订单加载失败" description={listError?.displayMessage ?? '请稍后重试'} onAction={refetch} />
        </View>
      ) : (
        <FlatList
          data={orders}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={<View style={{ padding: spacing.xl }}><EmptyState title="暂无订单" description="去首页看看新鲜好物" /></View>}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: safeBottom }}
          refreshControl={<RefreshControl refreshing={isFetching && !isFetchingNextPage} onRefresh={refetch} />}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={isFetchingNextPage ? (
            <View style={{ padding: 16, alignItems: 'center' }}>
              <ActivityIndicator size="small" />
            </View>
          ) : null}
        />
      )}
    </Screen>
  );
}

function FilterChip({ active, label, onPress, colors, radius, typography }: any) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, { borderRadius: radius.pill, overflow: 'hidden' }]}>
      {active ? (
        <LinearGradient colors={[colors.brand.primarySoft, colors.ai.soft]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.chipInner, { borderRadius: radius.pill }]}>
          <Text style={[typography.caption, { color: colors.brand.primary }]}>{label}</Text>
        </LinearGradient>
      ) : (
        <View style={[styles.chipInner, { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill }]}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  chip: { marginRight: 8, marginBottom: 8 },
  chipInner: { paddingHorizontal: 12, paddingVertical: 6 },
});
