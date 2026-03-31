/**
 * 售后列表页 — 显示用户所有售后申请记录
 *
 * 支持下拉刷新 + 无限滚动分页，每条卡片展示售后类型标签、商品信息、状态、创建时间。
 * 点击卡片导航到售后详情页。
 */
import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../../src/components/layout';
import { EmptyState, ErrorState, Skeleton } from '../../../src/components/feedback';
import { afterSaleStatusLabels, afterSaleTypeLabels } from '../../../src/constants/statuses';
import { AfterSaleRepo } from '../../../src/repos/AfterSaleRepo';
import { useAuthStore } from '../../../src/store';
import { useTheme } from '../../../src/theme';
import type { AfterSaleDetailStatus, AfterSaleRequest, AfterSaleType } from '../../../src/types/domain/Order';

const PAGE_SIZE = 20;

// ─── 状态颜色映射 ────────────────────────────────────────
const getStatusColor = (status: AfterSaleDetailStatus, colors: any): string => {
  switch (status) {
    case 'REQUESTED':
    case 'UNDER_REVIEW':
      return colors.warning;
    case 'APPROVED':
    case 'RETURN_SHIPPING':
    case 'RECEIVED_BY_SELLER':
    case 'REFUNDING':
    case 'REPLACEMENT_SHIPPED':
      return colors.info;
    case 'REFUNDED':
    case 'COMPLETED':
      return colors.success;
    case 'REJECTED':
    case 'SELLER_REJECTED_RETURN':
    case 'PENDING_ARBITRATION':
      return colors.danger;
    case 'CLOSED':
    case 'CANCELED':
      return colors.muted;
    default:
      return colors.text.secondary;
  }
};

// ─── 售后类型标签颜色映射 ─────────────────────────────────
const getTypeColor = (type: AfterSaleType, colors: any): { bg: string; text: string } => {
  switch (type) {
    case 'NO_REASON_RETURN':
      return { bg: colors.accent.blueSoft, text: colors.accent.blue };
    case 'QUALITY_RETURN':
      return { bg: 'rgba(211, 47, 47, 0.08)', text: colors.danger };
    case 'QUALITY_EXCHANGE':
      return { bg: colors.ai.soft, text: colors.ai.start };
    default:
      return { bg: colors.bgSecondary, text: colors.text.secondary };
  }
};

export default function AfterSaleListScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const {
    data,
    isLoading,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['after-sales'],
    queryFn: async ({ pageParam = 1 }) => {
      const result = await AfterSaleRepo.list(pageParam, PAGE_SIZE);
      if (!result.ok) throw result.error;
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 1,
    enabled: isLoggedIn,
  });

  const allItems = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.items);
  }, [data]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item, index }: { item: AfterSaleRequest; index: number }) => {
      const statusColor = getStatusColor(item.status, colors);
      const typeColor = getTypeColor(item.afterSaleType, colors);
      const snapshot = item.orderItem?.productSnapshot;
      const productImage = snapshot?.image ?? snapshot?.images?.[0];
      const productTitle = snapshot?.title ?? '商品';
      const unitPrice = item.orderItem?.unitPrice ?? 0;
      const quantity = item.orderItem?.quantity ?? 1;

      return (
        <Animated.View entering={FadeInDown.duration(250).delay(40 + index * 25)}>
          <Pressable
            onPress={() =>
              router.push({ pathname: '/orders/after-sale-detail/[id]' as any, params: { id: item.id } })
            }
            style={[
              styles.card,
              shadow.md,
              {
                backgroundColor: colors.surface,
                borderRadius: radius.lg,
                borderLeftWidth: 3,
                borderLeftColor: statusColor,
              },
            ]}
          >
            {/* 顶部行：类型标签 + 状态 */}
            <View style={styles.cardHeader}>
              <View style={[styles.typeTag, { backgroundColor: typeColor.bg, borderRadius: radius.sm }]}>
                <Text style={[typography.captionSm, { color: typeColor.text }]}>
                  {afterSaleTypeLabels[item.afterSaleType]}
                </Text>
              </View>
              <Text style={[typography.caption, { color: statusColor, fontWeight: '600' }]}>
                {afterSaleStatusLabels[item.status]}
              </Text>
            </View>

            {/* 商品信息行 */}
            <View style={styles.productRow}>
              {productImage ? (
                <Image
                  source={{ uri: productImage }}
                  style={[styles.productImage, { borderRadius: radius.md }]}
                  contentFit="cover"
                />
              ) : (
                <View
                  style={[
                    styles.productImage,
                    { borderRadius: radius.md, backgroundColor: colors.skeleton },
                  ]}
                />
              )}
              <View style={styles.productInfo}>
                <Text style={[typography.bodySm, { color: colors.text.primary }]} numberOfLines={2}>
                  {productTitle}
                </Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                  ¥{unitPrice.toFixed(2)} x{quantity}
                </Text>
              </View>
            </View>

            {/* 底部：创建时间 + 退款金额 */}
            <View style={styles.cardFooter}>
              <Text style={[typography.caption, { color: colors.text.tertiary }]}>
                {item.createdAt}
              </Text>
              {item.refundAmount != null && item.afterSaleType !== 'QUALITY_EXCHANGE' && (
                <Text style={[typography.bodySm, { color: colors.danger, fontWeight: '600' }]}>
                  退款 ¥{item.refundAmount.toFixed(2)}
                </Text>
              )}
            </View>
          </Pressable>
        </Animated.View>
      );
    },
    [colors, radius, shadow, typography, router],
  );

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={colors.brand.primary} />
        <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: spacing.sm }]}>
          加载中...
        </Text>
      </View>
    );
  }, [isFetchingNextPage, colors, typography, spacing]);

  // ─── 加载态 ─────────────────────────────────────────────
  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="我的售后" />
        <View style={{ padding: spacing.xl }}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={{ marginBottom: spacing.md }}>
              <Skeleton height={130} radius={radius.lg} />
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  // ─── 错误态 ─────────────────────────────────────────────
  if (data === undefined) {
    return (
      <Screen contentStyle={{ flex: 1, paddingHorizontal: spacing.xl }}>
        <AppHeader title="我的售后" />
        <ErrorState title="售后记录加载失败" description="请稍后重试" onAction={() => refetch()} />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="我的售后" />
      <FlatList
        data={allItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={
          <RefreshControl refreshing={isFetching && !isFetchingNextPage} onRefresh={() => refetch()} />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={
          <EmptyState title="暂无售后记录" description="您还没有申请过售后服务" />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  typeTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  productImage: {
    width: 56,
    height: 56,
  },
  productInfo: {
    flex: 1,
    marginLeft: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2EAE2',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
  },
});
