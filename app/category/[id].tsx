import React, { useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { ProductCard } from '../../src/components/cards';
import { CategoryRepo, ProductRepo } from '../../src/repos';
import { useCartStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AppError, PaginationResult, Product } from '../../src/types';

export default function CategoryScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const { show } = useToast();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const categoryId = Array.isArray(id) ? id[0] : id;
  const addItem = useCartStore((state) => state.addItem);

  const { data: categoriesResult, isLoading: categoriesLoading } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => CategoryRepo.list(),
    staleTime: 5 * 60_000,
  });
  const categories = categoriesResult?.ok ? categoriesResult.data : [];
  const category = useMemo(() => categories.find((item) => item.id === categoryId), [categories, categoryId]);

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
        categoryId,
      });
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 1,
    enabled: !!categoryId,
  });

  const error = (listError as AppError | null) ?? null;
  const products = data?.pages?.flatMap((page) => page.items) ?? [];

  const columns = width >= 900 ? 3 : 2;
  const horizontalPadding = spacing.xl;
  const gap = spacing.md;
  const cardWidth = (width - horizontalPadding * 2 - gap * (columns - 1)) / columns;

  const refreshing = (isFetching && !isFetchingNextPage) || categoriesLoading;
  const shouldShowCategoryMissing = !categoriesLoading && !!categoryId && categories.length > 0 && !category;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="分类" />
      <FlatList
        key={columns}
        data={products}
        numColumns={columns}
        keyExtractor={(item) => item.id}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={10}
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
          <Animated.View entering={FadeInDown.duration(300)} style={{ marginBottom: spacing.lg }}>
            <View style={[styles.hero, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' }]}>
              <LinearGradient
                colors={[...gradients.aiGradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ height: 3 }}
              />
              <View style={{ padding: 16 }}>
                <Text style={[typography.title3, { color: colors.text.primary }]}>
                  {category?.name ?? '分类商品'}
                </Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                  已加载 {products.length} 件商品
                </Text>
              </View>
            </View>
          </Animated.View>
        }
        ListEmptyComponent={() => {
          if (isLoading || categoriesLoading) {
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
          if (!categoryId) {
            return <EmptyState title="缺少分类参数" description="请返回重新选择分类" />;
          }
          if (shouldShowCategoryMissing) {
            return <EmptyState title="分类不存在" description="该分类可能已被删除或停用" />;
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
          ) : error && products.length > 0 ? (
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
            <Animated.View entering={FadeInDown.duration(300).delay(50 + index * 30)} style={{ width: cardWidth, marginBottom: spacing.md }}>
              <ProductCard
                product={item}
                width={cardWidth}
                imageHeight={imageHeight}
                onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.id } })}
                onAdd={(product) => {
                  addItem(product, 1, product.defaultSkuId, product.price);
                  show({ message: '已加入购物车', type: 'success' });
                }}
              />
            </Animated.View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderWidth: 0,
  },
  skeletonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
});
