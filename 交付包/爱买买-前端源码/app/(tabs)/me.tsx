import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AuthModal } from '../../src/components/overlay';
import { AvatarFrame, Tag } from '../../src/components/ui';
import { orderStatusLabels } from '../../src/constants/statuses';
import { CheckInRepo, FollowRepo, InboxRepo, OrderRepo, RecommendRepo, TaskRepo, UserRepo } from '../../src/repos';
import { useAuthStore, useCartStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { OrderStatus } from '../../src/types';

const orderEntries: Array<{ id: OrderStatus; label: string; icon: string }> = [
  { id: 'pendingPay', label: '待付款', icon: 'credit-card-outline' },
  { id: 'pendingShip', label: '待发货', icon: 'package-variant' },
  { id: 'shipping', label: '待收货', icon: 'truck-delivery-outline' },
  { id: 'afterSale', label: '退款/售后', icon: 'headset' },
];

const afterSaleProgress: Record<string, number> = {
  applying: 0.25,
  reviewing: 0.5,
  refunding: 0.75,
  completed: 1,
};
const afterSaleLabels: Record<string, string> = {
  applying: '申请中',
  reviewing: '审核中',
  refunding: '退款中',
  completed: '已完成',
};

const getGreeting = (name: string, interest?: string, streakDays?: number) => {
  if (streakDays && streakDays >= 3) {
    return `已连续签到 ${streakDays} 天，${name}`;
  }
  const hour = new Date().getHours();
  const period = hour < 11 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  if (interest) {
    return `${period}，热爱${interest}的${name}`;
  }
  return `${period}，${name}`;
};

export default function MeScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const setLoggedIn = useAuthStore((state) => state.setLoggedIn);
  const cartCount = useCartStore((state) => state.items.reduce((sum, item) => sum + item.quantity, 0));

  const { data: profileData, isLoading: profileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ['me-profile'],
    queryFn: () => UserRepo.profile(),
  });
  const { data: taskData, isLoading: taskLoading } = useQuery({
    queryKey: ['me-tasks'],
    queryFn: () => TaskRepo.list(),
  });
  const { data: checkInData, isLoading: checkInLoading, refetch: refetchCheckIn } = useQuery({
    queryKey: ['me-checkin'],
    queryFn: () => CheckInRepo.getStatus(),
  });
  const { data: recommendData, isLoading: recommendLoading, refetch: refetchRecommend } = useQuery({
    queryKey: ['me-recommend'],
    queryFn: () => RecommendRepo.listForMe(),
  });
  const { data: orderCountData } = useQuery({
    queryKey: ['me-order-counts'],
    queryFn: () => OrderRepo.getStatusCounts(),
  });
  const { data: inboxCountData } = useQuery({
    queryKey: ['me-inbox-unread'],
    queryFn: () => InboxRepo.getUnreadCount(),
  });
  const { data: followCountData } = useQuery({
    queryKey: ['me-follow-counts'],
    queryFn: async () => {
      const [userResult, companyResult] = await Promise.all([
        FollowRepo.listFollowing('user', 'recent'),
        FollowRepo.listFollowing('company', 'recent'),
      ]);
      return {
        users: userResult.ok ? userResult.data.length : 0,
        companies: companyResult.ok ? companyResult.data.length : 0,
      };
    },
  });
  const { data: issueData } = useQuery({
    queryKey: ['me-order-issue'],
    queryFn: () => OrderRepo.getLatestIssue(),
  });

  const profile = profileData?.ok ? profileData.data : null;
  const tasks = taskData?.ok ? taskData.data : [];
  const checkIn = checkInData?.ok ? checkInData.data : null;
  const recommendations = recommendData?.ok ? recommendData.data : [];
  const orderCounts = orderCountData?.ok ? orderCountData.data : null;
  const issueOrder = issueData?.ok ? issueData.data : null;
  const unreadCount = inboxCountData?.ok ? inboxCountData.data : 0;
  const unreadBadge = unreadCount > 99 ? '99+' : `${unreadCount}`;
  const cartBadge = cartCount > 99 ? '99+' : `${cartCount}`;
  const followCounts = followCountData ?? { users: 0, companies: 0 };
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['me-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['me-tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['me-checkin'] }),
      queryClient.invalidateQueries({ queryKey: ['me-recommend'] }),
      queryClient.invalidateQueries({ queryKey: ['me-order-counts'] }),
      queryClient.invalidateQueries({ queryKey: ['me-order-issue'] }),
      queryClient.invalidateQueries({ queryKey: ['me-inbox-unread'] }),
      queryClient.invalidateQueries({ queryKey: ['me-follow-counts'] }),
    ]);
    setRefreshing(false);
  };

  const greeting = useMemo(() => {
    if (!profile) {
      return '欢迎回来';
    }
    return getGreeting(profile.name, profile.interests?.[0], checkIn?.streakDays);
  }, [profile, checkIn?.streakDays]);
  const levelMeta = useMemo(() => {
    if (!profile) {
      return null;
    }
    const mapping: Record<string, { next: string; perks: string }> = {
      种子会员: { next: '生长会员', perks: '运费券/会员价' },
      生长会员: { next: '丰收会员', perks: '专属客服/活动名额' },
      丰收会员: { next: '更高等级', perks: '年度礼盒/顾问服务' },
    };
    return mapping[profile.level] ?? { next: '更多等级', perks: '权益持续升级' };
  }, [profile]);
  const profileTags = useMemo(() => {
    if (!profile) {
      return [];
    }
    const tags: string[] = [];
    if (checkIn?.streakDays) {
      tags.push(`连签${checkIn.streakDays}天`);
    }
    if (profile.interests?.length) {
      tags.push(...profile.interests.slice(0, 2));
    }
    return tags;
  }, [profile, checkIn?.streakDays]);
  const checkInSummary = useMemo(() => {
    if (!checkIn) {
      return null;
    }
    const nextDay = checkIn.todayChecked ? checkIn.streakDays : checkIn.streakDays + 1;
    const todayReward = checkIn.rewards.find((reward) => reward.day === nextDay);
    const upcomingReward = checkIn.rewards.find((reward) => reward.day === Math.min(nextDay + 1, 7));
    return { todayReward, upcomingReward };
  }, [checkIn]);
  // 推荐理由展示：移除前缀，保留简短标签
  const formatReason = (reason: string) => reason.replace(/^推荐理由[:：]\s*/, '');

  const headerBar = (
    <View
      style={[
        styles.topBarSticky,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
          paddingHorizontal: spacing.xl,
          paddingVertical: spacing.md,
        },
      ]}
    >
      <View style={styles.titleRow}>
        <View>
          <Text style={[typography.title2, { color: colors.text.primary }]}>我的</Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
            你的专属爱买买空间
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/inbox')}
            style={[
              styles.bellButton,
              {
                borderColor: colors.border,
                backgroundColor: colors.surface,
                borderRadius: radius.pill,
              },
            ]}
          >
            <MaterialCommunityIcons name="bell-outline" size={18} color={colors.text.secondary} />
            {unreadCount > 0 ? (
              <View style={[styles.bellBadge, { backgroundColor: colors.danger }]}>
                <Text style={[typography.caption, { color: colors.text.inverse }]}>{unreadBadge}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            onPress={() => router.push('/cart')}
            style={[
              styles.cartButton,
              {
                backgroundColor: colors.brand.primarySoft,
                borderRadius: radius.pill,
              },
            ]}
          >
            <Text style={[typography.title3, { color: colors.brand.primary }]}>🛒</Text>
            {cartCount > 0 ? (
              <View style={[styles.cartBadge, { backgroundColor: colors.accent.blue }]}>
                <Text style={[typography.caption, { color: colors.text.inverse }]}>{cartBadge}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>
    </View>
  );

  const handleCheckIn = async () => {
    const result = await CheckInRepo.checkIn();
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '签到失败', type: 'error' });
      return;
    }
    const reward = result.data.lastReward;
    if (reward?.points || reward?.growth) {
      // 签到奖励联动到积分/成长值（复杂业务逻辑需中文注释）
      await UserRepo.applyRewards({
        points: reward.points ?? 0,
        growthPoints: reward.growth ?? 0,
      });
      await queryClient.invalidateQueries({ queryKey: ['me-profile'] });
      await queryClient.invalidateQueries({ queryKey: ['me-vip-profile'] });
    }
    const rewardLabel = reward?.label ?? '奖励已领取';
    show({ message: `签到成功，${rewardLabel}`, type: 'success' });
    refetchCheckIn();
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <ScrollView
        stickyHeaderIndices={[0]}
        contentContainerStyle={{ paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {headerBar}
        <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>

        {!isLoggedIn ? (
          <View style={[styles.loginCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <View style={styles.loginInfo}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>登录/注册</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                登录后解锁会员权益、任务签到与订单追踪
              </Text>
            </View>
            <Pressable
              onPress={() => setAuthOpen(true)}
              style={[styles.loginButton, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>立即登录</Text>
            </Pressable>
          </View>
        ) : profileLoading ? (
          <Skeleton height={160} radius={radius.lg} />
        ) : profile ? (
          <Pressable
            onPress={() => router.push('/me/profile')}
            style={[styles.profileCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
          >
            <View style={styles.profileHeader}>
              <Pressable
                onPress={(event) => {
                  event.stopPropagation();
                  router.push('/me/appearance');
                }}
              >
                <AvatarFrame uri={profile.avatar} size={72} frame={profile.avatarFrame} />
              </Pressable>
              <View style={styles.profileInfo}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>{greeting}</Text>
                <Text style={[typography.title3, { color: colors.text.primary, marginTop: 4 }]}>
                  {profile.name}
                </Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                  {profile.location}
                </Text>
                {profileTags.length > 0 ? (
                  <View style={styles.tagRow}>
                    {profileTags.map((tag, index) => (
                      <Tag
                        key={`${tag}-${index}`}
                        label={tag}
                        tone={index === 0 ? 'accent' : 'neutral'}
                        style={{ marginRight: 6, marginTop: 6 }}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
              <View style={styles.profileActions}>
                <Pressable
                  onPress={(event) => {
                    event.stopPropagation();
                    router.push('/ai/assistant');
                  }}
                  style={[
                    styles.aiButton,
                    {
                      borderColor: colors.accent.blue,
                      backgroundColor: colors.accent.blueSoft,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <MaterialCommunityIcons name="robot-happy-outline" size={16} color={colors.accent.blue} />
                  <Text style={[typography.caption, { color: colors.accent.blue, marginLeft: 6 }]}>AI农管家</Text>
                </Pressable>
                <Pressable
                  onPress={(event) => {
                    event.stopPropagation();
                    router.push('/me/vip');
                  }}
                  style={[styles.vipButton, { borderColor: colors.brand.primary, borderRadius: radius.pill }]}
                >
                  <Text style={[typography.caption, { color: colors.brand.primary }]}>会员权益</Text>
                </Pressable>
              </View>
            </View>

            <View style={{ marginTop: spacing.sm }}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{profile.level}</Text>
              <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    { backgroundColor: colors.brand.primary, width: `${Math.min(100, profile.levelProgress * 100)}%` },
                  ]}
                />
              </View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                距离下一等级还差 {Math.max(0, profile.nextLevelPoints - profile.growthPoints)} 成长值
              </Text>
              {levelMeta ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                  下一等级：{levelMeta.next} · 权益：{levelMeta.perks}
                </Text>
              ) : null}
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                成长值来源：消费 / 互动 / 创作
              </Text>
            </View>

            <View style={styles.assetRow}>
              <View style={styles.assetItem}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>成长值</Text>
                <Text style={[typography.title3, { color: colors.text.primary }]}>{profile.growthPoints}</Text>
              </View>
              <View style={styles.assetItem}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>爱买买积分</Text>
                <Text style={[typography.title3, { color: colors.text.primary }]}>{profile.points}</Text>
              </View>
            </View>
          </Pressable>
        ) : (
          <ErrorState title="资料加载失败" description="请稍后重试" onAction={refetchProfile} />
        )}

        <View style={styles.dualRow}>
          <View style={[styles.checkCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <View style={styles.cardHeaderRow}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>7 天签到</Text>
              <Pressable onPress={() => show({ message: '连续签到奖励递增，断签后重置', type: 'info' })}>
                <Text style={[typography.caption, { color: colors.accent.blue }]}>奖励说明</Text>
              </Pressable>
            </View>
            {checkInLoading ? (
              <Skeleton height={80} radius={radius.md} />
            ) : checkIn ? (
              <>
                <View style={styles.checkinSummary}>
                  <View>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>今日奖励</Text>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: 2 }]}>
                      {checkInSummary?.todayReward?.label ?? '已领取'}
                    </Text>
                  </View>
                  <View>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>下一档</Text>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: 2 }]}>
                      {checkInSummary?.upcomingReward?.label ?? '完成周期'}
                    </Text>
                  </View>
                </View>
                <View style={styles.checkinRow}>
                  {checkIn.rewards.map((reward) => {
                    const checked = reward.day <= checkIn.streakDays;
                    return (
                      <View
                        key={reward.day}
                        style={[
                          styles.checkinDot,
                          {
                            backgroundColor: checked ? colors.brand.primary : colors.border,
                            borderColor: reward.highlight ? colors.accent.blue : colors.border,
                          },
                        ]}
                      >
                        <Text style={[typography.caption, { color: checked ? colors.text.inverse : colors.text.secondary }]}>
                          {reward.day}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                  连续 {checkIn.streakDays} 天 · 断签重置
                </Text>
                <Pressable
                  onPress={handleCheckIn}
                  disabled={checkIn.todayChecked}
                  style={[
                    styles.checkinButton,
                    {
                      backgroundColor: checkIn.todayChecked ? colors.border : colors.brand.primary,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Text style={[typography.caption, { color: checkIn.todayChecked ? colors.text.secondary : colors.text.inverse }]}>
                    {checkIn.todayChecked ? '今日已签到' : '签到'}
                  </Text>
                </Pressable>
              </>
            ) : (
              <EmptyState title="暂无签到" description="请稍后重试" />
            )}
          </View>

          <View style={[styles.taskCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <View style={styles.cardHeaderRow}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>我的任务/福利</Text>
              <View style={styles.headerActions}>
                <Pressable
                  onPress={() => show({ message: '完成任务可获得成长值/积分奖励', type: 'info' })}
                  style={{ marginRight: 10 }}
                >
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>规则</Text>
                </Pressable>
                <Pressable onPress={() => router.push('/me/tasks')}>
                  <Text style={[typography.caption, { color: colors.accent.blue }]}>全部</Text>
                </Pressable>
              </View>
            </View>
            {taskLoading ? (
              <Skeleton height={80} radius={radius.md} />
            ) : tasks.length === 0 ? (
              <EmptyState title="暂无任务" description="完成任务可获得奖励" />
            ) : (
              tasks.slice(0, 3).map((task) => (
                <Pressable
                  key={task.id}
                  onPress={() => router.push(task.targetRoute)}
                  style={[styles.taskRow, { borderBottomColor: colors.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.body, { color: colors.text.primary }]}>{task.title}</Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                      {task.rewardLabel}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.taskStatus,
                      {
                        backgroundColor:
                          task.status === 'done' ? colors.brand.primarySoft : colors.accent.blueSoft,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        typography.caption,
                        { color: task.status === 'done' ? colors.brand.primary : colors.accent.blue },
                      ]}
                    >
                      {task.status === 'done' ? '已完成' : task.status === 'inProgress' ? '进行中' : '去完成'}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
              完成任务可解锁头像框与等级成长值
            </Text>
          </View>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <View style={styles.sectionHeader}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>订单管理</Text>
            <Pressable onPress={() => router.push('/orders')}>
              <Text style={[typography.caption, { color: colors.accent.blue }]}>全部订单</Text>
            </Pressable>
          </View>
          <View style={styles.orderQuickRow}>
            <Pressable
              onPress={() => router.push({ pathname: '/orders', params: { status: 'afterSale' } })}
              style={[
                styles.quickChip,
                { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.pill },
              ]}
            >
              <MaterialCommunityIcons name="headset" size={16} color={colors.text.secondary} />
              <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 6 }]}>退款/售后</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/orders/track')}
              style={[
                styles.quickChip,
                { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.pill },
              ]}
            >
              <MaterialCommunityIcons name="map-marker-path" size={16} color={colors.text.secondary} />
              <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 6 }]}>物流追踪</Text>
            </Pressable>
          </View>
          <View style={styles.orderRow}>
            {orderEntries.map((entry, index) => {
              const count = orderCounts ? orderCounts[entry.id] : 0;
              return (
                <Pressable
                  key={entry.id}
                  onPress={() => router.push({ pathname: '/orders', params: { status: entry.id } })}
                  style={[
                    styles.orderItem,
                    {
                      borderColor: colors.border,
                      borderRadius: radius.lg,
                      marginRight: index === orderEntries.length - 1 ? 0 : 8,
                    },
                  ]}
                >
                  {count > 0 ? (
                    <View style={[styles.orderBadge, { backgroundColor: colors.danger, borderColor: colors.surface }]}>
                      <Text style={[styles.orderBadgeText, { color: colors.text.inverse }]}>
                        {count > 99 ? '99+' : count}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.orderIconWrap}>
                    <MaterialCommunityIcons name={entry.icon as any} size={20} color={colors.brand.primary} />
                  </View>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>{entry.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {issueOrder ? (
            <View style={[styles.issueCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={styles.issueHeader}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>异常订单</Text>
                <Pressable onPress={() => router.push({ pathname: '/orders/[id]', params: { id: issueOrder.id } })}>
                  <Text style={[typography.caption, { color: colors.accent.blue }]}>查看详情</Text>
                </Pressable>
              </View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                {issueOrder.id} · {orderStatusLabels[issueOrder.status]}
              </Text>
              <View style={[styles.progressTrack, { backgroundColor: colors.border, marginTop: 8 }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: colors.accent.blue,
                      width: `${Math.min(100, (afterSaleProgress[issueOrder.afterSaleStatus ?? 'reviewing'] || 0.4) * 100)}%`,
                    },
                  ]}
                />
              </View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                当前进度：{afterSaleLabels[issueOrder.afterSaleStatus ?? 'reviewing'] ?? '审核中'}
              </Text>
            </View>
          ) : (
            <View style={[styles.issueCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>暂无异常订单</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                售后进度会在这里展示，方便你快速处理
              </Text>
            </View>
          )}
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>我的入口</Text>
          <View style={[styles.entryCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Pressable onPress={() => router.push('/inbox')} style={[styles.entryRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.entryIcon, { backgroundColor: colors.brand.primarySoft }]}>
                <MaterialCommunityIcons name="bell-outline" size={18} color={colors.brand.primary} />
              </View>
              <View style={styles.entryInfo}>
                <View style={styles.entryTitleRow}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>消息中心</Text>
                  {unreadCount > 0 ? (
                    <View style={[styles.entryBadge, { backgroundColor: colors.danger }]}>
                      <Text style={[typography.caption, { color: colors.text.inverse }]}>{unreadBadge}</Text>
                    </View>
                  ) : (
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>全部已读</Text>
                  )}
                </View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  互动/交易/系统通知
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.secondary} />
            </Pressable>
            <Pressable onPress={() => router.push('/me/following')} style={[styles.entryRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.entryIcon, { backgroundColor: colors.accent.blueSoft }]}>
                <MaterialCommunityIcons name="account-heart-outline" size={18} color={colors.accent.blue} />
              </View>
              <View style={styles.entryInfo}>
                <View style={styles.entryTitleRow}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>我的关注</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>
                    {followCounts.users} 用户 · {followCounts.companies} 企业
                  </Text>
                </View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  查看动态与亲密度进度
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.secondary} />
            </Pressable>
            <Pressable onPress={() => router.push('/settings')} style={[styles.entryRow, styles.entryRowLast]}>
              <View style={[styles.entryIcon, { backgroundColor: colors.border }]}>
                <MaterialCommunityIcons name="cog-outline" size={18} color={colors.text.secondary} />
              </View>
              <View style={styles.entryInfo}>
                <View style={styles.entryTitleRow}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>设置</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>账户/隐私/通知</Text>
                </View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  偏好设置与权限管理
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.secondary} />
            </Pressable>
          </View>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <View style={styles.sectionHeader}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>为你推荐</Text>
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => {
                  refetchRecommend();
                  show({ message: '已刷新推荐', type: 'success' });
                }}
                style={{ marginRight: 12 }}
              >
                <Text style={[typography.caption, { color: colors.text.secondary }]}>换一批</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/me/recommend')}>
                <Text style={[typography.caption, { color: colors.accent.blue }]}>更多</Text>
              </Pressable>
            </View>
          </View>
          {recommendLoading ? (
            <Skeleton height={140} radius={radius.lg} />
          ) : recommendations.length === 0 ? (
            <EmptyState title="暂无推荐" description="稍后再来看看" actionLabel="刷新推荐" onAction={refetchRecommend} />
          ) : (
            recommendations.slice(0, 4).map((item) => (
              <View
                key={item.id}
                style={[styles.recommendRow, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
              >
                <Image source={{ uri: item.product.image }} style={styles.recommendImage} />
                <View style={styles.recommendInfo}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                    {item.product.title}
                  </Text>
                  <View style={styles.reasonRow}>
                    <Tag label={formatReason(item.reason)} tone="accent" />
                  </View>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: 6 }]}>
                    ¥{item.product.price}
                  </Text>
                </View>
                <Pressable
                  onPress={async () => {
                    const result = await RecommendRepo.markNotInterested(item.id);
                    if (!result.ok) {
                      show({ message: result.error.displayMessage ?? '操作失败', type: 'error' });
                      return;
                    }
                    show({ message: '已为你减少类似推荐', type: 'info' });
                    refetchRecommend();
                  }}
                  style={styles.recommendClose}
                >
                  <MaterialCommunityIcons name="thumb-down-outline" size={18} color={colors.text.secondary} />
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>不感兴趣</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
        </View>
      </ScrollView>
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={(session) => setLoggedIn({ accessToken: session.accessToken, loginMethod: session.loginMethod })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBarSticky: {
    borderBottomWidth: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bellButton: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
  },
  bellBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cartButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cartBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  aiButton: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  profileCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  loginCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  loginInfo: {
    flex: 1,
    marginRight: 12,
  },
  loginButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileInfo: {
    flex: 1,
    marginRight: 8,
    marginLeft: 12,
  },
  vipButton: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  profileActions: {
    alignItems: 'flex-end',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  assetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  assetItem: {
    flex: 1,
    alignItems: 'center',
  },
  dualRow: {
    marginTop: 16,
  },
  taskCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 16,
  },
  checkCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  taskStatus: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  checkinSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  checkinRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  checkinDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    borderWidth: 1,
  },
  checkinButton: {
    marginTop: 10,
    paddingVertical: 6,
    alignItems: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  orderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  orderQuickRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  quickChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
  },
  orderItem: {
    flex: 1,
    position: 'relative',
    paddingVertical: 12,
    marginRight: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  orderIconWrap: {
    marginBottom: 6,
  },
  orderBadge: {
    position: 'absolute',
    top: 6,
    right: 10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  orderBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
  },
  issueCard: {
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  issueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  entryCard: {
    marginTop: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  entryRowLast: {
    borderBottomWidth: 0,
  },
  entryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  entryInfo: {
    flex: 1,
    marginRight: 8,
  },
  entryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  entryBadge: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  recommendRow: {
    flexDirection: 'row',
    padding: 12,
    marginBottom: 12,
  },
  recommendImage: {
    width: 64,
    height: 64,
    borderRadius: 12,
    marginRight: 12,
  },
  recommendInfo: {
    flex: 1,
  },
  recommendClose: {
    alignItems: 'center',
    paddingLeft: 8,
  },
  reasonRow: {
    marginTop: 6,
  },
});
