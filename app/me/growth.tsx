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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AiDivider, Tag } from '../../src/components/ui';
import { CouponRepo, GrowthRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { compactActionTextProps, useBottomInset, useTheme } from '../../src/theme';
import type { GrowthExchangeItem, NormalShareRecord } from '../../src/types';

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

export default function GrowthCenterScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const bottomInset = useBottomInset(0);
  const [bindCode, setBindCode] = useState('');

  const growthQuery = useQuery({
    queryKey: ['growth-me'],
    queryFn: () => GrowthRepo.getMe(),
    enabled: isLoggedIn,
  });
  const shareQuery = useQuery({
    queryKey: ['normal-share-me'],
    queryFn: () => GrowthRepo.getNormalShareMe(),
    enabled: isLoggedIn,
  });
  const statsQuery = useQuery({
    queryKey: ['normal-share-stats'],
    queryFn: () => GrowthRepo.getNormalShareStats(),
    enabled: isLoggedIn,
  });
  const recordsQuery = useQuery({
    queryKey: ['normal-share-records'],
    queryFn: () => GrowthRepo.getNormalShareRecords(),
    enabled: isLoggedIn,
  });
  const exchangeItemsQuery = useQuery({
    queryKey: ['growth-exchange-items'],
    queryFn: () => GrowthRepo.getExchangeItems(),
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
  const isLoading = growthQuery.isLoading || shareQuery.isLoading;
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
      : '好友注册后绑定关系，首单确认收货后按后台规则发放成长奖励');

  const nextLevelText = useMemo(() => {
    if (!growth?.nextLevel) return '已达最高等级';
    const required = growth.levelProgress.required ?? growth.nextLevel.threshold;
    const current = growth.levelProgress.current ?? 0;
    return `距离 ${growth.nextLevel.name} 还差 ${Math.max(0, required - current)} 成长值`;
  }, [growth]);

  const refresh = async () => {
    await Promise.all([
      growthQuery.refetch(),
      shareQuery.refetch(),
      statsQuery.refetch(),
      recordsQuery.refetch(),
      exchangeItemsQuery.refetch(),
    ]);
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
        <AppHeader title="普通成长" />
        <View style={{ flex: 1, padding: spacing.xl, justifyContent: 'center' }}>
          <EmptyState title="登录后查看成长权益" description="普通积分、成长值和分享码会在登录后自动生成" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="普通成长" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] + bottomInset }}
        refreshControl={<RefreshControl refreshing={growthQuery.isFetching || shareQuery.isFetching} onRefresh={refresh} />}
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
                      {growth?.level?.name ?? '普通会员'}
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
                    <Text style={[typography.captionSm, { color: 'rgba(255,255,255,0.75)' }]}>普通积分</Text>
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
              entering={FadeInDown.duration(300).delay(80)}
              style={[styles.shareCard, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }, shadow.sm]}
            >
              <View style={styles.sectionTitleRow}>
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>普通分享码</Text>
                <Tag label={shareStatusLabel} tone={canUseShareCode ? 'brand' : 'neutral'} />
              </View>
              <AiDivider style={{ marginVertical: spacing.sm }} />

              <View style={styles.shareBody}>
                <View style={[styles.qrBox, { borderRadius: radius.lg, borderColor: colors.border }]}>
                  {canUseShareCode ? (
                    <QRCode value={shareUrl} size={112} color={colors.brand.primaryDark} backgroundColor="#FFFFFF" />
                  ) : (
                    <MaterialCommunityIcons name={shareProfileError ? 'wifi-off' : 'link-off'} size={48} color={colors.muted} />
                  )}
                </View>
                <View style={styles.shareInfo}>
                  <Text style={[styles.shareCodeText, { color: colors.text.primary }]}>
                    {shareProfile?.code ?? (shareProfileError ? '加载失败' : '生成中')}
                  </Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                    {shareHelpText}
                  </Text>
                  <View style={styles.shareActions}>
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

            <Animated.View
              entering={FadeInDown.duration(300).delay(160)}
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

            <Animated.View
              entering={FadeInDown.duration(300).delay(200)}
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
  shareBody: {
    flexDirection: 'row',
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
});
