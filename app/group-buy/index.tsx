import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AuthModal } from '../../src/components/overlay';
import {
  GROUP_BUY_COLORS,
  GroupBuyCurrentPanel,
  GroupBuyProductCard,
  GroupBuyPurchaseGuardSheet,
} from '../../src/components/group-buy';
import { GroupBuyRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { compactActionTextProps, fitTextProps, useBottomInset, useResponsiveLayout, useTheme } from '../../src/theme';
import type { GroupBuyActivity, GroupBuyCurrentState } from '../../src/types';

type TabKey = 'CURRENT' | 'PRODUCTS';

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

export default function GroupBuyIndexScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const bottomPad = useBottomInset(spacing.xl);
  const { isCompact } = useResponsiveLayout();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const [activeTab, setActiveTab] = useState<TabKey>('PRODUCTS');
  const [refreshing, setRefreshing] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [pendingActivity, setPendingActivity] = useState<GroupBuyActivity | null>(null);
  const [guardTarget, setGuardTarget] = useState<GroupBuyActivity | null>(null);

  const activitiesQuery = useQuery({
    queryKey: ['group-buy-activities'],
    queryFn: () => GroupBuyRepo.listActivities(),
  });

  const currentQuery = useQuery({
    queryKey: ['group-buy-current'],
    queryFn: () => GroupBuyRepo.getCurrent(),
    enabled: isLoggedIn,
  });

  const activities = activitiesQuery.data?.ok ? activitiesQuery.data.data.items : [];
  const currentState = currentQuery.data?.ok ? currentQuery.data.data : emptyCurrentState;
  const current = currentState.current;
  const hasCurrent = Boolean(current);

  useEffect(() => {
    if (!hasCurrent) {
      setActiveTab('PRODUCTS');
      return;
    }
    setActiveTab(currentState.defaultTab);
  }, [hasCurrent, current?.id, currentState.defaultTab]);

  const featured = activities[0] ?? null;
  const otherActivities = useMemo(
    () => activities.filter((item) => item.id !== featured?.id),
    [activities, featured?.id],
  );

  const closeGuard = () => setGuardTarget(null);

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

  const navigateToActivity = (activity: GroupBuyActivity) => {
    router.push({ pathname: '/group-buy/[activityId]', params: { activityId: activity.id } });
  };

  const handleActivityPress = (activity: GroupBuyActivity) => {
    navigateToActivity(activity);
  };

  const handlePurchasePress = (activity: GroupBuyActivity) => {
    if (activity.sku.stock <= 0) {
      show({ message: '该团购商品暂无库存', type: 'info' });
      return;
    }
    if (!isLoggedIn) {
      setPendingActivity(activity);
      setAuthModalOpen(true);
      return;
    }
    if (currentState.occupiesSlot) {
      setGuardTarget(activity);
      return;
    }
    navigateToActivity(activity);
  };

  const handleEndAndBuy = async () => {
    if (!guardTarget || !current) return;
    const mode = current.status === 'QUALIFICATION_PENDING' ? 'abandon' : 'terminate';
    await endMutation.mutateAsync(mode);
    const target = guardTarget;
    closeGuard();
    navigateToActivity(target);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      activitiesQuery.refetch(),
      isLoggedIn ? currentQuery.refetch() : Promise.resolve(),
    ]);
    setRefreshing(false);
  };

  const handleAuthSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: ['group-buy-current'] });
    if (pendingActivity) {
      const next = pendingActivity;
      setPendingActivity(null);
      setTimeout(() => navigateToActivity(next), 160);
    }
  };

  if (activitiesQuery.isLoading || (isLoggedIn && currentQuery.isLoading)) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团购" />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton height={170} radius={8} />
          <Skeleton height={340} radius={8} />
          <Skeleton height={210} radius={8} />
        </ScrollView>
      </Screen>
    );
  }

  if (!activitiesQuery.data || !activitiesQuery.data.ok) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团购" />
        <ErrorState
          title="团购加载失败"
          description={activitiesQuery.data?.ok === false ? activitiesQuery.data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={() => activitiesQuery.refetch()}
        />
      </Screen>
    );
  }

  const renderProductShelf = () => (
    <View style={{ gap: spacing.lg }}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionTitleWrap}>
          <Text {...fitTextProps} style={[typography.headingMd, { color: colors.text.primary }]}>
            当前团购商品
          </Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
            购买指定商品后，符合条件时可获得专属推荐码。
          </Text>
        </View>
        <View style={[styles.countPill, { backgroundColor: GROUP_BUY_COLORS.porcelain, borderColor: GROUP_BUY_COLORS.mist }]}>
          <Text {...compactActionTextProps} style={[typography.caption, { color: GROUP_BUY_COLORS.tide }]}>
            {activities.length} 款
          </Text>
        </View>
      </View>

      {activities.length === 0 ? (
        <EmptyState
          title="暂无团购商品"
          description="活动上架后会在这里显示"
        />
      ) : (
        <>
          {featured ? (
            <Animated.View entering={FadeInDown.duration(280)}>
              <GroupBuyProductCard
                activity={featured}
                featured
                onPress={() => handleActivityPress(featured)}
                onPurchase={() => handlePurchasePress(featured)}
              />
            </Animated.View>
          ) : null}
          {otherActivities.map((activity, index) => (
            <Animated.View key={activity.id} entering={FadeInDown.duration(280).delay(60 * (index + 1))}>
              <GroupBuyProductCard
                activity={activity}
                onPress={() => handleActivityPress(activity)}
                onPurchase={() => handlePurchasePress(activity)}
              />
            </Animated.View>
          ))}
        </>
      )}
    </View>
  );

  return (
    <Screen contentStyle={{ flex: 1 }} statusBarStyle="dark">
      <AppHeader title="团购" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingHorizontal: isCompact ? spacing.md : spacing.lg,
            paddingTop: spacing.lg,
            paddingBottom: bottomPad,
          },
        ]}
      >
        <LinearGradient
          colors={[GROUP_BUY_COLORS.ivory, GROUP_BUY_COLORS.porcelain, '#EEF6F2']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroBand, shadow.sm, { borderRadius: 8, borderColor: GROUP_BUY_COLORS.mist }]}
        >
          <View style={styles.heroCopy}>
            <Text style={[typography.caption, { color: GROUP_BUY_COLORS.tide }]}>
              爱买买 · 精选团购
            </Text>
            <Text style={[typography.headingLg, styles.heroTitle, { color: GROUP_BUY_COLORS.pine }]}>
              精选团购
            </Text>
            <Text style={[typography.bodySm, { color: GROUP_BUY_COLORS.inkSoft, marginTop: spacing.xs }]}>
              当前上架的指定团购商品，购买前可查看价格、运费和活动条件。
            </Text>
          </View>
          <View style={[styles.heroMark, { backgroundColor: `${GROUP_BUY_COLORS.tide}12` }]}>
            <MaterialCommunityIcons name="ticket-percent-outline" size={34} color={GROUP_BUY_COLORS.tide} />
          </View>
        </LinearGradient>

        {hasCurrent ? (
          <View style={[styles.segment, { backgroundColor: GROUP_BUY_COLORS.mist }]}>
            <Pressable
              onPress={() => setActiveTab('CURRENT')}
              style={[
                styles.segmentItem,
                activeTab === 'CURRENT' && { backgroundColor: colors.surface },
              ]}
            >
              <Text
                {...compactActionTextProps}
                style={[
                  typography.bodyStrong,
                  { color: activeTab === 'CURRENT' ? GROUP_BUY_COLORS.pine : GROUP_BUY_COLORS.inkSoft },
                ]}
              >
                我的团购
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('PRODUCTS')}
              style={[
                styles.segmentItem,
                activeTab === 'PRODUCTS' && { backgroundColor: colors.surface },
              ]}
            >
              <Text
                {...compactActionTextProps}
                style={[
                  typography.bodyStrong,
                  { color: activeTab === 'PRODUCTS' ? GROUP_BUY_COLORS.pine : GROUP_BUY_COLORS.inkSoft },
                ]}
              >
                团购商品
              </Text>
            </Pressable>
          </View>
        ) : null}

        {activeTab === 'CURRENT' && current ? (
          <GroupBuyCurrentPanel
            current={current}
            onTerminate={() => endMutation.mutate('terminate')}
            onAbandon={() => endMutation.mutate('abandon')}
            terminating={endMutation.isPending}
            abandoning={endMutation.isPending}
          />
        ) : (
          renderProductShelf()
        )}
      </ScrollView>

      <GroupBuyPurchaseGuardSheet
        open={Boolean(guardTarget)}
        current={current}
        targetActivity={guardTarget}
        onClose={closeGuard}
        onEndAndBuy={handleEndAndBuy}
        onViewCurrent={() => {
          closeGuard();
          setActiveTab('CURRENT');
        }}
        loading={endMutation.isPending}
      />

      <AuthModal
        open={authModalOpen}
        onClose={() => {
          setAuthModalOpen(false);
          setPendingActivity(null);
        }}
        onSuccess={handleAuthSuccess}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    gap: 16,
  },
  heroBand: {
    minHeight: 150,
    borderWidth: 1,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
  },
  heroTitle: {
    marginTop: 6,
    fontWeight: '800',
  },
  heroMark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 14,
  },
  segment: {
    borderRadius: 8,
    padding: 4,
    flexDirection: 'row',
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    minHeight: 42,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  countPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});
