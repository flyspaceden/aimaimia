import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../src/components/layout';
import { EmptyState, useToast } from '../src/components/feedback';
import { paymentMethods } from '../src/constants';
import { OrderRepo } from '../src/repos';
import { useCartStore } from '../src/store';
import { useTheme } from '../src/theme';
import { PaymentMethod } from '../src/types';

export default function CheckoutScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const items = useCartStore((state) => state.items);
  const clear = useCartStore((state) => state.clear);
  const [refreshing, setRefreshing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('wechat');
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const orderItems = useMemo(
    () =>
      items.map((item, index) => ({
        id: `oi-${item.productId}-${index}`,
        productId: item.productId,
        title: item.title,
        image: item.image,
        price: item.price,
        quantity: item.quantity,
      })),
    [items]
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
  };

  const handleCheckout = async () => {
    const created = await OrderRepo.createFromCart({ items: orderItems, paymentMethod });
    if (!created.ok) {
      show({ message: created.error.displayMessage ?? '下单失败', type: 'error' });
      return;
    }
    const paid = await OrderRepo.payOrder(created.data.id, paymentMethod);
    if (!paid.ok) {
      show({ message: paid.error.displayMessage ?? '支付失败', type: 'error' });
      return;
    }
    clear();
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-issue'] });
    show({ message: '支付成功，订单已生成', type: 'success' });
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="确认订单" />
      {items.length === 0 ? (
        <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
          <EmptyState title="暂无商品" description="购物车为空，无法结算" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>收货地址</Text>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
              默认地址占位 · 可在后续接入地址管理
            </Text>
          </View>

          <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>商品清单</Text>
            {orderItems.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <Image source={{ uri: item.image }} style={styles.cover} contentFit="cover" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                    数量 x{item.quantity}
                  </Text>
                </View>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                  ¥{item.price.toFixed(2)}
                </Text>
              </View>
            ))}
          </View>

          <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>支付方式</Text>
            {paymentMethods.map((method) => {
              const active = paymentMethod === method.value;
              return (
                <Pressable
                  key={method.value}
                  onPress={() => setPaymentMethod(method.value)}
                  style={[
                    styles.payRow,
                    {
                      borderColor: active ? colors.brand.primary : colors.border,
                      borderRadius: radius.lg,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{method.label}</Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                      {method.description}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.radio,
                      {
                        borderColor: active ? colors.brand.primary : colors.border,
                        backgroundColor: active ? colors.brand.primary : 'transparent',
                      },
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>费用明细</Text>
            <View style={styles.priceRow}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>商品小计</Text>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>¥{total.toFixed(2)}</Text>
            </View>
            <View style={styles.priceRow}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>运费</Text>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>¥0.00</Text>
            </View>
            <View style={styles.priceRow}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>合计</Text>
              <Text style={[typography.title3, { color: colors.text.primary }]}>¥{total.toFixed(2)}</Text>
            </View>
          </View>

          <Pressable
            onPress={handleCheckout}
            style={[styles.submitButton, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>提交订单并支付</Text>
          </Pressable>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 16,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  cover: {
    width: 64,
    height: 64,
    borderRadius: 12,
  },
  payRow: {
    borderWidth: 1,
    padding: 12,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  submitButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
});
