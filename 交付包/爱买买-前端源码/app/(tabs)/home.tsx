import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AiFeatureStrip, BannerCarousel, CategoryGrid } from '../../src/components/data';
import { ProductCard } from '../../src/components/cards';
import { SearchBar } from '../../src/components/inputs';
import { categories } from '../../src/constants';
import { ProductRepo } from '../../src/repos';
import { useCartStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AppError, PaginationResult, Product } from '../../src/types';

type AiFeatureItem = {
  id: string;
  title: string;
  description: string;
  icon: string;
  tone?: 'green' | 'blue' | 'neutral';
};

export default function HomeScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const { show } = useToast();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);
  const cartCount = useCartStore((state) =>
    state.items.reduce((sum, item) => sum + item.quantity, 0)
  );
  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    error: listError,
  } = useInfiniteQuery<PaginationResult<Product>, AppError>({
    queryKey: ['products'],
    queryFn: async ({ pageParam = 1 }) => {
      const nextPage = typeof pageParam === 'number' ? pageParam : 1;
      const result = await ProductRepo.list({
        page: nextPage,
        pageSize: 8,
      });
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 1,
  });
  const error = (listError as AppError | null) ?? null;
  const products = data?.pages?.flatMap((page) => page.items) ?? [];
  const tagline = 'AI赋能农业，夯实健康之路';
  const columns = width >= 900 ? 3 : 2;
  const horizontalPadding = spacing.xl;
  const gap = spacing.md;
  const cardWidth = (width - horizontalPadding * 2 - gap * (columns - 1)) / columns;
  const refreshing = isFetching && !isFetchingNextPage;
  const bannerImages = [
    'https://placehold.co/900x480/png',
    'https://placehold.co/900x480/png',
    'https://placehold.co/900x480/png',
  ];

  const aiItems: AiFeatureItem[] = [
    { id: 'ai-trace', title: 'AI 溯源', description: '全链路溯源图谱', icon: 'timeline-text', tone: 'blue' },
    { id: 'ai-reco', title: 'AI 推荐', description: '个性化精选', icon: 'brain', tone: 'green' },
    { id: 'ai-fin', title: 'AI 金融', description: '金融服务入口', icon: 'cash-multiple', tone: 'neutral' },
  ];

  // 瀑布流分栏：用预估高度把商品分配到更短的列
  const columnData = useMemo(() => {
    const cols: Array<Array<{ product: Product; imageHeight: number }>> = Array.from(
      { length: columns },
      () => []
    );
    const heights = Array.from({ length: columns }, () => 0);

    products.forEach((product, index) => {
      const imageHeight = cardWidth * (0.75 + (index % 3) * 0.12);
      const estimated = imageHeight + 118;
      const target = heights.indexOf(Math.min(...heights));
      cols[target].push({ product, imageHeight });
      heights[target] += estimated + spacing.md;
    });

    return cols;
  }, [cardWidth, columns, products, spacing.md]);

  const handleAiPress = (item: AiFeatureItem) => {
    if (item.id === 'ai-trace') {
      router.push('/ai/trace');
      return;
    }
    if (item.id === 'ai-reco') {
      router.push('/ai/recommend');
      return;
    }
    if (item.id === 'ai-fin') {
      router.push('/ai/finance');
      return;
    }

    show({ message: '功能即将上线', type: 'info' });
  };

  const topBar = (
    <View
      style={[
        styles.topBarSticky,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
          paddingHorizontal: horizontalPadding,
          paddingVertical: spacing.sm,
        },
      ]}
    >
      <View style={styles.topBar}>
        <View style={styles.logoWrap}>
          <Text style={[typography.title2, { color: colors.brand.primary }]}>爱买买</Text>
          <View style={[styles.logoChip, { backgroundColor: colors.accent.blueSoft }]}>
            <Text style={[typography.caption, { color: colors.accent.blue }]}>AI</Text>
          </View>
        </View>
        <View style={[styles.centerTagline, { paddingHorizontal: spacing.sm }]}>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[typography.caption, { color: colors.text.secondary }]}
          >
            {tagline}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/cart')}
          style={[styles.cartButton, { backgroundColor: colors.brand.primarySoft }]}
        >
          <Text style={[typography.title3, { color: colors.brand.primary }]}>🛒</Text>
          {cartCount > 0 ? (
            <View style={[styles.cartBadge, { backgroundColor: colors.accent.blue }]}>
              <Text style={[typography.caption, { color: colors.text.inverse }]}>
                {cartCount > 99 ? '99+' : cartCount}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );

  const header = (
    <View style={{ paddingHorizontal: horizontalPadding, paddingTop: spacing.md }}>
      <SearchBar style={{ marginTop: 0 }} onPress={() => router.push('/search')} />
      <View style={{ marginTop: spacing.lg }}>
        <BannerCarousel images={bannerImages} />
      </View>
      <View style={{ marginTop: spacing.lg }}>
        <CategoryGrid data={categories} onSelect={(item) => router.push(`/category/${item.id}`)} />
      </View>
      <View style={{ marginTop: spacing.lg }}>
        <AiFeatureStrip items={aiItems} onPress={handleAiPress} />
      </View>
      <View style={{ marginTop: spacing.lg, marginBottom: spacing.md }}>
        <Text style={[typography.title3, { color: colors.text.primary }]}>推荐商品</Text>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <ScrollView stickyHeaderIndices={[0]} contentContainerStyle={{ paddingBottom: spacing['3xl'] }}>
          {topBar}
          {header}
          <View style={{ paddingHorizontal: horizontalPadding }}>
            <View style={styles.skeletonRow}>
              <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
              <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
            </View>
            <View style={styles.skeletonRow}>
              <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
              <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
            </View>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <ScrollView
        stickyHeaderIndices={[0]}
        contentContainerStyle={{ paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} />}
        scrollEventThrottle={16}
        onScroll={({ nativeEvent }) => {
          const paddingToBottom = 260;
          const reachedBottom =
            nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y >=
            nativeEvent.contentSize.height - paddingToBottom;

          if (reachedBottom && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        }}
      >
        {topBar}
        {header}
        {products.length === 0 ? (
          error ? (
            <View style={{ paddingHorizontal: horizontalPadding }}>
              <ErrorState
                title="列表加载失败"
                description={error.displayMessage ?? '请稍后重试'}
                onAction={refetch}
              />
            </View>
          ) : (
            <View style={{ paddingHorizontal: horizontalPadding }}>
              <EmptyState title="暂无商品" description="请稍后再试" />
            </View>
          )
        ) : (
          <View style={{ flexDirection: 'row', paddingHorizontal: horizontalPadding, alignItems: 'flex-start' }}>
            {columnData.map((columnItems, columnIndex) => (
              <View
                key={`column-${columnIndex}`}
                style={{ width: cardWidth, marginRight: columnIndex === columns - 1 ? 0 : gap }}
              >
                {columnItems.map((entry) => (
                  <View key={entry.product.id} style={{ marginBottom: spacing.md }}>
                    <ProductCard
                      product={entry.product}
                      width={cardWidth}
                      imageHeight={entry.imageHeight}
                      onPress={() => router.push(`/product/${entry.product.id}`)}
                      onAdd={(product) => {
                        addItem(product);
                        show({ message: '已加入购物车', type: 'success' });
                      }}
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}
        {isFetchingNextPage ? (
          <View style={{ paddingHorizontal: horizontalPadding, marginTop: spacing.md }}>
            <View style={styles.skeletonRow}>
              <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
              <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
            </View>
          </View>
        ) : error && products.length > 0 ? (
          <View style={{ paddingHorizontal: horizontalPadding, marginTop: spacing.md }}>
            <ErrorState
              title="加载更多失败"
              description={error.displayMessage ?? '请稍后重试'}
              actionLabel="重试"
              onAction={fetchNextPage}
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBarSticky: {
    borderBottomWidth: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    marginLeft: 6,
  },
  centerTagline: {
    flex: 1,
    alignItems: 'center',
  },
  cartButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  skeletonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
});
