import React from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { StatusHero } from '../../src/components/orders/StatusHero';
import { AddressCard } from '../../src/components/orders/AddressCard';
import { ShopGroup } from '../../src/components/orders/ShopGroup';
import { AmountSummary } from '../../src/components/orders/AmountSummary';
import { OrderInfoBlock } from '../../src/components/orders/OrderInfoBlock';
import { StickyCTABar } from '../../src/components/orders/StickyCTABar';
import { InvoiceSection } from '../../src/components/cards/InvoiceSection';
import { OrderRepo } from '../../src/repos';
import { AfterSaleRepo } from '../../src/repos/AfterSaleRepo';
import { useAuthStore, useCartStore } from '../../src/store';
import { useBottomInset, useTheme } from '../../src/theme';
import type { OrderItem, OrderStatus, RefundStatus } from '../../src/types';
import { formatRepurchaseToast } from '../../src/utils';

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
  const [canceling, setCanceling] = React.useState(false);
  const [repurchasing, setRepurchasing] = React.useState(false);
  const cancelingRef = React.useRef(false);
  const repurchasingRef = React.useRef(false);
  const replaceCartFromServer = useCartStore((s) => s.replaceFromServer);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => OrderRepo.getById(orderId),
    enabled: isLoggedIn && Boolean(orderId),
    // 进行中的订单 30s 轮询；终态（已完成/已取消/已退款）停止轮询省流量
    refetchInterval: (query) => {
      const result = query.state.data;
      const status = result?.ok ? result.data.status : null;
      if (!status || ['RECEIVED', 'CANCELED', 'REFUNDED'].includes(status)) return false;
      return 30_000;
    },
    refetchOnWindowFocus: true,
  });

  // 切回前台 / 从其他页面 back 回详情时立即刷新
  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch]),
  );

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
  const refund = order.refundSummary;
  const refundTextMap: Record<RefundStatus, (amount: number) => string> = {
    REQUESTED: () => '退款申请已提交，等待审核',
    APPROVED: (amount) => `退款已同意，处理中 ¥${amount.toFixed(2)}`,
    REJECTED: () => '退款申请被拒绝，请联系客服',
    REFUNDING: (amount) => `退款处理中 ¥${amount.toFixed(2)}，预计 1-3 个工作日到账`,
    REFUNDED: (amount) => `已原路退回 ¥${amount.toFixed(2)}`,
    FAILED: () => '退款失败，请联系客服处理',
  };
  const refundText = refund ? refundTextMap[refund.status]?.(refund.amount) ?? refund.status : null;

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
    const afterSaleId = order.afterSaleSummary?.id;
    if (!afterSaleId) {
      show({ message: '未找到售后单，请刷新后重试', type: 'error' });
      return;
    }
    const r = await AfterSaleRepo.confirmReceive(afterSaleId);
    if (!r.ok) return show({ message: r.error.displayMessage ?? '失败', type: 'error' });
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['order', order.id] });
    await queryClient.invalidateQueries({ queryKey: ['after-sale', afterSaleId] });
    await queryClient.invalidateQueries({ queryKey: ['after-sales'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    show({ message: '已确认收到换货', type: 'success' });
    refetch();
  };

  const executeCancel = async () => {
    if (cancelingRef.current) return;
    cancelingRef.current = true;
    setCanceling(true);
    try {
      const r = await OrderRepo.cancelOrder(order.id);
      if (!r.ok) return show({ message: r.error.displayMessage ?? '失败', type: 'error' });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
      show({ message: '已取消，退款将原路退回', type: 'success' });
      refetch();
    } finally {
      cancelingRef.current = false;
      setCanceling(false);
    }
  };

  const handleCancel = () => {
    if (canceling) return;
    Alert.alert(
      '确认取消订单',
      '取消后将申请原路退款，预计 1-3 个工作日到账。多商户订单会整单取消。',
      [
        { text: '再想想', style: 'cancel' },
        {
          text: '确认取消',
          style: 'destructive',
          onPress: executeCancel,
        },
      ],
    );
  };

  const handleRepurchase = async () => {
    if (repurchasingRef.current || order.repurchasable === false) return;
    repurchasingRef.current = true;
    setRepurchasing(true);
    try {
      const r = await OrderRepo.repurchase(order.id);
      if (r.ok === false) {
        show({ message: r.error.displayMessage ?? '再次购买失败', type: 'error' });
        return;
      }
      const result = r.data;
      if (result.addedQuantity <= 0) {
        show({ message: '原订单商品当前不可再次购买', type: 'info' });
        return;
      }
      replaceCartFromServer(
        result.cart,
        result.items.filter((item) => item.status === 'ADDED').map((item) => item.skuId),
      );
      show(formatRepurchaseToast(result));
      router.push('/cart');
    } finally {
      repurchasingRef.current = false;
      setRepurchasing(false);
    }
  };

  // CTA mapping
  type DetailCTAItem = { label: string; onPress: () => void; disabled?: boolean };
  let primary: DetailCTAItem | undefined;
  const secondary: DetailCTAItem[] = [];

  // 付款后建单架构：无 PENDING_PAYMENT；订单存在即至少为 PAID
  switch (order.status) {
    case 'PAID':
      // 已付款待发货 — 仅允许取消（走退款）
      if (order.bizType !== 'VIP_PACKAGE') {
        secondary.push({ label: canceling ? '取消中...' : '取消订单', onPress: handleCancel, disabled: canceling });
      }
      break;
    case 'SHIPPED':
    case 'DELIVERED':
      primary = { label: '确认收货', onPress: handleConfirmReceive };
      secondary.push({ label: '查看物流', onPress: () => router.push({ pathname: '/orders/track', params: { orderId: order.id } }) });
      break;
    case 'RECEIVED':
      primary = {
        label: repurchasing ? '加入中...' : '再次购买',
        onPress: handleRepurchase,
        disabled: repurchasing || order.repurchasable === false,
      };
      break;
  }

  if (order.afterSaleStatus && order.afterSaleStatus !== 'rejected' && order.afterSaleStatus !== 'failed') {
    secondary.push({
      label: '查看售后',
      onPress: () => {
        if (order.afterSaleSummary?.id) {
          router.push(`/orders/after-sale-detail/${order.afterSaleSummary.id}`);
          return;
        }
        router.push('/orders/after-sale');
      },
    });
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
          subtitle={
            order.status === 'CANCELED' && refund?.status === 'REFUNDED'
              ? '订单已取消，退款已原路退回'
              : order.status === 'CANCELED'
                ? '订单已取消，退款处理中'
                : order.status === 'PAID'
                  ? '商家正在打包，预计 24 小时内发出'
                  : undefined
          }
        />

        {refund && refundText ? (
          <View style={[styles.sectionRow, { backgroundColor: colors.surface }]}>
            <MaterialCommunityIcons
              name={refund.status === 'FAILED' || refund.status === 'REJECTED' ? 'alert-circle-outline' : 'cash-refund'}
              size={18}
              color={refund.status === 'FAILED' || refund.status === 'REJECTED' ? colors.danger : colors.brand.primary}
            />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={[typography.body, { color: colors.text.primary }]}>{refundText}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                {refund.reason}
              </Text>
            </View>
          </View>
        ) : null}

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
              isVipPackage={isVip}
              showAfterSaleAction={['DELIVERED', 'RECEIVED'].includes(order.status) && !isVip}
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
            totalCouponDiscount={order.totalCouponDiscount}
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
          />
        </View>

        <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
          <InvoiceSection
            orderId={order.id}
            orderStatus={order.status}
            invoice={order.invoice}
            invoiceEligible={order.invoiceEligible}
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
