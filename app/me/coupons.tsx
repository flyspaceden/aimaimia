import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, Skeleton, useToast } from '../../src/components/feedback';
import { CouponRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { priceTextProps, useBottomInset, useTheme } from '../../src/theme';
import type {
  AvailableCampaignDto,
  CouponCenterDisplayStatus,
  CouponCenterView,
  CouponInstanceStatus,
  MyCouponDto,
} from '../../src/types/domain/Coupon';

// ==================== 类型与常量 ====================

type MainTab = 'mine' | 'center';
type SubTabKey = 'all' | 'available' | 'used' | 'expired';
type CenterTabKey = CouponCenterView;

const MAIN_TABS: Array<{ key: MainTab; label: string }> = [
  { key: 'mine', label: '我的福利' },
  { key: 'center', label: '领券中心' },
];

const SUB_TABS: Array<{ key: SubTabKey; label: string; status?: CouponInstanceStatus }> = [
  { key: 'all', label: '全部' },
  { key: 'available', label: '可用', status: 'AVAILABLE' },
  { key: 'used', label: '已使用', status: 'USED' },
  { key: 'expired', label: '已失效', status: 'EXPIRED' },
];

const CENTER_TABS: Array<{ key: CenterTabKey; label: string }> = [
  { key: 'claimable', label: '可领取' },
  { key: 'claimed', label: '已领取' },
  { key: 'active', label: '进行中' },
];

const CENTER_EMPTY_STATE: Record<CenterTabKey, { title: string; description: string }> = {
  claimable: { title: '暂无可领取福利', description: '已领取或已领完的活动可在其他分类查看' },
  claimed: { title: '暂无已领取福利', description: '领取后的活动记录会显示在这里' },
  active: { title: '暂无进行中活动', description: '请稍后再来查看活动' },
};

const KNOWN_CLAIM_STATE_FAILURES = [
  '红包已领完',
  '活动不在有效期内',
  '该活动当前不可领取',
  '每人限领',
  '您已领取',
  '领取上限',
  '领取冲突，请重试',
  '已达活动领取上限',
  '红包活动不存在',
  '该活动不支持用户自行领取',
  '活动已结束',
  '活动已暂停',
];

// ==================== 工具函数 ====================

/** 格式化我的福利折扣 */
const formatDiscount = (item: MyCouponDto): string => {
  if (item.discountType === 'FIXED') {
    return `¥${item.discountValue.toFixed(item.discountValue % 1 === 0 ? 0 : 2)}`;
  }
  return `${((100 - item.discountValue) / 10).toFixed(1).replace('.0', '')}折`;
};

/** 格式化领券中心活动折扣 */
const formatCampaignDiscount = (campaign: AvailableCampaignDto): string => {
  if (campaign.discountType === 'FIXED') {
    return `¥${campaign.discountValue.toFixed(campaign.discountValue % 1 === 0 ? 0 : 2)}`;
  }
  return `${((100 - campaign.discountValue) / 10).toFixed(1).replace('.0', '')}折`;
};

const isKnownClaimStateFailure = (message?: string): boolean => (
  !!message && KNOWN_CLAIM_STATE_FAILURES.some((pattern) => message.includes(pattern))
);

const normalizeBenefitDisplayMessage = (message: string): string => (
  message.replace(/红包/g, '福利')
);

const formatClaimedSummary = (campaign: { claimedSummary?: {
  total: number;
  available: number;
  used: number;
  expired: number;
  reserved: number;
  revoked: number;
  nearestExpiresAt: string | null;
} }): string | null => {
  const summary = campaign.claimedSummary;
  if (!summary || summary.total <= 0) return null;
  const parts = [
    `已领 ${summary.total} 张`,
    `可用 ${summary.available} 张`,
    `已用 ${summary.used} 张`,
    `已过期 ${summary.expired} 张`,
  ];
  if (summary.reserved > 0) parts.push(`锁定 ${summary.reserved} 张`);
  if (summary.revoked > 0) parts.push(`已撤回 ${summary.revoked} 张`);
  if (summary.nearestExpiresAt) {
    parts.push(`最近 ${new Date(summary.nearestExpiresAt).toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
    })} 过期`);
  }
  return parts.join(' · ');
};

const getCampaignStatusColor = (
  status: CouponCenterDisplayStatus,
  colors: any,
) => {
  if (status === 'CLAIMABLE') return colors.brand.primary;
  if (status === 'CLAIMED') return colors.success;
  if (status === 'SOLD_OUT') return colors.warning;
  if (status === 'NOT_ELIGIBLE') return colors.text.secondary;
  return colors.muted;
};

// ==================== 我的福利卡片 ====================

const CouponCard = React.memo(function CouponCard({
  item,
  colors,
  radius,
  shadow,
  spacing,
  typography,
}: {
  item: MyCouponDto;
  colors: any;
  radius: any;
  shadow: any;
  spacing: any;
  typography: any;
}) {
  const isAvailable = item.status === 'AVAILABLE';

  const statusTextMap: Record<string, string> = {
    AVAILABLE: '可用',
    USED: '已使用',
    EXPIRED: '已过期',
    RESERVED: '锁定中',
    REVOKED: '已撤回',
  };
  const statusText = statusTextMap[item.status] ?? `未知状态(${item.status})`;

  return (
    <View
      style={[
        styles.card,
        shadow.sm,
        {
          backgroundColor: isAvailable ? colors.surface : colors.bgSecondary,
          borderRadius: radius.lg,
          opacity: isAvailable ? 1 : 0.65,
        },
      ]}
    >
      <LinearGradient
        colors={isAvailable ? [colors.danger, '#E57373'] : [colors.muted, colors.border]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.amountSection, { borderRadius: radius.md }]}
      >
        <Text {...priceTextProps} style={styles.amountValue}>{formatDiscount(item)}</Text>
        <Text style={styles.amountThreshold}>
          {item.minOrderAmount > 0 ? `满¥${item.minOrderAmount}可用` : '无门槛'}
        </Text>
      </LinearGradient>

      <View style={[styles.infoSection, { paddingHorizontal: spacing.md }]}>
        <View style={styles.infoHeader}>
          <Text
            style={[
              typography.bodyStrong,
              { color: isAvailable ? colors.text.primary : colors.muted, flex: 1 },
            ]}
            numberOfLines={1}
          >
            {item.campaignName}
          </Text>
          <View
            style={[
              styles.statusTag,
              {
                backgroundColor: isAvailable ? `${colors.success}22` : `${colors.muted}22`,
              },
            ]}
          >
            <Text
              style={[
                typography.captionSm,
                { color: isAvailable ? colors.success : colors.muted },
              ]}
            >
              {statusText}
            </Text>
          </View>
        </View>

        {item.discountType === 'PERCENT' && item.maxDiscountAmount !== null && (
          <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}>
            最高减¥{item.maxDiscountAmount}
          </Text>
        )}

        <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}>
          过期时间：{new Date(item.expiresAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}
        </Text>

        {item.status === 'USED' && item.usedOrderId && (
          <Text style={[typography.captionSm, { color: colors.text.tertiary, marginTop: 4 }]}>
            已用于订单 {item.usedOrderId}
          </Text>
        )}
      </View>
    </View>
  );
});

