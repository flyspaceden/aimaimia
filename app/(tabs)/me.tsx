import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback';
import { AuthModal } from '../../src/components/overlay';
import { Countdown } from '../../src/components/ui/Countdown';
import { SeafoodIcon, type SeafoodIconName } from '../../src/components/ui/SeafoodIcon';
import { FloatingParticles } from '../../src/components/effects/FloatingParticles';
import { BonusRepo, CaptainRepo, InboxRepo, OrderRepo } from '../../src/repos';
import { LotteryRepo } from '../../src/repos/LotteryRepo';
import { useAuthStore, useCartStore } from '../../src/store';
import { compactActionTextProps, fitTextProps, priceTextProps, useResponsiveLayout, useTheme } from '../../src/theme';
import { OrderStatus } from '../../src/types';
import { getPrizeMergeNotice } from '../../src/utils/cartMerge';
import { buildMeReferralToolEntry } from '../../src/utils/referralRelation';

// 订单快捷入口
// 付款后建单架构：无 PENDING_PAYMENT 状态，未完成支付走 CheckoutSession 续付横幅
// 售后入口为 UI 派生（'afterSaleList' 路由参数），不是真实 OrderStatus
const orderEntries: Array<{ id: OrderStatus | 'afterSaleList'; label: string; icon: SeafoodIconName }> = [
  { id: 'PAID', label: '待发货', icon: 'lobster' },
  { id: 'SHIPPED', label: '已发货', icon: 'fish' },
  { id: 'DELIVERED', label: '待收货', icon: 'crab' },
  { id: 'afterSaleList', label: '换货/售后', icon: 'scallop' },
  { id: 'RECEIVED', label: '已完成', icon: 'puffer' },
];

type ToolEntry = {
  label: string;
  icon: SeafoodIconName;
  route: string;
};

// 工具网格
const TOOL_GRID_BASE: ToolEntry[] = [
  { label: '设置', icon: 'shrimp', route: '/settings' },
  { label: '地址', icon: 'abalone', route: '/me/addresses' },
  { label: '关注', icon: 'squid', route: '/me/following' },
  { label: '消息', icon: 'octopus', route: '/inbox' },
  { label: '我的福利', icon: 'conch', route: '/me/coupons' },
  { label: '数字资产', icon: 'puffer', route: '/me/digital-assets' },
  { label: '我的发票', icon: 'seaCucumber', route: '/invoices' },
  { label: '联系客服', icon: 'supportCrab', route: '/cs' },
];

