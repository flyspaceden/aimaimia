import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { CompanyCard } from '../../src/components/cards';
import { ProductCard } from '../../src/components/cards/ProductCard';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { Screen } from '../../src/components/layout';
import { AiBadge, AiCardGlow, AiDivider } from '../../src/components/ui';
import { MapView } from '../../src/components/overlay/MapView';
import { SearchOverlay } from '../../src/components/overlay/SearchOverlay';
import { mapProviders, MapProvider } from '../../src/constants';
import { CategoryRepo, CompanyRepo, ProductRepo } from '../../src/repos';
import { useCartStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { Product, AppError } from '../../src/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLUMN_GAP = 12;
const HORIZONTAL_PADDING = 20;
const CARD_WIDTH = (SCREEN_WIDTH - HORIZONTAL_PADDING * 2 - COLUMN_GAP) / 2;

// Mock AI 推荐数据
const AI_RECOMMENDATIONS = [
  { productIndex: 0, reason: '当季有机蔬菜，产地直供价格实惠', monthlySales: 2340 },
  { productIndex: 1, reason: 'AI 分析用户偏好，好评率 98%', monthlySales: 1856 },
  { productIndex: 2, reason: '低碳种植认证，新鲜度评分 4.9', monthlySales: 1520 },
  { productIndex: 3, reason: '限时产地直供，比市场价低 30%', monthlySales: 980 },
];

export default function MuseumScreen() {
  const { colors, radius, spacing, typography, shadow } = useTheme();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [mapProvider, setMapProvider] = useState<MapProvider>('amap');
  const [refreshing, setRefreshing] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const addItem = useCartStore((state) => state.addItem);
  const cartCount = useCartStore((state) => state.items.reduce((sum, item) => sum + item.quantity, 0));

  // 企业数据（3 分钟缓存）
  const companiesQuery = useQuery({
    queryKey: ['companies'],
    queryFn: () => CompanyRepo.list(),
    staleTime: 3 * 60_000,
  });
  const companies = companiesQuery.data?.ok ? companiesQuery.data.data.items : [];
  const categoriesQuery = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => CategoryRepo.list(),
    staleTime: 5 * 60_000,
  });
  const categories = useMemo(
    () => (categoriesQuery.data?.ok ? categoriesQuery.data.data.filter((category) => category.level === 1) : []),
    [categoriesQuery.data],
  );

  // 商品分页数据（无限滚动，60 秒缓存）
  const productsQuery = useInfiniteQuery({
    queryKey: ['products', 'discovery'],
    queryFn: ({ pageParam = 1 }) => ProductRepo.list({ page: pageParam }),
    getNextPageParam: (lastPage) => {
      if (lastPage.ok && lastPage.data.nextPage) return lastPage.data.nextPage;
      return undefined;
    },
    initialPageParam: 1,
    staleTime: 60_000,
  });

  // 扁平化所有页的商品
  const allProducts = useMemo(() => {
    if (!productsQuery.data) return [];
    return productsQuery.data.pages.flatMap((page) => (page.ok ? page.data.items : []));
  }, [productsQuery.data]);

  // AI 推荐商品（从商品列表前几项生成）
  const aiProducts = useMemo(() => {
    if (allProducts.length === 0) return [];
    return AI_RECOMMENDATIONS.map((rec) => ({
      product: allProducts[rec.productIndex % allProducts.length],
      reason: rec.reason,
      monthlySales: rec.monthlySales,
    })).filter((item) => item.product);
  }, [allProducts]);

  // 下拉刷新
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([companiesQuery.refetch(), productsQuery.refetch()]);
    setRefreshing(false);
  }, [companiesQuery, productsQuery]);

  // 加载更多
  const handleLoadMore = useCallback(() => {
    if (productsQuery.hasNextPage && !productsQuery.isFetchingNextPage) {
      productsQuery.fetchNextPage();
    }
  }, [productsQuery]);

  const isLoading = productsQuery.isLoading && companiesQuery.isLoading && categoriesQuery.isLoading;
  const listError = productsQuery.data?.pages[0] && !productsQuery.data.pages[0].ok
    ? (productsQuery.data.pages[0] as any).error as AppError
    : null;

  // 商品卡片渲染
  const renderProductItem = useCallback(
    ({ item, index }: { item: Product; index: number }) => (
      <View style={{ marginLeft: index % 2 === 0 ? 0 : COLUMN_GAP, marginBottom: COLUMN_GAP }}>
        <ProductCard
          product={item}
          width={CARD_WIDTH}
          imageHeight={CARD_WIDTH}
          onPress={(p) => router.push({ pathname: '/product/[id]', params: { id: p.id } })}
          onAdd={(p) => addItem(p, 1, p.defaultSkuId, p.price)}
        />
      </View>
    ),
    [router, addItem]
  );

  // 列表头部：搜索框 + 分类 + AI 推荐 + 企业横滑
  const ListHeader = useMemo(
    () => (
      <View>
        {/* 标题行 */}
        <View style={[styles.titleRow, { paddingHorizontal: HORIZONTAL_PADDING }]}>
          <Text style={[typography.headingLg, { color: colors.text.primary }]}>发现</Text>
          <View style={styles.titleIcons}>
            {/* 视图切换 */}
            <Pressable
              onPress={() => setViewMode((v) => (v === 'list' ? 'map' : 'list'))}
              style={styles.iconBtn}
            >
              <MaterialCommunityIcons
                name={viewMode === 'list' ? 'map-outline' : 'format-list-bulleted'}
                size={22}
                color={colors.text.secondary}
              />
            </Pressable>
            <Pressable
              onPress={() => router.push('/cart')}
              style={styles.iconBtn}
            >
              <MaterialCommunityIcons name="cart-outline" size={22} color={colors.text.secondary} />
              {cartCount > 0 && (
                <View style={[styles.cartBadge, { backgroundColor: colors.brand.primary }]}>
                  <Text style={[typography.captionSm, { color: colors.text.inverse, fontSize: 10, lineHeight: 14 }]}>
                    {cartCount > 99 ? '99+' : cartCount}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        {/* 搜索框（点击打开搜索覆盖层） */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <Pressable
            onPress={() => setSearchActive(true)}
            style={[
              styles.searchBar,
              {
                backgroundColor: colors.bgSecondary,
                borderRadius: radius.pill,
                marginHorizontal: HORIZONTAL_PADDING,
                marginTop: spacing.md,
              },
            ]}
          >
            <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
            <Text style={[typography.bodyMd, { color: colors.muted, marginLeft: spacing.sm }]}>
              搜索商品、品类、产地...
            </Text>
          </Pressable>
        </Animated.View>

        {/* 分类横滑标签 */}
        <Animated.View entering={FadeInDown.duration(300).delay(80)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.categoryScroll, { paddingHorizontal: HORIZONTAL_PADDING }]}
          >
            {categories.map((cat) => (
                <Pressable
                  key={cat.id}
                  onPress={() => router.push({ pathname: '/category/[id]', params: { id: cat.id } })}
                  hitSlop={10}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={(cat.icon || 'shape-outline') as any}
                    size={16}
                    color={colors.text.secondary}
                  />
                  <Text
                    style={[
                      typography.bodySm,
                      {
                        color: colors.text.primary,
                        marginLeft: spacing.xs,
                      },
                    ]}
                  >
                    {cat.name}
                  </Text>
                </Pressable>
            ))}
          </ScrollView>
        </Animated.View>

        {/* 地图视图 */}
        {viewMode === 'map' ? (
          <View style={{ paddingHorizontal: HORIZONTAL_PADDING }}>
            {/* 地图供应商切换 */}
            <View style={styles.mapProviderRow}>
              {mapProviders.map((provider) => {
                const active = mapProvider === provider.value;
                return (
                  <Pressable
                    key={provider.value}
                    onPress={() => setMapProvider(provider.value)}
                    style={[
                      styles.categoryChip,
                      {
                        backgroundColor: active ? colors.brand.primary : colors.surface,
                        borderColor: active ? colors.brand.primary : colors.border,
                        borderRadius: radius.pill,
                        marginRight: spacing.sm,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        typography.caption,
                        { color: active ? colors.text.inverse : colors.text.secondary },
                      ]}
                    >
                      {provider.label} · {provider.note}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <MapView
              provider={mapProvider}
              markers={companies}
              onSelect={(company) =>
                router.push({ pathname: '/company/[id]', params: { id: company.id } })
              }
            />
          </View>
        ) : null}

        {/* 脉脉精选区 */}
        {aiProducts.length > 0 && viewMode === 'list' ? (
          <Animated.View entering={FadeInDown.duration(300).delay(160)} style={{ marginTop: spacing.xl }}>
            <View style={styles.sectionHeader}>
              <AiBadge variant="curated" />
            </View>
            <AiDivider style={{ marginVertical: spacing.md }} />
            <View style={styles.aiGrid}>
              {aiProducts.map((item, index) => (
                <View
                  key={item.product.id + '-ai-' + index}
                  style={{
                    width: CARD_WIDTH,
                    marginRight: index % 2 === 0 ? COLUMN_GAP : 0,
                    marginBottom: COLUMN_GAP,
                  }}
                >
                  <ProductCard
                    product={item.product}
                    width={CARD_WIDTH}
                    imageHeight={CARD_WIDTH}
                    aiRecommend
                    aiReason={item.reason}
                    monthlySales={item.monthlySales}
                    onPress={(p) => router.push({ pathname: '/product/[id]', params: { id: p.id } })}
                    onAdd={(p) => addItem(p, 1, p.defaultSkuId, p.price)}
                  />
                </View>
              ))}
            </View>
          </Animated.View>
        ) : null}

        {/* 优选企业区 */}
        {companies.length > 0 && viewMode === 'list' ? (
          <Animated.View entering={FadeInDown.duration(300).delay(240)} style={{ marginTop: spacing['2xl'] }}>
            <Text
              style={[
                typography.headingSm,
                { color: colors.text.primary, paddingHorizontal: HORIZONTAL_PADDING },
              ]}
            >
              优选企业
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: HORIZONTAL_PADDING,
                paddingTop: spacing.md,
                paddingBottom: spacing.sm,
              }}
            >
              {companies.slice(0, 6).map((company, index) => (
                <View key={company.id} style={{ width: 260, marginRight: spacing.md }}>
                  <CompanyCard
                    company={company}
                    onPress={(c) =>
                      router.push({ pathname: '/company/[id]', params: { id: c.id } })
                    }
                  />
                </View>
              ))}
            </ScrollView>
          </Animated.View>
        ) : null}

        {/* 热门商品标题 */}
        {viewMode === 'list' ? (
          <Text
            style={[
              typography.headingSm,
              {
                color: colors.text.primary,
                paddingHorizontal: HORIZONTAL_PADDING,
                marginTop: spacing['2xl'],
                marginBottom: spacing.md,
              },
            ]}
          >
            热门商品
          </Text>
        ) : null}
      </View>
    ),
    [
      colors, typography, radius, spacing, shadow, router,
      viewMode, mapProvider, searchActive,
      aiProducts, companies, categories, cartCount, addItem,
    ]
  );

  // 加载态
  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <View style={{ padding: HORIZONTAL_PADDING, paddingTop: spacing.xl }}>
          <Skeleton height={40} radius={radius.pill} />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={44} radius={radius.pill} />
          <View style={{ height: spacing.xl }} />
          <View style={styles.aiGrid}>
            <Skeleton height={220} radius={radius.lg} style={{ flex: 1, marginRight: COLUMN_GAP }} />
            <Skeleton height={220} radius={radius.lg} style={{ flex: 1 }} />
          </View>
        </View>
      </Screen>
    );
  }

  // 地图模式下只显示头部
  if (viewMode === 'map') {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          {ListHeader}
        </ScrollView>
        <SearchOverlay visible={searchActive} onClose={() => setSearchActive(false)} />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <FlashList
        data={allProducts}
        numColumns={2}
        renderItem={renderProductItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: HORIZONTAL_PADDING, paddingBottom: spacing['3xl'] }}
        ListHeaderComponent={ListHeader}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          productsQuery.isFetchingNextPage ? (
            <View style={{ padding: spacing.xl, alignItems: 'center' }}>
              <Text style={[typography.bodySm, { color: colors.muted }]}>加载中...</Text>
            </View>
          ) : !productsQuery.hasNextPage && allProducts.length > 0 ? (
            <View style={{ padding: spacing.xl, alignItems: 'center' }}>
              <Text style={[typography.bodySm, { color: colors.muted }]}>已加载全部商品</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          listError ? (
            <ErrorState
              title="加载失败"
              description={listError.displayMessage ?? '请稍后再试'}
              onAction={() => productsQuery.refetch()}
            />
          ) : (
            <EmptyState title="暂无商品" description="稍后再来看看" />
          )
        }
      />
      <SearchOverlay visible={searchActive} onClose={() => setSearchActive(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  titleIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  categoryScroll: {
    paddingTop: 16,
    paddingBottom: 4,
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  mapProviderRow: {
    flexDirection: 'row',
    marginBottom: 12,
    marginTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cartBadge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
});
