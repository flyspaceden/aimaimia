import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fitTextProps, useTheme } from '../../theme';
import { OrderItemRow } from './OrderItemRow';
import { Order, OrderStatus } from '../../types';
import { isPickupOrder, pickupOrderPresentation } from '../../utils/pickupOrder';

interface Props {
  order: Order;
  onPress: () => void;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
  primaryLabel?: string;
  secondaryLabel?: string;
  primaryDisabled?: boolean;
  secondaryDisabled?: boolean;
}

const STATUS_COLOR: Record<OrderStatus, string> = {
  PAID: '#3B82F6',
  SHIPPED: '#3B82F6',
  DELIVERED: '#3B82F6',
  RECEIVED: '#2E7D32',
  CANCELED: '#9CA3AF',
  REFUNDED: '#DC2626',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  PAID: '待发货',
  SHIPPED: '已发货',
  DELIVERED: '待收货',
  RECEIVED: '已完成',
  CANCELED: '已取消',
  REFUNDED: '已退款',
};

export function OrderCard({
  order,
  onPress,
  onPrimaryAction,
  onSecondaryAction,
  primaryLabel,
  secondaryLabel,
  primaryDisabled = false,
  secondaryDisabled = false,
}: Props) {
  const { colors, radius, shadow, typography } = useTheme();
  const pickupPresentation = pickupOrderPresentation(order);
  const pickupToneColor = pickupPresentation?.tone === 'warning'
    ? colors.gold.primary
    : pickupPresentation?.tone === 'brand'
      ? colors.brand.primary
      : pickupPresentation?.tone === 'success'
        ? colors.success
        : colors.muted;
  const statusColor = pickupPresentation ? pickupToneColor : STATUS_COLOR[order.status];
  const statusLabel = pickupPresentation?.label ?? STATUS_LABEL[order.status];
  const companyName = order.items[0]?.companyName || '商家';
  const isVipPackage = order.bizType === 'VIP_PACKAGE';
  const pickup = order.pickupFulfillment;

  return (
    <Pressable onPress={onPress} style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[typography.bodyStrong, { color: colors.text.primary, flex: 1 }]} numberOfLines={1}>
          🏪 {companyName}
        </Text>
        <Text {...fitTextProps} style={[typography.caption, { color: statusColor, fontWeight: '600' }]}>
          {statusLabel}
        </Text>
      </View>

      {order.items.map((item) => (
        <OrderItemRow
          key={item.id}
          image={item.image}
          title={item.title}
          skuTitle={item.skuTitle}
          productType={item.productType}
          bundleItems={item.bundleItems}
          unitPrice={item.price}
          quantity={item.quantity}
          priceLabel={isVipPackage ? 'VIP礼包' : undefined}
        />
      ))}

      {isPickupOrder(order) ? (
        <View style={[styles.pickupSummary, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.md }]}>
          <Text style={[typography.caption, { color: colors.brand.primary, fontWeight: '700' }]}>到店自提</Text>
          <Text style={[typography.caption, { color: colors.text.primary, marginTop: 2 }]} numberOfLines={1}>
            {pickup?.pickupPoint.name || '自提信息暂不可用'}
          </Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 1 }]} numberOfLines={2}>
            {pickup
              ? `${pickup.pickupPoint.regionText} ${pickup.pickupPoint.detail}`.trim()
              : '系统不会将本单改按快递展示，请联系订单客服处理。'}
          </Text>
        </View>
      ) : null}

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Text style={[typography.caption, { color: colors.text.secondary }]}>
          共 {order.items.reduce((s, i) => s + i.quantity, 0)} 件，实付 <Text style={{ fontWeight: '600', color: colors.text.primary }}>¥{order.totalPrice.toFixed(2)}</Text>
        </Text>
        <View style={styles.actionRow}>
          {secondaryLabel ? (
            <Pressable
              onPress={secondaryDisabled ? undefined : onSecondaryAction}
              disabled={secondaryDisabled}
              accessibilityState={{ disabled: secondaryDisabled }}
            >
              <Text style={[typography.caption, { color: colors.text.secondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4, marginRight: 8, opacity: secondaryDisabled ? 0.5 : 1 }]}>
                {secondaryLabel}
              </Text>
            </Pressable>
          ) : null}
          {primaryLabel ? (
            <Pressable
              onPress={primaryDisabled ? undefined : onPrimaryAction}
              disabled={primaryDisabled}
              accessibilityState={{ disabled: primaryDisabled }}
            >
              <Text style={[typography.caption, { color: colors.text.inverse, backgroundColor: statusColor, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 4, fontWeight: '600', opacity: primaryDisabled ? 0.5 : 1 }]}>
                {primaryLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 12, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingBottom: 6, marginBottom: 4 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, paddingTop: 8, marginTop: 4 },
  actionRow: { flexDirection: 'row', alignItems: 'center' },
  pickupSummary: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 8 },
});
