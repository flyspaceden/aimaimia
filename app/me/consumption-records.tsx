import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
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

type LedgerTone = 'seed' | 'consumption' | 'frozen' | 'spend' | 'refund' | 'adjustment';
type LedgerTabKey = 'all' | LedgerTone;

const ASSET_LEDGER_TONES = {
  seed: {
    color: '#1F8A5F',
    bg: '#DFF1E6',
    border: 'rgba(31,138,95,0.28)',
    icon: 'sprout-outline',
  },
  consumption: {
    color: '#267B93',
    bg: '#DFF1F3',
    border: 'rgba(38,123,147,0.28)',
    icon: 'chart-line',
  },
  frozen: {
    color: '#4A79A8',
    bg: '#E1ECF6',
    border: 'rgba(74,121,168,0.28)',
    icon: 'timer-sand',
  },
  spend: {
    color: '#A87918',
    bg: '#F3ECD8',
    border: 'rgba(168,121,24,0.26)',
    icon: 'shopping-outline',
  },
  refund: {
    color: '#B65347',
    bg: '#F7E3DF',
    border: 'rgba(182,83,71,0.28)',
    icon: 'cash-refund',
  },
  adjustment: {
    color: '#6E7B72',
    bg: '#E7ECE8',
    border: 'rgba(110,123,114,0.28)',
    icon: 'tune-variant',
  },
} as const;

const ALL_LEDGER_TONE = {
  color: '#15364B',
  bg: '#E6EFEC',
  border: 'rgba(21,54,75,0.22)',
  icon: 'view-grid-outline',
} as const;

const ASSET_LEDGER_TABS: ReadonlyArray<{ key: LedgerTabKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'seed', label: '种子资产' },
  { key: 'consumption', label: '消费资产' },
  { key: 'frozen', label: '冻结资产' },
  { key: 'spend', label: '累计消费' },
  { key: 'refund', label: '扣回' },
  { key: 'adjustment', label: '调整' },
];

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
  if (item.sourceType === 'CONSUMPTION_CONFIRMED' && item.subjectType === 'CREDIT_ASSET') return '消费资产入账';
  if (item.sourceType === 'CONSUMPTION_PAID_FROZEN') return '消费资产冻结';
  if (item.sourceType === 'CONSUMPTION_FROZEN_RELEASED') return '消费资产释放';
  if (item.sourceType === 'CONSUMPTION_FROZEN_VOIDED') return '冻结资产作废';
  if (item.sourceType === 'SELF_VIP_PURCHASE') return '自购 VIP 种子资产';
  if (item.sourceType === 'REFERRAL_VIP_PURCHASE') return '推荐 VIP 种子资产';
  if (item.sourceType === 'HISTORICAL_CONSUMPTION_GRANT') return '历史消费转入';
  if (item.sourceType === 'REFUND_REVERSAL') return '退款扣回';
  if (item.sourceType === 'ADMIN_ADJUSTMENT') return '后台调整';
  return item.title || '资产流水';
};

const getLedgerTone = (item: DigitalAssetLedger): LedgerTone => {
  if (item.sourceType === 'ADMIN_ADJUSTMENT') return 'adjustment';
  if (item.sourceType === 'CONSUMPTION_PAID_FROZEN') return 'frozen';
  if (item.direction === 'DEBIT' || item.sourceType === 'REFUND_REVERSAL') return 'refund';
  if (item.subjectType === 'SEED_ASSET') return 'seed';
  if (item.subjectType === 'CREDIT_ASSET') return 'consumption';
  return 'spend';
};

const getLedgerVisual = (item: DigitalAssetLedger) => ASSET_LEDGER_TONES[getLedgerTone(item)];
const getTabVisual = (key: LedgerTabKey) => (key === 'all' ? ALL_LEDGER_TONE : ASSET_LEDGER_TONES[key]);

const filterRecordsByTab = (records: DigitalAssetLedger[], tab: LedgerTabKey) =>
  tab === 'all' ? records : records.filter((item) => getLedgerTone(item) === tab);

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
    : item.status === 'FROZEN' || item.status === 'VOIDED'
      ? `冻结 ${formatAssetValue(item.frozenCreditAssetBalanceAfter ?? item.balanceAfter)}`
    : `余额 ${formatAssetValue(item.balanceAfter)}`;

export default function ConsumptionRecordsScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const router = useRouter();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const bottomInset = useBottomInset(spacing['3xl']);
  const [selectedLedgerTab, setSelectedLedgerTab] = React.useState<LedgerTabKey>('all');

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
      if (result.ok === false) throw result.error;
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
  const filteredRecords = filterRecordsByTab(records, selectedLedgerTab);

  const renderItem = ({ item, index }: { item: DigitalAssetLedger; index: number }) => {
    const visual = getLedgerVisual(item);
    return (
      <Animated.View entering={FadeInDown.duration(220).delay(index < PAGE_SIZE ? index * 24 : 0)}>
        <View
          style={[
            styles.recordCard,
            {
              borderRadius: radius.lg,
              borderColor: visual.border,
              backgroundColor: colors.surface,
            },
          ]}
        >
          <View style={[styles.recordAccent, { backgroundColor: visual.color }]} />
          <View
            style={[
              styles.recordIcon,
              {
                backgroundColor: visual.bg,
                borderColor: visual.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={visual.icon as any}
              size={20}
              color={visual.color}
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
                { color: visual.color, textAlign: 'right' },
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

  const renderTabs = () => (
    <View style={styles.tabsBlock}>
      <View style={styles.tabsHeader}>
        <Text style={[typography.headingSm, { color: colors.text.primary }]}>资产流水</Text>
        <Text style={[typography.captionSm, { color: colors.text.secondary }]}>
          {filteredRecords.length}/{records.length}
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsContent}
      >
        {ASSET_LEDGER_TABS.map((tab) => {
          const visual = getTabVisual(tab.key);
          const active = selectedLedgerTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setSelectedLedgerTab(tab.key)}
              style={[
                styles.tabChip,
                {
                  borderColor: active ? visual.color : visual.border,
                  backgroundColor: active ? visual.color : visual.bg,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={visual.icon as any}
                size={15}
                color={active ? '#FFFFFF' : visual.color}
              />
              <Text
                style={[
                  typography.captionSm,
                  { color: active ? '#FFFFFF' : visual.color, fontWeight: '700' },
                ]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  if (!isLoggedIn) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="资产流水" />
        <EmptyState
          title="请先登录"
          description="登录后查看资产流水"
          actionLabel="返回我的"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="资产流水" />
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
            title="资产流水加载失败"
            description={listError.displayMessage ?? '请稍后重试'}
            onAction={refetch}
          />
        </View>
      ) : (
        <FlatList
          data={filteredRecords}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={renderTabs}
          refreshControl={(
            <RefreshControl
              refreshing={isFetching && !isFetchingNextPage}
              onRefresh={refetch}
            />
          )}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: bottomInset }}
          ListEmptyComponent={<EmptyState title="暂无资产流水" description="当前分类暂无记录" />}
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
  tabsBlock: {
    marginBottom: 14,
  },
  tabsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tabsContent: {
    gap: 8,
    paddingRight: 4,
  },
  tabChip: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
    overflow: 'hidden',
  },
  recordAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  recordIcon: {
    width: 40,
    height: 40,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
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
