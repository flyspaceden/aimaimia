import React, { useMemo } from 'react';
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
  useResponsiveLayout,
  useTheme,
} from '../../src/theme';
import type {
  DigitalAssetCreditTierInfo,
  DigitalAssetLedger,
  DigitalAssetVipSeedRule,
} from '../../src/types';

const NON_VIP_ACTIVATION_PROMPT = {
  title: '让每一次消费，都成为你的数字资产基础',
  description: '成为 VIP 后，累计消费可按规则转化为消费资产。',
  actionLabel: '开通 VIP 激活资产',
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

const getLedgerIcon = (item: DigitalAssetLedger) => {
  if (item.subjectType === 'SEED_ASSET') return 'sprout-outline';
  if (item.subjectType === 'CREDIT_ASSET' && item.direction === 'DEBIT') return 'chart-line-variant';
  if (item.subjectType === 'CREDIT_ASSET') return 'chart-line';
  if (item.sourceType === 'REFUND_REVERSAL') return 'cash-refund';
  if (item.sourceType === 'ADMIN_ADJUSTMENT') return 'tune-variant';
  if (item.sourceType === 'BACKFILL') return 'archive-arrow-up-outline';
  return 'shopping-outline';
};

const buildTierProgress = (
  currentTier?: DigitalAssetCreditTierInfo,
  nextTier?: DigitalAssetCreditTierInfo | null,
) => {
  if (!currentTier) return { progress: 0, remainingText: '规则待定' };
  if (!nextTier) return { progress: 1, remainingText: '已达当前最高档' };
  const span = Math.max(1, nextTier.minAmount - currentTier.minAmount);
  const currentAmount = currentTier.currentAmount ?? currentTier.minAmount;
  const progress = Math.min(1, Math.max(0, (currentAmount - currentTier.minAmount) / span));
  return {
    progress,
    remainingText: `距下一档还差 ${formatCurrency(nextTier.remainingAmount ?? 0)}`,
  };
};

export default function DigitalAssetsScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const { isCompact } = useResponsiveLayout();
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
  const hasCreditTierRules = Boolean(summary?.currentCreditTier);

  const tierProgress = useMemo(
    () => buildTierProgress(summary?.currentCreditTier, summary?.nextCreditTier),
    [summary?.currentCreditTier, summary?.nextCreditTier],
  );

  const renderMetricCard = ({
    label,
    value,
    accent,
    currency = false,
  }: {
    label: string;
    value: number;
    accent: string;
    currency?: boolean;
  }) => (
    <View
      style={[
        styles.metricCard,
        {
          width: isCompact ? '100%' : '48.5%',
          borderRadius: radius.lg,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        },
      ]}
    >
      <Text style={[typography.caption, { color: colors.text.secondary }]} {...fitTextProps}>
        {label}
      </Text>
      <Text
        style={[
          typography.title2,
          styles.metricValue,
          { color: accent, marginTop: spacing.xs },
        ]}
        {...priceTextProps}
      >
        {currency ? formatCurrency(value) : formatAssetValue(value)}
      </Text>
    </View>
  );

  const renderVipSeedRule = ({ item, index }: { item: DigitalAssetVipSeedRule; index: number }) => (
    <Animated.View entering={FadeInDown.duration(220).delay(index * 40)}>
      <View
        style={[
          styles.ruleCard,
          {
            borderRadius: radius.lg,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          },
        ]}
      >
        <View style={styles.ruleHeader}>
          <View>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]} {...fitTextProps}>
              VIP 套餐 {formatCurrency(item.price)}
            </Text>
            <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}>
              当前套餐规则
            </Text>
          </View>
          <View style={[styles.pendingPill, { borderRadius: radius.pill, backgroundColor: colors.brand.primarySoft }]}>
            <Text style={[typography.captionSm, { color: colors.brand.primary }]}>生效中</Text>
          </View>
        </View>

        <View style={[styles.metricGrid, { marginTop: spacing.md }]}>
          {renderMetricCard({
            label: '自购种子资产',
            value: item.selfSeedAssetAmount,
            accent: colors.brand.primary,
          })}
          {renderMetricCard({
            label: '推荐种子资产',
            value: item.referralSeedAssetAmount,
            accent: colors.gold.primary,
          })}
        </View>
      </View>
    </Animated.View>
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
              name={getLedgerIcon(item) as any}
              size={20}
              color={isPositive ? colors.brand.primary : colors.danger}
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
          colors={[colors.brand.primary, colors.gold.primary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, { borderRadius: radius.xl }]}
        >
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
        </LinearGradient>
      ) : (
        <LinearGradient
          colors={[colors.brand.primary, colors.ai.soft]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, { borderRadius: radius.xl }]}
        >
          <Text style={styles.heroLabel}>累计消费金额</Text>
          <Text style={styles.heroValue} {...priceTextProps}>
            {formatCurrency(summary?.cumulativeSpendAmount ?? 0)}
          </Text>
          <Text style={styles.heroPromptTitle}>{NON_VIP_ACTIVATION_PROMPT.title}</Text>
          <Text style={styles.heroPromptDesc}>{NON_VIP_ACTIVATION_PROMPT.description}</Text>
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

      {isVip ? (
        <View style={[styles.metricGrid, { marginTop: spacing.md }]}>
          {renderMetricCard({
            label: '种子资产',
            value: summary?.seedAssetBalance ?? 0,
            accent: colors.brand.primary,
          })}
          {renderMetricCard({
            label: '消费资产',
            value: summary?.creditAssetBalance ?? 0,
            accent: colors.gold.primary,
          })}
        </View>
      ) : null}

      <View style={styles.sectionBlock}>
        <View style={styles.sectionHeader}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>消费资产规则</Text>
          <Text style={[typography.captionSm, { color: colors.text.secondary }]}>
            {summary?.currentCreditTier ? `当前档位 x${summary.currentCreditTier.multiplier}` : '规则待开放'}
          </Text>
        </View>
        {hasCreditTierRules ? (
          <View
            style={[
              styles.sectionCard,
              {
                borderRadius: radius.lg,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          >
            <View style={styles.ruleHeader}>
              <View>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                  {summary?.nextCreditTier
                    ? `下一档 x${summary.nextCreditTier.multiplier}`
                    : '当前最高档'}
                </Text>
                <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}>
                  {tierProgress.remainingText}
                </Text>
              </View>
              <Text style={[typography.captionSm, { color: colors.text.secondary }]}>
                {summary?.currentCreditTier ? `${formatCurrency(summary.currentCreditTier.minAmount)} 起算` : '暂无档位规则'}
              </Text>
            </View>

            <View style={[styles.progressTrack, { backgroundColor: colors.bgSecondary, borderRadius: radius.pill, marginTop: spacing.md }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.max(8, tierProgress.progress * 100)}%`,
                    backgroundColor: colors.brand.primary,
                    borderRadius: radius.pill,
                  },
                ]}
              />
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.sectionCard,
              {
                borderRadius: radius.lg,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>暂无档位规则</Text>
            <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}>
              规则待开放
            </Text>
          </View>
        )}
      </View>

      <View style={styles.sectionBlock}>
        <View style={styles.sectionHeader}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>VIP 种子资产规则</Text>
          <Text style={[typography.captionSm, { color: colors.text.secondary }]}>
            按套餐配置
          </Text>
        </View>
        {summary?.vipSeedRules?.length ? (
          summary.vipSeedRules.map((item, index) => (
            <View key={item.packageId} style={{ marginBottom: index === summary.vipSeedRules.length - 1 ? 0 : spacing.sm }}>
              {renderVipSeedRule({ item, index })}
            </View>
          ))
        ) : (
          <View
            style={[
              styles.sectionCard,
              {
                borderRadius: radius.lg,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>VIP 规则待配置</Text>
            <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}>
              暂无可展示的套餐规则
            </Text>
          </View>
        )}
      </View>

      <View style={styles.sectionBlock}>
        <View style={styles.sectionHeader}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>最近消费记录</Text>
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
  },
  heroLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
  },
  heroValue: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    marginTop: 8,
  },
  heroFootRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  heroFootLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
  },
  heroFootValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  heroPromptTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 12,
    lineHeight: 21,
  },
  heroPromptDesc: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  heroButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 14,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  metricCard: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  metricValue: {
    fontWeight: '800',
  },
  sectionBlock: {
    marginTop: 22,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 12,
  },
  sectionCard: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  ruleCard: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  ruleHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  pendingPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  progressTrack: {
    height: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    minWidth: 8,
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
