import React from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton } from '../../src/components/feedback';
import { BonusRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import type { QueueRewardStatusV2 } from '../../src/types';
import {
  fitTextProps,
  priceTextProps,
  useResponsiveLayout,
  useTheme,
} from '../../src/theme';

function money(value: number) {
  return Number(value || 0).toFixed(2);
}

function QueueRail({
  position,
}: {
  position: QueueRewardStatusV2['activePositions'][number];
}) {
  const total = Math.max(1, position.targetObservedUnitCount);
  const visible = Math.min(total, 20);
  const completedVisible = Math.min(
    visible,
    Math.round((position.observedUnitCount / total) * visible),
  );

  return (
    <View
      style={styles.rail}
      accessibilityLabel={`已经过${position.observedUnitCount}个新订单位置，还需${position.remainingObservedUnitCount}个`}
    >
      {Array.from({ length: visible }, (_, index) => (
        <View
          key={index}
          style={[
            styles.railCell,
            index < completedVisible
              ? styles.railCellCompleted
              : styles.railCellWaiting,
          ]}
        />
      ))}
      {total > visible ? (
        <Text style={styles.railMore}>+{total - visible}</Text>
      ) : null}
    </View>
  );
}

export default function BonusQueueScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { isCompact } = useResponsiveLayout();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const {
    data,
    error,
    isLoading,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['queue-reward-status', 20],
    queryFn: async ({ pageParam }) => {
      const result = await BonusRepo.getQueueRewardStatus(
        typeof pageParam === 'string'
          ? pageParam
          : undefined,
        20,
      );
      if (!result.ok) throw result.error;
      return result.data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.positionPage.hasMore
        ? lastPage.positionPage.nextSequence
        : undefined,
    enabled: isLoggedIn,
    refetchInterval: 30_000,
  });

  const firstPage = data?.pages[0] ?? null;
  const queue = firstPage
    ? {
        ...firstPage,
        activePositions: (data?.pages ?? []).flatMap(
          (page) => page.activePositions,
        ),
      }
    : null;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="排队红包" />
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isFetchingNextPage}
            onRefresh={refetch}
          />
        }
        contentContainerStyle={{
          padding: spacing.xl,
          paddingBottom: spacing['3xl'],
        }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View style={{ gap: spacing.md }}>
            <Skeleton height={190} radius={radius.xl} />
            <Skeleton height={160} radius={radius.lg} />
            <Skeleton height={120} radius={radius.lg} />
          </View>
        ) : error || !queue ? (
          <ErrorState
            title="排队红包加载失败"
            description="下拉或点击按钮重新加载"
            onAction={() => refetch()}
          />
        ) : (
          <>
            <Animated.View entering={FadeInDown.duration(260)}>
              <View
                style={[
                  styles.hero,
                  shadow.md,
                  { borderRadius: radius.xl },
                ]}
              >
                <View style={styles.heroTop}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.eyebrow}>全平台订单接力</Text>
                    <Text style={styles.heroTitle}>每次消费，都留下一个位置</Text>
                  </View>
                  <View style={styles.heroSeal}>
                    <Text {...priceTextProps} style={styles.heroSealNumber}>
                      {queue.queueSize}
                    </Text>
                    <Text style={styles.heroSealLabel}>人一轮</Text>
                  </View>
                </View>
                <View
                  style={[
                    styles.moneyRow,
                    isCompact && styles.moneyRowCompact,
                  ]}
                >
                  <View style={styles.moneyItem}>
                    <Text style={styles.moneyLabel}>可提现红包</Text>
                    <Text {...priceTextProps} style={styles.moneyValue}>
                      ¥{money(queue.wallet.available)}
                    </Text>
                    <Text style={styles.moneyHint}>到账后可直接提现</Text>
                  </View>
                  {!isCompact ? <View style={styles.moneyDivider} /> : null}
                  <View style={styles.moneyItem}>
                    <Text style={styles.moneyLabel}>进行中的位置</Text>
                    <Text {...fitTextProps} style={styles.moneyValue}>
                      {queue.totalActivePositions}
                    </Text>
                    <Text style={styles.moneyHint}>售后期结束后才到账</Text>
                  </View>
                </View>
              </View>
            </Animated.View>

            {!queue.enabled ? (
              <View
                style={[
                  styles.notice,
                  {
                    backgroundColor: '#FFF8E8',
                    borderColor: '#EBCB7C',
                    borderRadius: radius.lg,
                    marginTop: spacing.md,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name="pause-circle-outline"
                  size={22}
                  color="#9B6816"
                />
                <Text
                  style={[
                    typography.captionSm,
                    { color: '#765218', flex: 1 },
                  ]}
                >
                  平台暂未开放新订单入队；已有内部待结算记录仍会按原售后时间正常处理。
                </Text>
              </View>
            ) : null}

            <Animated.View
              entering={FadeInDown.duration(260).delay(70)}
              style={{ marginTop: spacing.xl }}
            >
              <View style={styles.sectionHeading}>
                <View>
                  <Text
                    style={[
                      typography.headingSm,
                      { color: colors.text.primary },
                    ]}
                  >
                    我的接力位置
                  </Text>
                  <Text
                    style={[
                      typography.captionSm,
                      { color: colors.text.secondary, marginTop: 3 },
                    ]}
                  >
                    每满 ¥{money(queue.splitUnitAmount)} 产生一个位置
                  </Text>
                </View>
                <View
                  style={[
                    styles.modeTag,
                    { backgroundColor: colors.brand.primarySoft },
                  ]}
                >
                  <Text
                    style={[
                      typography.captionSm,
                      { color: colors.brand.primary },
                    ]}
                  >
                    {queue.distributionMode === 'AVERAGE'
                      ? '平均分配'
                      : '正态随机'}
                  </Text>
                </View>
              </View>

              {queue.activePositions.length === 0 ? (
                <View
                  style={[
                    styles.emptyCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radius.lg,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="ticket-confirmation-outline"
                    size={34}
                    color={colors.brand.primary}
                  />
                  <Text
                    style={[
                      typography.bodyStrong,
                      { color: colors.text.primary, marginTop: spacing.sm },
                    ]}
                  >
                    当前没有进行中的位置
                  </Text>
                  <Text
                    style={[
                      typography.captionSm,
                      {
                        color: colors.text.secondary,
                        textAlign: 'center',
                        marginTop: 4,
                      },
                    ]}
                  >
                    确认收货后按商品实付金额自动入队；不足一个金额单元也会产生一个位置。
                  </Text>
                </View>
              ) : (
                <>
                {queue.activePositions.map((position, index) => (
                  <Animated.View
                    key={position.id}
                    entering={FadeInDown.duration(240).delay(
                      100 + Math.min(index * 40, 400),
                    )}
                  >
                    <View
                      style={[
                        styles.positionCard,
                        shadow.sm,
                        {
                          backgroundColor: colors.surface,
                          borderColor:
                            position.status === 'CAPPED'
                              ? '#E0B85C'
                              : colors.border,
                          borderRadius: radius.lg,
                        },
                      ]}
                    >
                      <View style={styles.positionTop}>
                        <View style={{ flex: 1 }}>
                          <Text
                            {...fitTextProps}
                            style={[
                              typography.bodyStrong,
                              { color: colors.text.primary },
                            ]}
                          >
                            {position.orderNo} · 第 {position.unitIndex + 1} 个位置
                          </Text>
                          <Text
                            style={[
                              typography.captionSm,
                              {
                                color: colors.text.secondary,
                                marginTop: 3,
                              },
                            ]}
                          >
                            全局前方 {position.ahead} 个仍在队位置
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.positionBadge,
                            {
                              backgroundColor:
                                position.status === 'CAPPED'
                                  ? '#FFF1C7'
                                  : '#DDF4E7',
                            },
                          ]}
                        >
                          <Text
                            style={[
                              typography.captionSm,
                              {
                                color:
                                  position.status === 'CAPPED'
                                    ? '#91620C'
                                    : '#176B43',
                              },
                            ]}
                          >
                            {position.status === 'CAPPED'
                              ? '已达收取上限'
                              : '接力中'}
                          </Text>
                        </View>
                      </View>

                      <QueueRail position={position} />
                      <View style={styles.progressCopy}>
                        <Text
                          style={[
                            typography.captionSm,
                            { color: colors.text.secondary },
                          ]}
                        >
                          已经过 {position.observedUnitCount} 个新位置
                        </Text>
                        <Text
                          {...priceTextProps}
                          style={[
                            typography.captionSm,
                            { color: colors.brand.primary, fontWeight: '700' },
                          ]}
                        >
                          还需 {position.remainingObservedUnitCount} 个
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.positionFoot,
                          { borderTopColor: colors.border },
                        ]}
                      >
                        <Text
                          style={[
                            typography.captionSm,
                            { color: colors.text.secondary },
                          ]}
                        >
                          本订单累计收到
                        </Text>
                        <Text
                          {...priceTextProps}
                          style={[
                            typography.bodyStrong,
                            { color: colors.brand.primaryDark },
                          ]}
                        >
                          ¥{money(position.receivedAmount)} / ¥
                          {money(position.sharedCapAmount)}
                        </Text>
                      </View>
                    </View>
                  </Animated.View>
                ))}
                {hasNextPage ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="加载更多排队位置"
                    disabled={isFetchingNextPage}
                    onPress={() => fetchNextPage()}
                    style={[
                      styles.refreshButton,
                      {
                        borderColor: colors.border,
                        borderRadius: radius.pill,
                        opacity: isFetchingNextPage ? 0.6 : 1,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="chevron-down"
                      size={18}
                      color={colors.brand.primary}
                    />
                    <Text
                      style={[
                        typography.captionSm,
                        { color: colors.brand.primary },
                      ]}
                    >
                      {isFetchingNextPage
                        ? '加载中…'
                        : `加载更多（已显示 ${queue.activePositions.length}/${queue.totalActivePositions}）`}
                    </Text>
                  </Pressable>
                ) : null}
                </>
              )}
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(260).delay(150)}
              style={{ marginTop: spacing.xl }}
            >
              <Text
                style={[
                  typography.headingSm,
                  { color: colors.text.primary, marginBottom: spacing.md },
                ]}
              >
                最近红包
              </Text>
              {queue.recentRewards.length === 0 ? (
                <Text
                  style={[
                    typography.body,
                    { color: colors.text.secondary },
                  ]}
                >
                  暂无红包记录。队列暖场阶段可能只有位置、暂时没有可分用户。
                </Text>
              ) : (
                <View
                  style={[
                    styles.rewardList,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radius.lg,
                    },
                  ]}
                >
                  {queue.recentRewards.map((reward, index) => (
                      <View
                        key={reward.id}
                        style={[
                          styles.rewardRow,
                          index > 0 && {
                            borderTopColor: colors.border,
                            borderTopWidth: StyleSheet.hairlineWidth,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.rewardIcon,
                            { backgroundColor: '#DDF4E7' },
                          ]}
                        >
                          <MaterialCommunityIcons
                            name="bell-check-outline"
                            size={21}
                            color="#176B43"
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            {...fitTextProps}
                            style={[
                              typography.bodyStrong,
                              { color: colors.text.primary },
                            ]}
                          >
                            来自订单 {reward.sourceOrderNo}
                          </Text>
                          <Text
                            style={[
                              typography.captionSm,
                              {
                                color: colors.text.secondary,
                                marginTop: 3,
                              },
                            ]}
                          >
                            已到账，可提现
                          </Text>
                        </View>
                        <Text
                          {...priceTextProps}
                          style={[
                            typography.bodyStrong,
                            { color: '#176B43' },
                          ]}
                        >
                          +¥{money(reward.amount)}
                        </Text>
                      </View>
                  ))}
                </View>
              )}
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(260).delay(210)}
              style={[
                styles.ruleCard,
                {
                  backgroundColor: '#F3F8F4',
                  borderColor: '#CEE2D4',
                  borderRadius: radius.lg,
                  marginTop: spacing.xl,
                },
              ]}
            >
              <Text
                style={[
                  typography.bodyStrong,
                  { color: colors.brand.primaryDark },
                ]}
              >
                规则一眼看懂
              </Text>
              {[
                `全平台共用一条队列，普通用户和 VIP 都参加，与商户无关。`,
                `每个新位置从该订单利润中拿出后台设定比例，分给前面 ${
                  queue.queueSize - 1
                } 个位置。`,
                '同一用户可以重复购买，新订单也可以奖励自己此前留下的位置。',
                '确认收货后只生成内部待结算记录；来源单和受益单的售后期都结束且均无退换货，红包才直接到账。',
              ].map((rule, index) => (
                <View key={rule} style={styles.ruleRow}>
                  <View style={styles.ruleIndex}>
                    <Text style={styles.ruleIndexText}>{index + 1}</Text>
                  </View>
                  <Text
                    style={[
                      typography.captionSm,
                      { color: colors.text.secondary, flex: 1 },
                    ]}
                  >
                    {rule}
                  </Text>
                </View>
              ))}
            </Animated.View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="刷新排队红包状态"
              onPress={() => refetch()}
              style={[
                styles.refreshButton,
                {
                  borderColor: colors.border,
                  borderRadius: radius.pill,
                  marginTop: spacing.lg,
                },
              ]}
            >
              <MaterialCommunityIcons
                name="refresh"
                size={18}
                color={colors.brand.primary}
              />
              <Text
                style={[
                  typography.captionSm,
                  { color: colors.brand.primary },
                ]}
              >
                刷新状态
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: '#164D37',
    overflow: 'hidden',
    padding: 22,
  },
  heroTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: '#EBCB7C',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 28,
    marginTop: 6,
  },
  heroSeal: {
    alignItems: 'center',
    backgroundColor: '#EBCB7C',
    borderRadius: 999,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  heroSealNumber: {
    color: '#164D37',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 24,
  },
  heroSealLabel: {
    color: '#164D37',
    fontSize: 10,
    fontWeight: '700',
  },
  moneyRow: {
    flexDirection: 'row',
    marginTop: 24,
  },
  moneyRowCompact: {
    flexDirection: 'column',
    gap: 16,
  },
  moneyItem: {
    flex: 1,
  },
  moneyDivider: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginHorizontal: 18,
    width: StyleSheet.hairlineWidth,
  },
  moneyLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
  },
  moneyValue: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    marginTop: 4,
  },
  moneyHint: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },
  notice: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modeTag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  emptyCard: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
  },
  positionCard: {
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    padding: 16,
  },
  positionTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
  },
  positionBadge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  rail: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 18,
    minHeight: 15,
  },
  railCell: {
    borderRadius: 3,
    flex: 1,
    height: 8,
    maxWidth: 15,
    minWidth: 4,
  },
  railCellCompleted: {
    backgroundColor: '#2B8A5A',
  },
  railCellWaiting: {
    backgroundColor: '#D9E2DD',
  },
  railMore: {
    color: '#7A8780',
    fontSize: 10,
    marginLeft: 2,
  },
  progressCopy: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  positionFoot: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
  },
  rewardList: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  rewardRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
    padding: 14,
  },
  rewardIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  ruleCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  ruleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  ruleIndex: {
    alignItems: 'center',
    backgroundColor: '#164D37',
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  ruleIndexText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  refreshButton: {
    alignItems: 'center',
    alignSelf: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: 18,
  },
});
