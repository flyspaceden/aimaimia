import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { CompanyCard } from '../../src/components/cards';
import { ProductCard } from '../../src/components/cards/ProductCard';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { Screen } from '../../src/components/layout';
import { AiBadge, AiDivider } from '../../src/components/ui';
import { MapView } from '../../src/components/overlay/MapView';
import { SearchOverlay } from '../../src/components/overlay/SearchOverlay';
import { MapProvider } from '../../src/constants';
import { CategoryRepo, CompanyRepo, ProductRepo } from '../../src/repos';
import { useCartStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { Product, Company, AppError } from '../../src/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLUMN_GAP = 10;
const HORIZONTAL_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - HORIZONTAL_PADDING * 2 - COLUMN_GAP) / 2;

// AI 推荐卡片固定宽度和图片高度
const AI_CARD_WIDTH = 140;
const AI_IMAGE_HEIGHT = 110;

// 瀑布流图片高度循环
const IMAGE_HEIGHTS = [130, 90, 110, 140, 95, 120];

// Mock AI 推荐数据
const AI_RECOMMENDATIONS = [
  { productIndex: 0, reason: '当季有机蔬菜，产地直供价格实惠', monthlySales: 2340 },
  { productIndex: 1, reason: 'AI 分析用户偏好，好评率 98%', monthlySales: 1856 },
  { productIndex: 2, reason: '低碳种植认证，新鲜度评分 4.9', monthlySales: 1520 },
  { productIndex: 3, reason: '限时产地直供，比市场价低 30%', monthlySales: 980 },
];

// 企业筛选项
const COMPANY_FILTERS: Array<{ label: string; value: string | null }> = [
  { label: '全部', value: null },
  { label: '🌿 有机认证', value: 'certified' },
  { label: '🍎 水果', value: '水果' },
  { label: '🍵 茶叶', value: '茶叶' },
  { label: '📍 附近', value: 'nearby' },
];

