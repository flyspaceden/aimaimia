import React from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { AppHeader, Screen } from '../../src/components/layout';
import { DigitalAssetRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import {
  compactActionTextProps,
  fitTextProps,
  priceTextProps,
  useBottomInset,
  useTheme,
} from '../../src/theme';
import type { DigitalAssetLedger } from '../../src/types';

const NON_VIP_ACTIVATION_PROMPT = {
  title: '开通 VIP 激活数字资产',
  actionLabel: '开通 VIP 激活资产',
} as const;

type LedgerTone = 'seed' | 'consumption' | 'spend' | 'refund' | 'adjustment';

const ASSET_VISUAL = {
  heroGradient: ['#15364B', '#116150', '#C2A03E'] as const,
  nonVipGradient: ['#15364B', '#116150'] as const,
  heroBorder: 'rgba(255,255,255,0.18)',
  heroLine: 'rgba(255,255,255,0.34)',
  heroTile: 'rgba(255,255,255,0.10)',
  heroTileBorder: 'rgba(255,255,255,0.18)',
  screenWash: '#EEF6F1',
  tones: {
    seed: {
      color: '#1F8A5F',
      bg: '#DFF1E6',
      border: 'rgba(31,138,95,0.28)',
      icon: 'sprout-outline',
      badge: '种',
    },
    consumption: {
      color: '#267B93',
      bg: '#DFF1F3',
      border: 'rgba(38,123,147,0.28)',
      icon: 'chart-line',
      badge: '消',
    },
    spend: {
      color: '#A87918',
      bg: '#F3ECD8',
      border: 'rgba(168,121,24,0.26)',
      icon: 'shopping-outline',
      badge: '单',
    },
    refund: {
      color: '#B65347',
      bg: '#F7E3DF',
      border: 'rgba(182,83,71,0.28)',
      icon: 'cash-refund',
      badge: '扣',
    },
    adjustment: {
      color: '#6E7B72',
      bg: '#E7ECE8',
      border: 'rgba(110,123,114,0.28)',
      icon: 'tune-variant',
      badge: '调',
    },
  },
} as const;

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

const getLedgerTone = (item: DigitalAssetLedger): LedgerTone => {
  if (item.direction === 'DEBIT' || item.sourceType === 'REFUND_REVERSAL') return 'refund';
  if (item.sourceType === 'ADMIN_ADJUSTMENT') return 'adjustment';
  if (item.subjectType === 'SEED_ASSET') return 'seed';
  if (item.subjectType === 'CREDIT_ASSET') return 'consumption';
  return 'spend';
};

const getLedgerVisual = (item: DigitalAssetLedger) => ASSET_VISUAL.tones[getLedgerTone(item)];

export default function DigitalAssetsScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const router = useRouter();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const bottomInset = useBottomInset(spacing['3xl']);

  const summaryQuery = useQuery({
    queryKey: ['digital-assets-summary'],
    queryFn: () => DigitalAssetRepo.getSummary(),
    enabled: isLoggedIn,
  });

  const summary = summaryQuery.data?.ok ? summaryQuery.data.data : null;
  const loadError = summaryQuery.data && !summaryQuery.data.ok ? summaryQuery.data.error : null;
  const recentRecords = (summary?.recentRecords ?? []).slice(0, 5);
  const isVip = summary?.isVip ?? false;

  const renderAssetTile = (label: string, value: number) => (
    <View
      style={[
        styles.heroAssetTile,
        {
          borderColor: ASSET_VISUAL.heroTileBorder,
          backgroundColor: ASSET_VISUAL.heroTile,
        },
      ]}
    >
      <Text style={styles.heroAssetLabel} {...fitTextProps}>
        {label}
      </Text>
      <Text style={styles.heroAssetValue} {...priceTextProps}>
        {formatAssetValue(value)}
      </Text>
    </View>
  );

  const renderRecentRecord = ({ item, index }: { item: DigitalAssetLedger; index: number }) => {
    const isPositive = item.direction === 'CREDIT';
    const accent = isPositive ? colors.success : colors.danger;
    return (
      <Animated.View entering={FadeInDown.duration(220).delay(index * 32)}>
        <View
          style={[
            styles.ledgerRow,
            {
              borderRadius: radius.lg,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
        >
          <View
            style={[
              styles.ledgerIcon,
              {
                backgroundColor: isPositive ? colors.brand.primarySoft : `${colors.danger}12`,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={getLedgerVisual(item).icon as any}
              size={20}
              color={getLedgerVisual(item).color}
            />
          </View>

          <View style={styles.ledgerMain}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 3 }]} numberOfLines={1}>
              {item.description || formatDateTime(item.createdAt)}
            </Text>
            <Text style={[typography.captionSm, { color: colors.muted, marginTop: 4 }]}>
              {formatDateTime(item.createdAt)}
            </Text>
          </View>

          <View style={styles.ledgerAmountBox}>
            <Text style={[typography.bodyStrong, { color: accent }]} {...priceTextProps}>
              {formatLedgerAmount(item)}
            </Text>
            <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]} {...priceTextProps}>
              {formatLedgerBalance(item)}
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  };

  const listHeader = (
    <View>
      {isVip ? (
        <LinearGradient
          colors={ASSET_VISUAL.heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, styles.assetHeroCard, { borderRadius: radius.xl }]}
        >
          <View pointerEvents="none" style={styles.heroFieldLines}>
            <View style={[styles.heroFieldLine, styles.heroFieldLinePrimary]} />
            <View style={[styles.heroFieldLine, styles.heroFieldLineSecondary]} />
            <View style={[styles.heroFieldLine, styles.heroFieldLineThird]} />
          </View>
          <View
            pointerEvents="none"
            style={[
              styles.heroInsetBorder,
              { borderColor: ASSET_VISUAL.heroBorder, borderRadius: radius.lg },
            ]}
          />

          <Text style={styles.heroLabel}>数字资产总额</Text>
          <Text style={styles.heroValue} {...priceTextProps}>
            {formatAssetValue(summary?.totalAssetBalance ?? 0)}
          </Text>
          <View style={styles.heroFootRow}>
            <Text style={styles.heroFootLabel}>累计消费金额</Text>
            <Text style={styles.heroFootValue} {...priceTextProps}>
              {formatCurrency(summary?.cumulativeSpendAmount ?? 0)}
            </Text>
          </View>
          <View style={styles.heroAssetGrid}>
            {renderAssetTile('种子资产', summary?.seedAssetBalance ?? 0)}
            {renderAssetTile('消费资产', summary?.creditAssetBalance ?? 0)}
          </View>
        </LinearGradient>
      ) : (
        <LinearGradient
          colors={ASSET_VISUAL.nonVipGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, styles.assetHeroCard, { borderRadius: radius.xl }]}
        >
          <View pointerEvents="none" style={styles.heroFieldLines}>
            <View style={[styles.heroFieldLine, styles.heroFieldLinePrimary]} />
            <View style={[styles.heroFieldLine, styles.heroFieldLineSecondary]} />
          </View>
          <View
            pointerEvents="none"
            style={[
              styles.heroInsetBorder,
              { borderColor: ASSET_VISUAL.heroBorder, borderRadius: radius.lg },
            ]}
          />

          <Text style={styles.heroLabel}>累计消费金额</Text>
          <Text style={styles.heroValue} {...priceTextProps}>
            {formatCurrency(summary?.cumulativeSpendAmount ?? 0)}
          </Text>
          <Text style={styles.heroPromptTitle}>{NON_VIP_ACTIVATION_PROMPT.title}</Text>
          <Pressable
            onPress={() => router.push('/me/vip')}
            style={[styles.heroButton, { borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.18)' }]}
          >
            <Text style={[typography.bodyStrong, { color: '#FFFFFF' }]} {...compactActionTextProps}>
              {NON_VIP_ACTIVATION_PROMPT.actionLabel}
            </Text>
          </Pressable>
        </LinearGradient>
      )}

      <View style={styles.sectionBlock}>
        <View style={styles.sectionHeader}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>最近资产流水</Text>
          <Text style={[typography.captionSm, { color: colors.text.secondary }]}>
            最近 5 条
          </Text>
        </View>
      </View>
    </View>
  );

  if (!isLoggedIn) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="数字资产" />
        <EmptyState
          title="请先登录"
          description="登录后查看数字资产和累计消费"
          actionLabel="返回我的"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="数字资产" />
      {summaryQuery.isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={188} radius={radius.xl} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={112} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={140} radius={radius.lg} />
        </View>
      ) : loadError ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="数字资产加载失败"
            description={loadError.displayMessage ?? '请稍后重试'}
            onAction={() => summaryQuery.refetch()}
          />
        </View>
      ) : (
        <FlatList
          data={recentRecords}
          keyExtractor={(item) => item.id}
          renderItem={renderRecentRecord}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={(
            <View style={{ paddingTop: spacing.sm }}>
              <EmptyState title="暂无消费记录" description="确认收货后开始累计" />
            </View>
          )}
          ListFooterComponent={(
            <Pressable
              onPress={() => router.push('/me/consumption-records')}
              style={[
                styles.viewAllButton,
                {
                  marginTop: spacing.sm,
                  borderRadius: radius.lg,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                },
              ]}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]} {...compactActionTextProps}>
                查看全部消费记录
              </Text>
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
            </Pressable>
          )}
          refreshControl={(
            <RefreshControl
              refreshing={summaryQuery.isFetching}
              onRefresh={() => summaryQuery.refetch()}
            />
          )}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: bottomInset }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    paddingHorizontal: 22,
    paddingVertical: 22,
    overflow: 'hidden',
  },
  assetHeroCard: {
    minHeight: 250,
    shadowColor: '#115240',
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 5,
  },
  heroInsetBorder: {
    position: 'absolute',
    top: 14,
    right: 14,
    bottom: 14,
    left: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroFieldLines: {
    position: 'absolute',
    right: -24,
    bottom: -8,
    width: 250,
    height: 120,
    opacity: 0.42,
  },
  heroFieldLine: {
    position: 'absolute',
    height: 1,
    backgroundColor: ASSET_VISUAL.heroLine,
  },
  heroFieldLinePrimary: {
    left: 0,
    right: 4,
    bottom: 28,
    transform: [{ rotate: '13deg' }],
  },
  heroFieldLineSecondary: {
    left: 12,
    right: 20,
    bottom: 56,
    transform: [{ rotate: '-13deg' }],
  },
  heroFieldLineThird: {
    left: 30,
    right: 0,
    bottom: 84,
    transform: [{ rotate: '8deg' }],
  },
  heroLabel: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: 13,
    fontWeight: '700',
  },
  heroValue: {
    color: '#FFFFFF',
    fontSize: 46,
    fontWeight: '900',
    lineHeight: 54,
    marginTop: 9,
  },
  heroFootRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 12,
    gap: 8,
  },
  heroFootLabel: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 12,
    fontWeight: '600',
  },
  heroFootValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  heroPromptTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 18,
    lineHeight: 22,
  },
  heroButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 14,
  },
  heroAssetGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  heroAssetTile: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 17,
  },
  heroAssetLabel: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: '700',
  },
  heroAssetValue: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 25,
    marginTop: 6,
  },
  sectionBlock: {
    marginTop: 22,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 12,
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  ledgerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ledgerMain: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  ledgerAmountBox: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
});
