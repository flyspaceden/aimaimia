import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { OrderCard } from '../../src/components/cards/OrderCard';
import { orderStatusLabels } from '../../src/constants/statuses';
import { OrderRepo } from '../../src/repos';
import { useAuthStore, useCartStore } from '../../src/store';
import { useBottomInset, useTheme } from '../../src/theme';
import { AppError, Order, OrderStatus } from '../../src/types';
import { formatRepurchaseToast } from '../../src/utils';

const statusOptions: Array<{ id: OrderStatus | 'afterSaleList'; label: string }> = [
  { id: 'PAID', label: '待发货' },
  { id: 'SHIPPED', label: '已发货' },
  { id: 'DELIVERED', label: '待收货' },
  { id: 'afterSaleList', label: '售后' },
  { id: 'RECEIVED', label: '已完成' },
];

const isOrderStatus = (v?: string): v is OrderStatus =>
  v === 'PAID' || v === 'SHIPPED' || v === 'DELIVERED' || v === 'RECEIVED' || v === 'CANCELED' || v === 'REFUNDED';

function useOrderActions() {
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const replaceCartFromServer = useCartStore((s) => s.replaceFromServer);
  const [repurchasingOrderId, setRepurchasingOrderId] = useState<string | null>(null);
  const repurchasingOrderIdRef = React.useRef<string | null>(null);

  const handleRepurchase = async (order: Order) => {
    if (repurchasingOrderIdRef.current || order.repurchasable === false) return;
    repurchasingOrderIdRef.current = order.id;
    setRepurchasingOrderId(order.id);
    try {
      const r = await OrderRepo.repurchase(order.id);
      if (r.ok === false) {
        show({ message: r.error.displayMessage ?? '再次购买失败', type: 'error' });
        return;
      }
      const result = r.data;
      replaceCartFromServer(
        result.cart,
        result.items.filter((item) => item.status === 'ADDED').map((item) => item.skuId),
      );
      const virtualNotices = result.items
        .filter((item) => item.virtual || item.reason === 'OUT_OF_STOCK_VIRTUAL')
        .map((item) => ({
          skuId: item.skuId,
          title: item.title,
          message: item.message || '商品暂无库存，未加入购物车',
        }));
      useCartStore.getState().setVirtualNotices(virtualNotices);
      if (result.addedQuantity <= 0 && virtualNotices.length === 0) {
        show({ message: '原订单商品当前不可再次购买', type: 'info' });
        return;
      }
      show(formatRepurchaseToast(result));
      router.push('/cart');
    } finally {
      repurchasingOrderIdRef.current = null;
      setRepurchasingOrderId(null);
    }
  };

  return (order: Order) => {
    switch (order.status) {
      case 'PAID':
        return {
          primaryLabel: '联系客服',
          primaryAction: () => router.push(`/cs?source=ORDER_DETAIL&sourceId=${order.id}`),
        } as const;
      case 'SHIPPED':
      case 'DELIVERED':
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
      case 'RECEIVED':
        return {
          primaryLabel: repurchasingOrderId === order.id ? '加入中...' : '再次购买',
          primaryAction: () => handleRepurchase(order),
          // 与 handleRepurchase() 的函数级 guard 保持一致：任意一笔复购中，全列表复购按钮禁用。
          primaryDisabled: repurchasingOrderId !== null || order.repurchasable === false,
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
    refetchOnWindowFocus: true,
  });

  // 切回前台 / back 回订单列表立即刷新当前 tab
  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch]),
  );

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
        primaryDisabled={'primaryDisabled' in ctas ? ctas.primaryDisabled : undefined}
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
