import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../src/components/layout';
import { AuthModal } from '../../src/components/overlay';
import { FloatingParticles, AiOrb } from '../../src/components/effects';
import { AiSessionRepo } from '../../src/repos/AiSessionRepo';
import { LotteryRepo } from '../../src/repos/LotteryRepo';
import { useAuthStore, useCartStore, useAiChatStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AuthSession } from '../../src/types';
import { USE_MOCK } from '../../src/repos/http/config';
import { useVoiceRecording } from '../../src/hooks/useVoiceRecording';

// 时段问候语
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

// AI 引导语池
const AI_GUIDE_PHRASES = [
  '今天想吃点什么？',
  '有什么可以帮你的？',
  '看看今天有什么新鲜的？',
  '说出你想要的，我帮你找',
  '想试试当季好物吗？',
  '让我帮你挑选健康食材',
];

// 快捷指令数据
const QUICK_COMMANDS = [
  { label: '帮我找有机蔬菜', icon: 'leaf' as const },
  { label: '当季推荐水果', icon: 'fruit-watermelon' as const },
  { label: '健康食谱搭配', icon: 'food-apple-outline' as const },
  { label: '附近农场直供', icon: 'map-marker-radius-outline' as const },
  { label: '今日特惠', icon: 'tag-outline' as const },
  { label: '溯源查询', icon: 'qrcode-scan' as const },
];

/** 格式化相对时间 */
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}天前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
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

