import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AuthModal } from '../../src/components/overlay';
import { GROUP_BUY_COLORS, GroupBuyPurchaseGuardSheet } from '../../src/components/group-buy';
import { Countdown } from '../../src/components/ui/Countdown';
import { GroupBuyRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useMeasuredBottomBar } from '../../src/hooks/useMeasuredBottomBar';
import { compactActionTextProps, fitTextProps, priceTextProps, useBottomInset, useResponsiveLayout, useTheme } from '../../src/theme';
import { buildGroupBuyActivityRules } from '../../src/utils/groupBuyRules';
import { getGroupBuyCountdownState } from '../../src/utils/groupBuyCountdown';
import { getGroupBuyLowStockText } from '../../src/utils/groupBuyStockDisplay';
import type { GroupBuyActivity, GroupBuyCurrentState } from '../../src/types';

type EndCurrentInput = { mode: 'terminate' | 'abandon'; instanceId?: string };

const emptyCurrentState: GroupBuyCurrentState = {
  current: null,
  occupiesSlot: false,
  defaultTab: 'PRODUCTS',
  canBuyNew: true,
};

const runResult = async <T,>(request: Promise<{ ok: true; data: T } | { ok: false; error: { displayMessage?: string; message: string } }>) => {
  const result = await request;
  if (!result.ok) {
    throw new Error(result.error.displayMessage ?? result.error.message);
  }
  return result.data;
};

const formatPrice = (value: number) => `¥${Number(value || 0).toFixed(2)}`;

const getActivityItems = (activity: GroupBuyActivity) => (
  activity.items && activity.items.length > 0
    ? activity.items
    : [{
        productId: activity.product.id,
        productTitle: activity.product.title,
        imageUrl: activity.product.imageUrl,
        skuId: activity.sku.id,
        skuTitle: activity.sku.title,
        stock: activity.sku.stock,
        weightGram: activity.sku.weightGram,
        quantity: 1,
      }]
);

