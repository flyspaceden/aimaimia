import React, { useMemo, useState } from 'react';
import {
  AppState,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { Tag } from '../../src/components/ui';
import { BonusRepo, CouponRepo, GrowthRepo, InviteH5Repo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { compactActionTextProps, useBottomInset, useTheme } from '../../src/theme';
import { monoFamily } from '../../src/theme/typography';
import type { NormalShareRecord, VipReferralRecord } from '../../src/types';
import { buildInviteH5Url } from '../../src/utils/inviteLink';
import { getReferralInviterLabel, hasBoundReferralInviter } from '../../src/utils/referralRelation';

const rewardStatusLabels: Record<NormalShareRecord['rewardStatus'], string> = {
  PENDING: '已绑定',
  REGISTER_REWARDED: '注册已奖',
  FIRST_ORDER_PENDING: '待首单',
  ISSUED: '首单已奖',
  REVERSED: '已冲正',
  VOIDED: '已作废',
};

const relationStatusLabels: Record<NonNullable<NormalShareRecord['relationStatus']>, string> = {
  ACTIVE: '关系有效',
  SUPERSEDED_BY_VIP_TREE: '转入 VIP 关系',
  INVALIDATED_BY_INVITEE_VIP_UPGRADE: '已因对方升级 VIP 结束',
  ADMIN_VOIDED: '已作废',
};

function formatCurrency(value?: number | null) {
  const amount = Math.max(0, Number(value ?? 0));
  return `¥${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2)}`;
}

function formatDate(value?: string | null) {
  if (!value) return '暂无时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无时间';
  return date.toLocaleDateString();
}

function getNormalRecordName(record: NormalShareRecord) {
  return record.invitee?.profile?.nickname || record.invitee?.buyerNo || '新用户';
}

function getVipRecordName(record: VipReferralRecord) {
  return record.nickname || record.invitee?.profile?.nickname || record.buyerNo || record.maskedPhone || '新用户';
}

// 推荐中心：普通用户和 VIP 共用入口，但展示不同的推荐动作和收益说明。
export default function ReferralScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const bottomPadding = useBottomInset(0);
  const [bindCode, setBindCode] = useState('');

  const memberQuery = useQuery({
    queryKey: ['bonus-member'],
    queryFn: () => BonusRepo.getMember(),
    enabled: isLoggedIn,
  });

  const member = memberQuery.data?.ok ? memberQuery.data.data : null;
  const isVip = member?.tier === 'VIP';
  const normalShareEnabled = Boolean(isLoggedIn && memberQuery.data?.ok && !isVip);
  const vipReferralEnabled = Boolean(isLoggedIn && memberQuery.data?.ok && isVip);

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
  const normalRecordsQuery = useQuery({
    queryKey: ['normal-share-records'],
    queryFn: () => GrowthRepo.getNormalShareRecords(),
    enabled: normalShareEnabled,
  });
  const vipRecordsQuery = useQuery({
    queryKey: ['vip-referral-records'],
    queryFn: () => BonusRepo.getReferralRecords(),
    enabled: vipReferralEnabled,
  });
  const inviteH5StatsQuery = useQuery({
    queryKey: ['invite-h5-stats'],
    queryFn: () => InviteH5Repo.getStats(),
    enabled: isLoggedIn,
  });

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || !isLoggedIn) return;
      queryClient.invalidateQueries({ queryKey: ['bonus-member'] });
      queryClient.invalidateQueries({ queryKey: ['normal-share-records'] });
      queryClient.invalidateQueries({ queryKey: ['normal-share-stats'] });
      queryClient.invalidateQueries({ queryKey: ['vip-referral-records'] });
      queryClient.invalidateQueries({ queryKey: ['invite-h5-stats'] });
    });
    return () => subscription.remove();
  }, [isLoggedIn, queryClient]);

  const bindMutation = useMutation({
    mutationFn: (code: string) => GrowthRepo.bindNormalShareCode(code),
    onSuccess: async (result) => {
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '绑定失败', type: 'error' });
        return;
      }
      setBindCode('');
      show({ message: '推荐关系已绑定', type: 'success' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bonus-member'] }),
        queryClient.invalidateQueries({ queryKey: ['growth-me'] }),
        queryClient.invalidateQueries({ queryKey: ['normal-share-records'] }),
        queryClient.invalidateQueries({ queryKey: ['normal-share-stats'] }),
      ]);
    },
  });

  const shareProfile = shareQuery.data?.ok ? shareQuery.data.data : null;
  const normalStats = statsQuery.data?.ok ? statsQuery.data.data : null;
  const inviteH5Stats = inviteH5StatsQuery.data?.ok ? inviteH5StatsQuery.data.data : null;
  const inviteH5StatsError = inviteH5StatsQuery.data && !inviteH5StatsQuery.data.ok
    ? (inviteH5StatsQuery.data.error.displayMessage ?? 'H5 邀请数据加载失败')
    : null;
  const normalRecords = normalRecordsQuery.data?.ok ? normalRecordsQuery.data.data : [];
  const vipRecords = vipRecordsQuery.data?.ok ? vipRecordsQuery.data.data : [];
  const referralCode = isVip ? (member?.referralCode ?? '') : '';
  const vipInviteUrl = referralCode ? buildInviteH5Url(referralCode) : '';
  const normalInviteUrl = shareProfile?.code ? buildInviteH5Url(shareProfile.code) : '';
  const shareProfileError = shareQuery.data && !shareQuery.data.ok
    ? (shareQuery.data.error.displayMessage ?? '普通分享码加载失败，请下拉刷新')
    : null;
  const shareActive = !shareProfileError && shareProfile?.status === 'ACTIVE';
  const hasInviter = hasBoundReferralInviter(member);
  const canBindReferrer = !isVip && !hasInviter;
  const inviterLabel = getReferralInviterLabel(member);
  const autoVipRemaining = member?.autoVipRemainingSpend ?? null;
  const autoVipThreshold = member?.autoVipCumulativeSpendThreshold ?? null;
  const autoVipProgress = useMemo(() => {
    if (typeof autoVipThreshold !== 'number' || typeof autoVipRemaining !== 'number') return 0;
    if (autoVipThreshold <= 0) return 100;
    const ratio = (autoVipThreshold - autoVipRemaining) / autoVipThreshold;
    return Math.min(100, Math.max(0, Math.round(ratio * 100)));
  }, [autoVipRemaining, autoVipThreshold]);
  const recentNormalRecords = normalRecords.slice(0, 5);
  const recentVipRecords = vipRecords.slice(0, 5);
  const recentCount = isVip ? recentVipRecords.length : recentNormalRecords.length;
  const inviteeVipCount = member?.inviteeVipCount ?? 0;
  const formatH5StatValue = (value?: number | null) => inviteH5StatsError ? '--' : String(value ?? 0);

  const loading =
    memberQuery.isLoading ||
    (normalShareEnabled && (shareQuery.isLoading || statsQuery.isLoading || normalRecordsQuery.isLoading)) ||
    (vipReferralEnabled && vipRecordsQuery.isLoading);
  const refreshing =
    memberQuery.isFetching ||
    shareQuery.isFetching ||
    statsQuery.isFetching ||
    normalRecordsQuery.isFetching ||
    vipRecordsQuery.isFetching ||
    inviteH5StatsQuery.isFetching;

  const refresh = async () => {
    const tasks: Array<Promise<unknown>> = [memberQuery.refetch()];
    if (normalShareEnabled) {
      tasks.push(shareQuery.refetch(), statsQuery.refetch(), normalRecordsQuery.refetch());
    }
    if (vipReferralEnabled) {
      tasks.push(vipRecordsQuery.refetch());
    }
    tasks.push(inviteH5StatsQuery.refetch());
    await Promise.all(tasks);
  };

  const handleCopyNormalCode = async () => {
    if (!shareActive || !shareProfile?.code) {
      show({ message: shareProfileError ?? '普通分享码暂不可用', type: 'info' });
      return;
    }
    await Clipboard.setStringAsync(shareProfile.code);
    show({ message: '普通分享码已复制', type: 'success' });
  };

  const handleShareNormal = async () => {
    if (!shareActive || !shareProfile?.code || !normalInviteUrl) {
      show({ message: shareProfileError ?? '普通分享码暂不可用', type: 'info' });
      return;
    }
    try {
      const result = await Share.share({
        message: `我在爱买买发现了优质农产品，用我的普通分享码 ${shareProfile.code} 注册登录：${normalInviteUrl}`,
      });
      if (result.action === Share.sharedAction) {
        CouponRepo.reportShareEvent({ scene: 'NORMAL_SHARE', targetId: shareProfile.code }).catch(() => {});
      }
    } catch {
      // 用户取消分享，不需要提示。
    }
  };

  const handleCopyVipCode = async () => {
    if (!referralCode) {
      show({ message: '暂无可复制的 VIP 推荐码', type: 'info' });
      return;
    }
    await Clipboard.setStringAsync(referralCode);
    show({ message: 'VIP 推荐码已复制', type: 'success' });
  };

  const handleShareVip = async () => {
    if (!referralCode) {
      show({ message: '暂无可分享的 VIP 推荐码', type: 'info' });
      return;
    }
    try {
      const result = await Share.share({
        message: `我在爱买买发现了优质农产品，使用我的 VIP 推荐码 ${referralCode} 注册：${vipInviteUrl}`,
      });
      if (result.action === Share.sharedAction) {
        CouponRepo.reportShareEvent({ scene: 'REFERRAL', targetId: referralCode }).catch(() => {});
      }
    } catch {
      // 用户取消分享，不需要提示。
    }
  };

  const handleBind = () => {
    const normalized = bindCode.trim().toUpperCase();
    if (!normalized) {
      show({ message: '请输入分享码', type: 'info' });
      return;
    }
    bindMutation.mutate(normalized);
  };

  if (!isLoggedIn) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="推荐中心" />
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl }}>
          <EmptyState title="登录后查看推荐中心" description="登录后可以查看自己的推荐码、推荐人和被推荐用户" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="推荐中心"
        rightSlot={canBindReferrer ? (
          <Pressable onPress={() => router.push('/me/scanner')} hitSlop={10}>
            <MaterialCommunityIcons name="qrcode-scan" size={22} color={colors.text.primary} />
          </Pressable>
        ) : undefined}
      />

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] + bottomPadding }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <>
            <Skeleton height={280} radius={radius.xl} />
            <View style={{ height: spacing.lg }} />
            <Skeleton height={150} radius={radius.lg} />
          </>
        ) : memberQuery.data && !memberQuery.data.ok ? (
          <ErrorState
            title="推荐中心加载失败"
            description={memberQuery.data.error.displayMessage ?? '请稍后重试'}
            onAction={memberQuery.refetch}
          />
        ) : (
          <>
            <Animated.View entering={FadeInDown.duration(300)}>
              {isVip ? (
                <LinearGradient
                  colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.heroCard, { borderRadius: radius.xl }, shadow.lg]}
                >
                  <View style={styles.heroTopRow}>
                    <View style={styles.heroCodeInfo}>
                      <Text style={[typography.caption, { color: 'rgba(255,255,255,0.75)' }]}>VIP 推荐码</Text>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.68}
                        style={[styles.codeText, { color: '#FFFFFF' }]}
                      >
                        {referralCode ? referralCode.split('').join(' ') : '暂无推荐码'}
                      </Text>
                    </View>
                      <View style={[styles.qrBox, { backgroundColor: '#FFFFFF', borderColor: 'rgba(255,255,255,0.35)', borderRadius: radius.lg }]}>
                      {vipInviteUrl ? (
                        <QRCode value={vipInviteUrl} size={116} color={colors.brand.primaryDark} backgroundColor="#FFFFFF" />
                      ) : (
                        <MaterialCommunityIcons name="qrcode-remove" size={44} color={colors.muted} />
                      )}
                    </View>
                  </View>
                  <View style={styles.actionRow}>
                    <Pressable onPress={handleCopyVipCode} style={[styles.ghostButton, { borderRadius: radius.pill }]}>
                      <MaterialCommunityIcons name="content-copy" size={15} color="#FFFFFF" />
                      <Text style={[typography.caption, { color: '#FFFFFF', marginLeft: 4 }]}>复制</Text>
                    </Pressable>
                    <Pressable onPress={handleShareVip} style={[styles.goldButton, { borderRadius: radius.pill }]}>
                      <MaterialCommunityIcons name="share-variant-outline" size={15} color="#FFFFFF" />
                      <Text {...compactActionTextProps} style={[typography.caption, { color: '#FFFFFF', marginLeft: 4 }]}>分享</Text>
                    </Pressable>
                  </View>
                  <Text style={[typography.caption, { color: 'rgba(255,255,255,0.82)', marginTop: spacing.md }]}>
                    已推荐 {inviteeVipCount} 位 VIP。好友成为 VIP 后进入你的 VIP 团队。
                  </Text>
                </LinearGradient>
              ) : (
                <View style={[styles.heroCard, { backgroundColor: colors.surface, borderRadius: radius.xl }, shadow.sm]}>
                  <View style={styles.heroTopRow}>
                    <View style={styles.heroCodeInfo}>
                      <Text style={[typography.caption, { color: colors.text.secondary }]}>普通分享码</Text>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.68}
                        style={[styles.codeText, { color: colors.text.primary }]}
                      >
                        {shareProfileError ? '加载失败' : (shareProfile?.code ?? '生成中')}
                      </Text>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                        {shareProfileError ?? '好友注册后立即记录普通推荐关系，后续首单和订单奖励按后台规则发放。'}
                      </Text>
                    </View>
                    <View style={[styles.qrBox, { backgroundColor: '#FFFFFF', borderColor: colors.border, borderRadius: radius.lg }]}>
                      {shareActive && normalInviteUrl ? (
                        <QRCode value={normalInviteUrl} size={116} color={colors.brand.primaryDark} backgroundColor="#FFFFFF" />
                      ) : (
                        <MaterialCommunityIcons name="qrcode-remove" size={44} color={colors.muted} />
                      )}
                    </View>
                  </View>
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={handleCopyNormalCode}
                      disabled={!shareActive}
                      style={[styles.secondaryButton, { borderColor: colors.border, borderRadius: radius.pill, opacity: shareActive ? 1 : 0.5 }]}
                    >
                      <MaterialCommunityIcons name="content-copy" size={15} color={colors.text.primary} />
                      <Text style={[typography.caption, { color: colors.text.primary, marginLeft: 4 }]}>复制</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleShareNormal}
                      disabled={!shareActive}
                      style={[styles.primaryButton, { backgroundColor: shareActive ? colors.brand.primary : colors.border, borderRadius: radius.pill }]}
                    >
                      <MaterialCommunityIcons name="share-variant-outline" size={15} color="#FFFFFF" />
                      <Text {...compactActionTextProps} style={[typography.caption, { color: '#FFFFFF', marginLeft: 4 }]}>分享</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(300).delay(60)}
              style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <View style={styles.sectionTitleRow}>
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>H5 邀请数据</Text>
                <Tag label="扫码页" tone="accent" />
              </View>
              <View style={[styles.h5StatsRow, { marginTop: spacing.md }]}>
                <View style={styles.statCell}>
                  <Text style={[typography.captionSm, { color: colors.text.secondary }]}>扫码打开</Text>
                  <Text style={[typography.title3, { color: colors.text.primary }]}>{formatH5StatValue(inviteH5Stats?.openCount)}</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={[typography.captionSm, { color: colors.text.secondary }]}>已登录</Text>
                  <Text style={[typography.title3, { color: colors.brand.primary }]}>{formatH5StatValue(inviteH5Stats?.authedCount)}</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={[typography.captionSm, { color: colors.text.secondary }]}>已绑定</Text>
                  <Text style={[typography.title3, { color: colors.success }]}>{formatH5StatValue(inviteH5Stats?.boundCount)}</Text>
                </View>
              </View>
              {inviteH5StatsError ? (
                <Text style={[typography.captionSm, { color: colors.danger, marginTop: spacing.sm }]}>
                  {inviteH5StatsError}
                </Text>
              ) : null}
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(300).delay(80)}
              style={[styles.statsCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              {isVip ? (
                <>
                  <View style={styles.statCell}>
                    <Text style={[typography.captionSm, { color: colors.text.secondary }]}>已推荐 VIP</Text>
                    <Text style={[typography.title3, { color: colors.text.primary }]}>{inviteeVipCount}</Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={[typography.captionSm, { color: colors.text.secondary }]}>直推用户</Text>
                    <Text style={[typography.title3, { color: colors.text.primary }]}>{vipRecords.length}</Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.statCell}>
                    <Text style={[typography.captionSm, { color: colors.text.secondary }]}>已邀请</Text>
                    <Text style={[typography.title3, { color: colors.text.primary }]}>{normalStats?.totalInvitees ?? 0}</Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={[typography.captionSm, { color: colors.text.secondary }]}>已奖励</Text>
                    <Text style={[typography.title3, { color: colors.success }]}>{normalStats?.rewardedInvitees ?? 0}</Text>
                  </View>
                </>
              )}
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(300).delay(110)}
              style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <View style={styles.sectionTitleRow}>
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>我的推荐人</Text>
                <Tag label={hasInviter ? '已绑定' : '未绑定'} tone={hasInviter ? 'brand' : 'neutral'} />
              </View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                {hasInviter
                  ? `${inviterLabel ?? '已绑定用户'} 是你的推荐人，推荐关系一旦绑定后不能自行更换。`
                  : isVip
                    ? '你当前没有有效推荐人。成为 VIP 后推荐关系不能自行补绑或更换。'
                    : '你还没有绑定推荐人。可以扫描好友推荐码，或输入好友普通分享码完成绑定。'}
              </Text>
              {canBindReferrer ? (
                <View style={[styles.bindRow, { marginTop: spacing.md }]}>
                  <TextInput
                    value={bindCode}
                    onChangeText={(value) => setBindCode(value.toUpperCase())}
                    autoCapitalize="characters"
                    placeholder="输入好友分享码"
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
                    <Text style={[typography.bodySm, { color: '#FFFFFF' }]}>{bindMutation.isPending ? '绑定中' : '绑定'}</Text>
                  </Pressable>
                </View>
              ) : null}
            </Animated.View>

            {!isVip && member?.autoVipBySpendEnabled && typeof autoVipThreshold === 'number' ? (
              <Animated.View
                entering={FadeInDown.duration(300).delay(130)}
                style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
              >
                <View style={styles.sectionTitleRow}>
                  <Text style={[typography.headingSm, { color: colors.text.primary }]}>自动成为 VIP</Text>
                  <Tag label={`${autoVipProgress}%`} tone={autoVipRemaining === 0 ? 'brand' : 'accent'} />
                </View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                  累计有效消费满 {formatCurrency(autoVipThreshold)} 后自动升级为 VIP。升级时如果推荐人已经是 VIP，会进入推荐人的 VIP 团队；如果推荐人仍是普通用户，普通推荐关系会结束。
                </Text>
                <View style={[styles.progressTrack, { backgroundColor: colors.border, marginTop: spacing.md }]}>
                  <View style={[styles.progressFill, { width: `${autoVipProgress}%`, backgroundColor: colors.brand.primary }]} />
                </View>
                <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                  {typeof autoVipRemaining === 'number' && autoVipRemaining <= 0
                    ? '已达到自动升级门槛，确认收货入账后会自动处理。'
                    : `还差 ${formatCurrency(autoVipRemaining ?? autoVipThreshold)}。你也可以继续按原流程购买 VIP。`}
                </Text>
              </Animated.View>
            ) : null}

            <Animated.View
              entering={FadeInDown.duration(300).delay(150)}
              style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <View style={styles.sectionTitleRow}>
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>推荐奖励</Text>
                <Tag label={isVip ? 'VIP 推荐' : '普通推荐'} tone="accent" />
              </View>
              <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                商品订单奖励会先冻结，确认收货且售后期结束后释放。
              </Text>
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(300).delay(180)}
              style={[styles.sectionCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <View style={styles.sectionTitleRow}>
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>最近推荐用户</Text>
                <Pressable onPress={() => router.push('/me/referral-users')} hitSlop={8}>
                  <Text {...compactActionTextProps} style={[typography.caption, { color: colors.brand.primary }]}>
                    查看全部推荐用户
                  </Text>
                </Pressable>
              </View>
              {recentCount === 0 ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.md }]}>
                  暂无推荐用户
                </Text>
              ) : (
                <View style={{ marginTop: spacing.sm }}>
                  {isVip
                    ? recentVipRecords.map((record) => (
                        <View key={record.id} style={[styles.recordRow, { borderBottomColor: colors.border }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={[typography.bodySm, { color: colors.text.primary }]}>{getVipRecordName(record)}</Text>
                            <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 2 }]}>
                              {record.tier === 'VIP' ? '已成为 VIP' : '普通用户'} · {formatDate(record.vipPurchasedAt ?? record.boundAt)}
                            </Text>
                          </View>
                          <Tag label="VIP 推荐" tone={record.tier === 'VIP' ? 'brand' : 'neutral'} />
                        </View>
                      ))
                    : recentNormalRecords.map((record) => (
                        <View key={record.id} style={[styles.recordRow, { borderBottomColor: colors.border }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={[typography.bodySm, { color: colors.text.primary }]}>{getNormalRecordName(record)}</Text>
                            <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 2 }]}>
                              {(record.relationStatus && relationStatusLabels[record.relationStatus]) || '关系有效'} · {formatDate(record.boundAt)}
                            </Text>
                          </View>
                          <Tag label={rewardStatusLabels[record.rewardStatus]} tone={record.rewardStatus === 'ISSUED' ? 'brand' : 'accent'} />
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
    padding: 20,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  heroCodeInfo: {
    flex: 1,
    minWidth: 0,
  },
  qrBox: {
    width: 136,
    height: 136,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  codeText: {
    fontFamily: monoFamily,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  ghostButton: {
    minHeight: 42,
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  goldButton: {
    minHeight: 42,
    flex: 1,
    backgroundColor: '#D4A017',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryButton: {
    minHeight: 42,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  secondaryButton: {
    minHeight: 42,
    flex: 1,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  statsCard: {
    flexDirection: 'row',
    padding: 16,
  },
  h5StatsRow: {
    flexDirection: 'row',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  bindRow: {
    flexDirection: 'row',
    gap: 10,
  },
  bindInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  bindButton: {
    minHeight: 44,
    minWidth: 74,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
  },
  recordRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
});