export default function HomeScreen() {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const cartCount = useCartStore((state) => state.items.reduce((sum, item) => sum + item.quantity, 0));
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const setLoggedIn = useAuthStore((s) => s.setLoggedIn);
  const [refreshing, setRefreshing] = useState(false);
  const [guidePhrase, setGuidePhrase] = useState('');
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // 语音录制 hook
  const voice = useVoiceRecording({ page: 'home' });

  // 避免长按松手后又触发一次短按，导致跳转被错误覆盖到 AI 聊天页
  const suppressShortPressUntilRef = useRef(0);

  // 从本地缓存读取最近对话（不依赖登录）
  const chatSessions = useAiChatStore((s) => s.sessions);
  const localRecentConversations = useMemo(() => {
    // 只展示有消息的会话
    return chatSessions
      .filter((s) => s.messages.length > 0)
      .slice(0, 3)
      .map((session) => {
        const firstUserMsg = session.messages.find((m) => m.role === 'user');
        const firstAiMsg = session.messages.find((m) => m.role === 'assistant');
        const truncate = (text: string | undefined, len: number) =>
          text ? text.slice(0, len) + (text.length > len ? '...' : '') : '';
        return {
          id: session.id,
          sessionId: session.id,
          question: truncate(firstUserMsg?.content, 25) || session.title,
          answer: truncate(firstAiMsg?.content, 30),
          time: formatRelativeTime(session.updatedAt),
        };
      });
  }, [chatSessions]);
  const recentSessionsQuery = useQuery({
    queryKey: ['ai-recent-conversations-home', isLoggedIn],
    queryFn: () => AiSessionRepo.listRecentConversations(3),
    enabled: !USE_MOCK && isLoggedIn,
  });
  const remoteRecentConversations = useMemo(() => {
    if (!recentSessionsQuery.data?.ok) return [];
    return recentSessionsQuery.data.data.map((conversation) => ({
      id: conversation.id,
      sessionId: conversation.sessionId,
      question: conversation.question
        ? conversation.question.slice(0, 25) + (conversation.question.length > 25 ? '...' : '')
        : '新对话',
      answer: conversation.answer
        ? conversation.answer.slice(0, 30) + (conversation.answer.length > 30 ? '...' : '')
        : '',
      time: formatRelativeTime(conversation.createdAt),
    }));
  }, [recentSessionsQuery.data]);
  const recentConversations = !USE_MOCK && isLoggedIn
    ? remoteRecentConversations
    : localRecentConversations;

  // 抽奖状态（后端 /lottery/today 已公开，登录态变化时重新请求）
  const { data: lotteryStatusData } = useQuery({
    queryKey: ['lottery-today', isLoggedIn],
    queryFn: () => LotteryRepo.getTodayStatus(),
  });
  const lotteryStatus = lotteryStatusData?.ok ? lotteryStatusData.data : null;
  const hasLotteryChance = !!(lotteryStatus && !lotteryStatus.hasDrawn);

  // 跨零点自动刷新抽奖状态
  useEffect(() => {
    const timer = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['lottery-today'] });
    }, getMsUntilNextUtc8Midnight() + 500); // +500ms 确保已过业务日切点
    return () => clearTimeout(timer);
  }, [queryClient, isLoggedIn]);

  // 随机选择 AI 引导语
  const pickGuidePhrase = useCallback(() => {
    const idx = Math.floor(Math.random() * AI_GUIDE_PHRASES.length);
    setGuidePhrase(AI_GUIDE_PHRASES[idx]);
  }, []);

  useEffect(() => {
    pickGuidePhrase();
  }, [pickGuidePhrase]);

  // 下拉刷新：更换引导语 + 刷新抽奖状态
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    pickGuidePhrase();
    queryClient.invalidateQueries({ queryKey: ['lottery-today'] });
    setTimeout(() => setRefreshing(false), 600);
  }, [pickGuidePhrase, queryClient]);

  const greeting = useMemo(() => getGreeting(), []);

  // --- 语音交互处理器 ---

  const handleLongPress = useCallback(() => {
    suppressShortPressUntilRef.current = Date.now() + 1500;
    void voice.startRecording();
  }, [voice.startRecording]);

  const handleOrbPressOut = useCallback(() => {
    void voice.stopRecording();
  }, [voice.stopRecording]);

  const handleClarifyCandidatePress = useCallback((candidateId: string) => {
    void voice.selectClarify(candidateId);
  }, [voice.selectClarify]);

  const handleVoiceAuthSuccess = useCallback((session: AuthSession) => {
    setAuthModalOpen(false);
    setLoggedIn({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      userId: session.userId,
      loginMethod: session.loginMethod,
    });
    void Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ['me-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['me-order-counts'] }),
      queryClient.invalidateQueries({ queryKey: ['me-inbox-unread'] }),
    ]);
    voice.retryAfterAuth();
  }, [voice.retryAfterAuth, queryClient, setLoggedIn]);

  // 首页自动跳转行为
  useEffect(() => {
    if (!voice.actionRoute) return;
    if (voice.needsAuth) return;

    const delay = voice.feedbackText ? 1500 : 0;
    const timer = setTimeout(() => {
      router.push({ pathname: voice.actionRoute as any, params: voice.actionParams || {} });
      voice.dismissFeedback();
    }, delay);
    return () => clearTimeout(timer);
  }, [voice.actionRoute, voice.needsAuth, voice.feedbackText, voice.actionParams, voice.dismissFeedback, router]);

  // needsAuth → 弹出 AuthModal
  useEffect(() => {
    if (voice.needsAuth) {
      const timer = setTimeout(() => setAuthModalOpen(true), 400);
      return () => clearTimeout(timer);
    }
  }, [voice.needsAuth]);

  // 短按：进入 AI 聊天页
  const handleShortPress = useCallback(() => {
    if (Date.now() < suppressShortPressUntilRef.current) {
      return;
    }
    if (!voice.isRecording && !voice.isProcessing) {
      router.push('/ai/chat');
    }
  }, [voice.isRecording, voice.isProcessing, router]);

  // --- 快捷指令点击：也走意图解析路径 ---
  const handleQuickCommand = useCallback(
    (label: string) => {
      router.push({ pathname: '/search', params: { q: label } });
    },
    [router]
  );

  // --- 录音按钮动画 ---
  const recordHaloScale = useSharedValue(1);
  const recordHaloOpacity = useSharedValue(0.18);
  const recordRippleScale = useSharedValue(1);
  const recordRippleOpacity = useSharedValue(0.3);

  useEffect(() => {
    if (voice.isRecording) {
      // 录音中：快速脉动
      recordHaloScale.value = withRepeat(
        withSequence(
          withTiming(1.25, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        ),
        -1, true,
      );
      recordHaloOpacity.value = withRepeat(
        withSequence(
          withTiming(0.35, { duration: 800 }),
          withTiming(0.12, { duration: 800 }),
        ),
        -1, true,
      );
      // 扩散波纹
      recordRippleScale.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 0 }),
          withTiming(1.6, { duration: 1200, easing: Easing.out(Easing.ease) }),
        ),
        -1,
      );
      recordRippleOpacity.value = withRepeat(
        withSequence(
          withTiming(0.25, { duration: 0 }),
          withTiming(0, { duration: 1200, easing: Easing.out(Easing.ease) }),
        ),
        -1,
      );
    } else {
      // 非录音：回到 idle 慢脉动（与 AiOrb idle 一致）
      recordHaloScale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
        ),
        -1, true,
      );
      recordHaloOpacity.value = withRepeat(
        withSequence(
          withTiming(0.15, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.4, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
        ),
        -1, true,
      );
      recordRippleScale.value = withTiming(1, { duration: 300 });
      recordRippleOpacity.value = withTiming(0, { duration: 300 });
    }
  }, [voice.isRecording, recordHaloScale, recordHaloOpacity, recordRippleScale, recordRippleOpacity]);

  const recordingHaloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: recordHaloScale.value }],
    opacity: recordHaloOpacity.value,
  }));

  const recordingRippleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: recordRippleScale.value }],
    opacity: recordRippleOpacity.value,
  }));

  // --- 抽奖悬浮按钮动画组 ---
  const fabScale = useSharedValue(1);
  const fabGlow = useSharedValue(0);
  const fabWobble = useSharedValue(0); // 图标左右摇摆
  const fabShine = useSharedValue(0); // 流光扫过

  useEffect(() => {
    if (lotteryStatus && !lotteryStatus.hasDrawn) {
      // 脉冲：缩放 1→1.08→1，循环
      fabScale.value = withRepeat(
        withSequence(
          withDelay(2500, withTiming(1.08, { duration: 500, easing: Easing.out(Easing.ease) })),
          withTiming(1, { duration: 500, easing: Easing.in(Easing.ease) }),
        ),
        -1,
      );
      // 光晕：0→1→0，循环
      fabGlow.value = withRepeat(
        withSequence(
          withDelay(2500, withTiming(1, { duration: 500 })),
          withTiming(0, { duration: 500 }),
        ),
        -1,
      );
      // 摇摆：脉冲间歇期连续晃 3 下（-12°→12°→-8°→8°→0°），像藏着宝藏急着被打开
      fabWobble.value = withRepeat(
        withSequence(
          withDelay(800, withTiming(-12, { duration: 80, easing: Easing.out(Easing.ease) })),
          withTiming(12, { duration: 100, easing: Easing.inOut(Easing.ease) }),
          withTiming(-8, { duration: 90, easing: Easing.inOut(Easing.ease) }),
          withTiming(8, { duration: 90, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 80, easing: Easing.in(Easing.ease) }),
          withDelay(3000, withTiming(0, { duration: 0 })), // 静止等待下一轮
        ),
        -1,
      );
      // 流光：从左到右扫过，循环
      fabShine.value = withRepeat(
        withSequence(
          withDelay(4000, withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) })),
          withTiming(0, { duration: 0 }),
        ),
        -1,
      );
    } else {
      fabScale.value = withTiming(1);
      fabGlow.value = withTiming(0);
      fabWobble.value = withTiming(0);
      fabShine.value = withTiming(0);
    }
  }, [lotteryStatus, fabScale, fabGlow, fabWobble, fabShine]);

  const fabAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fabScale.value }],
  }));

  const fabGlowStyle = useAnimatedStyle(() => ({
    opacity: fabGlow.value * 0.5,
    transform: [{ scale: 1 + fabGlow.value * 0.4 }],
  }));

  // 图标摇摆样式
  const fabIconWobbleStyle = useAnimatedStyle(() => ({
    transform: [{ rotateZ: `${fabWobble.value}deg` }],
  }));

  // 流光高光条（匹配 140px 抽奖按钮宽度）
  const fabShineStyle = useAnimatedStyle(() => ({
    opacity: fabShine.value * 0.6,
    transform: [{ translateX: -70 + fabShine.value * 140 }],
  }));

  // --- AiOrb state ---
  const orbState = voice.isRecording ? 'listening' : voice.isProcessing ? 'thinking' : 'idle';

  return (
    <Screen contentStyle={{ flex: 1 }}>
      {/* 背景漂浮粒子 */}
      <FloatingParticles count={18} color={colors.ai.start} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.ai.start}
          />
        }
      >
        {/* 问候语区域 */}
        <View style={[styles.greetingRow, { marginTop: spacing['3xl'] }]}>
          <View style={styles.greetingArea}>
            <Text
              style={[
                typography.displaySm,
                { color: colors.text.primary },
              ]}
            >
              {greeting} 🌿
            </Text>
            <Text
              style={[
                typography.bodyLg,
                { color: colors.text.secondary, marginTop: spacing.xs },
              ]}
            >
              {guidePhrase}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/cart')}
            style={styles.cartBtn}
          >
            <MaterialCommunityIcons name="cart-outline" size={24} color={colors.text.secondary} />
            {cartCount > 0 && (
              <View style={[styles.cartBadge, { backgroundColor: colors.brand.primary }]}>
                <Text style={[typography.captionSm, { color: colors.text.inverse, fontSize: 10, lineHeight: 14 }]}>
                  {cartCount > 99 ? '99+' : cartCount}
                </Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* 搜索框（胶囊形，点击跳转搜索页） */}
        <Pressable
          onPress={() => router.push('/search')}
          style={[
            styles.searchBar,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.pill,
              marginTop: spacing.xl,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
            },
            shadow.sm,
          ]}
        >
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={colors.muted}
          />
          <Text
            style={[
              typography.bodyLg,
              { color: colors.muted, marginLeft: spacing.sm, flex: 1 },
            ]}
          >
            搜索商品，或问我...
          </Text>
          <MaterialCommunityIcons
            name="microphone-outline"
            size={20}
            color={colors.ai.start}
          />
        </Pressable>

        {/* 今日已抽完提示 — 搜索框下方 */}
        {lotteryStatus && lotteryStatus.hasDrawn && (
          <Animated.View entering={FadeIn.duration(300)} style={[styles.drawnHint, { marginTop: spacing.sm }]}>
            <MaterialCommunityIcons name="gift-open-outline" size={14} color={colors.muted} />
            <Text style={[typography.captionSm, { color: colors.muted, marginLeft: spacing.xxs }]}>
              今日已抽奖，请明天再来
            </Text>
          </Animated.View>
        )}

        {/* AI光球 + 抽奖按钮区域 */}
        <Animated.View entering={FadeInDown.duration(300)}>
          {hasLotteryChance ? (
            /* 并排模式：两个等大的 120px 圆形按钮 */
            <View style={[styles.pairedRow, { marginTop: spacing['3xl'] }]}>
              {/* AI买买按钮 */}
              <View style={styles.pairedBtnWrap}>
                {/* 光环：始终脉动（idle 慢速 / 录音快速） */}
                <Animated.View
                  style={[
                    styles.pairedHalo,
                    { backgroundColor: colors.ai.start },
                    recordingHaloStyle,
                  ]}
                />
                {/* 录音时额外扩散波纹 */}
                {voice.isRecording && (
                  <Animated.View
                    style={[
                      styles.pairedHalo,
                      { backgroundColor: colors.ai.start },
                      recordingRippleStyle,
                    ]}
                  />
                )}
                <Pressable
                  onPress={handleShortPress}
                  onLongPress={handleLongPress}
                  onPressOut={handleOrbPressOut}
                  delayLongPress={400}
                  style={[styles.pairedBtn, shadow.lg, { backgroundColor: voice.isRecording ? colors.brand.primaryDark : colors.brand.primary }]}
                >
                  {voice.isRecording ? (
                    <>
                      <MaterialCommunityIcons name="microphone" size={40} color={colors.text.inverse} />
                      <Text style={[typography.bodySm, { color: colors.text.inverse, marginTop: 2 }]}>
                        正在听...
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.pairedAiTitle}>AI</Text>
                      <Text style={[styles.pairedAiSub, { color: colors.text.inverse }]}>买买</Text>
                    </>
                  )}
                </Pressable>
              </View>

              {/* 抽奖按钮 */}
              <Pressable
                onPress={() => router.push('/lottery' as any)}
                style={styles.lotteryInline}
              >
                {/* 光晕层 */}
                <Animated.View
                  style={[
                    styles.lotteryGlowRing,
                    { backgroundColor: '#F97316' },
                    fabGlowStyle,
                  ]}
                />
                {/* 按钮主体 */}
                <Animated.View
                  style={[
                    styles.lotteryButton,
                    shadow.lg,
                    { backgroundColor: '#F97316' },
                    fabAnimatedStyle,
                  ]}
                >
                  {/* 流光高光条 */}
                  <Animated.View
                    style={[styles.lotteryShine, fabShineStyle]}
                    pointerEvents="none"
                  />
                  {/* 图标带摇摆动画 */}
                  <Animated.View style={fabIconWobbleStyle}>
                    <MaterialCommunityIcons name="gift-outline" size={46} color="#FFFFFF" />
                  </Animated.View>
                  <Text style={styles.lotteryBtnLabel}>抽奖</Text>
                </Animated.View>
                {/* 剩余次数角标 */}
                {(lotteryStatus?.remainingDraws ?? 0) > 0 && (
                  <View style={styles.lotteryBadge}>
                    <Text style={styles.lotteryBadgeText}>
                      {lotteryStatus!.remainingDraws}
                    </Text>
                  </View>
                )}
              </Pressable>
            </View>
          ) : (
            /* 单独模式：完整大光球 */
            <AiOrb
              size="large"
              state={orbState}
              onPress={handleShortPress}
              onLongPress={handleLongPress}
              onPressOut={handleOrbPressOut}
              showLabel
              style={{ alignSelf: 'center', marginTop: spacing['4xl'] }}
            />
          )}

          {/* 提示文字 / AI 反馈文字 */}
          {voice.feedbackText ? (
            <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)}>
              <View style={styles.feedbackWrap}>
                <View style={[styles.feedbackBar, { backgroundColor: colors.ai.soft, borderRadius: radius.pill, marginTop: spacing.lg }]}>
                  {voice.isProcessing && !voice.feedbackText.includes('失败') ? (
                    <ActivityIndicator size="small" color={colors.ai.start} style={{ marginRight: spacing.xs }} />
                  ) : (
                    <MaterialCommunityIcons
                      name={voice.clarifyIntent ? 'help-circle-outline' : 'check-circle-outline'}
                      size={16}
                      color={colors.ai.start}
                      style={{ marginRight: spacing.xs }}
                    />
                  )}
                  <Text style={[typography.bodySm, { color: colors.ai.start, flexShrink: 1 }]}>
                    {voice.feedbackText}
                  </Text>
                </View>
                {/* Phase 2: 继续对话按钮 */}
                {voice.continueChatContext && !voice.clarifyIntent && (
                  <Pressable
                    onPress={() => {
                      const ctx = voice.continueChatContext;
                      if (ctx) {
                        router.push({
                          pathname: '/ai/chat',
                          params: {
                            initialTranscript: ctx.initialTranscript,
                            initialReply: ctx.initialReply,
                          },
                        });
                      }
                      voice.dismissFeedback();
                    }}
                    style={[
                      styles.clarifyChip,
                      {
                        borderRadius: radius.pill,
                        borderColor: colors.ai.start,
                        backgroundColor: colors.ai.soft,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.xs,
                        marginTop: spacing.sm,
                        alignSelf: 'center',
                      },
                    ]}
                  >
                    <MaterialCommunityIcons name="chat-outline" size={14} color={colors.ai.start} style={{ marginRight: 4 }} />
                    <Text style={[typography.bodySm, { color: colors.ai.start }]}>继续对话</Text>
                  </Pressable>
                )}
                {voice.clarifyIntent?.clarify?.candidates?.length ? (
                  <View style={[styles.clarifyList, { marginTop: spacing.sm }]}>
                    {voice.clarifyIntent.clarify.candidates.map((candidate) => (
                      <Pressable
                        key={candidate.id}
                        onPress={() => handleClarifyCandidatePress(candidate.id)}
                        style={[
                          styles.clarifyChip,
                          {
                            borderRadius: radius.pill,
                            borderColor: colors.ai.start,
                            backgroundColor: colors.surface,
                            paddingHorizontal: spacing.md,
                            paddingVertical: spacing.xs,
                          },
                        ]}
                      >
                        <Text style={[typography.bodySm, { color: colors.ai.start }]}>
                          {candidate.label}
                        </Text>
                      </Pressable>
                    ))}
                    <Pressable
                      onPress={() => {
                        voice.dismissFeedback();
                      }}
                      style={[
                        styles.clarifyChip,
                        {
                          borderRadius: radius.pill,
                          borderColor: colors.border,
                          backgroundColor: colors.surface,
                          paddingHorizontal: spacing.md,
                          paddingVertical: spacing.xs,
                        },
                      ]}
                    >
                      <Text style={[typography.bodySm, { color: colors.text.secondary }]}>
                        都不是
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </Animated.View>
          ) : (
            <Text
              style={[
                typography.bodySm,
                {
                  color: colors.ai.start,
                  textAlign: 'center',
                  marginTop: spacing.lg,
                },
              ]}
            >
              {voice.isRecording ? '松开发送语音' : '点击进入对话 · 长按语音指令'}
            </Text>
          )}
        </Animated.View>

        {/* 快捷指令气泡 */}
        <Animated.View entering={FadeInDown.duration(300).delay(80)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
              styles.quickCommandsContent,
              { gap: spacing.sm },
            ]}
            style={[styles.quickCommands, { marginTop: spacing['2xl'] }]}
          >
            {QUICK_COMMANDS.map((cmd) => (
              <Pressable
                key={cmd.label}
                onPress={() => handleQuickCommand(cmd.label)}
                hitSlop={10}
                style={[
                  styles.commandBubble,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radius.pill,
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.sm,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={cmd.icon}
                  size={14}
                  color={colors.ai.start}
                  style={{ marginRight: spacing.xs }}
                />
                <Text style={[typography.bodySm, { color: colors.text.primary }]}>
                  {cmd.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>

        {/* 最近对话 */}
        <Animated.View entering={FadeInDown.duration(300).delay(160)} style={[styles.recentSection, { marginTop: spacing['3xl'] }]}>
          <Text
            style={[
              typography.headingSm,
              { color: colors.text.primary, marginBottom: spacing.md },
            ]}
          >
            最近对话
          </Text>

          {recentConversations.length > 0 ? (
            recentConversations.map((conv, index) => (
              <Animated.View key={conv.id} entering={FadeInDown.duration(300).delay(50 + index * 30)}>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/ai/chat',
                      params: { sessionId: conv.sessionId ?? conv.id },
                    })
                  }
                  style={[
                    styles.conversationCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radius.lg,
                      padding: spacing.lg,
                      marginBottom: spacing.sm,
                    },
                    shadow.sm,
                  ]}
                >
                  {/* 小光球图标 */}
                  <View
                    style={[
                      styles.miniOrb,
                      { backgroundColor: colors.ai.soft },
                    ]}
                  >
                    <View
                      style={[
                        styles.miniOrbInner,
                        { backgroundColor: colors.ai.start },
                      ]}
                    />
                  </View>
                  <View style={styles.conversationText}>
                    <Text
                      style={[typography.bodySm, { color: colors.text.primary }]}
                      numberOfLines={1}
                    >
                      {conv.question}
                    </Text>
                    {conv.answer ? (
                      <Text
                        style={[
                          typography.captionSm,
                          { color: colors.text.secondary, marginTop: 2 },
                        ]}
                        numberOfLines={1}
                      >
                        {conv.answer}
                      </Text>
                    ) : null}
                    <Text
                      style={[
                        typography.captionSm,
                        { color: colors.muted, marginTop: spacing.xxs },
                      ]}
                    >
                      {conv.time}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={18}
                    color={colors.muted}
                  />
                </Pressable>
              </Animated.View>
            ))
          ) : (
            <View style={[styles.emptyState, { paddingVertical: spacing['3xl'] }]}>
              <Text style={[typography.bodySm, { color: colors.muted, textAlign: 'center' }]}>
                和爱买买聊聊，发现更多好物
              </Text>
            </View>
          )}
        </Animated.View>

        {/* 底部安全留白 */}
        <View style={{ height: spacing['4xl'] }} />
      </ScrollView>

      <AuthModal
        open={authModalOpen}
        onClose={() => {
          setAuthModalOpen(false);
        }}
        onSuccess={handleVoiceAuthSuccess}
      />

    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    zIndex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  greetingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greetingArea: {
    flex: 1,
    alignItems: 'flex-start',
  },
  cartBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  cartBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  quickCommands: {
    flexGrow: 0,
    marginHorizontal: -20, // 溢出父级 padding 实现满屏横滑
  },
  quickCommandsContent: {
    paddingHorizontal: 20,
  },
  commandBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  pairedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  pairedBtnWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairedHalo: {
    position: 'absolute',
    width: 164,
    height: 164,
    borderRadius: 82,
    opacity: 0.18,
  },
  pairedBtn: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairedAiTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  pairedAiSub: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: -2,
  },
  drawnHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lotteryInline: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lotteryGlowRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  lotteryButton: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  lotteryShine: {
    position: 'absolute',
    width: 18,
    height: 140,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  lotteryBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  lotteryBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 14,
  },
  lotteryBtnLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 2,
    letterSpacing: 1,
  },
  recentSection: {},
  conversationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  miniOrb: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  miniOrbInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  conversationText: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  feedbackWrap: {
    alignItems: 'center',
  },
  clarifyList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  clarifyChip: {
    borderWidth: 1,
  },
});
