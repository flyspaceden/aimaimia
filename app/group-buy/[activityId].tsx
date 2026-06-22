import React, { useMemo, useState } from 'react';
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
import { GroupBuyRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useMeasuredBottomBar } from '../../src/hooks/useMeasuredBottomBar';
import { compactActionTextProps, fitTextProps, priceTextProps, useBottomInset, useResponsiveLayout, useTheme } from '../../src/theme';
import type { GroupBuyActivity, GroupBuyCurrentState } from '../../src/types';

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

  const activityQuery = useQuery({
    queryKey: ['group-buy-activity', activityId],
    queryFn: () => GroupBuyRepo.getActivity(String(activityId)),
    enabled: Boolean(activityId),
  });

  const currentQuery = useQuery({
    queryKey: ['group-buy-current'],
    queryFn: () => GroupBuyRepo.getCurrent(),
    enabled: isLoggedIn,
  });

  const activity = activityQuery.data?.ok ? activityQuery.data.data : null;
  const currentState = currentQuery.data?.ok ? currentQuery.data.data : emptyCurrentState;
  const current = currentState.current;

  const rules = useMemo(() => [
    '仅购买本活动指定商品，确认收货且无退换货后生成专属推荐码。',
    '仅统计直接推荐的全新用户购买同款商品，好友再推荐不计入您的名额。',
    '返还货款按活动设定规则处理，运费、优惠券、赠品差价不计入返还。',
    '无法保证一定推荐满指定人数，未达标不产生对应返还。',
  ], []);

  const endMutation = useMutation({
    mutationFn: async (mode: 'terminate' | 'abandon') => {
      if (mode === 'abandon') {
        return runResult(GroupBuyRepo.abandonCurrent());
      }
      return runResult(GroupBuyRepo.terminateCurrent());
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['group-buy-current'] });
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
    if (activity.sku.stock <= 0) {
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

  const handleEndAndBuy = async () => {
    if (!activity || !current) return;
    const mode = current.status === 'QUALIFICATION_PENDING' ? 'abandon' : 'terminate';
    await endMutation.mutateAsync(mode);
    setGuardOpen(false);
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
                分享回馈活动
              </Text>
            </View>
            <Text style={[typography.headingLg, styles.coverTitle, { color: '#FFFFFF' }]}>
              {activity.title}
            </Text>
            <Text style={[typography.bodySm, { color: 'rgba(255,255,255,0.82)', marginTop: 4 }]}>
              {activity.product.title} · {activity.sku.title}
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
            <View style={[styles.metaLine, { borderTopColor: colors.border }]}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>
                {activity.shippingSummary}
              </Text>
              <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: 6 }]}>
                库存 {activity.sku.stock} · 下单前请确认收货地址
              </Text>
            </View>
          </View>

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

          <View style={[styles.compliancePanel, { borderRadius: 8, backgroundColor: GROUP_BUY_COLORS.porcelain, borderColor: GROUP_BUY_COLORS.mist }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={GROUP_BUY_COLORS.inkSoft} />
            <Text style={[typography.caption, styles.complianceCopy, { color: GROUP_BUY_COLORS.inkSoft }]}>
              活动为品牌购物回馈，仅一级直接推荐；推广成功与否不保证，未满足条件不产生对应返还。
            </Text>
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
          disabled={activity.sku.stock <= 0}
          style={[
            styles.cta,
            {
              borderRadius: radius.pill,
              backgroundColor: activity.sku.stock > 0 ? GROUP_BUY_COLORS.pine : colors.bgSecondary,
            },
          ]}
        >
          <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: activity.sku.stock > 0 ? '#FFFFFF' : colors.muted }]}>
            {activity.sku.stock > 0 ? '去付款' : '暂无库存'}
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
        onSuccess={async () => {
          await queryClient.invalidateQueries({ queryKey: ['group-buy-current'] });
          setTimeout(handleCheckoutPress, 180);
        }}
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
