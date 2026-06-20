import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback/Toast';
import { useDeliveryCartStore } from '../../src/store';
import {
  DeliveryButton,
  DeliveryLoading,
  DeliveryMessageState,
  DeliveryPanel,
  DeliveryQuantityControl,
  formatDeliveryMoney,
  useDeliveryTheme,
} from './_components';

export default function DeliveryCartScreen() {
  const router = useRouter();
  const { show } = useToast();
  const { palette, spacing, typography } = useDeliveryTheme();
  const items = useDeliveryCartStore((state) => state.items);
  const loading = useDeliveryCartStore((state) => state.loading);
  const syncFromServer = useDeliveryCartStore((state) => state.syncFromServer);
  const toggleSelect = useDeliveryCartStore((state) => state.toggleSelect);
  const updateQty = useDeliveryCartStore((state) => state.updateQty);
  const removeItem = useDeliveryCartStore((state) => state.removeItem);
  const selectAll = useDeliveryCartStore((state) => state.selectAll);
  const deselectAll = useDeliveryCartStore((state) => state.deselectAll);
  const selectedCount = useDeliveryCartStore((state) => state.selectedCount());
  const selectedTotal = useDeliveryCartStore((state) => state.selectedTotal());

  useFocusEffect(
    React.useCallback(() => {
      syncFromServer();
    }, [syncFromServer]),
  );

  const allSelected = items.length > 0 && items.every((item) => item.isSelected);

  const handleQtyChange = async (id: string, quantity: number) => {
    const result = await updateQty(id, quantity);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '更新数量失败', type: 'error' });
    }
  };

  const handleRemove = async (id: string) => {
    const result = await removeItem(id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '移除失败', type: 'error' });
      return;
    }
    show({ message: '已移出配送购物车', type: 'success' });
  };

  if (loading && items.length === 0) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="配送购物车" />
        <DeliveryLoading />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title={`配送购物车${items.length ? `(${items.length})` : ''}`} />
      {items.length === 0 ? (
        <DeliveryMessageState
          title="配送购物车还是空的"
          description="先去商品页选几样要配送的商品"
          actionLabel="去选商品"
          onAction={() => router.replace('/delivery/(tabs)/products')}
          icon="cart-outline"
        />
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: 140 }}>
            <DeliveryPanel style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[typography.bodyStrong, { color: palette.text.primary }]}>
                  已选 {selectedCount} 件
                </Text>
                <DeliveryButton
                  label={allSelected ? '取消全选' : '全选'}
                  variant="ghost"
                  onPress={() => (allSelected ? deselectAll() : selectAll())}
                />
              </View>
            </DeliveryPanel>
            {items.map((item) => (
              <DeliveryPanel key={item.id} style={{ marginBottom: spacing.md }}>
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <Pressable onPress={() => toggleSelect(item.id)} style={{ paddingTop: 4 }}>
                    <MaterialCommunityIcons
                      name={item.isSelected ? 'check-circle' : 'checkbox-blank-circle-outline'}
                      size={22}
                      color={item.isSelected ? palette.brand.primary : palette.text.tertiary}
                    />
                  </Pressable>
                  <Image
                    source={item.imageUrl ? { uri: item.imageUrl } : undefined}
                    style={{ width: 72, height: 72, borderRadius: 12, backgroundColor: palette.bgSecondary }}
                    contentFit="cover"
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyStrong, { color: palette.text.primary }]} numberOfLines={2}>
                      {item.productTitle}
                    </Text>
                    <Text style={[typography.caption, { color: palette.text.secondary, marginTop: spacing.xs }]}>
                      {item.skuTitle} · {item.merchant.name}
                    </Text>
                    <Text style={[typography.captionSm, { color: palette.text.tertiary, marginTop: spacing.xs }]}>
                      起订 {item.minOrderQuantity}
                      {item.unitName} · 步长 {item.orderStepQuantity} · 库存 {item.stock}
                    </Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md }}>
                      <Text style={[typography.bodyStrong, { color: palette.brand.primaryDark }]}>
                        {formatDeliveryMoney(item.lineAmount)}
                      </Text>
                      <DeliveryQuantityControl
                        value={item.quantity}
                        min={item.minOrderQuantity}
                        max={Math.max(item.minOrderQuantity, item.stock)}
                        step={item.orderStepQuantity}
                        onChange={(next) => handleQtyChange(item.id, next)}
                      />
                    </View>
                  </View>
                  <Pressable onPress={() => handleRemove(item.id)} style={{ paddingTop: 4 }}>
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color={palette.text.tertiary} />
                  </Pressable>
                </View>
              </DeliveryPanel>
            ))}
          </ScrollView>
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              borderTopWidth: 1,
              borderTopColor: palette.border,
              backgroundColor: palette.surface,
              paddingHorizontal: spacing.xl,
              paddingTop: spacing.md,
              paddingBottom: spacing.xl,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
              <View>
                <Text style={[typography.caption, { color: palette.text.secondary }]}>合计</Text>
                <Text style={[typography.headingSm, { color: palette.brand.primaryDark, marginTop: 2 }]}>
                  {formatDeliveryMoney(selectedTotal)}
                </Text>
              </View>
              <Text style={[typography.caption, { color: palette.text.secondary }]}>
                已选 {selectedCount} 件
              </Text>
            </View>
            <DeliveryButton
              label="去结算"
              disabled={selectedCount === 0}
              onPress={() => router.push('/delivery/checkout')}
            />
          </View>
        </>
      )}
    </Screen>
  );
}