export default function GroupBuyActivityDetailScreen() {
  const { activityId: rawActivityId, shareCode: rawShareCode } = useLocalSearchParams<{
    activityId: string;
    shareCode?: string;
  }>();
  const activityId = Array.isArray(rawActivityId) ? rawActivityId[0] : rawActivityId;
  const shareCode = Array.isArray(rawShareCode) ? rawShareCode[0] : rawShareCode;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { isCompact, isLargeText } = useResponsiveLayout();
  const bottomInset = useBottomInset(spacing.md);
  const { bottomPadding, onBarLayout } = useMeasuredBottomBar(isCompact || isLargeText ? 148 : 112, spacing.xl);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [guardOpen, setGuardOpen] = useState(false);
  const [clockState, setClockState] = useState(() => getGroupBuyCountdownState(null));

  const activityQuery = useQuery({
    queryKey: ['group-buy-activity', activityId],
    queryFn: () => GroupBuyRepo.getActivity(String(activityId)),
    enabled: Boolean(activityId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: true,
  });

  const currentQuery = useQuery({
    queryKey: ['group-buy-current'],
    queryFn: () => GroupBuyRepo.getCurrent(),
    enabled: isLoggedIn,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: true,
  });

  const activity = activityQuery.data?.ok ? activityQuery.data.data : null;
  const currentState = currentQuery.data?.ok ? currentQuery.data.data : emptyCurrentState;
  const current = currentState.current;
  const activityNotStarted = Boolean(activity?.startAt && new Date(activity.startAt).getTime() > Date.now());
  const activityPaused = activity?.status === 'PAUSED';
  const activityEnded = activity?.status === 'ENDED' || clockState.expired;
  const activityUnavailable = activityNotStarted || activityPaused || activityEnded;
  const countdownUrgent = Boolean(activity && !activityUnavailable && clockState.urgent);

  const rules = useMemo(
    () => buildGroupBuyActivityRules(activity?.tiers.length ?? 0),
    [activity?.tiers.length],
  );

  useEffect(() => {
    setClockState(getGroupBuyCountdownState(activity?.endAt));
  }, [activity?.id, activity?.endAt]);

  const endMutation = useMutation({
    mutationFn: async ({ mode, instanceId }: EndCurrentInput) => {
      if (mode === 'abandon') {
        if (!instanceId) throw new Error('团购状态已变化，请刷新后重试');
        return runResult(GroupBuyRepo.abandonCurrent(instanceId));
      }
      return runResult(GroupBuyRepo.terminateCurrent());
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['group-buy-current'] });
      await queryClient.refetchQueries({ queryKey: ['group-buy-current'] });
      show({ message: '本次团购已处理', type: 'success' });
    },
    onError: (error) => {
      show({ message: error instanceof Error ? error.message : '处理失败', type: 'error' });
    },
  });

  const navigateToCheckout = (target: GroupBuyActivity) => {
    router.push({
      pathname: '/group-buy/checkout' as any,
      params: {
        activityId: target.id,
        ...(shareCode ? { shareCode } : {}),
      },
    });
  };

  const handleCheckoutPress = () => {
    if (!activity) return;
    if (activityPaused) {
      show({ message: '团购活动已暂停', type: 'info' });
      return;
    }
    if (activityNotStarted) {
      show({ message: '团购活动未开始', type: 'info' });
      return;
    }
    if (activityEnded) {
      show({ message: '团购活动已结束', type: 'info' });
      return;
    }
    if ((activity.availableStock ?? activity.sku.stock) <= 0) {
      show({ message: '该团购商品暂无库存', type: 'info' });
      return;
    }
    if (!isLoggedIn) {
      setAuthModalOpen(true);
      return;
    }
    if (currentState.occupiesSlot) {
      setGuardOpen(true);
      return;
    }
    navigateToCheckout(activity);
  };

  const handleActivityExpire = () => {
    setClockState({ expired: true, urgent: false });
    void Promise.all([
      activityQuery.refetch(),
      isLoggedIn ? currentQuery.refetch() : Promise.resolve(),
    ]);
  };

  const handleCountdownTick = (remainingMs: number) => {
    setClockState({
      expired: remainingMs <= 0,
      urgent: remainingMs > 0 && remainingMs < 24 * 60 * 60 * 1000,
    });
  };

  const handleEndAndBuy = async () => {
    if (!activity || !current) return;
    const mode = current.status === 'QUALIFICATION_PENDING' ? 'abandon' : 'terminate';
    await endMutation.mutateAsync({ mode, instanceId: current.id });
    setGuardOpen(false);
    navigateToCheckout(activity);
  };

  const handleAuthSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: ['group-buy-current'] });
    if (!activity) return;

    const latestCurrent = await GroupBuyRepo.getCurrent();
    if (!latestCurrent.ok) {
      show({ message: latestCurrent.error.displayMessage ?? '团购状态加载失败，请重试', type: 'error' });
      return;
    }

    queryClient.setQueryData(['group-buy-current'], latestCurrent);
    if (latestCurrent.data.occupiesSlot) {
      setGuardOpen(true);
      return;
    }

    navigateToCheckout(activity);
  };

  if (activityQuery.isLoading || (isLoggedIn && currentQuery.isLoading)) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团购详情" />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton height={300} radius={8} />
          <Skeleton height={120} radius={8} />
          <Skeleton height={180} radius={8} />
        </ScrollView>
      </Screen>
    );
  }

  if (!activityQuery.data || !activityQuery.data.ok || !activity) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团购详情" />
        <ErrorState
          title="团购商品加载失败"
          description={activityQuery.data?.ok === false ? activityQuery.data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={() => activityQuery.refetch()}
        />
      </Screen>
    );
  }

  if (isLoggedIn && currentQuery.data && !currentQuery.data.ok) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团购详情" />
        <ErrorState
          title="团购状态加载失败"
          description={currentQuery.data.error.displayMessage ?? '请刷新后重试'}
          actionLabel="重新加载"
          onAction={() => currentQuery.refetch()}
        />
      </Screen>
    );
  }

  const activityDescription = activity.description?.trim();
  const activityItems = getActivityItems(activity);
  const itemSummary = activity.itemSummary || `${activity.product.title} · ${activity.sku.title}`;
  const availableStock = activityUnavailable ? 0 : activity.availableStock ?? activity.sku.stock;
  const ctaLabel = activityPaused
    ? '活动已暂停'
    : activityNotStarted
      ? '活动未开始'
      : activityEnded
        ? '活动已结束'
        : availableStock > 0
          ? '去付款'
          : '暂无库存';

  return (
    <Screen contentStyle={{ flex: 1 }} statusBarStyle="dark">
      <AppHeader title="团购详情" subtitle="指定商品活动" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPadding }}
      >
        <View style={styles.coverWrap}>
          {activity.product.imageUrl ? (
            <Image
              source={{ uri: activity.product.imageUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={180}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.coverFallback, { backgroundColor: GROUP_BUY_COLORS.mist }]}>
              <MaterialCommunityIcons name="shopping-outline" size={52} color={GROUP_BUY_COLORS.tide} />
            </View>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(18,55,42,0.74)']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.coverInfo}>
            <View style={[styles.coverBadge, { backgroundColor: 'rgba(255,253,246,0.94)' }]}>
              <MaterialCommunityIcons name="shield-check-outline" size={14} color={GROUP_BUY_COLORS.tide} />
              <Text {...compactActionTextProps} style={[typography.caption, { color: GROUP_BUY_COLORS.pine, marginLeft: 5 }]}>
                指定团购商品
              </Text>
            </View>
            <Text style={[typography.headingLg, styles.coverTitle, { color: '#FFFFFF' }]}>
              {activity.title}
            </Text>
            <Text style={[typography.bodySm, { color: 'rgba(255,255,255,0.82)', marginTop: 4 }]}>
              {itemSummary}
            </Text>
          </View>
        </View>

        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <View style={[styles.priceCard, shadow.sm, { borderRadius: 8, backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.priceRow}>
              <View style={styles.priceTextBlock}>
                <Text {...priceTextProps} style={[typography.headingLg, styles.priceValue, { color: GROUP_BUY_COLORS.coral }]}>
                  {formatPrice(activity.price)}
                </Text>
                <Text {...fitTextProps} style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  指定团购价，现金支付
                </Text>
              </View>
              <View style={[styles.shippingChip, { backgroundColor: GROUP_BUY_COLORS.porcelain, borderColor: GROUP_BUY_COLORS.mist }]}>
                <MaterialCommunityIcons
                  name={activity.freeShipping ? 'truck-check-outline' : 'truck-outline'}
                  size={15}
                  color={GROUP_BUY_COLORS.tide}
                />
                <Text {...compactActionTextProps} style={[typography.caption, { color: GROUP_BUY_COLORS.tide, marginLeft: 5 }]}>
                  {activity.freeShipping ? '包邮' : '按配置运费'}
                </Text>
              </View>
            </View>
            {activity.endAt ? (
              <View
                style={[
                  styles.countdownNotice,
                  {
                    backgroundColor: countdownUrgent ? '#FFF1EC' : GROUP_BUY_COLORS.porcelain,
                    borderColor: countdownUrgent ? `${GROUP_BUY_COLORS.coral}66` : GROUP_BUY_COLORS.mist,
                    marginTop: spacing.md,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={countdownUrgent ? 'timer-alert-outline' : 'clock-outline'}
                  size={15}
                  color={activityUnavailable ? GROUP_BUY_COLORS.inkSoft : countdownUrgent ? GROUP_BUY_COLORS.coral : GROUP_BUY_COLORS.tide}
                />
                {activityUnavailable ? (
                  <Text {...compactActionTextProps} style={[typography.caption, styles.countdownText, { color: GROUP_BUY_COLORS.inkSoft }]}>
                    {activityPaused
                      ? '活动已暂停，暂时无法购买本团购商品'
                      : activityNotStarted
                        ? '活动未开始，暂时无法购买本团购商品'
                        : '活动已结束，无法继续购买本团购商品'}
                  </Text>
                ) : (
                  <Countdown
                    expiresAt={activity.endAt}
                    format="days-hours-minutes"
                    prefix={countdownUrgent ? '活动即将结束' : '活动剩余'}
                    onExpire={handleActivityExpire}
                    onTick={handleCountdownTick}
                    {...compactActionTextProps}
                    style={[
                      typography.caption,
                      styles.countdownText,
                      countdownUrgent && styles.countdownTextUrgent,
                      { color: countdownUrgent ? GROUP_BUY_COLORS.coral : GROUP_BUY_COLORS.tide },
                    ]}
                  />
                )}
              </View>
            ) : null}
            <View style={[styles.metaLine, { borderTopColor: colors.border }]}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>
                {activity.shippingSummary}
              </Text>
              <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: 6 }]}>
                下单前请确认收货地址
              </Text>
            </View>
          </View>

          <View style={[styles.rulePanel, { borderRadius: 8, backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.ruleTitleRow}>
              <MaterialCommunityIcons name="basket-outline" size={20} color={GROUP_BUY_COLORS.tide} />
              <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: 7 }]}>
                包含商品
              </Text>
            </View>
            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              {activityItems.map((item) => {
                const lowStockText = getGroupBuyLowStockText(item.stock);

                return (
                  <View key={`${item.productId}-${item.skuId}`} style={styles.itemRow}>
                    <View style={[styles.itemDot, { backgroundColor: GROUP_BUY_COLORS.porcelain }]} />
                    <View style={styles.itemCopy}>
                      <Text {...fitTextProps} style={[typography.bodySm, { color: colors.text.primary }]}>
                        {item.productTitle} x{item.quantity}
                      </Text>
                      {lowStockText ? (
                        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                          {lowStockText}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {activityDescription ? (
            <View style={[styles.rulePanel, { borderRadius: 8, backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.ruleTitleRow}>
                <MaterialCommunityIcons name="text-box-outline" size={20} color={GROUP_BUY_COLORS.tide} />
                <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: 7 }]}>
                  商品详情
                </Text>
              </View>
              <Text style={[typography.bodySm, styles.detailCopy, { color: colors.text.secondary }]}>
                {activityDescription}
              </Text>
            </View>
          ) : null}

          {shareCode ? (
            <View style={[styles.inviterBox, { borderRadius: 8, backgroundColor: '#FFF7DF', borderColor: `${GROUP_BUY_COLORS.brass}55` }]}>
              <MaterialCommunityIcons name="account-check-outline" size={20} color={GROUP_BUY_COLORS.brass} />
              <Text style={[typography.bodySm, styles.inviterText, { color: GROUP_BUY_COLORS.pine }]}>
                已识别团购推荐码，付款时将标记本次购买来源。
              </Text>
            </View>
          ) : null}

          <View style={[styles.rulePanel, { borderRadius: 8, backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.ruleTitleRow}>
              <MaterialCommunityIcons name="clipboard-text-outline" size={20} color={GROUP_BUY_COLORS.tide} />
              <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: 7 }]}>
                活动条件
              </Text>
            </View>
            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              {rules.map((rule, index) => (
                <View key={rule} style={styles.ruleItem}>
                  <View style={[styles.ruleIndex, { backgroundColor: GROUP_BUY_COLORS.porcelain }]}>
                    <Text {...compactActionTextProps} style={[typography.caption, { color: GROUP_BUY_COLORS.tide }]}>
                      {index + 1}
                    </Text>
                  </View>
                  <Text style={[typography.bodySm, styles.ruleCopy, { color: colors.text.secondary }]}>
                    {rule}
                  </Text>
                </View>
              ))}
            </View>
          </View>

        </View>
      </ScrollView>

      <View
        onLayout={onBarLayout}
        style={[styles.bottomBar, shadow.lg, { paddingBottom: bottomInset, backgroundColor: colors.surface, borderTopColor: colors.border }]}
      >
        <View style={styles.bottomPriceBlock}>
          <Text {...priceTextProps} style={[typography.headingMd, { color: GROUP_BUY_COLORS.coral, fontWeight: '800' }]}>
            {formatPrice(activity.price)}
          </Text>
          <Text {...fitTextProps} style={[typography.caption, { color: colors.text.secondary }]}>
            团购价
          </Text>
        </View>
        <Pressable
          onPress={handleCheckoutPress}
          disabled={availableStock <= 0 || activityUnavailable}
          style={[
            styles.cta,
            {
              borderRadius: radius.pill,
              backgroundColor: availableStock > 0 && !activityUnavailable ? GROUP_BUY_COLORS.pine : colors.bgSecondary,
            },
          ]}
        >
          <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: availableStock > 0 && !activityUnavailable ? '#FFFFFF' : colors.muted }]}>
            {ctaLabel}
          </Text>
        </Pressable>
      </View>

      <GroupBuyPurchaseGuardSheet
        open={guardOpen}
        current={current}
        targetActivity={activity}
        onClose={() => setGuardOpen(false)}
        onEndAndBuy={handleEndAndBuy}
        onViewCurrent={() => {
          setGuardOpen(false);
          router.replace('/group-buy');
        }}
        loading={endMutation.isPending}
      />

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  coverWrap: {
    height: 310,
    overflow: 'hidden',
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverInfo: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
  },
  coverBadge: {
    alignSelf: 'flex-start',
    minHeight: 28,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  coverTitle: {
    marginTop: 10,
    fontWeight: '800',
  },
  priceCard: {
    borderWidth: 1,
    padding: 16,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  priceTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  priceValue: {
    fontWeight: '800',
  },
  shippingChip: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  countdownNotice: {
    minHeight: 32,
    maxWidth: '100%',
    borderWidth: 1,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  countdownText: {
    marginLeft: 5,
  },
  countdownTextUrgent: {
    fontWeight: '800',
  },
  metaLine: {
    borderTopWidth: 1,
    marginTop: 14,
    paddingTop: 12,
  },
  inviterBox: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 13,
  },
  inviterText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 8,
  },
  rulePanel: {
    borderWidth: 1,
    padding: 16,
  },
  detailCopy: {
    marginTop: 12,
    lineHeight: 22,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  itemDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 7,
  },
  itemCopy: {
    flex: 1,
    minWidth: 0,
  },
  ruleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ruleItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  ruleIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  ruleCopy: {
    flex: 1,
    minWidth: 0,
  },
  compliancePanel: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 13,
    gap: 8,
  },
  complianceCopy: {
    flex: 1,
    minWidth: 0,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bottomPriceBlock: {
    flex: 1,
    minWidth: 0,
  },
  cta: {
    minWidth: 138,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
});
