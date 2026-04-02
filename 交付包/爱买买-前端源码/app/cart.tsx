import React, { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../src/components/layout';
import { EmptyState, useToast } from '../src/components/feedback';
import { QuantityStepper } from '../src/components/inputs';
import { Price } from '../src/components/ui/Price';
import { useCartStore } from '../src/store';
import { useTheme } from '../src/theme';

export default function CartScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const items = useCartStore((state) => state.items);
  const clear = useCartStore((state) => state.clear);
  const updateQty = useCartStore((state) => state.updateQty);
  const removeItem = useCartStore((state) => state.removeItem);
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="购物车"
        subtitle={`共 ${items.length} 项商品`}
        rightSlot={
          items.length > 0 ? (
            <Pressable onPress={clear} hitSlop={10} style={{ padding: 8 }}>
              <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.text.secondary} />
            </Pressable>
          ) : null
        }
      />

      {items.length === 0 ? (
        <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
          <EmptyState title="购物车为空" description="去首页逛逛，把喜欢的商品加入购物车吧" />
        </View>
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={(item) => item.productId}
            contentContainerStyle={{
              paddingHorizontal: spacing.xl,
              paddingBottom: spacing['3xl'] + 84,
            }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.card,
                  shadow.sm,
                  { backgroundColor: colors.surface, borderRadius: radius.lg },
                ]}
              >
                <Image source={{ uri: item.image }} style={styles.cover} contentFit="cover" />
                <View style={styles.content}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <View style={styles.metaRow}>
                    <QuantityStepper value={item.quantity} onChange={(next) => updateQty(item.productId, next)} />
                    <Pressable onPress={() => removeItem(item.productId)} hitSlop={8}>
                      <MaterialCommunityIcons name="delete-outline" size={18} color={colors.text.secondary} />
                    </Pressable>
                  </View>
                  <View style={{ marginTop: spacing.sm }}>
                    <Price value={item.price} />
                  </View>
                </View>
              </View>
            )}
          />

          <View style={[styles.checkoutBar, shadow.sm, { backgroundColor: colors.surface }]}>
            <View>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>合计</Text>
              <Text style={[typography.title3, { color: colors.text.primary }]}>¥{total.toFixed(2)}</Text>
            </View>
            <Pressable
              onPress={() => {
                if (items.length === 0) {
                  show({ message: '购物车为空', type: 'info' });
                  return;
                }
                router.push('/checkout');
              }}
              style={[styles.checkoutButton, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>去结算</Text>
            </Pressable>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    padding: 12,
    marginBottom: 12,
  },
  cover: {
    width: 80,
    height: 80,
    borderRadius: 14,
  },
  content: {
    flex: 1,
    marginLeft: 12,
  },
  metaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  checkoutBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    padding: 14,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  checkoutButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});
