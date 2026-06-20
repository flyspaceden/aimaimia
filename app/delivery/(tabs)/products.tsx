import React from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../../src/components/layout';
import { useToast } from '../../../src/components/feedback/Toast';
import { DeliveryProductRepo } from '../../../src/repos/delivery';
import { useDeliveryAuthStore, useDeliveryCartStore } from '../../../src/store';
import {
  DeliveryButton,
  DeliveryLoading,
  DeliveryMessageState,
  DeliveryPanel,
  DeliveryTextField,
  formatDeliveryMoney,
  useDeliveryTheme,
} from '../_components';

export default function DeliveryProductsScreen() {
  const router = useRouter();
  const { show } = useToast();
  const { palette, spacing, typography } = useDeliveryTheme();
  const currentUnit = useDeliveryAuthStore((state) => state.currentUnit);
  const cartCount = useDeliveryCartStore((state) => state.totalCount());
  const syncFromServer = useDeliveryCartStore((state) => state.syncFromServer);
  const addItem = useDeliveryCartStore((state) => state.addItem);
  const [keywordInput, setKeywordInput] = React.useState('');
  const [keyword, setKeyword] = React.useState('');
  const [categoryId, setCategoryId] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    const timer = setTimeout(() => setKeyword(keywordInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [keywordInput]);

  const categoriesQuery = useQuery({
    queryKey: ['delivery-categories'],
    queryFn: () => DeliveryProductRepo.listCategories(),
  });

  const productsQuery = useQuery({
    queryKey: ['delivery-products', categoryId ?? 'all', keyword],
    queryFn: () => DeliveryProductRepo.listProducts({ categoryId, keyword: keyword || undefined }),
  });

  useFocusEffect(
    React.useCallback(() => {
      syncFromServer();
    }, [syncFromServer]),
  );

  const handleQuickAdd = async (product: any) => {
    const sku = product.skus[0];
    if (!sku) {
      show({ message: '当前商品暂无可下单规格', type: 'warning' });
      return;
    }

    const result = await addItem(sku.id, sku.minOrderQuantity || 1);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '加入购物车失败', type: 'error' });
      return;
    }
    show({ message: '已加入配送购物车', type: 'success' });
  };

  if (productsQuery.isLoading && !productsQuery.data) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="配送商品" showBack={false} />
        <DeliveryLoading />
      </Screen>
    );
  }

  const categories = categoriesQuery.data?.ok ? categoriesQuery.data.data.items : [];
  const products = productsQuery.data?.ok ? productsQuery.data.data.items : [];

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="配送商品"
        showBack={false}
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
      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={productsQuery.isFetching}
            onRefresh={() => productsQuery.refetch()}
          />
        }
        ListHeaderComponent={
          <View style={{ padding: spacing.xl, paddingBottom: spacing.lg }}>
            <DeliveryPanel style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.caption, { color: palette.text.secondary }]}>当前单位</Text>
                  <Text style={[typography.bodyStrong, { color: palette.text.primary, marginTop: spacing.xs }]}>
                    {currentUnit?.name ?? '未选择'}
                  </Text>
                </View>
                <DeliveryButton
                  label="切换单位"
                  variant="secondary"
                  onPress={() => router.push('/delivery/unit-select')}
                />
              </View>
            </DeliveryPanel>
            <DeliveryTextField
              value={keywordInput}
              onChangeText={setKeywordInput}
              placeholder="搜索配送商品"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}
            >
              <DeliveryButton
                label="全部"
                variant={!categoryId ? 'primary' : 'secondary'}
                onPress={() => setCategoryId(undefined)}
              />
              {categories.map((category) => (
                <DeliveryButton
                  key={category.id}
                  label={category.name}
                  variant={categoryId === category.id ? 'primary' : 'secondary'}
                  onPress={() => setCategoryId(category.id)}
                />
              ))}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          <DeliveryMessageState
            title="当前没有可下单商品"
            description="换个关键词或分类试试"
            icon="store-search-outline"
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/delivery/product/[id]', params: { id: item.id } })}
            style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.md }}
          >
            <DeliveryPanel>
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <Image
                  source={item.imageUrl ? { uri: item.imageUrl } : undefined}
                  style={{ width: 84, height: 84, borderRadius: 12, backgroundColor: palette.bgSecondary }}
                  contentFit="cover"
                />
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodyStrong, { color: palette.text.primary }]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={[typography.caption, { color: palette.text.secondary, marginTop: spacing.xs }]}>
                    {item.merchant.name}
                  </Text>
                  <Text style={[typography.caption, { color: palette.text.secondary, marginTop: spacing.xs }]}>
                    {item.skus.length} 个规格 · 库存 {item.stock}
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md }}>
                    <View>
                      <Text style={[typography.headingSm, { color: palette.brand.primaryDark }]}>
                        {formatDeliveryMoney(item.price)}
                        {item.priceFrom ? ' 起' : ''}
                      </Text>
                      <Text style={[typography.captionSm, { color: palette.text.tertiary, marginTop: 2 }]}>
                        起订 {item.minOrderQuantity}
                        {item.unitName}
                      </Text>
                    </View>
                    <DeliveryButton
                      label="加入"
                      onPress={() => handleQuickAdd(item)}
                      style={{ minWidth: 88 }}
                    />
                  </View>
                </View>
              </View>
            </DeliveryPanel>
          </Pressable>
        )}
      />
    </Screen>
  );
}