function formatPercent(value?: number | null) {
  if (typeof value !== 'number') return '后台配置';
  const percent = value * 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2)}%`;
}

function getMsUntilNextUtc8Midnight(): number {
  const now = new Date();
  const nowUtc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const nextUtc8Midnight = new Date(
    Date.UTC(
      nowUtc8.getUTCFullYear(),
      nowUtc8.getUTCMonth(),
      nowUtc8.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
  return nextUtc8Midnight.getTime() - nowUtc8.getTime();
}

// 【AI 多轮对话已下线 — 过华为审查】「AI 小助手」整块已注释，恢复时取消注释即可
// AI 小助手 3 格
// const AI_TOOLS = [
//   { label: '聊天', icon: 'chat-outline' as const, route: '/ai/chat' },
//   { label: '助手', icon: 'robot-happy-outline' as const, route: '/ai/assistant' },
//   { label: '溯源', icon: 'qrcode-scan' as const, route: '/ai/trace' },
// ];

export default function MeScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const { isCompact, isLargeText } = useResponsiveLayout();
  const compactMe = isCompact || isLargeText;
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [vipModalOpen, setVipModalOpen] = useState(false);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const setLoggedIn = useAuthStore((state) => state.setLoggedIn);

  // const { data: taskData, isLoading: taskLoading } = useQuery({
  //   queryKey: ['me-tasks'],
  //   queryFn: () => TaskRepo.list(),
  // });
  // const { data: checkInData, refetch: refetchCheckIn } = useQuery({
  //   queryKey: ['me-checkin'],
  //   queryFn: () => CheckInRepo.getStatus(),
  // });
  const { data: orderCountData, refetch: refetchOrderCounts } = useQuery({
    queryKey: ['me-order-counts'],
    queryFn: () => OrderRepo.getStatusCounts(),
    enabled: isLoggedIn,
    refetchInterval: 60_000, // 60s 轮询（仅角标，比详情页省）
    refetchOnWindowFocus: true,
  });

  // 切回「我的」tab / 从订单页 back 回来时立即刷新角标
  useFocusEffect(
    React.useCallback(() => {
      if (isLoggedIn) refetchOrderCounts();
    }, [isLoggedIn, refetchOrderCounts]),
  );
  const { data: pendingData } = useQuery({
    queryKey: ['pending-checkout'],
    queryFn: () => OrderRepo.getPendingCheckout(),
    enabled: isLoggedIn,
    refetchInterval: 30_000,
  });
  const pendingSession = pendingData?.ok ? pendingData.data : null;
  const { data: inboxCountData } = useQuery({
    queryKey: ['me-inbox-unread'],
    queryFn: () => InboxRepo.getUnreadCount(),
    enabled: isLoggedIn,
  });
  const { data: walletData } = useQuery({
    queryKey: ['bonus-wallet'],
    queryFn: () => BonusRepo.getWallet(),
    enabled: isLoggedIn,
  });
  const { data: memberData } = useQuery({
    queryKey: ['bonus-member'],
    queryFn: () => BonusRepo.getMember(),
    enabled: isLoggedIn,
  });
  const {
    data: captainProfileData,
    isError: isCaptainProfileError,
    refetch: refetchCaptainProfile,
  } = useQuery({
    queryKey: ['captain-me'],
    queryFn: () => CaptainRepo.getMyCaptainProfile(),
    enabled: isLoggedIn,
  });
  const { data: lotteryStatusData } = useQuery({
    queryKey: ['lottery-today', isLoggedIn],
    queryFn: () => LotteryRepo.getTodayStatus(),
  });

  // const tasks = taskData?.ok ? taskData.data : [];
  // const checkIn = checkInData?.ok ? checkInData.data : null;
  const orderCounts = orderCountData?.ok ? orderCountData.data : null;
  const unreadCount = inboxCountData?.ok ? inboxCountData.data : 0;
  const walletBalance = walletData?.ok ? walletData.data.balance : 0;
  const member = memberData?.ok ? memberData.data : null;
  const captainProfile = captainProfileData?.ok ? captainProfileData.data : null;
  const captainProfileFailed = isLoggedIn && (isCaptainProfileError || captainProfileData?.ok === false);
  const lotteryStatus = lotteryStatusData?.ok ? lotteryStatusData.data : null;
  const lotteryRemaining = lotteryStatus?.remainingDraws ?? 0;
  const hasLotteryChance = Boolean(lotteryStatus && !lotteryStatus.hasDrawn);
  const lotterySummary = lotteryStatus
    ? hasLotteryChance
      ? `今天还有 ${lotteryRemaining} 次机会`
      : '今日已参与 · 明天再来'
    : '进入抽奖页查看今日机会';
  const directReferralPercentText = formatPercent(member?.directReferralPercent);
  const growthToolLabel = '耕耘值';
  const normalGrowthTool = useMemo(
    () => ({ label: growthToolLabel, icon: 'starfish' as const, route: '/me/growth' }),
    [growthToolLabel],
  );
  const toolGrid = useMemo(
    () => {
      const referralTool = buildMeReferralToolEntry(member);
      const entries: ToolEntry[] = [
        { label: referralTool.label, icon: 'seahorse', route: referralTool.route },
        normalGrowthTool,
      ];
      if (!captainProfileFailed) {
        if (captainProfile?.isCaptain) {
          entries.push({ label: '团长经营', icon: 'fish', route: '/me/captain' });
        } else {
          entries.push({
            label: '社区服务',
            icon: 'fish',
            route: '/me/captain-application',
          });
        }
      }
      return [...entries, ...TOOL_GRID_BASE];
    },
    [member, normalGrowthTool, captainProfile?.isCaptain, captainProfileFailed],
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['me-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['me-order-counts'] }),
      queryClient.invalidateQueries({ queryKey: ['me-inbox-unread'] }),
      queryClient.invalidateQueries({ queryKey: ['bonus-wallet'] }),
      queryClient.invalidateQueries({ queryKey: ['bonus-member'] }),
      queryClient.invalidateQueries({ queryKey: ['captain-me'] }),
      queryClient.invalidateQueries({ queryKey: ['lottery-today'] }),
    ]);
    setRefreshing(false);
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleNextRefresh = () => {
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['lottery-today'] });
        scheduleNextRefresh();
      }, getMsUntilNextUtc8Midnight() + 500);
    };
    scheduleNextRefresh();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [queryClient, isLoggedIn]);

  // const handleCheckIn = async () => {
  //   const result = await CheckInRepo.checkIn();
  //   if (!result.ok) {
  //     show({ message: result.error.displayMessage ?? '签到失败', type: 'error' });
  //     return;
  //   }
  //   const reward = result.data.lastReward;
  //   if (reward?.points || reward?.growth) {
  //     await UserRepo.applyRewards({
  //       points: reward.points ?? 0,
  //       growthPoints: reward.growth ?? 0,
  //     });
  //     await queryClient.invalidateQueries({ queryKey: ['me-profile'] });
  //   }
  //   const rewardLabel = reward?.label ?? '奖励已领取';
  //   show({ message: `签到成功，${rewardLabel}`, type: 'success' });
  //   refetchCheckIn();
  // };

  // 未登录拦截：普通入口弹登录提示，VIP 入口弹权益弹窗
  const isAuthed = isLoggedIn;
  const requireLogin = (action: () => void) => {
    if (!isAuthed) { setLoginPromptOpen(true); return; }
    action();
  };
  const handleVipPress = () => {
    // VIP用户直接进入会员权益页，未登录/普通用户弹出权益弹窗
    if (isAuthed && member?.tier === 'VIP') {
      router.push('/me/vip');
    } else {
      setVipModalOpen(true);
    }
  };
  return (
    <Screen contentStyle={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.xl }}>
          {/* ===== 5A. 活动中心：团购与抽奖从首页迁入 ===== */}
          <Animated.View
            entering={FadeInDown.duration(300)}
            style={{ marginTop: spacing.lg, marginBottom: spacing.xl }}
          >
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>活动中心</Text>
                <Text style={[typography.captionSm, { color: colors.muted, marginTop: 2 }]}>
                  团购好物与每日惊喜
                </Text>
              </View>
            </View>

            <Pressable
              onPress={() => router.push('/group-buy')}
              accessibilityRole="button"
              accessibilityLabel="精选团购，查看限时团购商品"
              style={{ marginTop: spacing.md }}
            >
              <LinearGradient
                colors={['#F8FFF9', '#E5F7EA']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                  styles.activityCard,
                  {
                    borderColor: 'rgba(38,123,72,0.18)',
                    borderRadius: radius.xl,
                  },
                  shadow.sm,
                ]}
              >
                <View style={styles.activitySeafoodWrap}>
                  <SeafoodIcon name="lobster" size={62} />
                </View>
                <View style={styles.activityCopy}>
                  <Text style={[typography.captionSm, { color: colors.brand.primary, fontWeight: '700' }]}>
                    限时拼团
                  </Text>
                  <Text style={[typography.bodyStrong, { color: colors.brand.primaryDark, marginTop: 2 }]}>
                    精选团购
                  </Text>
                  <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 3 }]}>
                    指定商品 · 团购活动
                  </Text>
                </View>
                <View style={[styles.activityCta, { backgroundColor: colors.brand.primary }]}>
                  <Text {...compactActionTextProps} style={[typography.captionSm, { color: '#FFFFFF', fontWeight: '700' }]}>
                    去拼团
                  </Text>
                </View>
              </LinearGradient>
            </Pressable>

            <Pressable
              onPress={() => router.push('/lottery' as any)}
              accessibilityRole="button"
              accessibilityLabel={
                lotteryStatus
                  ? hasLotteryChance
                    ? `每日抽奖，今天还有${lotteryRemaining}次机会`
                    : '每日抽奖，今天已经参与'
                  : '每日抽奖，进入抽奖页查看今日机会'
              }
              style={{ marginTop: spacing.md }}
            >
              <LinearGradient
                colors={['#2D8850', '#155D37']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.lotteryActivityCard, { borderRadius: radius.xl }, shadow.md]}
              >
                <View style={styles.lotteryGlow} />
                <View style={styles.lotteryCopy}>
                  <Text style={[typography.captionSm, { color: 'rgba(255,255,255,0.76)', fontWeight: '700' }]}>
                    每日惊喜
                  </Text>
                  <Text style={[typography.bodyStrong, { color: '#FFFFFF', marginTop: 3 }]}>幸运抽奖</Text>
                  <Text style={[typography.captionSm, { color: 'rgba(255,255,255,0.76)', marginTop: 4 }]}>
                    {lotterySummary}
                  </Text>
                </View>
                <View style={styles.lotterySeafoodWrap}>
                  <SeafoodIcon name="crab" size={72} />
                  {hasLotteryChance && lotteryRemaining > 0 ? (
                    <View style={styles.lotteryCountBadge}>
                      <Text style={styles.lotteryCountText}>{lotteryRemaining}</Text>
                    </View>
                  ) : null}
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color="rgba(255,255,255,0.84)" />
              </LinearGradient>
            </Pressable>
          </Animated.View>

          {/* ===== 5B. 订单快捷入口 ===== */}
          <Animated.View entering={FadeInDown.duration(300).delay(80)} style={{ marginBottom: spacing.lg }}>
            <View style={styles.sectionHeader}>
              <Text style={[typography.headingSm, { color: colors.text.primary }]}>我的订单</Text>
              <Pressable onPress={() => requireLogin(() => router.push('/orders'))}>
                <Text style={[typography.captionSm, { color: colors.muted }]}>全部订单 &gt;</Text>
              </Pressable>
            </View>
            <View
              style={[
                styles.orderRow,
                compactMe && styles.orderRowCompact,
                { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
                shadow.sm,
              ]}
            >
              {pendingSession ? (
                <Pressable
                  onPress={() => router.push({ pathname: '/checkout-pending', params: { sessionId: pendingSession.sessionId } })}
                  style={[styles.orderItem, compactMe && styles.orderItemCompact]}
                >
                  <View style={styles.orderIconWrap}>
                    <MaterialCommunityIcons name="credit-card-clock-outline" size={22} color="#FF6B35" />
                  </View>
                  <Text {...compactActionTextProps} style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}>
                    未完成支付
                  </Text>
                  <Countdown
                    expiresAt={pendingSession.expiresAt}
                    format="mm:ss"
                    style={{ color: '#FF6B35', fontSize: 10, marginTop: 2, fontWeight: '600' }}
                  />
                </Pressable>
              ) : null}
              {orderEntries.map((entry) => {
                const count = orderCounts
                  ? entry.id === 'afterSaleList'
                    ? (orderCounts.afterSale ?? 0) // 后端 getStatusCounts 已计算活跃售后订单数
                    : (orderCounts[entry.id as OrderStatus] ?? 0)
                  : 0;
                return (
                  <Pressable
                    key={entry.id}
                    onPress={() => requireLogin(() => router.push({ pathname: '/orders', params: { status: entry.id } }))}
                    style={[styles.orderItem, compactMe && styles.orderItemCompact]}
                  >
                    <View style={styles.orderIconWrap}>
                      <SeafoodIcon name={entry.icon} size={40} />
                      {count > 0 && (
                        <View style={[styles.orderBadge, { backgroundColor: colors.danger }]}>
                          <Text style={styles.orderBadgeText}>
                            {count > 99 ? '99+' : count}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text {...compactActionTextProps} style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}>
                      {entry.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>

          {/* ===== 5C. 财库与 VIP 全宽纵向卡片 ===== */}
          <View style={[styles.dualCards, { marginBottom: spacing.lg }]}>
            {/* 钱包卡 */}
            <Pressable
              onPress={() => requireLogin(() => router.push('/me/wallet'))}
              style={styles.dualCardItem}
            >
              <LinearGradient
                colors={['#F4C73B', '#E6AB15']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.dualCardGradient, { borderRadius: radius.xl }]}
              >
                <Image
                  source={require('../../assets/seafood/me-shell-ivory.png')}
                  style={styles.walletShell}
                  contentFit="contain"
                  transition={0}
                  pointerEvents="none"
                />
                <MaterialCommunityIcons name="wallet-outline" size={20} color="#FFFFFF" />
                <Text style={[typography.bodyStrong, { color: '#FFFFFF', marginTop: spacing.sm }]}>
                  我的财库
                </Text>
                <Text {...priceTextProps} style={[typography.headingMd, { color: '#FFFFFF', marginTop: 2 }]}>
                  ¥{Number(walletBalance ?? 0).toFixed(2)}
                </Text>
                <View style={[styles.dualCardCta, { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: radius.pill }]}>
                  <Text {...compactActionTextProps} style={[typography.captionSm, { color: '#FFFFFF' }]}>去提现</Text>
                </View>
              </LinearGradient>
            </Pressable>

            {/* VIP 卡 */}
            <Pressable
              onPress={handleVipPress}
              style={styles.dualCardItem}
            >
              <LinearGradient
                colors={['#3B9A59', '#17623A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.dualCardGradient, { borderRadius: radius.xl }]}
              >
                <Image
                  source={require('../../assets/seafood/me-shell-mint.png')}
                  style={styles.vipShell}
                  contentFit="contain"
                  transition={0}
                  pointerEvents="none"
                />
                <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View>
                    <MaterialCommunityIcons name="crown-outline" size={20} color="#FFFFFF" />
                    <Text style={[typography.bodyStrong, { color: '#FFFFFF', marginTop: spacing.sm }]}>
                      VIP
                    </Text>
                  </View>
                  <View style={{ justifyContent: 'center' }}>
                    <Text style={[typography.captionSm, { color: 'rgba(255,255,255,0.75)' }]}>
                      · 全场 95 折
                    </Text>
                    <Text style={[typography.captionSm, { color: 'rgba(255,255,255,0.75)', marginTop: 3 }]}>
                      · 更多奖励
                    </Text>
                    <Text style={[typography.captionSm, { color: 'rgba(255,255,255,0.75)', marginTop: 3 }]}>
                      · 减免运费权益
                    </Text>
                  </View>
                </View>
                <View style={[styles.dualCardCta, { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: radius.pill }]}>
                  <Text {...compactActionTextProps} style={[typography.captionSm, { color: '#FFFFFF' }]}>查看权益</Text>
                </View>
              </LinearGradient>
            </Pressable>
          </View>

          {/* 今日任务区暂时隐藏
          {/* ===== 5D. 今日任务区 ===== *\/}
          <View style={[styles.section, { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg }, shadow.sm]}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Text style={[typography.headingSm, { color: colors.text.primary, marginRight: spacing.sm }]}>今日任务</Text>
                <AiBadge variant="curated" />
              </View>
              <Pressable onPress={() => router.push('/me/tasks')}>
                <Text style={[typography.captionSm, { color: colors.muted }]}>全部 &gt;</Text>
              </Pressable>
            </View>

            {/* 签到紧凑行 *\/}
            {checkIn && (
              <Pressable
                onPress={handleCheckIn}
                disabled={checkIn.todayChecked}
                style={[
                  styles.checkInRow,
                  {
                    backgroundColor: checkIn.todayChecked ? colors.background : colors.brand.primarySoft,
                    borderRadius: radius.md,
                    padding: spacing.md,
                    marginBottom: spacing.sm,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={checkIn.todayChecked ? 'check-circle' : 'calendar-check'}
                  size={20}
                  color={checkIn.todayChecked ? colors.muted : colors.brand.primary}
                />
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text style={[typography.bodySm, { color: colors.text.primary }]}>
                    {checkIn.todayChecked ? '今日已签到' : '立即签到'}
                  </Text>
                  <Text style={[typography.captionSm, { color: colors.text.secondary }]}>
                    连续 {checkIn.streakDays} 天
                  </Text>
                </View>
                {!checkIn.todayChecked && (
                  <View style={[styles.checkInCta, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}>
                    <Text style={[typography.captionSm, { color: colors.text.inverse }]}>签到</Text>
                  </View>
                )}
              </Pressable>
            )}

            {/* 前 2 个任务 *\/}
            {taskLoading ? (
              <Skeleton height={60} radius={radius.md} />
            ) : tasks.length === 0 ? (
              <Text style={[typography.bodySm, { color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg }]}>
                暂无任务，稍后再来
              </Text>
            ) : (
              tasks.slice(0, 2).map((task) => (
                <Pressable
                  key={task.id}
                  onPress={() => router.push(task.targetRoute)}
                  style={[styles.taskRow, { borderBottomColor: colors.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodySm, { color: colors.text.primary }]}>{task.title}</Text>
                    <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 2 }]}>
                      {task.rewardLabel}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.taskStatus,
                      {
                        backgroundColor: task.status === 'done' ? colors.brand.primarySoft : colors.ai.soft,
                        borderRadius: radius.pill,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        typography.captionSm,
                        { color: task.status === 'done' ? colors.brand.primary : colors.ai.start },
                      ]}
                    >
                      {task.status === 'done' ? '已完成' : task.status === 'inProgress' ? '进行中' : '去完成'}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
          </View>
          今日任务区暂时隐藏结束 */}

          {/* ===== 5E. 工具网格 ===== */}
          <Animated.View entering={FadeInDown.duration(300).delay(160)} style={[styles.section, { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg }, shadow.sm]}>
            <Text style={[typography.headingSm, { color: colors.text.primary, marginBottom: spacing.md }]}>
              常用工具
            </Text>
            {captainProfileFailed ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="重新加载团长状态"
                onPress={() => { void refetchCaptainProfile(); }}
                style={{
                  alignItems: 'center',
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  borderWidth: StyleSheet.hairlineWidth,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  marginBottom: spacing.md,
                  minHeight: 44,
                  paddingHorizontal: spacing.md,
                }}
              >
                <Text style={[typography.captionSm, { color: colors.text.secondary, flex: 1 }]}>
                  团长状态加载失败
                </Text>
                <MaterialCommunityIcons name="refresh" size={20} color={colors.brand.primary} />
              </Pressable>
            ) : null}
            <View style={styles.toolGrid}>
              {toolGrid.map((tool) => (
                <Pressable
                  key={tool.label}
                  onPress={() => requireLogin(() => router.push(tool.route as any))}
                  style={[styles.toolItem, compactMe && styles.toolItemCompact]}
                >
                  <View style={styles.toolIcon}>
                    <SeafoodIcon name={tool.icon} size={43} />
                    {/* 消息角标 */}
                    {tool.label === '消息' && unreadCount > 0 && (
                      <View style={[styles.toolBadge, { backgroundColor: colors.danger }]}>
                        <Text style={styles.toolBadgeText}>
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 6 }]}>
                    {tool.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Animated.View>

          {/* ===== 5F. AI 小助手区（【AI 多轮对话已下线】整块已注释，恢复时取消注释即可）=====
          <Animated.View entering={FadeInDown.duration(300).delay(240)} style={[styles.section, { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg }, shadow.sm]}>
            <View style={styles.sectionTitleRow}>
              <Text style={[typography.headingSm, { color: colors.text.primary, marginRight: spacing.sm }]}>
                AI 小助手
              </Text>
              <AiBadge variant="analysis" />
            </View>
            <View style={[styles.aiToolGrid, { marginTop: spacing.md }]}>
              {AI_TOOLS.map((tool) => (
                <Pressable
                  key={tool.label}
                  onPress={() => router.push(tool.route as any)}
                  style={styles.aiToolItem}
                >
                  <View style={[styles.aiToolIcon, { backgroundColor: colors.ai.soft }]}>
                    <MaterialCommunityIcons name={tool.icon} size={22} color={colors.ai.start} />
                  </View>
                  <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 6 }]}>
                    {tool.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Animated.View>
          */}
        </View>
      </ScrollView>

      {/* ===== 登录提示弹窗 ===== */}
      <Modal transparent visible={loginPromptOpen} animationType="fade" onRequestClose={() => setLoginPromptOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setLoginPromptOpen(false)}>
          <Animated.View entering={FadeIn.duration(200)} style={styles.modalCenter}>
            <Pressable onPress={(e) => e.stopPropagation()}>
              <LinearGradient
                colors={[...gradients.aiGradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.loginPromptCard, shadow.lg, { borderRadius: radius.xl }]}
              >
                <FloatingParticles count={5} color={colors.ai.glow} />
                <View style={[styles.loginPromptIcon, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                  <MaterialCommunityIcons name="account-lock-outline" size={32} color="#FFFFFF" />
                </View>
                <Text style={[typography.title3, { color: '#FFFFFF', marginTop: 16, zIndex: 1 }]}>
                  请先登录
                </Text>
                <Text style={[typography.caption, { color: 'rgba(255,255,255,0.7)', marginTop: 8, textAlign: 'center', zIndex: 1 }]}>
                  登录后即可使用全部功能
                </Text>
                <Pressable
                  onPress={() => { setLoginPromptOpen(false); setAuthOpen(true); }}
                  style={[styles.loginPromptBtn, { borderRadius: radius.pill }]}
                >
                  <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>登录 / 注册</Text>
                </Pressable>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* ===== VIP 权益弹窗 ===== */}
      <Modal transparent visible={vipModalOpen} animationType="fade" onRequestClose={() => setVipModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setVipModalOpen(false)}>
          <Animated.View entering={FadeIn.duration(200)} style={styles.modalCenter}>
            <Pressable onPress={(e) => e.stopPropagation()}>
              <LinearGradient
                colors={[colors.brand.primary, colors.brand.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.vipModalCard, shadow.lg, { borderRadius: radius.xl }]}
              >
                <FloatingParticles count={6} color="rgba(255,215,0,0.3)" />
                <View style={[styles.loginPromptIcon, { backgroundColor: 'rgba(255,215,0,0.2)' }]}>
                  <MaterialCommunityIcons name="crown" size={32} color="#FFD700" />
                </View>
                <Text {...fitTextProps} style={[typography.title2, { color: '#FFFFFF', marginTop: 16, zIndex: 1 }]}>
                  VIP 会员权益
                </Text>
                <View style={[styles.vipPerkList, { zIndex: 1 }]}>
                  {[
                    { icon: 'sale' as const, text: '普通商品会员价' },
                    { icon: 'truck-fast-outline' as const, text: '更低包邮门槛' },
                    { icon: 'wallet-outline' as const, text: '消费积分抵扣更多' },
                    { icon: 'account-cash-outline' as const, text: `推荐 VIP 奖励 / 直推 ${directReferralPercentText}` },
                  ].map((perk) => (
                    <View key={perk.text} style={styles.vipPerkRow}>
                      <MaterialCommunityIcons name={perk.icon} size={18} color="#FFD700" />
                      <Text style={[typography.bodySm, { color: '#FFFFFF', marginLeft: 10 }]}>
                        {perk.text}
                      </Text>
                    </View>
                  ))}
                </View>
                <Pressable
                  onPress={() => {
                    setVipModalOpen(false);
                    router.push('/vip/gifts');
                  }}
                  style={[styles.vipModalBtn, { borderRadius: radius.pill }]}
                >
                  <LinearGradient
                    colors={[...gradients.goldGradient]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.vipModalBtnInner, { borderRadius: radius.pill }]}
                  >
                    <Text style={[typography.bodyStrong, { color: '#FFFFFF' }]}>购买VIP礼包</Text>
                  </LinearGradient>
                </Pressable>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={async (session) => {
          setLoggedIn({ accessToken: session.accessToken, refreshToken: session.refreshToken, userId: session.userId, loginMethod: session.loginMethod });
          // 登录成功后合并本地购物车到服务端（含 claimToken 奖品）
          const mergeOutcome = await useCartStore.getState().syncLocalCartToServer();
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['lottery-today'] }),
            queryClient.invalidateQueries({ queryKey: ['lottery-today-page'] }),
          ]);
          const prizeNotice = getPrizeMergeNotice(mergeOutcome?.mergeResults);
          if (prizeNotice) {
            show({ type: 'warning', message: `${prizeNotice.title}：${prizeNotice.message}` });
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // 通用
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  section: {},
  // 活动中心
  activityCard: {
    minHeight: 108,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  activitySeafoodWrap: {
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 8,
  },
  activityCta: {
    minWidth: 66,
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lotteryActivityCard: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 14,
    paddingVertical: 15,
    overflow: 'hidden',
  },
  lotteryGlow: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    right: 42,
    top: -70,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  lotteryCopy: {
    flex: 1,
    minWidth: 0,
    zIndex: 1,
  },
  lotterySeafoodWrap: {
    width: 82,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginHorizontal: 4,
    zIndex: 1,
  },
  lotteryCountBadge: {
    position: 'absolute',
    top: 0,
    right: 3,
    minWidth: 21,
    height: 21,
    borderRadius: 11,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF7A32',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  lotteryCountText: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
  },
  // 订单
  orderRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  orderRowCompact: {
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    rowGap: 12,
  },
  orderItem: {
    alignItems: 'center',
    paddingVertical: 4,
    flex: 1,
  },
  orderItemCompact: {
    width: '33.333%',
    flexBasis: '33.333%',
    flexGrow: 0,
    flexShrink: 0,
    minHeight: 68,
  },
  orderIconWrap: {
    position: 'relative',
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBadge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBadgeText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // 财库 / VIP 纵向卡片
  dualCards: {
    flexDirection: 'column',
    gap: 12,
  },
  dualCardItem: {
    width: '100%',
  },
  dualCardGradient: {
    padding: 16,
    minHeight: 152,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  dualCardCta: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 8,
    zIndex: 1,
  },
  walletShell: {
    position: 'absolute',
    width: 132,
    height: 132,
    right: -18,
    bottom: -22,
    opacity: 0.42,
    transform: [{ rotate: '-8deg' }],
  },
  vipShell: {
    position: 'absolute',
    width: 142,
    height: 142,
    left: '38%',
    bottom: -48,
    opacity: 0.19,
    transform: [{ rotate: '12deg' }],
  },
  // 签到行
  checkInRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkInCta: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  // 任务
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  taskStatus: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  // 工具网格
  toolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  toolItem: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: 10,
  },
  toolItemCompact: {
    width: '33.333%',
    flexBasis: '33.333%',
    flexGrow: 0,
    flexShrink: 0,
  },
  toolIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  toolBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBadgeText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // AI 工具网格
  aiToolGrid: {
    flexDirection: 'row',
  },
  aiToolItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  aiToolIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 登录提示 & VIP 弹窗
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCenter: {
    width: '85%',
    maxWidth: 340,
  },
  loginPromptCard: {
    padding: 28,
    alignItems: 'center',
    overflow: 'hidden',
  },
  loginPromptIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  loginPromptBtn: {
    marginTop: 20,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 32,
    paddingVertical: 12,
    zIndex: 1,
  },
  vipModalCard: {
    padding: 28,
    alignItems: 'center',
    overflow: 'hidden',
  },
  vipPerkList: {
    alignSelf: 'stretch',
    marginTop: 20,
  },
  vipPerkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  vipModalBtn: {
    alignSelf: 'stretch',
    marginTop: 24,
    overflow: 'hidden',
  },
  vipModalBtnInner: {
    paddingVertical: 14,
    alignItems: 'center',
  },
});
