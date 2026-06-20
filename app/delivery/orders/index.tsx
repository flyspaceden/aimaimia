import React from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../../src/components/layout';
import { DeliveryOrderRepo } from '../../../src/repos/delivery';
import {
  DELIVERY_ORDER_STATUS_LABELS,
  DeliveryButton,
  DeliveryLoading,
  DeliveryMessageState,
  DeliveryPanel,
  DeliveryStatusPill,
  formatDeliveryMoney,
  useDeliveryTheme,
} from '../_components';

const filters: Array<{ id?: string; label: string }> = [
  { label: '全部' },
  { id: 'PENDING_SHIPMENT', label: '待发货' },
  { id: 'SHIPPED', label: '已发货' },
  { id: 'DELIVERED', label: '已送达' },
  { id: 'COMPLETED', label: '已完成' },
];

export default function DeliveryOrdersScreen() {
  const router = useRouter();
  const { spacing, typography, palette } = useDeliveryTheme();
  const [status, setStatus] = React.useState<string | undefined>(undefined);

  const query = useQuery({
    queryKey: ['delivery-orders', status ?? 'all'],
    queryFn: () => DeliveryOrderRepo.listOrders({ status, page: 1, pageSize: 50 }),
  });

  if (query.isLoading && !query.data) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="配送订单" />
        <DeliveryLoading />
      </Screen>
    );
  }

  const orders = query.data?.ok ? query.data.data.items : [];

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="配送订单" />
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={query.isFetching} onRefresh={() => query.refetch()} />
        }
        ListHeaderComponent={
          <View style={{ padding: spacing.xl, paddingBottom: spacing.md }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {filters.map((filter) => (
                <DeliveryButton
                  key={filter.id || 'all'}
                  label={filter.label}
                  variant={status === filter.id || (!status && !filter.id) ? 'primary' : 'secondary'}
                  onPress={() => setStatus(filter.id)}
                />
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          <DeliveryMessageState
            title="还没有配送订单"
            description="支付完成后的配送订单会出现在这里"
            actionLabel="去选商品"
            onAction={() => router.replace('/delivery/(tabs)/products')}
            icon="clipboard-text-outline"
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/delivery/orders/[id]', params: { id: item.id } })}
            style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.md }}
          >
            <DeliveryPanel>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[typography.bodyStrong, { color: palette.text.primary }]}>
                  {item.id}
                </Text>
                <DeliveryStatusPill status={item.status} />
              </View>
              <Text style={[typography.caption, { color: palette.text.secondary, marginTop: spacing.sm }]}>
                {item.unit.name} · {item.items.length} 件商品
              </Text>
              <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.xs }]} numberOfLines={1}>
                {item.items[0]?.productTitle || '配送商品'}
                {item.items.length > 1 ? ` 等 ${item.items.length} 件` : ''}
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md }}>
                <Text style={[typography.headingSm, { color: palette.brand.primaryDark }]}>
                  {formatDeliveryMoney(item.totalAmount)}
                </Text>
                <Text style={[typography.caption, { color: palette.text.tertiary }]}>
                  {DELIVERY_ORDER_STATUS_LABELS[item.status] ?? item.status}
                </Text>
              </View>
            </DeliveryPanel>
          </Pressable>
        )}
      />
    </Screen>
  );
}