// ==================== 主页面 ====================

export default function MyCouponsScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const routeParams = useLocalSearchParams<{ tab?: string }>();
  const lastClaimableReadKeyRef = useRef('');
  // R-RS07: FlatList paddingBottom 吃系统 safe-area，避免底部内容贴边。
  const safeBottom = useBottomInset(spacing.xl);

  // 主 Tab 状态：我的福利 / 领券中心
  const [mainTab, setMainTab] = useState<MainTab>(routeParams.tab === 'center' ? 'center' : 'mine');
  // 子 Tab 状态（仅用于「我的福利」）
  const [subTab, setSubTab] = useState<SubTabKey>('all');
  // 领券中心内层 Tab
  const [centerTab, setCenterTab] = useState<CenterTabKey>('claimable');

  // ==================== 我的福利数据 ====================
  const subStatus = SUB_TABS.find((tab) => tab.key === subTab)?.status;
  const { data: myData, isLoading: myLoading } = useQuery({
    queryKey: ['my-coupons', subTab],
    queryFn: () => CouponRepo.getMyCoupons(subStatus),
    enabled: isLoggedIn && mainTab === 'mine',
  });

  const coupons = myData?.ok ? myData.data : [];
  const availableCount = useMemo(
    () => coupons.filter((item) => item.status === 'AVAILABLE').length,
    [coupons],
  );

  const { data: claimableAlertData } = useQuery({
    queryKey: ['coupon-claimable-alert'],
    queryFn: () => CouponRepo.getClaimableAlert(),
    enabled: isLoggedIn,
  });
  const claimableBadgeCount = claimableAlertData?.ok ? claimableAlertData.data.count : 0;
  const claimableCampaignKey = claimableAlertData?.ok ? claimableAlertData.data.campaignIds.join(',') : '';
  const badgeText = claimableBadgeCount > 99 ? '99+' : String(claimableBadgeCount);

  const markClaimableAlertMutation = useMutation({
    mutationFn: async (_campaignKey: string) => {
      const result = await CouponRepo.markClaimableAlertRead();
      if (!result.ok) {
        throw new Error(result.error.displayMessage ?? '标记领券中心已读失败');
      }
      return result.data;
    },
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coupon-claimable-alert'] });
      queryClient.invalidateQueries({ queryKey: ['me-inbox-unread'] });
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
  });

  useEffect(() => {
    if (routeParams.tab === 'center') {
      setMainTab('center');
    }
  }, [routeParams.tab]);

  useEffect(() => {
    if (mainTab !== 'center') {
      lastClaimableReadKeyRef.current = '';
    }
  }, [mainTab]);

  useEffect(() => {
    if (
      mainTab !== 'center'
      || claimableBadgeCount === 0
      || !claimableCampaignKey
      || markClaimableAlertMutation.isPending
      || lastClaimableReadKeyRef.current === claimableCampaignKey
    ) {
      return;
    }
    lastClaimableReadKeyRef.current = claimableCampaignKey;
    markClaimableAlertMutation.mutate(claimableCampaignKey);
  }, [mainTab, claimableBadgeCount, claimableCampaignKey, markClaimableAlertMutation]);

  // ==================== 领券中心数据 ====================
  const {
    data: centerData,
    isLoading: centerLoading,
    refetch: centerRefetch,
    isRefetching: centerRefetching,
  } = useQuery({
    queryKey: ['coupon-center-campaigns', centerTab],
    queryFn: () => CouponRepo.getCouponCenterCampaigns(centerTab),
    enabled: mainTab === 'center',
  });

  const campaigns = centerData?.ok ? centerData.data : [];
  const centerEmpty = CENTER_EMPTY_STATE[centerTab];

  const refreshCouponCenterQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['coupon-center-campaigns'] });
    queryClient.invalidateQueries({ queryKey: ['coupon-claimable-alert'] });
    queryClient.invalidateQueries({ queryKey: ['my-coupons'] });
    queryClient.invalidateQueries({ queryKey: ['checkout-eligible-coupons'] });
  };

  const claimMutation = useMutation({
    mutationFn: (campaignId: string) => CouponRepo.claimCoupon(campaignId),
    onSuccess: (result) => {
      if (!result.ok) {
        const rawMessage = result.error.code === 'NETWORK'
          ? '领取失败，请稍后重试'
          : result.error.displayMessage ?? '领取失败，请稍后重试';
        const message = normalizeBenefitDisplayMessage(rawMessage);
        show({ message, type: 'error' });
        if (isKnownClaimStateFailure(rawMessage)) {
          refreshCouponCenterQueries();
        }
        return;
      }
      show({ message: '领取成功，已放入我的福利', type: 'success' });
      refreshCouponCenterQueries();
    },
    onError: () => {
      show({ message: '领取失败，请稍后重试', type: 'error' });
    },
  });

  // ==================== 渲染 ====================

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="我的福利" />

      {/* ===== 主 Tab 切换（胶囊按钮） ===== */}
      <View
        style={[
          styles.mainTabs,
          { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surface },
        ]}
      >
        {MAIN_TABS.map((tab) => {
          const active = tab.key === mainTab;
          const showClaimableBadge = tab.key === 'center' && claimableBadgeCount > 0;
          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                if (tab.key === 'center') {
                  setMainTab('center');
                  return;
                }
                setMainTab(tab.key);
              }}
              style={[
                styles.mainTabBtn,
                {
                  backgroundColor: active ? colors.brand.primary : colors.bgSecondary,
                  borderRadius: radius.pill,
                },
              ]}
            >
              <View style={styles.mainTabContent}>
                <Text
                  style={[
                    typography.body,
                    {
                      color: active ? '#FFFFFF' : colors.text.secondary,
                      fontWeight: active ? '600' : '400',
                    },
                  ]}
                >
                  {tab.label}
                </Text>
                {showClaimableBadge ? (
                  <View style={[styles.badge, { backgroundColor: colors.danger }]}>
                    <Text style={styles.badgeText}>{badgeText}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* ===== 我的福利视图 ===== */}
      {mainTab === 'mine' && (
        <>
          {/* 可用数量概览 */}
          <View
            style={[
              styles.summary,
              { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, backgroundColor: colors.surface },
            ]}
          >
            <MaterialCommunityIcons name="ticket-percent-outline" size={18} color={colors.brand.primary} />
            <Text style={[typography.bodySm, { color: colors.text.primary, marginLeft: spacing.sm }]}>
              当前可用 <Text style={{ color: colors.danger, fontWeight: '600' }}>{availableCount}</Text> 项福利
            </Text>
          </View>

          {/* 子 Tab（全部/可用/已使用/已失效） */}
          <View style={[styles.subTabs, { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }]}>
            {SUB_TABS.map((tab) => {
              const active = tab.key === subTab;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => setSubTab(tab.key)}
                  style={[
                    styles.subTabBtn,
                    {
                      backgroundColor: active ? colors.brand.primarySoft : colors.surface,
                      borderColor: active ? colors.brand.primary : colors.border,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Text
                    style={[
                      typography.captionSm,
                      { color: active ? colors.brand.primary : colors.text.secondary },
                    ]}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* 福利列表 */}
          {myLoading ? (
            <View style={{ paddingHorizontal: spacing.lg }}>
              <Skeleton height={96} radius={radius.lg} />
              <View style={{ height: spacing.md }} />
              <Skeleton height={96} radius={radius.lg} />
            </View>
          ) : coupons.length === 0 ? (
            <EmptyState
              title="暂无福利"
              description="去领券中心领取可用福利"
              actionLabel="去领券中心"
              onAction={() => setMainTab('center')}
            />
          ) : (
            <FlatList
              data={coupons}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: safeBottom }}
              renderItem={({ item, index }) => (
                <Animated.View entering={FadeInDown.duration(240).delay(index * 30)}>
                  <CouponCard
                    item={item}
                    colors={colors}
                    radius={radius}
                    shadow={shadow}
                    spacing={spacing}
                    typography={typography}
                  />
                </Animated.View>
              )}
            />
          )}
        </>
      )}

      {/* ===== 领券中心视图 ===== */}
      {mainTab === 'center' && (
        <>
          <View style={[styles.centerTabs, { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }]}>
            {CENTER_TABS.map((tab) => {
              const active = tab.key === centerTab;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => setCenterTab(tab.key)}
                  style={[
                    styles.centerTabBtn,
                    {
                      backgroundColor: active ? colors.brand.primarySoft : colors.surface,
                      borderColor: active ? colors.brand.primary : colors.border,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Text
                    style={[
                      typography.captionSm,
                      { color: active ? colors.brand.primary : colors.text.secondary },
                    ]}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {centerLoading ? (
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
              <Skeleton height={120} radius={radius.lg} />
              <View style={{ height: spacing.md }} />
              <Skeleton height={120} radius={radius.lg} />
            </View>
          ) : campaigns.length === 0 ? (
            <EmptyState title={centerEmpty.title} description={centerEmpty.description} />
          ) : (
            <FlatList
              data={campaigns}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: safeBottom }}
              refreshing={centerRefetching}
              onRefresh={centerRefetch}
              renderItem={({ item, index }) => {
                const actionText = item.displayStatus === 'CLAIMABLE' ? '立即领取' : item.statusLabel;
                const disabled = !item.canClaim || centerTab === 'claimed' || claimMutation.isPending;
                const statusColor = getCampaignStatusColor(item.displayStatus, colors);
                const claimedSummaryText = formatClaimedSummary(item);

                return (
                  <Animated.View entering={FadeInDown.duration(240).delay(index * 30)}>
                    <View
                      style={[
                        styles.card,
                        shadow.sm,
                        { backgroundColor: colors.surface, borderRadius: radius.lg },
                      ]}
                    >
                      <LinearGradient
                        colors={[colors.danger, '#E57373']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={[styles.campaignAmountSection, { borderRadius: radius.md }]}
                      >
                        <Text {...priceTextProps} style={styles.amountValue}>{formatCampaignDiscount(item)}</Text>
                        <Text style={styles.amountThreshold}>
                          {item.minOrderAmount > 0 ? `满¥${item.minOrderAmount}可用` : '无门槛'}
                        </Text>
                      </LinearGradient>

                      <View style={[styles.infoSection, { paddingHorizontal: spacing.md }]}>
                        <View style={styles.infoHeader}>
                          <Text style={[typography.bodyStrong, { color: colors.text.primary, flex: 1 }]} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <View style={[styles.statusTag, { backgroundColor: `${statusColor}22` }]}>
                            <Text style={[typography.captionSm, { color: statusColor }]}>
                              {item.statusLabel}
                            </Text>
                          </View>
                        </View>
                        <Text
                          style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}
                          numberOfLines={2}
                        >
                          {item.description || '平台福利活动'}
                        </Text>
                        <Text style={[typography.captionSm, { color: colors.text.tertiary, marginTop: 4 }]}>
                          {claimedSummaryText ?? `剩余 ${item.remainingQuota} 张 · 每人限领 ${item.maxPerUser} 张`}
                        </Text>

                        <View style={styles.centerActionRow}>
                          <Pressable
                            onPress={() => claimMutation.mutate(item.id)}
                            disabled={disabled}
                            style={[
                              styles.claimBtn,
                              {
                                backgroundColor: disabled ? colors.bgSecondary : colors.brand.primary,
                                borderRadius: radius.pill,
                              },
                            ]}
                          >
                            <MaterialCommunityIcons
                              name="ticket-percent-outline"
                              size={14}
                              color={disabled ? colors.muted : '#FFFFFF'}
                            />
                            <Text
                              style={[
                                typography.captionSm,
                                {
                                  color: disabled ? colors.muted : '#FFFFFF',
                                  marginLeft: 6,
                                },
                              ]}
                            >
                              {actionText}
                            </Text>
                          </Pressable>

                          {centerTab === 'claimed' && item.claimedSummary.available > 0 ? (
                            <Pressable
                              onPress={() => {
                                setMainTab('mine');
                                setSubTab('available');
                              }}
                              style={[styles.useCouponLink, { borderColor: colors.brand.primary, borderRadius: radius.pill }]}
                            >
                              <Text style={[typography.captionSm, { color: colors.brand.primary }]}>去使用</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  </Animated.View>
                );
              }}
            />
          )}
        </>
      )}
    </Screen>
  );
}

// ==================== 样式 ====================

const styles = StyleSheet.create({
  // 主 Tab（我的福利 / 领券中心）
  mainTabs: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  mainTabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  mainTabContent: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
  },
  // 可用数量概览
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // 子 Tab（全部/可用/已使用/已失效）
  subTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  subTabBtn: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  centerTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  centerTabBtn: {
    flex: 1,
    minHeight: 34,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 通用卡片
  card: {
    marginBottom: 12,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  // 我的福利 - 金额区域
  amountSection: {
    width: 92,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  // 领券中心 - 金额区域（略宽，适配更多信息）
  campaignAmountSection: {
    width: 104,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  amountValue: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  amountThreshold: {
    marginTop: 4,
    fontSize: 11,
    color: '#FFFFFF',
  },
  infoSection: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusTag: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  // 领取按钮
  claimBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  centerActionRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  useCouponLink: {
    minHeight: 28,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
