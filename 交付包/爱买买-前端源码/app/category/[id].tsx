import React, { useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { ProductCard } from '../../src/components/cards';
import { categories } from '../../src/constants';
import { ProductRepo } from '../../src/repos';
import { useCartStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AppError, PaginationResult, Product } from '../../src/types';

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  fresh: ['生鲜', '鲜', '鸡蛋', '番茄', '生菜', '蓝莓'],
  vegetable: ['蔬菜', '生菜', '番茄', '菜'],
  fruit: ['水果', '蓝莓', '果'],
  organic: ['有机', '绿色'],
  grain: ['粮', '米', '胚芽', '谷'],
  tea: ['茶', '绿茶'],
  gift: ['礼盒', '礼品'],
  equipment: ['农资', '设备', '工具'],
};

export default function CategoryScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const categoryId = Array.isArray(id) ? id[0] : id;
  const addItem = useCartStore((state) => state.addItem);

  const category = useMemo(() => categories.find((item) => item.id === categoryId), [categoryId]);
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
    queryKey: ['category-products', categoryId],
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
  const filteredProducts = useMemo(() => {
    if (!categoryId) {
      return products;
    }
    const keywords = CATEGORY_KEYWORDS[categoryId] ?? [];
    if (keywords.length === 0) {
      return products;
    }
    return products.filter((product) => {
      const haystack = `${product.title} ${product.origin} ${product.tags.join(' ')}`;
      return keywords.some((keyword) => haystack.includes(keyword));
    });
  }, [categoryId, products]);

  const columns = width >= 900 ? 3 : 2;
  const horizontalPadding = spacing.xl;
  const gap = spacing.md;
  const cardWidth = (width - horizontalPadding * 2 - gap * (columns - 1)) / columns;

  const refreshing = isFetching && !isFetchingNextPage;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="分类" />
      <FlatList
        key={columns}
        data={filteredProducts}
        numColumns={columns}
        keyExtractor={(item) => item.id}
        columnWrapperStyle={{ justifyContent: 'space-between' }}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} />}
        onEndReachedThreshold={0.2}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        }}
        ListHeaderComponent={
          <View style={{ marginBottom: spacing.lg }}>
            <View style={[styles.hero, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>
                {category?.name ?? '未知分类'}
              </Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                已加载 {filteredProducts.length} 件 · 共 {products.length} 件商品
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={() => {
          if (isLoading) {
            return (
              <View>
                <View style={styles.skeletonRow}>
                  <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
                  <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
                </View>
                <View style={styles.skeletonRow}>
                  <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
                  <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
                </View>
              </View>
            );
          }
          if (error) {
            return (
              <ErrorState
                title="分类加载失败"
                description={error.displayMessage ?? '请稍后重试'}
                onAction={refetch}
              />
            );
          }
          return (
            <EmptyState
              title="暂无该分类商品"
              description={hasNextPage ? '继续加载更多看看' : '稍后再来看看'}
              actionLabel={hasNextPage ? '加载更多' : undefined}
              onAction={hasNextPage ? fetchNextPage : undefined}
            />
          );
        }}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.skeletonRow}>
              <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
              <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
            </View>
          ) : error && filteredProducts.length > 0 ? (
            <ErrorState
              title="加载更多失败"
              description={error.displayMessage ?? '请稍后重试'}
              actionLabel="重试"
              onAction={fetchNextPage}
            />
          ) : null
        }
        renderItem={({ item, index }) => {
          const imageHeight = cardWidth * (0.78 + (index % 3) * 0.08);
          return (
            <View style={{ width: cardWidth, marginBottom: spacing.md }}>
              <ProductCard
                product={item}
                width={cardWidth}
                imageHeight={imageHeight}
                onPress={() => router.push(`/product/${item.id}`)}
                onAdd={(product) => {
                  addItem(product);
                  show({ message: '已加入购物车', type: 'success' });
                }}
              />
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  skeletonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
});
