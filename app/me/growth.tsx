import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AiDivider, Tag } from '../../src/components/ui';
import { BonusRepo, CouponRepo, GrowthRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { compactActionTextProps, useBottomInset, useResponsiveLayout, useTheme } from '../../src/theme';
import type { GrowthExchangeItem, GrowthGuideRule, NormalShareRecord } from '../../src/types';

const exchangeTypeLabels: Record<GrowthExchangeItem['type'], string> = {
  COUPON: '平台红包',
  SHIPPING_COUPON: '运费红包',
  LOTTERY_CHANCE: '抽奖机会',
  VIP_DISCOUNT_COUPON: 'VIP 优惠红包',
  DECORATION: '装饰权益',
};

const rewardStatusLabels: Record<NormalShareRecord['rewardStatus'], string> = {
  PENDING: '已绑定',
  REGISTER_REWARDED: '注册已奖',
  FIRST_ORDER_PENDING: '待首单',
  ISSUED: '首单已奖',
  REVERSED: '已冲正',
  VOIDED: '已作废',
};

const grantTimingLabels: Record<string, string> = {
  IMMEDIATE: '达成后立即发放',
  CONFIRMED_RECEIPT: '确认收货后发放',
  AFTER_SALE_WINDOW: '售后期结束后发放',
  MANUAL: '人工审核后发放',
};

type MaterialIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const vipGrowthGuideItems: Array<{
  icon: MaterialIconName;
  title: string;
  description: string;
}> = [
  {
    icon: 'sprout-outline',
    title: '会员成长怎么用',
    description: '会员积分可兑换红包和会员权益；成长值只用于升级，不会因积分兑换而减少。',
  },
  {
    icon: 'qrcode-scan',
    title: '推荐好友怎么操作',
    description: '邀请好友时使用 VIP 推荐码，好友成为 VIP 后进入你的 VIP 团队。',
  },
  {
    icon: 'format-list-checks',
    title: '积分和成长值怎么获得',
    description: '完成下方已开启的任务，或订单确认收货后，系统会按后台规则自动发放。',
  },
];

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

function formatPercent(value?: number | null) {
  if (typeof value !== 'number') return '后台配置';
  const percent = value * 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2)}%`;
}

function formatCurrency(value: number) {
  const safeValue = Math.max(0, value);
  return `¥${Number.isInteger(safeValue) ? safeValue.toFixed(0) : safeValue.toFixed(2)}`;
}

export default function GrowthCenterScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const bottomInset = useBottomInset(0);
  const { isCompact, isLargeText } = useResponsiveLayout();
  const compactShareLayout = isCompact || isLargeText;
  const [bindCode, setBindCode] = useState('');

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
  const member = memberQuery.data?.ok ? memberQuery.data.data : null;
  const memberLoaded = Boolean(memberQuery.data);
  const memberLoadFailed = Boolean(memberQuery.data && !memberQuery.data.ok);
  const isVip = member?.tier === 'VIP';
  const normalShareEnabled = Boolean(isLoggedIn && memberQuery.data?.ok && !isVip);
  const shareQuery = useQuery({
    queryKey: ['normal-share-me'],
    queryFn: () => GrowthRepo.getNormalShareMe(),
    enabled: normalShareEnabled,
  });
  const statsQuery = useQuery({
    queryKey: ['normal-share-stats'],
    queryFn: () => GrowthRepo.getNormalShareStats(),
    enabled: normalShareEnabled,
  });
  const recordsQuery = useQuery({
    queryKey: ['normal-share-records'],
    queryFn: () => GrowthRepo.getNormalShareRecords(),
    enabled: normalShareEnabled,
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
      show({ message: '兑换成功，红包已放入账户', type: 'success' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['growth-me'] }),
        queryClient.invalidateQueries({ queryKey: ['growth-exchange-items'] }),
        queryClient.invalidateQueries({ queryKey: ['growth-exchange-records'] }),
        queryClient.invalidateQueries({ queryKey: ['me-coupons'] }),
      ]);
    },
  });

  const bindMutation = useMutation({
    mutationFn: (code: string) => GrowthRepo.bindNormalShareCode(code),
    onSuccess: async (result) => {
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '绑定失败', type: 'error' });
        return;
      }
      show({ message: '普通分享关系已绑定', type: 'success' });
      setBindCode('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['normal-share-records'] }),
        queryClient.invalidateQueries({ queryKey: ['normal-share-stats'] }),
      ]);
    },
  });

  const growth = growthQuery.data?.ok ? growthQuery.data.data : null;
  const shareProfile = shareQuery.data?.ok ? shareQuery.data.data : null;
  const stats = statsQuery.data?.ok ? statsQuery.data.data : null;
  const records = recordsQuery.data?.ok ? recordsQuery.data.data : [];
  const exchangeItems = exchangeItemsQuery.data?.ok ? exchangeItemsQuery.data.data : [];
  const guide = guideQuery.data?.ok ? guideQuery.data.data : null;
  const inviteRules = guide?.inviteRules ?? [];
  const earningRules = guide?.earningRules ?? [];
  const levels = guide?.levels ?? [];
  const directReferralPercent = growth?.directReferralPercent ?? member?.directReferralPercent ?? null;
  const directReferralPercentText = formatPercent(directReferralPercent);
  const autoVipEnabled = Boolean(growth?.autoVipBySpendEnabled ?? member?.autoVipBySpendEnabled);
  const autoVipThreshold =
    growth?.autoVipCumulativeSpendThreshold ?? member?.autoVipCumulativeSpendThreshold ?? null;
  const autoVipRemaining = growth?.autoVipRemainingSpend ?? member?.autoVipRemainingSpend ?? null;
  const autoVipSpent =
    typeof autoVipThreshold === 'number' && typeof autoVipRemaining === 'number'
      ? Math.max(0, autoVipThreshold - autoVipRemaining)
      : null;
  const autoVipProgressPercent =
    typeof autoVipThreshold === 'number' && autoVipThreshold > 0 && typeof autoVipSpent === 'number'
      ? Math.min(100, Math.round((autoVipSpent / autoVipThreshold) * 100))
      : autoVipRemaining === 0
        ? 100
        : 0;
  const isLoading = growthQuery.isLoading || memberQuery.isLoading || (normalShareEnabled && shareQuery.isLoading);
  const growthTitle = memberLoaded ? (isVip ? '会员成长' : '普通成长') : '成长中心';
  const pointsLabel = memberQuery.data?.ok ? (isVip ? '会员积分' : '普通积分') : '积分';
  const levelPercent = Math.round((growth?.levelProgress?.ratio ?? 0) * 100);
  const shareUrl = shareProfile?.shareUrl ?? '';
  const shareProfileError = shareQuery.data && !shareQuery.data.ok
    ? (shareQuery.data.error.displayMessage ?? '普通分享码加载失败，请下拉刷新')
    : null;
  const isShareActive = shareProfile?.status === 'ACTIVE';
  const canUseShareCode = Boolean(isShareActive && shareProfile?.code && shareUrl && !shareProfileError);
  const shareStatusLabel = shareProfileError ? '加载失败' : isShareActive ? '可分享' : '已停用';
  const shareHelpText = shareProfileError
    ?? (shareProfile?.status === 'DISABLED'
      ? (shareProfile.disabledReason ? `已停用：${shareProfile.disabledReason}` : '普通分享码已被后台停用，暂不可复制或分享')
      : '好友注册后立即发放注册奖励，首单确认收货后继续按后台规则发放奖励');
  const pointsNote = isVip
    ? '会员积分用于兑换红包和会员权益，兑换时会消耗。'
    : (guide?.pointsNote ?? '普通积分用于兑换红包和权益，兑换时会消耗');
  const growthNote = guide?.growthNote ?? '成长值用于升级，不会因为积分兑换而减少';
  const earningEmptyText = isVip
    ? '当前暂无开启中的会员成长任务。'
    : '当前暂无开启中的积分成长任务。';

  const nextLevelText = useMemo(() => {
    if (!growth?.nextLevel) return '已达最高等级';
    const required = growth.levelProgress.required ?? growth.nextLevel.threshold;
    const current = growth.levelProgress.current ?? 0;
    return `距离 ${growth.nextLevel.name} 还差 ${Math.max(0, required - current)} 成长值`;
  }, [growth]);

  const refresh = async () => {
    const tasks: Array<Promise<unknown>> = [
      growthQuery.refetch(),
      memberQuery.refetch(),
      exchangeItemsQuery.refetch(),
      guideQuery.refetch(),
    ];
    if (normalShareEnabled) {
      tasks.push(
        shareQuery.refetch(),
        statsQuery.refetch(),
        recordsQuery.refetch(),
      );
    }
    await Promise.all(tasks);
  };

  const handleCopyShareCode = async () => {
    if (!canUseShareCode || !shareProfile?.code) {
      show({ message: shareProfileError ?? '普通分享码暂不可用', type: 'info' });
      return;
    }
    await Clipboard.setStringAsync(shareProfile.code);
    show({ message: '普通分享码已复制', type: 'success' });
  };

  const handleShare = async () => {
    if (!canUseShareCode || !shareProfile?.code || !shareUrl) {
      show({ message: shareProfileError ?? '普通分享码暂不可用', type: 'info' });
      return;
    }
    try {
      const result = await Share.share({
        message: `我在爱买买买农产品，用我的普通分享码 ${shareProfile.code} 注册登录，一起领成长奖励：${shareUrl}`,
      });
      if (result.action === Share.sharedAction) {
        CouponRepo.reportShareEvent({
          scene: 'NORMAL_SHARE',
          targetId: shareProfile.code,
        }).catch(() => {});
      }
    } catch {
      // 用户取消分享
    }
  };

  const handleBind = () => {
    const normalized = bindCode.trim().toUpperCase();
    if (!normalized) {
      show({ message: '请输入普通分享码', type: 'info' });
      return;
    }
    bindMutation.mutate(normalized);
  };

  if (!isLoggedIn) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title={growthTitle} />
        <View style={{ flex: 1, padding: spacing.xl, justifyContent: 'center' }}>
          <EmptyState title="登录后查看成长权益" description="普通积分、成长值和分享码会在登录后自动生成" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title={growthTitle} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] + bottomInset }}
        refreshControl={
          <RefreshControl
            refreshing={growthQuery.isFetching || memberQuery.isFetching || (normalShareEnabled && shareQuery.isFetching)}
            onRefresh={refresh}
          />
        }
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
        ) : memberLoadFailed ? (
          <ErrorState
            title="会员状态加载失败"
            description={memberQuery.data && !memberQuery.data.ok ? (memberQuery.data.error.displayMessage ?? '请稍后重试') : '请稍后重试'}
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

            {isVip ? (
              <Animated.View
                entering={FadeInDown.duration(300).delay(80)}
                style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
              >
                <View style={styles.sectionTitleRow}>
                  <Text style={[typography.headingSm, { color: colors.text.primary }]}>VIP 成长与推荐</Text>
                  <Tag label="VIP 推荐权益" tone="accent" />
                </View>

                <View style={[styles.vipGuideList, { marginTop: spacing.md }]}>
                  {vipGrowthGuideItems.map((item) => (
                    <View key={item.title} style={[styles.vipGuideRow, { borderBottomColor: colors.border }]}>
                      <View style={[styles.vipGuideIconBox, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.md }]}>
                        <MaterialCommunityIcons name={item.icon} size={18} color={colors.brand.primary} />
                      </View>
                      <View style={styles.vipGuideText}>
                        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{item.title}</Text>
                        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 3 }]}>
                          {item.description}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>

                <View style={[styles.vipBoundaryBox, { backgroundColor: colors.background, borderRadius: radius.md, marginTop: spacing.md }]}>
                  <MaterialCommunityIcons name="information-outline" size={16} color={colors.brand.primary} />
                  <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 6, flex: 1 }]}>
                    普通分享码仅普通用户拉新使用；VIP 使用推荐码，积分和成长值仍可继续获得。
                  </Text>
                </View>

                <Pressable
                  onPress={() => router.push('/me/referral')}
                  style={[styles.primaryAction, { alignSelf: 'flex-start', backgroundColor: colors.brand.primary, borderRadius: radius.pill, marginTop: spacing.md }]}
                >
                  <MaterialCommunityIcons name="qrcode" size={15} color="#FFFFFF" />
                  <Text {...compactActionTextProps} style={[typography.caption, { color: '#FFFFFF', marginLeft: 4 }]}>
                    去分享 VIP 推荐码
                  </Text>
                </Pressable>
              </Animated.View>
            ) : (
              <>
            <Animated.View
              entering={FadeInDown.duration(300).delay(80)}
              style={[styles.shareCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <View style={styles.sectionTitleRow}>
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>普通分享码</Text>
                <Tag label={shareStatusLabel} tone={canUseShareCode ? 'brand' : 'neutral'} />
              </View>
              <AiDivider style={{ marginVertical: spacing.sm }} />

              <View style={[styles.shareBody, compactShareLayout && styles.shareBodyCompact]}>
                <View style={[styles.qrBox, { borderRadius: radius.lg, borderColor: colors.border }]}>
                  {canUseShareCode ? (
                    <QRCode value={shareUrl} size={112} color={colors.brand.primaryDark} backgroundColor="#FFFFFF" />
                  ) : (
                    <MaterialCommunityIcons name={shareProfileError ? 'wifi-off' : 'link-off'} size={48} color={colors.muted} />
                  )}
                </View>
                <View style={[styles.shareInfo, compactShareLayout && styles.shareInfoCompact]}>
                  <Text style={[styles.shareCodeText, { color: colors.text.primary }]}>
                    {shareProfile?.code ?? (shareProfileError ? '加载失败' : '生成中')}
                  </Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                    {shareHelpText}
                  </Text>
                  <View style={[styles.shareActions, compactShareLayout && styles.shareActionsCompact]}>
                    <Pressable
                      onPress={handleCopyShareCode}
                      disabled={!canUseShareCode}
                      style={[
                        styles.smallAction,
                        { borderColor: colors.border, borderRadius: radius.pill, opacity: canUseShareCode ? 1 : 0.48 },
                      ]}
                    >
                      <MaterialCommunityIcons name="content-copy" size={15} color={canUseShareCode ? colors.text.primary : colors.muted} />
                      <Text style={[typography.caption, { color: canUseShareCode ? colors.text.primary : colors.muted, marginLeft: 4 }]}>复制</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleShare}
                      disabled={!canUseShareCode}
                      style={[
                        styles.primaryAction,
                        {
                          backgroundColor: canUseShareCode ? colors.brand.primary : colors.border,
                          borderRadius: radius.pill,
                        },
                      ]}
                    >
                      <MaterialCommunityIcons name="share-variant-outline" size={15} color={canUseShareCode ? '#FFFFFF' : colors.text.secondary} />
                      <Text {...compactActionTextProps} style={[typography.caption, { color: canUseShareCode ? '#FFFFFF' : colors.text.secondary, marginLeft: 4 }]}>分享</Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              <View style={[styles.statsRow, { marginTop: spacing.md }]}>
                <View style={styles.statCell}>
                  <Text style={[typography.captionSm, { color: colors.text.secondary }]}>已邀请</Text>
                  <Text style={[typography.title3, { color: colors.text.primary }]}>{stats?.totalInvitees ?? 0}</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={[typography.captionSm, { color: colors.text.secondary }]}>已奖励</Text>
                  <Text style={[typography.title3, { color: colors.success }]}>{stats?.rewardedInvitees ?? 0}</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={[typography.captionSm, { color: colors.text.secondary }]}>待首单</Text>
                  <Text style={[typography.title3, { color: colors.gold.primary }]}>{stats?.pendingInvitees ?? 0}</Text>
                </View>
              </View>
            </Animated.View>

            {autoVipEnabled && typeof autoVipThreshold === 'number' ? (
              <Animated.View
                entering={FadeInDown.duration(300).delay(90)}
                style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
              >
                <View style={styles.sectionTitleRow}>
                  <Text style={[typography.headingSm, { color: colors.text.primary }]}>自动成为 VIP</Text>
                  <Tag label={`${autoVipProgressPercent}%`} tone={autoVipRemaining === 0 ? 'brand' : 'accent'} />
                </View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                  累计普通商品有效消费满 {formatCurrency(autoVipThreshold)} 可自动成为 VIP。
                </Text>
                <View style={[styles.autoVipTrack, { backgroundColor: colors.border, marginTop: spacing.md }]}>
                  <View
                    style={[
                      styles.autoVipFill,
                      { width: `${autoVipProgressPercent}%`, backgroundColor: colors.brand.primary },
                    ]}
                  />
                </View>
                <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                  {typeof autoVipRemaining === 'number' && autoVipRemaining <= 0
                    ? '已达到门槛，订单确认收货入账后会自动升级。'
                    : `还差 ${formatCurrency(autoVipRemaining ?? autoVipThreshold)}。购买 VIP 礼包仍按原流程立即开通。`}
                </Text>
              </Animated.View>
            ) : null}

            <Animated.View
              entering={FadeInDown.duration(300).delay(100)}
              style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <View style={styles.sectionTitleRow}>
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>推荐收益</Text>
                <Tag label="后台规则" tone="brand" />
              </View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                邀请好友后，可按后台规则获得好友普通商品订单利润的 {directReferralPercentText}。好友成为 VIP 时，如果你还不是 VIP，普通推荐关系会结束；如果你已是 VIP，好友会进入你的 VIP 团队。
              </Text>
              {guideQuery.isLoading ? (
                <View style={{ marginTop: spacing.md }}>
                  <Skeleton height={76} radius={radius.md} />
                </View>
              ) : inviteRules.length === 0 ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.md }]}>
                  当前后台未开启普通推荐奖励。
                </Text>
              ) : (
                <View style={{ marginTop: spacing.sm }}>
                  {inviteRules.map((rule) => (
                    <View key={rule.code} style={[styles.ruleRow, { borderColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{rule.name}</Text>
                        <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 3 }]}>
                          {formatTimingText(rule)} · {formatLimitText(rule)}
                        </Text>
                      </View>
                      <Tag label={formatRewardText(rule)} tone="accent" style={styles.rewardTag} />
                    </View>
                  ))}
                </View>
              )}
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(300).delay(120)}
              style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <Text style={[typography.headingSm, { color: colors.text.primary }]}>绑定好友分享码</Text>
              <View style={[styles.bindRow, { marginTop: spacing.md }]}>
                <TextInput
                  value={bindCode}
                  onChangeText={(value) => setBindCode(value.toUpperCase())}
                  autoCapitalize="characters"
                  placeholder="输入 S 开头的 8 位分享码"
                  placeholderTextColor={colors.muted}
                  style={[
                    styles.bindInput,
                    {
                      borderColor: colors.border,
                      color: colors.text.primary,
                      backgroundColor: colors.background,
                      borderRadius: radius.md,
                    },
                  ]}
                />
                <Pressable
                  onPress={handleBind}
                  disabled={bindMutation.isPending}
                  style={[styles.bindButton, { backgroundColor: colors.brand.primary, borderRadius: radius.md }]}
                >
                  <Text style={[typography.bodySm, { color: '#FFFFFF' }]}>绑定</Text>
                </Pressable>
              </View>
            </Animated.View>
              </>
            )}

            <Animated.View
              entering={FadeInDown.duration(300).delay(150)}
              style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <View style={styles.sectionTitleRow}>
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>赚积分和成长值</Text>
                <Tag label="任务规则" tone="neutral" />
              </View>
              {guideQuery.isLoading ? (
                <View style={{ marginTop: spacing.md }}>
                  <Skeleton height={96} radius={radius.md} />
                </View>
              ) : earningRules.length === 0 ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.md }]}>
                  {earningEmptyText}
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
              entering={FadeInDown.duration(300).delay(180)}
              style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <Text style={[typography.headingSm, { color: colors.text.primary }]}>升级规则</Text>
              <View style={[styles.noteBox, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.md, marginTop: spacing.md }]}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  {growthNote}
                </Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                  {pointsNote}
                </Text>
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
              entering={FadeInDown.duration(300).delay(210)}
              style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <View style={styles.sectionTitleRow}>
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>积分兑换</Text>
                <Text style={[typography.captionSm, { color: colors.text.secondary }]}>余额 {growth?.pointsBalance ?? 0}</Text>
              </View>
              {exchangeItemsQuery.isLoading ? (
                <View style={{ marginTop: spacing.md }}>
                  <Skeleton height={84} radius={radius.md} />
                </View>
              ) : exchangeItems.length === 0 ? (
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
                        <Text style={[typography.caption, { color: item.canExchange ? '#FFFFFF' : colors.text.secondary }]}>
                          {item.canExchange ? '兑换' : '不可兑'}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </Animated.View>

            {!isVip ? (
              <Animated.View
                entering={FadeInDown.duration(300).delay(240)}
                style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
              >
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>最近邀请</Text>
                {records.length === 0 ? (
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.md }]}>
                    暂无邀请记录
                  </Text>
                ) : (
                  <View style={{ marginTop: spacing.sm }}>
                    {records.slice(0, 5).map((record) => (
                      <View key={record.id} style={[styles.recordRow, { borderBottomColor: colors.border }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[typography.bodySm, { color: colors.text.primary }]}>
                            {record.invitee?.profile?.nickname || record.invitee?.buyerNo || '新用户'}
                          </Text>
                          <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 2 }]}>
                            {new Date(record.boundAt).toLocaleDateString()}
                          </Text>
                        </View>
                        <Tag label={rewardStatusLabels[record.rewardStatus] ?? record.rewardStatus} tone={record.rewardStatus === 'ISSUED' ? 'brand' : 'neutral'} />
                      </View>
                    ))}
                  </View>
                )}
              </Animated.View>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    padding: 20,
    minHeight: 218,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
  },
  metricItem: {
    flex: 1,
  },
  metricDivider: {
    width: 1,
    height: 42,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginHorizontal: 16,
  },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 24,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  autoVipTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  autoVipFill: {
    height: '100%',
    borderRadius: 999,
  },
  shareCard: {
    padding: 16,
  },
  sectionCard: {
    padding: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  vipGuideList: {
    width: '100%',
  },
  vipGuideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  vipGuideIconBox: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  vipGuideText: {
    flex: 1,
  },
  vipBoundaryBox: {
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  shareBody: {
    flexDirection: 'row',
  },
  shareBodyCompact: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  qrBox: {
    width: 128,
    height: 128,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  shareInfo: {
    flex: 1,
    marginLeft: 14,
  },
  shareInfoCompact: {
    width: '100%',
    marginLeft: 0,
    marginTop: 14,
  },
  shareCodeText: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0,
  },
  shareActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  shareActionsCompact: {
    flexWrap: 'wrap',
    rowGap: 8,
  },
  smallAction: {
    height: 34,
    paddingHorizontal: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryAction: {
    height: 34,
    paddingHorizontal: 14,
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148,163,184,0.24)',
    paddingTop: 14,
  },
  statCell: {
    flex: 1,
  },
  bindRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bindInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0,
  },
  bindButton: {
    height: 44,
    paddingHorizontal: 18,
    marginLeft: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exchangeItem: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  exchangeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  exchangeButton: {
    minWidth: 66,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ruleRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rewardTag: {
    maxWidth: 136,
    flexShrink: 0,
  },
  noteBox: {
    padding: 12,
  },
  levelRuleRow: {
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
