import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { StatusHero } from '../../src/components/orders/StatusHero';
import { AddressCard } from '../../src/components/orders/AddressCard';
import { ShopGroup } from '../../src/components/orders/ShopGroup';
import { AmountSummary } from '../../src/components/orders/AmountSummary';
import { OrderInfoBlock } from '../../src/components/orders/OrderInfoBlock';
import { StickyCTABar } from '../../src/components/orders/StickyCTABar';
import { OrderRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import type { OrderItem } from '../../src/types';

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id ?? '');
  const { colors, radius, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => OrderRepo.getById(orderId),
    enabled: isLoggedIn && Boolean(orderId),
  });

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="订单详情" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={160} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="订单详情" />
        <ErrorState
          title="加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请重试' : '请重试'}
          onAction={refetch}
        />
      </Screen>
    );
  }

  const order = data.data;
  const isVip = order.bizType === 'VIP_PACKAGE';

  // Phase 1 fallback: 用 deliveredAt + 7 天 模拟 autoReceiveAt（Phase 2 后端会真实返回）
  const autoReceiveAt = (order as any).autoReceiveAt
    ?? (order.deliveredAt ? new Date(new Date(order.deliveredAt).getTime() + 7 * 86400_000).toISOString() : undefined);

  const handleConfirmReceive = async () => {
    const r = await OrderRepo.confirmReceive(order.id);
    if (!r.ok) return show({ message: r.error.displayMessage ?? '失败', type: 'error' });
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    show({ message: '已确认收货', type: 'success' });
    refetch();
  };

  const handleConfirmReplacement = async () => {
    const r = await OrderRepo.confirmReplacement(order.id);
    if (!r.ok) return show({ message: r.error.displayMessage ?? '失败', type: 'error' });
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    show({ message: '已确认收到换货', type: 'success' });
    refetch();
  };

  const handleCancel = async () => {
    const r = await OrderRepo.cancelOrder(order.id);
    if (!r.ok) return show({ message: r.error.displayMessage ?? '失败', type: 'error' });
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    show({ message: '已取消', type: 'success' });
    refetch();
  };

  // CTA mapping
  let primary: { label: string; onPress: () => void } | undefined;
  const secondary: Array<{ label: string; onPress: () => void }> = [];

  switch (order.status) {
    case 'pendingPay':
      // F1 后流程不会有新的 pendingPay 订单；此分支仅兼容老数据
      primary = { label: '已停用', onPress: () => show({ message: '历史订单不可支付，请重新下单', type: 'error' }) };
      secondary.push({ label: '取消订单', onPress: handleCancel });
      break;
    case 'shipping':
    case 'delivered':
      primary = { label: '确认收货', onPress: handleConfirmReceive };
      secondary.push({ label: '查看物流', onPress: () => router.push({ pathname: '/orders/track', params: { orderId: order.id } }) });
      break;
    case 'completed':
      primary = { label: '再次购买', onPress: () => show({ message: '功能即将上线', type: 'info' }) };
      break;
  }

  if (order.afterSaleStatus && order.afterSaleStatus !== 'rejected' && order.afterSaleStatus !== 'failed') {
    secondary.push({ label: '查看售后', onPress: () => router.push('/orders/after-sale') });
  }

  if (order.status === 'afterSale' && order.afterSaleStatus === 'shipped') {
    primary = { label: '确认收到换货', onPress: handleConfirmReplacement };
  }

  secondary.push({ label: '联系客服', onPress: () => router.push(`/cs?source=ORDER_DETAIL&sourceId=${orderId}`) });

  // 物流摘要（Phase 1 取 shipments[0] 最新事件）
  const shipments = (order as any).shipments as Array<any> | undefined;
  const latestEvent = shipments?.[0]?.trackingEvents?.[0];
  const showLogistics = ['pendingShip', 'shipping', 'delivered', 'completed'].includes(order.status);

  // 按 companyId 分组商品
  const groups = new Map<string, OrderItem[]>();
  for (const it of order.items) {
    const k = (it as any).companyId ?? 'unknown';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }

  // Phase 1 地址 fallback：addressSnapshotMasked（详情已暴露）
  // Phase 2 后端会直接给 order.address.fullAddress 拼好的字段
  const addr = (order as any).address || (order as any).addressSnapshotMasked;
  const addrFullText = addr?.fullAddress
    || [addr?.province, addr?.city, addr?.district, addr?.detail].filter(Boolean).join(' ');

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="订单详情" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
      >
        {/* ① StatusHero */}
        <StatusHero
          status={order.status}
          isVipPackage={isVip}
          countdownExpiresAt={order.status === 'delivered' && autoReceiveAt ? autoReceiveAt : undefined}
          countdownPrefix={order.status === 'delivered' ? '还剩' : undefined}
          subtitle={order.status === 'pendingShip' ? '商家正在打包，预计 24 小时内发出' : undefined}
        />

        {/* ② Logistics card */}
        {showLogistics && latestEvent ? (
          <Pressable
            onPress={() => router.push({ pathname: '/orders/track', params: { orderId: order.id } })}
            style={[styles.sectionRow, { backgroundColor: colors.surface }]}
          >
            <MaterialCommunityIcons name="package-variant" size={18} color={colors.brand.primary} />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={[typography.body, { color: colors.text.primary }]}>{latestEvent.message}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>{latestEvent.time}</Text>
            </View>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>查看物流 ›</Text>
          </Pressable>
        ) : null}

        {/* ③ Address */}
        {addr ? (
          <View style={[styles.section, { backgroundColor: colors.surface, paddingHorizontal: spacing.md }]}>
            <AddressCard
              recipientName={addr.recipientName || '收件人'}
              recipientPhone={addr.phone || ''}
              fullAddress={addrFullText}
            />
          </View>
        ) : null}

        {/* ④ Shop groups + items */}
        {Array.from(groups.entries()).map(([cid, items]) => (
          <View key={cid} style={[styles.section, { backgroundColor: colors.surface, paddingHorizontal: spacing.md }]}>
            <ShopGroup
              companyName={(items[0] as any).companyName || '商家'}
              items={items}
              showAfterSaleAction={['delivered', 'completed'].includes(order.status) && !isVip}
              onItemAfterSale={() => router.push({ pathname: '/orders/after-sale/[id]', params: { id: order.id } })}
            />
          </View>
        ))}

        {/* ⑤ Amount summary */}
        <View style={[styles.section, { backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.md }]}>
          <AmountSummary
            goodsAmount={order.goodsAmount ?? 0}
            shippingFee={order.shippingFee ?? 0}
            vipDiscountAmount={order.vipDiscountAmount}
            discountAmount={order.discountAmount}
            totalPrice={order.totalPrice}
          />
        </View>

        {/* ⑥ Order info */}
        <View style={[styles.section, { backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.md }]}>
          <OrderInfoBlock
            orderId={order.id}
            createdAt={order.createdAt}
            paidAt={order.paidAt}
            shippedAt={order.shippedAt}
            deliveredAt={order.deliveredAt}
            paymentMethod={(order as any).paymentMethod}
            buyerNote={(order as any).buyerNote}
            isVipPackage={isVip}
            onApplyInvoice={!isVip ? () => router.push({ pathname: '/invoices/request', params: { orderId: order.id } }) : undefined}
          />
        </View>
      </ScrollView>

      {/* ⑦ Sticky CTA */}
      <StickyCTABar primary={primary} secondary={secondary} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { padding: 12, marginTop: 8 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 8 },
});
