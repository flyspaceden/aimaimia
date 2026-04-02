import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, Skeleton, useToast } from '../../src/components/feedback';
import { CouponRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import type {
  AvailableCampaignDto,
  CouponInstanceStatus,
  MyCouponDto,
} from '../../src/types/domain/Coupon';

// ==================== 类型与常量 ====================

type MainTab = 'mine' | 'center';
type SubTabKey = 'all' | 'available' | 'used' | 'expired';

const MAIN_TABS: Array<{ key: MainTab; label: string }> = [
  { key: 'mine', label: '我的红包' },
  { key: 'center', label: '领券中心' },
];

const SUB_TABS: Array<{ key: SubTabKey; label: string; status?: CouponInstanceStatus }> = [
  { key: 'all', label: '全部' },
  { key: 'available', label: '可用', status: 'AVAILABLE' },
  { key: 'used', label: '已使用', status: 'USED' },
  { key: 'expired', label: '已失效', status: 'EXPIRED' },
];

// ==================== 工具函数 ====================

/** 格式化我的红包折扣 */
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

// ==================== 我的红包卡片 ====================

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
  const statusText = statusTextMap[item.status] ?? item.status;

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
        <Text style={styles.amountValue}>{formatDiscount(item)}</Text>
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
          过期时间：{item.expiresAt.slice(0, 10)}
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

  // 主 Tab 状态：我的红包 / 领券中心
  const [mainTab, setMainTab] = useState<MainTab>('mine');
  // 子 Tab 状态（仅用于「我的红包」）
  const [subTab, setSubTab] = useState<SubTabKey>('all');

  // ==================== 我的红包数据 ====================
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

  // ==================== 领券中心数据 ====================
  const {
    data: centerData,
    isLoading: centerLoading,
    refetch: centerRefetch,
    isRefetching: centerRefetching,
  } = useQuery({
    queryKey: ['coupon-center-campaigns'],
    queryFn: () => CouponRepo.getAvailableCampaigns(),
    enabled: mainTab === 'center',
  });

  const campaigns = centerData?.ok ? centerData.data : [];

  const claimMutation = useMutation({
    mutationFn: (campaignId: string) => CouponRepo.claimCoupon(campaignId),
    onSuccess: (result) => {
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '领取失败', type: 'error' });
        return;
      }
      show({ message: '领取成功，已放入我的红包', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['coupon-center-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['my-coupons'] });
      queryClient.invalidateQueries({ queryKey: ['checkout-eligible-coupons'] });
    },
    onError: () => {
      show({ message: '领取失败，请稍后重试', type: 'error' });
    },
  });

  // ==================== 渲染 ====================

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="红包" />

      {/* ===== 主 Tab 切换（胶囊按钮） ===== */}
      <View
        style={[
          styles.mainTabs,
          { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surface },
        ]}
      >
        {MAIN_TABS.map((tab) => {
          const active = tab.key === mainTab;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setMainTab(tab.key)}
              style={[
                styles.mainTabBtn,
                {
                  backgroundColor: active ? colors.brand.primary : colors.bgSecondary,
                  borderRadius: radius.pill,
                },
              ]}
            >
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
            </Pressable>
          );
        })}
      </View>

      {/* ===== 我的红包视图 ===== */}
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
              当前可用 <Text style={{ color: colors.danger, fontWeight: '600' }}>{availableCount}</Text> 张红包
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

          {/* 红包列表 */}
          {myLoading ? (
            <View style={{ paddingHorizontal: spacing.lg }}>
              <Skeleton height={96} radius={radius.lg} />
              <View style={{ height: spacing.md }} />
              <Skeleton height={96} radius={radius.lg} />
            </View>
          ) : coupons.length === 0 ? (
            <EmptyState title="暂无红包" description="去领券中心领取可用红包" />
          ) : (
            <FlatList
              data={coupons}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
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
          {centerLoading ? (
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
              <Skeleton height={120} radius={radius.lg} />
              <View style={{ height: spacing.md }} />
              <Skeleton height={120} radius={radius.lg} />
            </View>
          ) : campaigns.length === 0 ? (
            <EmptyState title="暂无可领取红包" description="请稍后再来查看活动" />
          ) : (
            <FlatList
              data={campaigns}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
              refreshing={centerRefetching}
              onRefresh={centerRefetch}
              renderItem={({ item, index }) => {
                const reachedLimit = item.userClaimedCount >= item.maxPerUser;
                const depleted = item.remainingQuota <= 0;
                const disabled = reachedLimit || depleted || claimMutation.isPending;
                const actionText = reachedLimit ? '已达上限' : depleted ? '已领完' : '立即领取';

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
                        <Text style={styles.amountValue}>{formatCampaignDiscount(item)}</Text>
                        <Text style={styles.amountThreshold}>
                          {item.minOrderAmount > 0 ? `满¥${item.minOrderAmount}` : '无门槛'}
                        </Text>
                      </LinearGradient>

                      <View style={[styles.infoSection, { paddingHorizontal: spacing.md }]}>
                        <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text
                          style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}
                          numberOfLines={2}
                        >
                          {item.description}
                        </Text>
                        <Text style={[typography.captionSm, { color: colors.text.tertiary, marginTop: 4 }]}>
                          剩余 {item.remainingQuota} 张 · 每人限领 {item.maxPerUser} 张
                        </Text>

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
  // 主 Tab（我的红包 / 领券中心）
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
  // 通用卡片
  card: {
    marginBottom: 12,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  // 我的红包 - 金额区域
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
});
