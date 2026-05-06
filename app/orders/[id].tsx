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
import { useBottomInset, useTheme } from '../../src/theme';
import type { OrderItem, OrderStatus } from '../../src/types';

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id ?? '');
  const { colors, radius, spacing, typography } = useTheme();
  // StickyCTABar 自吃 inset（高度 ~48dp + inset），ScrollView 留 80 + inset 才不会
  // 让最后一个区块被 bar 盖住。useBottomInset(0) 仅 inset + OEM 兜底，不加 extra
  const safeBottom = useBottomInset(0);
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

  // Phase 2: 后端真实暴露 autoReceiveAt；旧订单仍可能为 null（不显示倒计时，可接受）
  const autoReceiveAt = order.autoReceiveAt ?? undefined;

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

  // 付款后建单架构：无 PENDING_PAYMENT；订单存在即至少为 PAID
  switch (order.status) {
    case 'PAID':
      // 已付款待发货 — 仅允许取消（走退款）
      secondary.push({ label: '取消订单', onPress: handleCancel });
      break;
    case 'SHIPPED':
    case 'DELIVERED':
      primary = { label: '确认收货', onPress: handleConfirmReceive };
      secondary.push({ label: '查看物流', onPress: () => router.push({ pathname: '/orders/track', params: { orderId: order.id } }) });
      break;
    case 'RECEIVED':
      primary = { label: '再次购买', onPress: () => show({ message: '功能即将上线', type: 'info' }) };
      break;
  }

  if (order.afterSaleStatus && order.afterSaleStatus !== 'rejected' && order.afterSaleStatus !== 'failed') {
    secondary.push({ label: '查看售后', onPress: () => router.push('/orders/after-sale') });
  }

  // 售后中且换货已发出 → 主操作改为"确认收到换货"
  if (order.afterSaleStatus === 'shipped') {
    primary = { label: '确认收到换货', onPress: handleConfirmReplacement };
  }

  secondary.push({ label: '联系客服', onPress: () => router.push(`/cs?source=ORDER_DETAIL&sourceId=${orderId}`) });

  // 物流摘要（Phase 3 Review Fix 5：优先用 logisticsSummary 跨包裹最新事件，多包裹场景更准确）
  const shipments = (order as any).shipments as Array<any> | undefined;
  const summary = (order as any).logisticsSummary as { status?: string; latestEventMessage?: string; latestEventTime?: string } | undefined;
  const latestEvent = summary?.latestEventMessage
    ? { message: summary.latestEventMessage, time: summary.latestEventTime ?? '' }
    : (shipments?.[0]?.trackingEvents?.[0] ?? null);
  const showLogistics = (['PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'] as OrderStatus[]).includes(order.status);

  // 按 companyId 分组商品
  const groups = new Map<string, OrderItem[]>();
  for (const it of order.items) {
    const k = (it as any).companyId ?? 'unknown';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }

  // Phase 2 后端直接给 order.address.fullAddress 拼好的字段，保留 raw fallback 以兼容旧数据
  const addr = (order as any).address || (order as any).addressSnapshotMasked;
  const addrRecipientName = addr?.recipientName || '收件人';
  const addrPhone = addr?.recipientPhone || addr?.phone || '';
  const addrFullText = addr?.fullAddress
    || [addr?.province, addr?.city, addr?.district, addr?.detail].filter(Boolean).join(' ');

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="订单详情" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 80 + safeBottom }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
      >
        {/* ① StatusHero */}
        <StatusHero
          status={order.status}
          isVipPackage={isVip}
          countdownExpiresAt={order.status === 'DELIVERED' && autoReceiveAt ? autoReceiveAt : undefined}
          countdownPrefix={order.status === 'DELIVERED' ? '还剩' : undefined}
          subtitle={order.status === 'PAID' ? '商家正在打包，预计 24 小时内发出' : undefined}
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
              recipientName={addrRecipientName}
              recipientPhone={addrPhone}
              fullAddress={addrFullText}
            />
          </View>
        ) : null}

        {/* ④ Shop groups + items */}
        {Array.from(groups.entries()).map(([cid, items]) => (
          <View key={cid} style={[styles.section, { backgroundColor: colors.surface, paddingHorizontal: spacing.md }]}>
            <ShopGroup
              companyName={items[0].companyName || '商家'}
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
