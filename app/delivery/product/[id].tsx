import React from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../../src/components/layout';
import { useToast } from '../../../src/components/feedback/Toast';
import { DeliveryProductRepo } from '../../../src/repos/delivery';
import { useDeliveryCartStore } from '../../../src/store';
import {
  DeliveryButton,
  DeliveryLoading,
  DeliveryMessageState,
  DeliveryPanel,
  DeliveryQuantityControl,
  formatDeliveryMoney,
  useDeliveryTheme,
} from '../_components';

export default function DeliveryProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { show } = useToast();
  const { palette, spacing, typography } = useDeliveryTheme();
  const addItem = useDeliveryCartStore((state) => state.addItem);
  const cartCount = useDeliveryCartStore((state) => state.totalCount());
  const [skuId, setSkuId] = React.useState<string | null>(null);
  const [quantity, setQuantity] = React.useState(1);

  const query = useQuery({
    queryKey: ['delivery-product', id],
    queryFn: () => DeliveryProductRepo.getById(String(id)),
    enabled: Boolean(id),
  });

  const product = query.data?.ok ? query.data.data : null;
  const sku = product?.skus.find((item) => item.id === (skuId || product.skus[0]?.id));

  React.useEffect(() => {
    if (!product || skuId) return;
    const firstSku = product.skus[0];
    if (!firstSku) return;
    setSkuId(firstSku.id);
    setQuantity(firstSku.minOrderQuantity || product.minOrderQuantity || 1);
  }, [product, skuId]);

  React.useEffect(() => {
    if (!sku || !product) return;
    setQuantity(sku.minOrderQuantity || product.minOrderQuantity || 1);
  }, [product, sku?.id]);

  const handleAdd = async (goCart = false) => {
    if (!sku) {
      show({ message: '请选择可下单规格', type: 'warning' });
      return;
    }
    const result = await addItem(sku.id, quantity);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '加入购物车失败', type: 'error' });
      return;
    }
    if (goCart) {
      router.push('/delivery/cart');
      return;
    }
    show({ message: '已加入配送购物车', type: 'success' });
  };

  if (query.isLoading && !query.data) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="商品详情" />
        <DeliveryLoading />
      </Screen>
    );
  }

  if (!query.data || !query.data.ok || !product) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="商品详情" />
        <DeliveryMessageState
          title="商品加载失败"
          description={query.data?.ok === false ? query.data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          actionLabel="重新加载"
          onAction={() => query.refetch()}
          icon="package-variant-closed"
        />
      </Screen>
    );
  }

  const minQty = sku?.minOrderQuantity || product.minOrderQuantity || 1;
  const stepQty = sku?.orderStepQuantity || product.orderStepQuantity || 1;
  const maxQty = Math.max(minQty, sku?.stock || product.stock || minQty);

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="商品详情"
        rightSlot={
          <Pressable onPress={() => router.push('/delivery/cart')} style={{ padding: 8 }}>
            <View>
              <MaterialCommunityIcons name="cart-outline" size={22} color={palette.text.primary} />
              {cartCount > 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    right: -6,
                    top: -4,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: palette.brand.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                  }}
                >
                  <Text style={[typography.captionSm, { color: palette.text.inverse }]}>
                    {cartCount > 99 ? '99+' : cartCount}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => query.refetch()} />}
      >
        <Image
          source={product.imageUrl ? { uri: product.imageUrl } : undefined}
          style={{ height: 280, borderRadius: 16, backgroundColor: palette.bgSecondary }}
          contentFit="cover"
        />
        <DeliveryPanel style={{ marginTop: spacing.lg }}>
          <Text style={[typography.headingLg, { color: palette.text.primary }]}>{product.title}</Text>
          {product.subtitle ? (
            <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.sm }]}>
              {product.subtitle}
            </Text>
          ) : null}
          <Text style={[typography.headingSm, { color: palette.brand.primaryDark, marginTop: spacing.md }]}>
            {formatDeliveryMoney(sku?.finalPrice ?? product.price)}
          </Text>
          <Text style={[typography.caption, { color: palette.text.secondary, marginTop: spacing.xs }]}>
            {product.merchant.name} · 单位 {product.unitName}
          </Text>
          <Text style={[typography.caption, { color: palette.text.secondary, marginTop: spacing.xs }]}>
            起订 {minQty}
            {product.unitName} · 步长 {stepQty} · 库存 {sku?.stock ?? product.stock}
          </Text>
        </DeliveryPanel>

        <DeliveryPanel style={{ marginTop: spacing.md }}>
          <Text style={[typography.headingSm, { color: palette.text.primary }]}>规格</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            {product.skus.map((item) => {
              const active = item.id === sku?.id;
              return (
                <DeliveryButton
                  key={item.id}
                  label={`${item.title} · ${formatDeliveryMoney(item.finalPrice)}`}
                  variant={active ? 'primary' : 'secondary'}
                  onPress={() => setSkuId(item.id)}
                />
              );
            })}
          </View>
        </DeliveryPanel>

        <DeliveryPanel style={{ marginTop: spacing.md }}>
          <Text style={[typography.headingSm, { color: palette.text.primary, marginBottom: spacing.md }]}>
            购买数量
          </Text>
          <DeliveryQuantityControl
            value={quantity}
            min={minQty}
            max={maxQty}
            step={stepQty}
            onChange={setQuantity}
          />
        </DeliveryPanel>

        {product.description ? (
          <DeliveryPanel style={{ marginTop: spacing.md }}>
            <Text style={[typography.headingSm, { color: palette.text.primary, marginBottom: spacing.md }]}>
              商品说明
            </Text>
            <Text style={[typography.bodySm, { color: palette.text.secondary }]}>{product.description}</Text>
          </DeliveryPanel>
        ) : null}

        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
          <View style={{ flex: 1 }}>
            <DeliveryButton label="加入购物车" variant="secondary" onPress={() => handleAdd(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <DeliveryButton label="去购物车" onPress={() => handleAdd(true)} />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