export default function MuseumScreen() {
  const { colors, radius, spacing, shadow, typography } = useTheme();
  const router = useRouter();

  // 标签页与视图状态
  const [activeTab, setActiveTab] = useState<'products' | 'companies'>('products');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [searchActive, setSearchActive] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mapProvider, setMapProvider] = useState<MapProvider>('amap');
  // 地图模式选中企业（用于底部浮动卡片）
  const [selectedMapCompany, setSelectedMapCompany] = useState<Company | null>(null);

  // 标签页下划线动画
  const tabIndicatorX = useSharedValue(0);
  const tabIndicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tabIndicatorX.value }],
  }));

  // 底部卡片滑入动画
  const cardTranslateY = useSharedValue(120);
  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cardTranslateY.value }],
  }));

  // 标签页内容淡入淡出动画
  const tabOpacity = useSharedValue(1);
  const tabAnimatedStyle = useAnimatedStyle(() => ({
    opacity: tabOpacity.value,
  }));

  // AI 推荐横滑提示动画（首次加载左移提示可滚动）
  const scrollHintX = useSharedValue(0);
  useEffect(() => {
    scrollHintX.value = withSequence(
      withDelay(500, withTiming(-20, { duration: 300 })),
      withTiming(0, { duration: 300 }),
    );
  }, []);
  const scrollHintStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: scrollHintX.value }],
  }));

  // 关闭卡片定时器引用（防止泄漏）
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const addItem = useCartStore((state) => state.addItem);
  const cartCount = useCartStore((state) =>
    state.items.reduce((sum, item) => sum + item.quantity, 0),
  );

  // ==================== 数据查询 ====================

  // 分类数据（5 分钟缓存）
  const categoriesQuery = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => CategoryRepo.list(),
    staleTime: 5 * 60_000,
  });
  const categories = useMemo(
    () =>
      categoriesQuery.data?.ok
        ? categoriesQuery.data.data.filter((category) => category.level === 1)
        : [],
    [categoriesQuery.data],
  );

  // 商品分页数据（无限滚动，60 秒缓存，支持分类筛选）
  const productsQuery = useInfiniteQuery({
    queryKey: ['products', 'discovery', selectedCategory],
    queryFn: ({ pageParam = 1 }) => ProductRepo.list({
      page: pageParam,
      ...(selectedCategory ? { categoryId: selectedCategory } : {}),
    }),
    getNextPageParam: (lastPage) => {
      if (lastPage.ok && lastPage.data.nextPage) return lastPage.data.nextPage;
      return undefined;
    },
    initialPageParam: 1,
    staleTime: 60_000,
  });

  // 企业分页数据（仅在企业标签页激活时加载，3 分钟缓存）
  const companiesQuery = useInfiniteQuery({
    queryKey: ['companies', 'discovery', companyFilter],
    queryFn: ({ pageParam = 1 }) =>
      CompanyRepo.list({
        page: pageParam,
        includeTopProducts: true,
        ...(companyFilter === 'certified' ? { certified: true } : {}),
        ...(companyFilter === 'nearby' ? { sortBy: 'distance' as const } : {}),
        ...(companyFilter && !['certified', 'nearby'].includes(companyFilter)
          ? { productCategory: companyFilter }
          : {}),
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.ok && lastPage.data.nextPage) return lastPage.data.nextPage;
      return undefined;
    },
    initialPageParam: 1,
    // 始终启用，避免切换 Tab 时显示空状态
    enabled: true,
    staleTime: 3 * 60_000,
  });

  // 扁平化所有页的商品
  const allProducts = useMemo(() => {
    if (!productsQuery.data) return [];
    return productsQuery.data.pages.flatMap((page) => (page.ok ? page.data.items : []));
  }, [productsQuery.data]);

  // 扁平化所有页的企业
  const allCompanies = useMemo(() => {
    if (!companiesQuery.data) return [];
    return companiesQuery.data.pages
      .flatMap((page) => (page.ok ? page.data.items : []))
      .filter(Boolean) as Company[];
  }, [companiesQuery.data]);

  // 企业数据（用于地图视图，不分页，取第一页的）
  const mapCompanies = useMemo(() => {
    if (!companiesQuery.data?.pages?.[0]) return [];
    const firstPage = companiesQuery.data.pages[0];
    return firstPage.ok ? firstPage.data.items : [];
  }, [companiesQuery.data]);

  // AI 推荐商品（从商品列表前几项生成）
  const aiProducts = useMemo(() => {
    if (allProducts.length === 0) return [];
    return AI_RECOMMENDATIONS.map((rec) => ({
      product: allProducts[rec.productIndex % allProducts.length],
      reason: rec.reason,
      monthlySales: rec.monthlySales,
    })).filter((item) => item.product);
  }, [allProducts]);

  // ==================== 事件处理 ====================

  // 标签页切换
  const handleTabSwitch = useCallback(
    (tab: 'products' | 'companies') => {
      // 内容淡出再淡入（200ms 总时长）
      tabOpacity.value = withSequence(
        withTiming(0, { duration: 100 }),
        withTiming(1, { duration: 100 }),
      );
      // 延迟状态变更到淡出完成后，避免内容在淡出过程中闪变
      setTimeout(() => setActiveTab(tab), 100);
      // 动画移动下划线指示器
      const tabWidth = (SCREEN_WIDTH - HORIZONTAL_PADDING * 2) / 2;
      tabIndicatorX.value = withTiming(tab === 'products' ? 0 : tabWidth, { duration: 250 });
    },
    [tabIndicatorX, tabOpacity],
  );

  // 下拉刷新
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    if (activeTab === 'products') {
      await Promise.all([productsQuery.refetch(), categoriesQuery.refetch()]);
    } else {
      await companiesQuery.refetch();
    }
    setRefreshing(false);
  }, [activeTab, productsQuery, categoriesQuery, companiesQuery]);

  // 商品加载更多
  const handleProductsLoadMore = useCallback(() => {
    if (productsQuery.hasNextPage && !productsQuery.isFetchingNextPage) {
      productsQuery.fetchNextPage();
    }
  }, [productsQuery]);

  // 企业加载更多
  const handleCompaniesLoadMore = useCallback(() => {
    if (companiesQuery.hasNextPage && !companiesQuery.isFetchingNextPage) {
      companiesQuery.fetchNextPage();
    }
  }, [companiesQuery]);

  // 地图点位选中
  const handleMapMarkerSelect = useCallback(
    (company: Company) => {
      setSelectedMapCompany(company);
      cardTranslateY.value = withTiming(0, { duration: 300 });
    },
    [cardTranslateY],
  );

  // 关闭底部浮动卡片
  const handleCloseMapCard = useCallback(() => {
    cardTranslateY.value = withTiming(120, { duration: 250 });
    closeTimerRef.current = setTimeout(() => setSelectedMapCompany(null), 260);
  }, [cardTranslateY]);

  // 清理定时器，防止组件卸载后泄漏
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // 错误状态
  const productsError =
    productsQuery.data?.pages[0] && !productsQuery.data.pages[0].ok
      ? ((productsQuery.data.pages[0] as any).error as AppError)
      : null;

  const companiesError =
    companiesQuery.data?.pages[0] && !companiesQuery.data.pages[0].ok
      ? ((companiesQuery.data.pages[0] as any).error as AppError)
      : null;

  const isLoading = productsQuery.isLoading && categoriesQuery.isLoading;

  // ==================== 渲染辅助 ====================

  // 瀑布流双列分割
  const { leftColumn, rightColumn } = useMemo(() => {
    const left: Product[] = [];
    const right: Product[] = [];
    allProducts.forEach((product, index) => {
      if (index % 2 === 0) left.push(product);
      else right.push(product);
    });
    return { leftColumn: left, rightColumn: right };
  }, [allProducts]);

  // 瀑布流单列渲染
  const renderMasonryColumn = useCallback(
    (items: Product[], columnOffset: number) =>
      items.map((product, index) => {
        const globalIndex = columnOffset + index * 2;
        const imageHeight = IMAGE_HEIGHTS[globalIndex % IMAGE_HEIGHTS.length];
        return (
          <View key={product.id} style={{ marginBottom: COLUMN_GAP }}>
            <ProductCard
              product={product}
              imageHeight={imageHeight}
              onPress={(p) => router.push({ pathname: '/product/[id]', params: { id: p.id } })}
              onAdd={(p) => addItem(p, 1, p.defaultSkuId, p.price)}
            />
          </View>
        );
      }),
    [router, addItem],
  );

  // 企业卡片渲染
  const renderCompanyItem = useCallback(
    ({ item }: { item: Company }) => {
      if (!item) return null;
      return (
        <View style={{ paddingHorizontal: HORIZONTAL_PADDING }}>
          <CompanyCard
            company={item}
            onPress={(c) => router.push({ pathname: '/company/[id]', params: { id: c.id } })}
            onProductPress={(productId) =>
              router.push({ pathname: '/product/[id]', params: { id: productId } })
            }
          />
        </View>
      );
    },
    [router],
  );

  // ==================== 加载态 ====================
  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <View style={{ padding: HORIZONTAL_PADDING, paddingTop: spacing.xl }}>
          <Skeleton height={40} radius={radius.pill} />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={44} radius={radius.pill} />
          <View style={{ height: spacing.xl }} />
          <View style={styles.skeletonRow}>
            <Skeleton height={220} radius={radius.lg} style={{ flex: 1, marginRight: COLUMN_GAP }} />
            <Skeleton height={220} radius={radius.lg} style={{ flex: 1 }} />
          </View>
        </View>
      </Screen>
    );
  }

  // ==================== 固定头部 ====================
  const tabWidth = (SCREEN_WIDTH - HORIZONTAL_PADDING * 2) / 2;

  const StickyHeader = (
    <View style={[styles.stickyHeader, { backgroundColor: colors.background }]}>
      {/* 第一行：标题 + 图标 */}
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
          {/* 购物车 */}
          <Pressable onPress={() => router.push('/cart')} style={styles.iconBtn}>
            <MaterialCommunityIcons name="cart-outline" size={22} color={colors.text.secondary} />
            {cartCount > 0 && (
              <View style={[styles.cartBadge, { backgroundColor: colors.brand.primary }]}>
                <Text
                  style={[
                    typography.captionSm,
                    { color: colors.text.inverse, fontSize: 10, lineHeight: 14 },
                  ]}
                >
                  {cartCount > 99 ? '99+' : cartCount}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      {/* 搜索框 */}
      <Pressable
        onPress={() => setSearchActive(true)}
        style={[
          styles.searchBar,
          {
            backgroundColor: colors.bgSecondary,
            borderRadius: radius.pill,
            marginHorizontal: HORIZONTAL_PADDING,
            marginTop: spacing.sm,
          },
        ]}
      >
        <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
        <Text style={[typography.bodyMd, { color: colors.muted, marginLeft: spacing.sm }]}>
          搜索商品、品类、企业...
        </Text>
      </Pressable>

      {/* 标签页切换 */}
      <View style={[styles.tabBar, { marginHorizontal: HORIZONTAL_PADDING, marginTop: spacing.md }]}>
        <Pressable
          onPress={() => handleTabSwitch('products')}
          style={[styles.tabItem, { width: tabWidth }]}
        >
          <Text
            style={[
              typography.bodyStrong,
              {
                color: activeTab === 'products' ? colors.text.primary : colors.text.secondary,
                textAlign: 'center',
              },
            ]}
          >
            商品
          </Text>
        </Pressable>
        <Pressable
          onPress={() => handleTabSwitch('companies')}
          style={[styles.tabItem, { width: tabWidth }]}
        >
          <Text
            style={[
              typography.bodyStrong,
              {
                color: activeTab === 'companies' ? colors.text.primary : colors.text.secondary,
                textAlign: 'center',
              },
            ]}
          >
            企业
          </Text>
        </Pressable>
        {/* 下划线指示器 */}
        <Animated.View
          style={[
            styles.tabIndicator,
            {
              width: tabWidth * 0.4,
              backgroundColor: colors.brand.primary,
              borderRadius: radius.pill,
              left: tabWidth * 0.3,
            },
            tabIndicatorStyle,
          ]}
        />
      </View>
    </View>
  );

  // ==================== 地图模式 ====================
  if (viewMode === 'map') {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        {/* 地图全屏底层 */}
        <View style={StyleSheet.absoluteFillObject}>
          <MapView
            provider={mapProvider}
            markers={mapCompanies}
            onSelect={handleMapMarkerSelect}
            fullScreen
            selectedMarker={selectedMapCompany}
          />
        </View>

        {/* 顶部浮动区：标题栏 + 搜索框 + Tab Pill */}
        <View style={styles.mapFloatingTop} pointerEvents="box-none">
          {/* 半透明标题栏 */}
          <View
            style={[
              styles.mapTitleBar,
              {
                backgroundColor: 'rgba(255,255,255,0.92)',
                borderRadius: radius.lg,
                marginHorizontal: HORIZONTAL_PADDING,
                ...shadow.sm,
              },
            ]}
          >
            <Text style={[typography.headingLg, { color: colors.text.primary }]}>发现</Text>
            <View style={styles.titleIcons}>
              {/* 列表模式切换 */}
              <Pressable
                onPress={() => {
                  setSelectedMapCompany(null);
                  cardTranslateY.value = 120;
                  setViewMode('list');
                }}
                style={styles.iconBtn}
              >
                <MaterialCommunityIcons
                  name="format-list-bulleted"
                  size={22}
                  color={colors.text.secondary}
                />
              </Pressable>
              {/* 购物车 */}
              <Pressable onPress={() => router.push('/cart')} style={styles.iconBtn}>
                <MaterialCommunityIcons
                  name="cart-outline"
                  size={22}
                  color={colors.text.secondary}
                />
                {cartCount > 0 && (
                  <View style={[styles.cartBadge, { backgroundColor: colors.brand.primary }]}>
                    <Text
                      style={[
                        typography.captionSm,
                        { color: colors.text.inverse, fontSize: 10, lineHeight: 14 },
                      ]}
                    >
                      {cartCount > 99 ? '99+' : cartCount}
                    </Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>

          {/* 浮动搜索框 */}
          <Pressable
            onPress={() => setSearchActive(true)}
            style={[
              styles.mapSearchBar,
              {
                backgroundColor: '#FFFFFF',
                borderRadius: radius.pill,
                marginHorizontal: HORIZONTAL_PADDING,
                marginTop: spacing.sm,
                ...shadow.md,
              },
            ]}
          >
            <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
            <Text style={[typography.bodyMd, { color: colors.muted, marginLeft: spacing.sm }]}>
              搜索商品、品类、企业...
            </Text>
          </Pressable>

          {/* 地图模式 企业/商品 切换 Tab Pill */}
          <View style={[styles.mapTabPills, { marginHorizontal: HORIZONTAL_PADDING, marginTop: spacing.sm }]}>
            {([
              { label: '企业', value: 'companies' as const },
              { label: '商品', value: 'products' as const },
            ]).map((option) => {
              const active = activeTab === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setActiveTab(option.value)}
                  style={[
                    styles.tabPill,
                    {
                      backgroundColor: active ? colors.brand.primary : '#FFFFFF',
                      borderRadius: radius.pill,
                      marginRight: spacing.sm,
                      ...shadow.sm,
                    },
                  ]}
                >
                  <Text
                    style={[
                      typography.caption,
                      { color: active ? '#FFFFFF' : colors.text.secondary, fontWeight: '600' },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 底部浮动企业卡片（点击点位后展示） */}
        {selectedMapCompany && (
          <Animated.View
            style={[
              styles.mapBottomCard,
              {
                backgroundColor: colors.surface,
                borderRadius: radius.xl,
                marginHorizontal: HORIZONTAL_PADDING,
                marginBottom: spacing.xl,
                ...shadow.lg,
              },
              cardAnimatedStyle,
            ]}
          >
            {/* 关闭按钮 */}
            <Pressable
              onPress={handleCloseMapCard}
              style={[styles.mapCardClose, { backgroundColor: colors.bgSecondary }]}
            >
              <MaterialCommunityIcons name="close" size={16} color={colors.text.secondary} />
            </Pressable>

            {/* 企业基本信息 */}
            <View style={styles.mapCardHeader}>
              {/* Logo 占位 */}
              <View
                style={[
                  styles.mapCardLogo,
                  { backgroundColor: colors.brand.primarySoft, borderRadius: radius.md },
                ]}
              >
                <MaterialCommunityIcons
                  name="store-outline"
                  size={24}
                  color={colors.brand.primary}
                />
              </View>

              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <View style={styles.mapCardNameRow}>
                  <Text
                    style={[typography.bodyStrong, { color: colors.text.primary }]}
                    numberOfLines={1}
                  >
                    {selectedMapCompany.name}
                  </Text>
                  {selectedMapCompany.badges?.[0] && (
                    <View
                      style={[
                        styles.mapCardBadge,
                        {
                          backgroundColor: colors.brand.primarySoft,
                          borderRadius: radius.sm,
                          marginLeft: spacing.xs,
                        },
                      ]}
                    >
                      <Text style={[typography.captionSm, { color: colors.brand.primary }]}>
                        {selectedMapCompany.badges[0]}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  {selectedMapCompany.distanceKm != null
                    ? `距离约 ${selectedMapCompany.distanceKm.toFixed(1)} km`
                    : selectedMapCompany.location}
                </Text>
              </View>
            </View>

            {/* 商品预览 + 进店按钮 */}
            <View style={[styles.mapCardFooter, { marginTop: spacing.md }]}>
              {/* 商品缩略图 */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flex: 1 }}
                contentContainerStyle={{ gap: spacing.sm }}
              >
                {(selectedMapCompany.topProducts ?? []).slice(0, 4).map((product, index) => (
                  <Pressable
                    key={product.id}
                    onPress={() =>
                      router.push({ pathname: '/product/[id]', params: { id: product.id } })
                    }
                    style={[
                      styles.mapCardProduct,
                      { borderRadius: radius.md, backgroundColor: colors.bgSecondary },
                    ]}
                  >
                    {product.image ? (
                      <Image
                        source={{ uri: product.image }}
                        style={[StyleSheet.absoluteFillObject, { borderRadius: radius.md }]}
                        resizeMode="cover"
                      />
                    ) : (
                      <MaterialCommunityIcons
                        name="image-outline"
                        size={20}
                        color={colors.muted}
                      />
                    )}
                  </Pressable>
                ))}
                {(selectedMapCompany.topProducts?.length ?? 0) > 4 && (
                  <View
                    style={[
                      styles.mapCardProduct,
                      {
                        borderRadius: radius.md,
                        backgroundColor: colors.bgSecondary,
                        alignItems: 'center',
                        justifyContent: 'center',
                      },
                    ]}
                  >
                    <Text style={[typography.captionSm, { color: colors.text.secondary }]}>
                      +{(selectedMapCompany.topProducts?.length ?? 0) - 4}
                    </Text>
                  </View>
                )}
              </ScrollView>

              {/* 进店按钮 */}
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/company/[id]',
                    params: { id: selectedMapCompany.id },
                  })
                }
                style={[
                  styles.mapCardEnterBtn,
                  {
                    backgroundColor: colors.brand.primary,
                    borderRadius: radius.pill,
                    marginLeft: spacing.md,
                  },
                ]}
              >
                <Text style={[typography.captionSm, { color: '#FFFFFF', fontWeight: '700' }]}>
                  进店
                </Text>
                <MaterialCommunityIcons name="chevron-right" size={14} color="#FFFFFF" />
              </Pressable>
            </View>
          </Animated.View>
        )}

        <SearchOverlay visible={searchActive} onClose={() => setSearchActive(false)} />
      </Screen>
    );
  }

  // ==================== 列表模式 ====================
  return (
    <Screen contentStyle={{ flex: 1 }}>
      {StickyHeader}

      {/* 商品标签页 */}
      <Animated.View style={[{ flex: 1, display: activeTab === 'products' ? 'flex' : 'none' }, tabAnimatedStyle]}>
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
          onScroll={({ nativeEvent }) => {
            const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
            if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300) {
              handleProductsLoadMore();
            }
          }}
          scrollEventThrottle={400}
        >
          <View>
              {/* 分类横滑标签 */}
              <Animated.View entering={FadeInDown.duration(300).delay(0)}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={[
                    styles.categoryScroll,
                    { paddingHorizontal: HORIZONTAL_PADDING },
                  ]}
                >
                  {/* "全部" 分类芯片 */}
                  <Pressable
                    onPress={() => setSelectedCategory(null)}
                    hitSlop={10}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor:
                          selectedCategory === null ? colors.brand.primarySoft : colors.surface,
                        borderColor:
                          selectedCategory === null ? colors.brand.primary : colors.border,
                        borderRadius: radius.pill,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="view-grid-outline"
                      size={16}
                      color={
                        selectedCategory === null ? colors.brand.primary : colors.text.secondary
                      }
                    />
                    <Text
                      style={[
                        typography.bodySm,
                        {
                          color:
                            selectedCategory === null ? colors.brand.primary : colors.text.primary,
                          marginLeft: spacing.xs,
                        },
                      ]}
                    >
                      全部
                    </Text>
                  </Pressable>
                  {categories.map((cat) => (
                    <Pressable
                      key={cat.id}
                      onPress={() => {
                        setSelectedCategory(selectedCategory === cat.id ? null : cat.id);
                      }}
                      hitSlop={10}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor:
                            selectedCategory === cat.id ? colors.brand.primarySoft : colors.surface,
                          borderColor:
                            selectedCategory === cat.id ? colors.brand.primary : colors.border,
                          borderRadius: radius.pill,
                        },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={(cat.icon || 'shape-outline') as any}
                        size={16}
                        color={
                          selectedCategory === cat.id ? colors.brand.primary : colors.text.secondary
                        }
                      />
                      <Text
                        style={[
                          typography.bodySm,
                          {
                            color:
                              selectedCategory === cat.id ? colors.brand.primary : colors.text.primary,
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

              {/* 脉脉精选区 — 横滑 */}
              {aiProducts.length > 0 && (
                <Animated.View entering={FadeInDown.duration(300).delay(80)} style={{ marginTop: spacing.lg }}>
                  <View
                    style={[
                      styles.sectionHeader,
                      { paddingHorizontal: HORIZONTAL_PADDING },
                    ]}
                  >
                    <AiBadge variant="curated" />
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>为你推荐</Text>
                  </View>
                  <AiDivider
                    style={{
                      marginVertical: spacing.sm,
                      marginHorizontal: HORIZONTAL_PADDING,
                    }}
                  />
                  {/* 包裹 ScrollView 以应用横滑提示动画 */}
                  <Animated.View style={scrollHintStyle}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{
                        paddingHorizontal: HORIZONTAL_PADDING,
                        paddingBottom: spacing.sm,
                      }}
                    >
                      {aiProducts.map((item, index) => (
                        <View
                          key={item.product.id + '-ai-' + index}
                          style={{ width: AI_CARD_WIDTH, marginRight: spacing.md }}
                        >
                          <ProductCard
                            product={item.product}
                            width={AI_CARD_WIDTH}
                            imageHeight={AI_IMAGE_HEIGHT}
                            aiRecommend
                            aiReason={item.reason}
                            monthlySales={item.monthlySales}
                            onPress={(p) =>
                              router.push({ pathname: '/product/[id]', params: { id: p.id } })
                            }
                            onAdd={(p) => addItem(p, 1, p.defaultSkuId, p.price)}
                          />
                        </View>
                      ))}
                    </ScrollView>
                  </Animated.View>
                </Animated.View>
              )}

              {/* 分隔区域 */}
              <View
                style={{
                  height: 6,
                  backgroundColor: colors.bgSecondary,
                  marginTop: spacing.md,
                }}
              />

              {/* 热门商品标题 */}
              {/* 热门商品标题 */}
              <Animated.View entering={FadeInDown.duration(300).delay(160)}>
                <Text
                  style={[
                    typography.headingSm,
                    {
                      color: colors.text.primary,
                      paddingHorizontal: HORIZONTAL_PADDING,
                      marginTop: spacing.lg,
                      marginBottom: spacing.md,
                    },
                  ]}
                >
                  热门商品
                </Text>
              </Animated.View>
          </View>

          {/* 瀑布流双列 */}
          {allProducts.length > 0 ? (
            <View
              style={{
                flexDirection: 'row',
                paddingHorizontal: HORIZONTAL_PADDING,
                paddingBottom: spacing['3xl'],
              }}
            >
              <View style={{ flex: 1, marginRight: COLUMN_GAP / 2 }}>
                {renderMasonryColumn(leftColumn, 0)}
              </View>
              <View style={{ flex: 1, marginLeft: COLUMN_GAP / 2 }}>
                {renderMasonryColumn(rightColumn, 1)}
              </View>
            </View>
          ) : productsQuery.isLoading ? (
            <View style={{ padding: HORIZONTAL_PADDING, paddingTop: spacing.xl }}>
              <View style={styles.skeletonRow}>
                <Skeleton height={220} radius={radius.lg} style={{ flex: 1, marginRight: COLUMN_GAP }} />
                <Skeleton height={220} radius={radius.lg} style={{ flex: 1 }} />
              </View>
            </View>
          ) : productsError ? (
            <ErrorState
              title="加载失败"
              description={productsError.displayMessage ?? '请稍后再试'}
              onAction={() => productsQuery.refetch()}
            />
          ) : (
            <EmptyState title="暂无商品" description="稍后再来看看" />
          )}

          {/* 加载更多指示 */}
          {productsQuery.isFetchingNextPage && (
            <View style={{ padding: spacing.xl, alignItems: 'center' }}>
              <Text style={[typography.bodySm, { color: colors.muted }]}>加载中...</Text>
            </View>
          )}
          {!productsQuery.hasNextPage && allProducts.length > 0 && (
            <View style={{ padding: spacing.xl, alignItems: 'center' }}>
              <Text style={[typography.bodySm, { color: colors.muted }]}>已加载全部商品</Text>
            </View>
          )}
        </ScrollView>
      </Animated.View>

      {/* 企业标签页 */}
      <Animated.View style={[{ flex: 1, display: activeTab === 'companies' ? 'flex' : 'none' }, tabAnimatedStyle]}>
        <FlatList
          data={allCompanies}
          renderItem={renderCompanyItem}
          keyExtractor={(item, index) => item?.id ?? `company-${index}`}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
          onEndReached={handleCompaniesLoadMore}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={
            <View>
              {/* 企业筛选标签 */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[
                  styles.categoryScroll,
                  { paddingHorizontal: HORIZONTAL_PADDING },
                ]}
              >
                {COMPANY_FILTERS.map((filter) => {
                  const isActive = companyFilter === filter.value;
                  return (
                    <Pressable
                      key={filter.label}
                      onPress={() => setCompanyFilter(filter.value)}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: isActive
                            ? colors.brand.primarySoft
                            : colors.surface,
                          borderColor: isActive ? colors.brand.primary : colors.border,
                          borderRadius: radius.pill,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          typography.bodySm,
                          {
                            color: isActive ? colors.brand.primary : colors.text.primary,
                          },
                        ]}
                      >
                        {filter.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          }
          ListFooterComponent={
            companiesQuery.isFetchingNextPage ? (
              <View style={{ padding: spacing.xl, alignItems: 'center' }}>
                <Text style={[typography.bodySm, { color: colors.muted }]}>加载中...</Text>
              </View>
            ) : !companiesQuery.hasNextPage && allCompanies.length > 0 ? (
              <View style={{ padding: spacing.xl, alignItems: 'center' }}>
                <Text style={[typography.bodySm, { color: colors.muted }]}>已加载全部企业</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            companiesQuery.isLoading ? (
              <View style={{ padding: HORIZONTAL_PADDING, paddingTop: spacing.xl }}>
                <Skeleton height={120} radius={radius.lg} style={{ marginBottom: spacing.md }} />
                <Skeleton height={120} radius={radius.lg} style={{ marginBottom: spacing.md }} />
                <Skeleton height={120} radius={radius.lg} />
              </View>
            ) : companiesError ? (
              <ErrorState
                title="加载失败"
                description={companiesError.displayMessage ?? '请稍后再试'}
                onAction={() => companiesQuery.refetch()}
              />
            ) : (
              <EmptyState title="暂无企业" description="稍后再来看看" />
            )
          }
        />
      </Animated.View>

      <SearchOverlay visible={searchActive} onClose={() => setSearchActive(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stickyHeader: {
    zIndex: 10,
    paddingBottom: 4,
  },
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
  tabBar: {
    flexDirection: 'row',
    position: 'relative',
    paddingBottom: 8,
  },
  tabItem: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 3,
  },
  categoryScroll: {
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  skeletonRow: {
    flexDirection: 'row',
  },
  // ---- 地图模式样式 ----
  mapFloatingTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    paddingTop: 12,
  },
  mapTitleBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  mapSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  mapTabPills: {
    flexDirection: 'row',
  },
  tabPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  mapBottomCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    padding: 16,
  },
  mapCardClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  mapCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 32, // 避免被关闭按钮遮挡
  },
  mapCardLogo: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mapCardBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  mapCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mapCardProduct: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mapCardEnterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 2,
  },
});
