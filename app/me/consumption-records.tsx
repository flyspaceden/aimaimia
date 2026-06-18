import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { AppHeader, Screen } from '../../src/components/layout';
import { DigitalAssetRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { priceTextProps, useBottomInset, useTheme } from '../../src/theme';
import type { AppError, DigitalAssetLedger } from '../../src/types';

const PAGE_SIZE = 20;

const formatDateTime = (value: string) => {
  const date = new Date(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
};

const formatCurrency = (value: number) => `¥${value.toFixed(2)}`;
const formatAssetValue = (value: number) => `${Math.round(value).toLocaleString('zh-CN')}`;

const getLedgerTitle = (item: DigitalAssetLedger) => {
  if (item.sourceType === 'CONSUMPTION_CONFIRMED' && item.subjectType === 'CUMULATIVE_SPEND') return '消费累计';
  if (item.sourceType === 'CONSUMPTION_CONFIRMED' && item.subjectType === 'CREDIT_ASSET') return '信用资产入账';
  if (item.sourceType === 'SELF_VIP_PURCHASE') return '自购 VIP 种子资产';
  if (item.sourceType === 'REFERRAL_VIP_PURCHASE') return '推荐 VIP 种子资产';
  if (item.sourceType === 'HISTORICAL_CONSUMPTION_GRANT') return '历史消费转入';
  if (item.sourceType === 'REFUND_REVERSAL') return '退款扣回';
  if (item.sourceType === 'ADMIN_ADJUSTMENT') return '后台调整';
  return item.title || '消费记录';
};

const getLedgerIcon = (item: DigitalAssetLedger) => {
  if (item.subjectType === 'SEED_ASSET') return 'sprout-outline';
  if (item.subjectType === 'CREDIT_ASSET' && item.direction === 'DEBIT') return 'chart-line-variant';
  if (item.subjectType === 'CREDIT_ASSET') return 'chart-line';
  if (item.sourceType === 'REFUND_REVERSAL') return 'cash-refund';
  if (item.sourceType === 'ADMIN_ADJUSTMENT') return 'tune-variant';
  if (item.sourceType === 'HISTORICAL_CONSUMPTION_GRANT') return 'archive-arrow-up-outline';
  return 'shopping-outline';
};

const isCurrencyLedger = (item: DigitalAssetLedger) => item.subjectType === 'CUMULATIVE_SPEND';

const formatLedgerAmount = (item: DigitalAssetLedger) => {
  const prefix = item.direction === 'DEBIT' ? '-' : '+';
  return isCurrencyLedger(item)
    ? `${prefix}${formatCurrency(Math.abs(item.amount))}`
    : `${prefix}${formatAssetValue(Math.abs(item.assetAmount ?? item.amount))}`;
};

const formatLedgerBalance = (item: DigitalAssetLedger) =>
  isCurrencyLedger(item)
    ? `累计 ${formatCurrency(item.balanceAfter)}`
    : `余额 ${formatAssetValue(item.balanceAfter)}`;

export default function ConsumptionRecordsScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const router = useRouter();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const bottomInset = useBottomInset(spacing['3xl']);

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['digital-assets-consumption-records'],
    queryFn: async ({ pageParam = 1 }) => {
      const result = await DigitalAssetRepo.getConsumptionRecords(pageParam as number, PAGE_SIZE);
      if (!result.ok) throw result.error;
      return result.data;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const page = lastPage.page ?? 1;
      const pageSize = lastPage.pageSize ?? PAGE_SIZE;
      const total = lastPage.total ?? 0;
      const loaded = page * pageSize;
      return loaded < total ? page + 1 : undefined;
    },
    enabled: isLoggedIn,
  });

  const listError = isError ? (error as unknown as AppError) : null;
  const records = data?.pages.flatMap((page) => page.items) ?? [];

  const renderItem = ({ item, index }: { item: DigitalAssetLedger; index: number }) => {
    const isPositive = item.direction === 'CREDIT';
    return (
      <Animated.View entering={FadeInDown.duration(220).delay(index < PAGE_SIZE ? index * 24 : 0)}>
        <View
          style={[
            styles.recordCard,
            {
              borderRadius: radius.lg,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
        >
          <View
            style={[
              styles.recordIcon,
              {
                backgroundColor: isPositive ? colors.brand.primarySoft : `${colors.danger}12`,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={getLedgerIcon(item) as any}
              size={20}
              color={isPositive ? colors.brand.primary : colors.danger}
            />
          </View>

          <View style={styles.recordMain}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
              {getLedgerTitle(item)}
            </Text>
            <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]} numberOfLines={2}>
              {item.description || formatDateTime(item.createdAt)}
            </Text>
            <Text style={[typography.captionSm, { color: colors.muted, marginTop: 4 }]}>
              {formatDateTime(item.createdAt)}
            </Text>
          </View>

          <View style={styles.recordAmount}>
            <Text
              style={[
                typography.bodyStrong,
                { color: isPositive ? colors.success : colors.danger, textAlign: 'right' },
              ]}
              {...priceTextProps}
            >
              {formatLedgerAmount(item)}
            </Text>
            <Text
              style={[
                typography.captionSm,
                { color: colors.text.secondary, marginTop: 4, textAlign: 'right' },
              ]}
              {...priceTextProps}
            >
              {formatLedgerBalance(item)}
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  };

  if (!isLoggedIn) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="消费记录" />
        <EmptyState
          title="请先登录"
          description="登录后查看消费记录"
          actionLabel="返回我的"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="消费记录" />
      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={96} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={96} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={96} radius={radius.lg} />
        </View>
      ) : listError ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="消费记录加载失败"
            description={listError.displayMessage ?? '请稍后重试'}
            onAction={refetch}
          />
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={(
            <RefreshControl
              refreshing={isFetching && !isFetchingNextPage}
              onRefresh={refetch}
            />
          )}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: bottomInset }}
          ListEmptyComponent={<EmptyState title="暂无消费记录" description="确认收货后开始累计" />}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={isFetchingNextPage ? (
            <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={colors.brand.primary} />
            </View>
          ) : null}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  recordIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordMain: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  recordAmount: {
    alignItems: 'flex-end',
    marginLeft: 12,
    flexShrink: 1,
    maxWidth: '42%',
  },
});
