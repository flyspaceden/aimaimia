import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { Tag } from '../../src/components/ui';
import { BonusRepo, GrowthRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { compactActionTextProps, useBottomInset, useTheme } from '../../src/theme';
import type { GrowthExchangeItem, GrowthGuideRule } from '../../src/types';

const exchangeTypeLabels: Record<GrowthExchangeItem['type'], string> = {
  COUPON: '平台红包',
  SHIPPING_COUPON: '运费红包',
  LOTTERY_CHANCE: '抽奖机会',
  VIP_DISCOUNT_COUPON: 'VIP 优惠红包',
  DECORATION: '装饰权益',
};

const grantTimingLabels: Record<string, string> = {
  IMMEDIATE: '达成后立即发放',
  CONFIRMED_RECEIPT: '确认收货后发放',
  AFTER_SALE_WINDOW: '售后期结束后发放',
  MANUAL: '人工审核后发放',
};

function formatRewardText(rule: GrowthGuideRule) {
  const rewards = [];
  if (rule.pointsReward) rewards.push(`${rule.pointsReward} 积分`);
  if (rule.growthReward) rewards.push(`${rule.growthReward} 成长值`);
  return rewards.length > 0 ? rewards.join(' + ') : '无奖励';
}

function formatLimitText(rule: GrowthGuideRule) {
  const limits = [];
  if (rule.dailyLimit) limits.push(`每日 ${rule.dailyLimit} 次`);
  if (rule.weeklyLimit) limits.push(`每周 ${rule.weeklyLimit} 次`);
  if (rule.monthlyLimit) limits.push(`每月 ${rule.monthlyLimit} 次`);
  if (rule.lifetimeLimit) limits.push(`共 ${rule.lifetimeLimit} 次`);
  return limits.length > 0 ? limits.join(' · ') : '不限次数';
}

function formatTimingText(rule: GrowthGuideRule) {
  return grantTimingLabels[rule.grantTiming] ?? rule.grantTiming;
}

export default function GrowthCenterScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const bottomInset = useBottomInset(0);

  const growthQuery = useQuery({
    queryKey: ['growth-me'],
    queryFn: () => GrowthRepo.getMe(),
    enabled: isLoggedIn,
  });
  const memberQuery = useQuery({
    queryKey: ['bonus-member'],
    queryFn: () => BonusRepo.getMember(),
    enabled: isLoggedIn,
  });
  const exchangeItemsQuery = useQuery({
    queryKey: ['growth-exchange-items'],
    queryFn: () => GrowthRepo.getExchangeItems(),
    enabled: isLoggedIn,
  });
  const guideQuery = useQuery({
    queryKey: ['growth-guide'],
    queryFn: () => GrowthRepo.getGuide(),
    enabled: isLoggedIn,
  });

  const exchangeMutation = useMutation({
    mutationFn: (itemId: string) => GrowthRepo.exchangeItem(itemId),
    onSuccess: async (result) => {
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '兑换失败', type: 'error' });
        return;
      }
      show({ message: '兑换成功，权益已放入账户', type: 'success' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['growth-me'] }),
        queryClient.invalidateQueries({ queryKey: ['growth-exchange-items'] }),
        queryClient.invalidateQueries({ queryKey: ['growth-exchange-records'] }),
        queryClient.invalidateQueries({ queryKey: ['me-coupons'] }),
      ]);
    },
  });

  const growth = growthQuery.data?.ok ? growthQuery.data.data : null;
  const member = memberQuery.data?.ok ? memberQuery.data.data : null;
  const isVip = member?.tier === 'VIP';
  const guide = guideQuery.data?.ok ? guideQuery.data.data : null;
  const earningRules = guide?.earningRules ?? [];
  const levels = guide?.levels ?? [];
  const exchangeItems = exchangeItemsQuery.data?.ok ? exchangeItemsQuery.data.data : [];
  const levelPercent = Math.round((growth?.levelProgress?.ratio ?? 0) * 100);
  const pointsLabel = memberQuery.data?.ok ? (isVip ? '会员积分' : '普通积分') : '积分';
  const pointsNote = guide?.pointsNote ?? '积分用于兑换红包和权益，兑换时会消耗。';
  const growthNote = guide?.growthNote ?? '成长值用于升级，不会因为积分兑换而减少。';
  const isLoading =
    growthQuery.isLoading ||
    memberQuery.isLoading ||
    exchangeItemsQuery.isLoading ||
    guideQuery.isLoading;
  const refreshing =
    growthQuery.isFetching ||
    memberQuery.isFetching ||
    exchangeItemsQuery.isFetching ||
    guideQuery.isFetching;

  const nextLevelText = useMemo(() => {
    if (!growth?.nextLevel) return '已达最高等级';
    const required = growth.levelProgress.required ?? growth.nextLevel.threshold;
    const current = growth.levelProgress.current ?? 0;
    return `距离 ${growth.nextLevel.name} 还差 ${Math.max(0, required - current)} 成长值`;
  }, [growth]);

  const refresh = async () => {
    await Promise.all([
      growthQuery.refetch(),
      memberQuery.refetch(),
      exchangeItemsQuery.refetch(),
      guideQuery.refetch(),
    ]);
  };

  if (!isLoggedIn) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="耕耘值" />
        <View style={{ flex: 1, padding: spacing.xl, justifyContent: 'center' }}>
          <EmptyState title="登录后查看耕耘值" description="登录后可以查看积分、成长值、等级和可兑换权益" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="耕耘值" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] + bottomInset }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <>
            <Skeleton height={220} radius={radius.xl} />
            <View style={{ height: spacing.lg }} />
            <Skeleton height={170} radius={radius.lg} />
          </>
        ) : growthQuery.data && !growthQuery.data.ok ? (
          <ErrorState
            title="成长账户加载失败"
            description={growthQuery.data.error.displayMessage ?? '请稍后重试'}
            onAction={growthQuery.refetch}
          />
        ) : memberQuery.data && !memberQuery.data.ok ? (
          <ErrorState
            title="会员状态加载失败"
            description={memberQuery.data.error.displayMessage ?? '请稍后重试'}
            onAction={memberQuery.refetch}
          />
        ) : (
          <>
            <Animated.View entering={FadeInDown.duration(300)}>
              <LinearGradient
                colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.heroCard, { borderRadius: radius.xl }, shadow.lg]}
              >
                <View style={styles.heroTopRow}>
                  <View>
                    <Text style={[typography.caption, { color: 'rgba(255,255,255,0.75)' }]}>当前等级</Text>
                    <Text style={[typography.title2, { color: '#FFFFFF', marginTop: 4 }]}>
                      {growth?.level?.name ?? (isVip ? 'VIP 会员' : '普通会员')}
                    </Text>
                  </View>
                  <View style={[styles.levelBadge, { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: radius.pill }]}>
                    <MaterialCommunityIcons name="sprout-outline" size={16} color="#FFFFFF" />
                    <Text style={[typography.captionSm, { color: '#FFFFFF', marginLeft: 4 }]}>
                      {growth?.level?.titleLabel ?? growth?.level?.code ?? 'G0'}
                    </Text>
                  </View>
                </View>

                <View style={styles.metricRow}>
                  <View style={styles.metricItem}>
                    <Text style={[typography.captionSm, { color: 'rgba(255,255,255,0.75)' }]}>{pointsLabel}</Text>
                    <Text style={[typography.title3, { color: '#FFFFFF', marginTop: 4 }]}>
                      {Number(growth?.pointsBalance ?? 0).toLocaleString()}
                    </Text>
                  </View>
                  <View style={styles.metricDivider} />
                  <View style={styles.metricItem}>
                    <Text style={[typography.captionSm, { color: 'rgba(255,255,255,0.75)' }]}>成长值</Text>
                    <Text style={[typography.title3, { color: '#FFFFFF', marginTop: 4 }]}>
                      {Number(growth?.growthValue ?? 0).toLocaleString()}
                    </Text>
                  </View>
                </View>

                <View style={[styles.progressTrack, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                  <View style={[styles.progressFill, { width: `${Math.min(100, levelPercent)}%`, backgroundColor: '#FFFFFF' }]} />
                </View>
                <Text style={[typography.caption, { color: 'rgba(255,255,255,0.78)', marginTop: spacing.sm }]}>
                  {nextLevelText}
                </Text>
              </LinearGradient>
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(300).delay(120)}
              style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <View style={styles.sectionTitleRow}>
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>赚积分和成长值</Text>
                <Tag label="任务规则" tone="neutral" />
              </View>
              {earningRules.length === 0 ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.md }]}>
                  当前暂无开启中的耕耘值任务。
                </Text>
              ) : (
                <View style={{ marginTop: spacing.sm }}>
                  {earningRules.map((rule) => (
                    <View key={rule.code} style={[styles.ruleRow, { borderColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{rule.name}</Text>
                        <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 3 }]}>
                          {formatTimingText(rule)} · {formatLimitText(rule)}
                        </Text>
                      </View>
                      <Tag label={formatRewardText(rule)} tone="brand" style={styles.rewardTag} />
                    </View>
                  ))}
                </View>
              )}
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(300).delay(160)}
              style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <Text style={[typography.headingSm, { color: colors.text.primary }]}>升级规则</Text>
              <View style={[styles.noteBox, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.md, marginTop: spacing.md }]}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>{growthNote}</Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>{pointsNote}</Text>
              </View>
              {levels.length === 0 ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.md }]}>
                  当前后台未配置成长等级。
                </Text>
              ) : (
                <View style={{ marginTop: spacing.sm }}>
                  {levels.map((level) => {
                    const isCurrent = growth?.level?.code === level.code;
                    const isNext = growth?.nextLevel?.code === level.code;
                    return (
                      <View key={level.code} style={[styles.levelRuleRow, { borderColor: colors.border }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{level.name}</Text>
                          <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 2 }]}>
                            累计 {Number(level.threshold).toLocaleString()} 成长值
                          </Text>
                        </View>
                        {isCurrent ? <Tag label="当前" tone="brand" /> : isNext ? <Tag label="下一等级" tone="accent" /> : null}
                      </View>
                    );
                  })}
                </View>
              )}
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(300).delay(200)}
              style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <View style={styles.sectionTitleRow}>
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>积分兑换</Text>
                <Text style={[typography.captionSm, { color: colors.text.secondary }]}>余额 {growth?.pointsBalance ?? 0}</Text>
              </View>
              {exchangeItems.length === 0 ? (
                <EmptyState title="暂无可兑换权益" description="后续会开放更多红包和权益" />
              ) : (
                <View style={{ marginTop: spacing.md }}>
                  {exchangeItems.map((item) => (
                    <View key={item.id} style={[styles.exchangeItem, { borderColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.exchangeTitleRow}>
                          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{item.name}</Text>
                          <Tag label={exchangeTypeLabels[item.type]} tone="accent" />
                        </View>
                        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                          {item.description ?? '兑换后自动放入账户'}
                        </Text>
                        <Text style={[typography.captionSm, { color: colors.muted, marginTop: 6 }]}>
                          {item.pointsCost} 积分
                          {item.requiredLevel ? ` · 需 ${item.requiredLevel.name}` : ''}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => exchangeMutation.mutate(item.id)}
                        disabled={!item.canExchange || exchangeMutation.isPending}
                        style={[
                          styles.exchangeButton,
                          {
                            backgroundColor: item.canExchange ? colors.brand.primary : colors.border,
                            borderRadius: radius.pill,
                          },
                        ]}
                      >
                        <Text
                          {...compactActionTextProps}
                          style={[typography.caption, { color: item.canExchange ? '#FFFFFF' : colors.text.secondary }]}
                        >
                          {item.canExchange ? '兑换' : '不可兑'}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </Animated.View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    padding: 22,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  levelBadge: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
  },
  metricItem: {
    flex: 1,
  },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    height: 42,
    backgroundColor: 'rgba(255,255,255,0.35)',
    marginHorizontal: 16,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 18,
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
  },
  sectionCard: {
    padding: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  ruleRow: {
    minHeight: 64,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rewardTag: {
    flexShrink: 0,
  },
  noteBox: {
    padding: 12,
  },
  levelRuleRow: {
    minHeight: 58,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  exchangeItem: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  exchangeTitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  exchangeButton: {
    minWidth: 64,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
