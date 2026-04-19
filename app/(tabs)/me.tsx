import React, { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AuthModal } from '../../src/components/overlay';
import { AvatarFrame } from '../../src/components/ui';
import { AiBadge } from '../../src/components/ui/AiBadge';
import { FloatingParticles } from '../../src/components/effects/FloatingParticles';
import { BonusRepo, CouponRepo, InboxRepo, OrderRepo, UserRepo } from '../../src/repos';
import { useAuthStore, useCartStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { monoFamily } from '../../src/theme/typography';
import { OrderStatus } from '../../src/types';
import { getPrizeMergeNotice } from '../../src/utils/cartMerge';

// 订单快捷入口（问题单复用 afterSale 状态，后端 issueFlag 已移除）
const orderEntries: Array<{ id: OrderStatus; label: string; icon: string }> = [
  { id: 'pendingPay', label: '待付款', icon: 'credit-card-outline' },
  { id: 'pendingShip', label: '待发货', icon: 'package-variant' },
  { id: 'shipping', label: '待收货', icon: 'truck-delivery-outline' },
  { id: 'afterSale', label: '换货/售后', icon: 'headset' },
  { id: 'completed', label: '已完成', icon: 'check-circle-outline' },
];

// 工具网格
const TOOL_GRID = [
  { label: '设置', icon: 'cog-outline' as const, route: '/settings' },
  { label: '地址', icon: 'map-marker-outline' as const, route: '/me/addresses' },
  { label: '关注', icon: 'account-heart-outline' as const, route: '/me/following' },
  { label: '消息', icon: 'bell-outline' as const, route: '/inbox' },
  { label: '奖励', icon: 'ticket-percent-outline' as const, route: '/me/wallet' },
  { label: '我的红包', icon: 'ticket-percent-outline' as const, route: '/me/coupons' },
  { label: '联系客服', icon: 'headset' as const, route: '/cs?source=MY_PAGE' },
];

// AI 小助手 3 格
const AI_TOOLS = [
  { label: '聊天', icon: 'chat-outline' as const, route: '/ai/chat' },
  { label: '助手', icon: 'robot-happy-outline' as const, route: '/ai/assistant' },
  { label: '溯源', icon: 'qrcode-scan' as const, route: '/ai/trace' },
];

export default function MeScreen() {
  const { colors, radius, shadow, spacing, typography, gradients, isDark } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [vipModalOpen, setVipModalOpen] = useState(false);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const setLoggedIn = useAuthStore((state) => state.setLoggedIn);

  const { data: profileData, isLoading: profileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ['me-profile'],
    queryFn: () => UserRepo.profile(),
    enabled: isLoggedIn,
  });
  // const { data: taskData, isLoading: taskLoading } = useQuery({
  //   queryKey: ['me-tasks'],
  //   queryFn: () => TaskRepo.list(),
  // });
  // const { data: checkInData, refetch: refetchCheckIn } = useQuery({
  //   queryKey: ['me-checkin'],
  //   queryFn: () => CheckInRepo.getStatus(),
  // });
  const { data: orderCountData } = useQuery({
    queryKey: ['me-order-counts'],
    queryFn: () => OrderRepo.getStatusCounts(),
    enabled: isLoggedIn,
  });
  const { data: inboxCountData } = useQuery({
    queryKey: ['me-inbox-unread'],
    queryFn: () => InboxRepo.getUnreadCount(),
    enabled: isLoggedIn,
  });
  const { data: walletData } = useQuery({
    queryKey: ['my-wallet'],
    queryFn: () => BonusRepo.getWallet(),
    enabled: isLoggedIn,
  });
  const { data: memberData } = useQuery({
    queryKey: ['bonus-member'],
    queryFn: () => BonusRepo.getMember(),
    enabled: isLoggedIn,
  });

  const profile = profileData?.ok ? profileData.data : null;
  // const tasks = taskData?.ok ? taskData.data : [];
  // const checkIn = checkInData?.ok ? checkInData.data : null;
  const orderCounts = orderCountData?.ok ? orderCountData.data : null;
  const unreadCount = inboxCountData?.ok ? inboxCountData.data : 0;
  const walletBalance = walletData?.ok ? walletData.data.balance : 0;
  const member = memberData?.ok ? memberData.data : null;
  const isVip = member?.tier === 'VIP';
  const referralCode = isVip ? (member?.referralCode ?? '') : '';
  const deepLink = `https://app.ai-maimai.com/r/${referralCode}`;

  // 复制推荐码
  const handleCopyReferral = async () => {
    await Clipboard.setStringAsync(referralCode);
    show({ message: '推荐码已复制', type: 'success' });
  };

  // 分享推荐码
  const handleShareReferral = async () => {
    try {
      const result = await Share.share({
        message: `我在爱买买发现了优质农产品，使用我的推荐码 ${referralCode} 注册，双方都能获得红包奖励！${deepLink}`,
      });
      if (result.action === Share.sharedAction) {
        CouponRepo.reportShareEvent({
          scene: 'REFERRAL',
          targetId: referralCode || 'GLOBAL',
        }).catch(() => {});
      }
    } catch {
      // 用户取消分享
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['me-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['me-order-counts'] }),
      queryClient.invalidateQueries({ queryKey: ['me-inbox-unread'] }),
      queryClient.invalidateQueries({ queryKey: ['my-wallet'] }),
    ]);
    setRefreshing(false);
  };

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

  const greeting = useMemo(() => {
    if (!profile) return '欢迎回来';
    const hour = new Date().getHours();
    const period = hour < 11 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
    return `${period}，${profile.name}`;
  }, [profile]);

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
        {/* ===== 5A. 用户卡片 ===== */}
        {!isLoggedIn ? (
          /* 未登录态 */
          <Animated.View entering={FadeInDown.duration(300)} style={[styles.loginCard, { margin: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.lg }, shadow.sm]}>
            <View style={styles.loginInfo}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>登录/注册</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                登录后解锁会员权益与订单追踪
              </Text>
            </View>
            <View style={styles.loginActions}>
              <Pressable
                onPress={() => router.push('/me/scanner')}
                hitSlop={10}
                style={[styles.scanIconBtn, { borderColor: colors.border, marginRight: 10 }]}
              >
                <MaterialCommunityIcons name="qrcode-scan" size={20} color={colors.brand.primary} />
              </Pressable>
              <Pressable
                onPress={() => setAuthOpen(true)}
                style={[styles.loginButton, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
              >
                <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>立即登录/注册</Text>
              </Pressable>
            </View>
          </Animated.View>
        ) : profileLoading ? (
          <View style={{ margin: spacing.xl }}>
            <Skeleton height={140} radius={radius.lg} />
          </View>
        ) : profile ? (
          <LinearGradient
            colors={[`${colors.brand.primary}10`, `${colors.ai.start}08`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.userCard, { margin: spacing.xl, borderRadius: radius.lg }]}
          >
            <View style={styles.userCardTop}>
              <Pressable onPress={() => router.push('/me/appearance')}>
                <AvatarFrame uri={profile.avatar} size={64} frame={profile.avatarFrame} />
              </Pressable>
              <View style={styles.userCardInfo}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>{greeting}</Text>
                <View style={styles.nameRow}>
                  <Text style={[typography.headingSm, { color: colors.text.primary }]}>
                    {profile.name}
                  </Text>
                  {/* VIP 徽章 */}
                  <View style={[styles.vipBadge, { backgroundColor: colors.gold.light }]}>
                    <Text style={[typography.captionSm, { color: colors.gold.primary }]}>
                      {profile.level}
                    </Text>
                  </View>
                  {/* 推荐码按钮 */}
                  {referralCode ? (
                    <Pressable
                      onPress={() => setReferralOpen(true)}
                      style={[styles.referralChip, { backgroundColor: colors.ai.soft, borderRadius: radius.pill }]}
                    >
                      <MaterialCommunityIcons name="qrcode" size={15} color={colors.ai.start} />
                      <Text style={[typography.captionSm, { color: colors.ai.start, marginLeft: 3 }]}>推荐码</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              <View style={styles.userCardActions}>
                <Pressable
                  onPress={() => router.push('/me/scanner')}
                  hitSlop={8}
                  style={[styles.actionChip, { borderColor: colors.border, backgroundColor: colors.surface }]}
                >
                  <MaterialCommunityIcons name="qrcode-scan" size={14} color={colors.brand.primary} />
                  <Text style={[typography.captionSm, { color: colors.text.secondary, marginLeft: 4 }]}>扫一扫</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push('/me/profile')}
                  style={[styles.actionChip, { borderColor: colors.border, backgroundColor: colors.surface, marginTop: 6 }]}
                >
                  <MaterialCommunityIcons name="pencil-outline" size={14} color={colors.text.secondary} />
                  <Text style={[typography.captionSm, { color: colors.text.secondary, marginLeft: 4 }]}>编辑</Text>
                </Pressable>
              </View>
            </View>
          </LinearGradient>
        ) : (
          <View style={{ margin: spacing.xl }}>
            <ErrorState title="资料加载失败" description="请稍后重试" onAction={refetchProfile} />
          </View>
        )}

        <View style={{ paddingHorizontal: spacing.xl }}>
          {/* ===== 5B. 订单快捷入口 ===== */}
          <Animated.View entering={FadeInDown.duration(300).delay(80)} style={{ marginBottom: spacing.lg }}>
            <View style={styles.sectionHeader}>
              <Text style={[typography.headingSm, { color: colors.text.primary }]}>我的订单</Text>
              <Pressable onPress={() => requireLogin(() => router.push('/orders'))}>
                <Text style={[typography.captionSm, { color: colors.muted }]}>全部订单 &gt;</Text>
              </Pressable>
            </View>
            <View style={[styles.orderRow, { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md }, shadow.sm]}>
              {orderEntries.map((entry) => {
                const count = orderCounts
                  ? entry.id === 'shipping'
                    ? (orderCounts.shipping ?? 0) + (orderCounts.delivered ?? 0)
                    : (orderCounts[entry.id] ?? 0)
                  : 0;
                return (
                  <Pressable
                    key={entry.id}
                    onPress={() => requireLogin(() => router.push({ pathname: '/orders', params: { status: entry.id } }))}
                    style={styles.orderItem}
                  >
                    <View style={styles.orderIconWrap}>
                      <MaterialCommunityIcons name={entry.icon as any} size={22} color={colors.brand.primary} />
                      {count > 0 && (
                        <View style={[styles.orderBadge, { backgroundColor: colors.danger }]}>
                          <Text style={styles.orderBadgeText}>
                            {count > 99 ? '99+' : count}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}>
                      {entry.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>

          {/* ===== 5C. 钱包/VIP 双卡片 ===== */}
          <View style={[styles.dualCards, { marginBottom: spacing.lg }]}>
            {/* 钱包卡 */}
            <Pressable
              onPress={() => requireLogin(() => router.push('/me/wallet'))}
              style={[styles.dualCardItem, { marginRight: spacing.sm }]}
            >
              <LinearGradient
                colors={[colors.gold.primary, '#E8B730']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.dualCardGradient, { borderRadius: radius.xl, flex: 1 }]}
              >
                <MaterialCommunityIcons name="wallet-outline" size={20} color="#FFFFFF" />
                <Text style={[typography.bodyStrong, { color: '#FFFFFF', marginTop: spacing.sm }]}>
                  钱包
                </Text>
                <Text style={[typography.headingMd, { color: '#FFFFFF', marginTop: 2 }]}>
                  ¥{walletBalance}
                </Text>
                <View style={[styles.dualCardCta, { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: radius.pill }]}>
                  <Text style={[typography.captionSm, { color: '#FFFFFF' }]}>去提现</Text>
                </View>
              </LinearGradient>
            </Pressable>

            {/* VIP 卡 */}
            <Pressable
              onPress={handleVipPress}
              style={[styles.dualCardItem, { marginLeft: spacing.sm }]}
            >
              <LinearGradient
                colors={[colors.brand.primary, colors.brand.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.dualCardGradient, { borderRadius: radius.xl, flex: 1 }]}
              >
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
                      · 免运费
                    </Text>
                  </View>
                </View>
                <View style={[styles.dualCardCta, { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: radius.pill }]}>
                  <Text style={[typography.captionSm, { color: '#FFFFFF' }]}>查看权益</Text>
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
            <View style={styles.toolGrid}>
              {TOOL_GRID.map((tool) => (
                <Pressable
                  key={tool.label}
                  onPress={() => requireLogin(() => router.push(tool.route as any))}
                  style={styles.toolItem}
                >
                  <View style={[styles.toolIcon, { backgroundColor: colors.background }]}>
                    <MaterialCommunityIcons name={tool.icon} size={20} color={colors.brand.primary} />
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

          {/* ===== 5F. AI 小助手区 ===== */}
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
        </View>
      </ScrollView>

      {/* ===== 推荐码浮层（背景虚化）===== */}
      <Modal transparent visible={referralOpen} animationType="fade" onRequestClose={() => setReferralOpen(false)}>
        {/* 虚化背景 */}
        {Platform.OS === 'ios' ? (
          <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.3)' }]} />
          </BlurView>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} />
        )}

        {/* 关闭按钮 */}
        <Pressable
          onPress={() => setReferralOpen(false)}
          style={styles.referralCloseBtn}
          hitSlop={10}
        >
          <MaterialCommunityIcons name="close-circle" size={32} color="rgba(255,255,255,0.7)" />
        </Pressable>

        {/* 推荐码卡片 */}
        <View style={styles.referralOverlay}>
          <Animated.View entering={FadeIn.duration(300)}>
            <LinearGradient
              colors={[...gradients.aiGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.referralCard, shadow.lg, { borderRadius: radius.xl }]}
            >
              {/* 粒子效果 */}
              <FloatingParticles count={8} color={colors.ai.glow} />

              {/* 标题 */}
              <View style={styles.referralTitleRow}>
                <Text style={[typography.bodyStrong, { color: '#FFFFFF' }]}>我的专属推荐码</Text>
                <AiBadge variant="recommend" />
              </View>

              {/* QR 码 */}
              <View style={[styles.referralQrBox, shadow.lg, { borderRadius: radius.xl, backgroundColor: '#FFFFFF' }]}>
                {referralCode ? (
                  <QRCode
                    value={deepLink}
                    size={160}
                    color={colors.brand.primaryDark}
                    backgroundColor="#FFFFFF"
                  />
                ) : (
                  <View style={{ width: 160, height: 160, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={[typography.caption, { color: colors.muted }]}>暂无推荐码</Text>
                  </View>
                )}
              </View>

              {/* 推荐码文字 */}
              <Text style={styles.referralCodeText}>
                {referralCode.split('').join(' ')}
              </Text>

              {/* 操作按钮 */}
              <View style={styles.referralActions}>
                <Pressable
                  onPress={handleCopyReferral}
                  style={[styles.referralOutlineBtn, { borderRadius: radius.pill }]}
                >
                  <MaterialCommunityIcons name="content-copy" size={16} color="#FFFFFF" />
                  <Text style={[typography.bodySm, { color: '#FFFFFF', marginLeft: 6 }]}>复制</Text>
                </Pressable>

                <View style={{ width: spacing.sm }} />

                <Pressable onPress={handleShareReferral} style={{ flex: 1 }}>
                  <LinearGradient
                    colors={[...gradients.goldGradient]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.referralShareBtn, { borderRadius: radius.pill }]}
                  >
                    <MaterialCommunityIcons name="share-variant-outline" size={16} color="#FFFFFF" />
                    <Text style={[typography.bodyStrong, { color: '#FFFFFF', marginLeft: 6 }]}>分享给好友</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </LinearGradient>
          </Animated.View>

          {/* 底部提示 */}
          <Text style={[typography.caption, { color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: spacing.md }]}>
            分享推荐码，好友注册后双方获得红包奖励
          </Text>
        </View>
      </Modal>

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
                <Text style={[typography.title2, { color: '#FFFFFF', marginTop: 16, zIndex: 1 }]}>
                  VIP 会员权益
                </Text>
                <View style={[styles.vipPerkList, { zIndex: 1 }]}>
                  {[
                    { icon: 'sale' as const, text: '全场商品享 95 折' },
                    { icon: 'cash-multiple' as const, text: '多买多补贴' },
                    { icon: 'gift-outline' as const, text: '惊喜礼包一份' },
                    { icon: 'truck-fast-outline' as const, text: '运费减免' },
                    { icon: 'headset' as const, text: '优先客服通道' },
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
  // 推荐码按钮（用户名旁）
  referralChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  // 推荐码浮层
  referralCloseBtn: {
    position: 'absolute',
    top: 54,
    right: 20,
    zIndex: 10,
  },
  referralOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  referralCard: {
    padding: 24,
    alignItems: 'center',
    overflow: 'hidden',
  },
  referralTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    marginBottom: 20,
    zIndex: 1,
  },
  referralQrBox: {
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  referralCodeText: {
    fontFamily: monoFamily,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 4,
    color: '#FFFFFF',
    marginTop: 18,
    textAlign: 'center',
    zIndex: 1,
  },
  referralActions: {
    flexDirection: 'row',
    marginTop: 18,
    width: '100%',
    zIndex: 1,
  },
  referralOutlineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  referralShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  // 登录卡
  loginCard: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  loginInfo: {
    flex: 1,
    marginRight: 12,
  },
  loginActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scanIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  // 用户卡片
  userCard: {
    padding: 16,
    overflow: 'hidden',
  },
  userCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userCardInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  vipBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  userCardActions: {
    alignItems: 'flex-end',
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
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
  // 订单
  orderRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  orderItem: {
    alignItems: 'center',
    paddingVertical: 4,
    flex: 1,
  },
  orderIconWrap: {
    position: 'relative',
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
  // 双卡片
  dualCards: {
    flexDirection: 'row',
  },
  dualCardItem: {
    flex: 1,
  },
  dualCardGradient: {
    padding: 16,
    minHeight: 140,
    justifyContent: 'space-between',
  },
  dualCardCta: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 8,
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
  toolIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
