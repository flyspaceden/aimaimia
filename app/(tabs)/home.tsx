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
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Screen } from '../../src/components/layout';
import { MeIdentityCard } from '../../src/components/cards';
import { VipHomePromoCarousel } from '../../src/components/data';
import { AuthModal } from '../../src/components/overlay';
import { PendingCheckoutBanner } from '../../src/components/overlay/PendingCheckoutBanner';
import { useToast } from '../../src/components/feedback';
import { FloatingParticles, AiOrb } from '../../src/components/effects';
import { SeafoodIcon } from '../../src/components/ui';
import { AiSessionRepo } from '../../src/repos/AiSessionRepo';
import { BonusRepo, DigitalAssetRepo, UserRepo } from '../../src/repos';
import { useAuthStore, useCartStore, useAiChatStore } from '../../src/store';
import { useResponsiveLayout, useTheme } from '../../src/theme';
import { AuthSession } from '../../src/types';
import {
  buildVipReferralHomePrompt,
  type VipHomePromoCard,
  type VipPromoMode,
} from '../../src/utils/vipHomePromo';
import { HOME_HERO_STATEMENT } from '../../src/utils/homeHero';
import { getHomeAiStageLayout } from '../../src/utils/homeAiStage';
import { USE_MOCK } from '../../src/repos/http/config';
import { useVoiceRecording } from '../../src/hooks/useVoiceRecording';

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

export default function HomeScreen() {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const { width, isCompact, isLargeText } = useResponsiveLayout();
  const compactHome = isCompact || isLargeText;
  const aiStageLayout = useMemo(
    () => getHomeAiStageLayout(width, spacing.xl),
    [spacing.xl, width]
  );
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const cartCount = useCartStore((state) => state.count());
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const setLoggedIn = useAuthStore((s) => s.setLoggedIn);
  const [refreshing, setRefreshing] = useState(false);
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
    // 【AI 最近对话已下线】停掉拉取，原: enabled: !USE_MOCK && isLoggedIn,
    enabled: false,
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

  // VIP 首页礼包展示：非 VIP 为购买语境；VIP 切推荐语境（好友开通可得），作为推荐弹药
  const { data: memberData } = useQuery({
    queryKey: ['bonus-member'],
    queryFn: () => BonusRepo.getMember(),
    enabled: isLoggedIn,
  });
  const { data: vipGiftOptionsData } = useQuery({
    queryKey: ['vip-gift-options'],
    queryFn: () => BonusRepo.getVipGiftOptions(),
  });
  const member = memberData?.ok ? memberData.data : null;
  const vipReferralPrompt = buildVipReferralHomePrompt(member);
  const vipPromoMode: VipPromoMode = member?.tier === 'VIP' ? 'referral' : 'purchase';
  const vipPackages = vipGiftOptionsData?.ok ? vipGiftOptionsData.data.packages : [];
  const { data: profileData, isLoading: profileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ['me-profile'],
    queryFn: () => UserRepo.profile(),
    enabled: isLoggedIn,
  });
  const { data: digitalAssetSummaryData } = useQuery({
    queryKey: ['digital-assets-summary'],
    queryFn: () => DigitalAssetRepo.getSummary(),
    enabled: isLoggedIn,
  });
  const profile = profileData?.ok ? profileData.data : null;
  const digitalAssetSummary = digitalAssetSummaryData?.ok ? digitalAssetSummaryData.data : null;
  const assetRankLabel = digitalAssetSummary?.assetRank != null
    ? String(digitalAssetSummary.assetRank)
    : '未上榜';
  const isVip = member?.tier === 'VIP';
  const referralCode = isVip ? (member.referralCode ?? '') : '';
  const showNormalShareEntry = Boolean(memberData?.ok && !isVip);

  // 下拉刷新：首页身份、会员礼包和数字资产
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    queryClient.invalidateQueries({ queryKey: ['me-profile'] });
    queryClient.invalidateQueries({ queryKey: ['bonus-member'] });
    queryClient.invalidateQueries({ queryKey: ['vip-gift-options'] });
    queryClient.invalidateQueries({ queryKey: ['digital-assets-summary'] });
    setTimeout(() => setRefreshing(false), 600);
  }, [queryClient]);

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
      queryClient.invalidateQueries({ queryKey: ['bonus-member'] }),
      queryClient.invalidateQueries({ queryKey: ['digital-assets-summary'] }),
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

  // 短按：原进入 AI 多轮聊天页，【AI 多轮对话已下线】——只保留长按语音，短按不再跳页
  const handleShortPress = useCallback(() => {
    if (Date.now() < suppressShortPressUntilRef.current) {
      return;
    }
    // 【AI 多轮对话已下线】原跳转（恢复时取消注释）：
    // if (!voice.isRecording && !voice.isProcessing) {
    //   router.push('/ai/chat');
    // }
  }, [voice.isRecording, voice.isProcessing, router]);

  const handleVipReferralPress = useCallback(() => {
    router.push('/me/referral');
  }, [router]);

  const handleCopyBuyerNo = useCallback(async () => {
    if (!profile?.buyerNo) {
      show({ message: '用户编号生成中', type: 'info' });
      return;
    }
    await Clipboard.setStringAsync(profile.buyerNo);
    show({ message: '用户编号已复制', type: 'success' });
  }, [profile?.buyerNo, show]);

  const handleVipPromoPress = useCallback((card: VipHomePromoCard) => {
    router.push({
      pathname: '/vip/gifts',
      params: {
        packageId: card.packageId,
        giftOptionId: card.giftOptionId,
      },
    });
  }, [router]);

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
        {/* 未完成订单横幅（无未支付订单时返回 null） */}
        <PendingCheckoutBanner />

        <Animated.View entering={FadeInDown.duration(300).delay(20)}>
          <View style={[styles.heroStatementWrap, { marginTop: spacing['3xl'] }]}>
            <Text
              accessibilityRole="header"
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              numberOfLines={2}
              style={[
                styles.heroStatement,
                compactHome && styles.heroStatementCompact,
                { color: colors.brand.primaryDark },
              ]}
            >
              {HOME_HERO_STATEMENT}
            </Text>
            <Pressable
              onPress={() => router.push('/cart')}
              accessibilityRole="button"
              accessibilityLabel={`购物车${cartCount > 0 ? `，${cartCount}件商品` : ''}`}
              style={[
                styles.cartBtn,
                styles.heroCartBtn,
                {
                  borderColor: colors.border,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surface,
                },
                shadow.sm,
              ]}
            >
              <MaterialCommunityIcons name="cart-outline" size={22} color={colors.text.secondary} />
              {cartCount > 0 && (
                <View style={[styles.cartBadge, { backgroundColor: colors.brand.primary }]}>
                  <Text style={[typography.captionSm, { color: colors.text.inverse, fontSize: 10, lineHeight: 14 }]}>
                    {cartCount > 99 ? '99+' : cartCount}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(40)}>
          <MeIdentityCard
            isLoggedIn={isLoggedIn}
            profileLoading={profileLoading}
            profile={profile}
            compact={compactHome}
            assetRankLabel={assetRankLabel}
            referralCode={referralCode}
            showNormalShareEntry={showNormalShareEntry}
            style={{ marginTop: spacing.xl }}
            onScanPress={() => router.push('/me/scanner')}
            onLoginPress={() => setAuthModalOpen(true)}
            onAppearancePress={() => router.push('/me/appearance')}
            onProfilePress={() => router.push('/me/profile')}
            onCopyBuyerNo={handleCopyBuyerNo}
            onReferralPress={() => router.push('/me/referral')}
            onNormalSharePress={() => router.push('/me/referral')}
            onDigitalAssetsPress={() => router.push('/me/digital-assets')}
            onRetryProfile={refetchProfile}
          />
        </Animated.View>

        {vipReferralPrompt ? (
          <Animated.View entering={FadeInDown.duration(300).delay(40)}>
            <Pressable
              onPress={handleVipReferralPress}
              accessibilityRole="button"
              accessibilityLabel={`${vipReferralPrompt.title}，${vipReferralPrompt.actionLabel}`}
              style={[
                styles.vipReferralStrip,
                {
                  marginTop: spacing.lg,
                  borderRadius: radius.pill,
                  borderColor: 'rgba(51,140,83,0.16)',
                },
                shadow.sm,
              ]}
            >
              <View style={styles.vipReferralGlow} pointerEvents="none" />
              <View style={styles.vipReferralIconHalo}>
                <SeafoodIcon name="scallop" size={38} />
              </View>
              <View style={styles.vipReferralCopy}>
                <Text
                  style={styles.vipReferralText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.86}
                  maxFontSizeMultiplier={1.1}
                >
                  {vipReferralPrompt.title}
                </Text>
                <Text
                  style={styles.vipReferralHint}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.1}
                >
                  邀请好友 · 一起享 VIP 礼遇
                </Text>
              </View>
              <View style={styles.vipReferralCta}>
                <Text
                  style={styles.vipReferralCtaText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.88}
                  maxFontSizeMultiplier={1.1}
                >
                  {vipReferralPrompt.actionLabel}
                </Text>
              </View>
            </Pressable>
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeInDown.duration(300).delay(80)}>
          <View style={[styles.searchRow, { marginTop: spacing.lg }]}>
            <Pressable
              onPress={() => router.push('/search')}
              accessibilityRole="search"
              accessibilityLabel="搜索商品，或问我"
              style={[
                styles.searchBar,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radius.pill,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                },
                shadow.sm,
              ]}
            >
              <SeafoodIcon name="puffer" size={32} style={styles.searchSeafoodIcon} />
              <View style={styles.searchDivider} />
              <Text
                style={[
                  typography.bodyLg,
                  styles.searchPrompt,
                  { color: colors.muted },
                ]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.1}
              >
                搜索商品，或问我...
              </Text>
              <MaterialCommunityIcons name="microphone-outline" size={20} color={colors.ai.start} />
            </Pressable>
          </View>
        </Animated.View>

        {/* 单一 AI 入口：龙虾与帝王蟹分居两侧，不再与抽奖按钮争夺主视觉 */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <View
            style={[
              styles.aiStage,
              {
                marginTop: spacing.xl,
                width: aiStageLayout.stageWidth,
                minHeight: aiStageLayout.stageHeight,
              },
            ]}
          >
            <Image
              source={require('../../assets/seafood/home-lobster.png')}
              style={[
                styles.homeLobster,
                {
                  width: aiStageLayout.lobsterSize,
                  height: aiStageLayout.lobsterSize,
                  left: aiStageLayout.lobsterLeft,
                  top: aiStageLayout.lobsterTop,
                },
              ]}
              contentFit="contain"
              transition={0}
              pointerEvents="none"
            />
            <AiOrb
              size={aiStageLayout.orbSize}
              state={orbState}
              appearance="bright"
              onPress={handleShortPress}
              onLongPress={handleLongPress}
              onPressOut={handleOrbPressOut}
              showLabel
              style={styles.homeAiOrb}
            />
            <Image
              source={require('../../assets/seafood/home-king-crab.png')}
              style={[
                styles.homeCrab,
                {
                  width: aiStageLayout.crabSize,
                  height: aiStageLayout.crabSize,
                  right: aiStageLayout.crabRight,
                  top: aiStageLayout.crabTop,
                },
              ]}
              contentFit="contain"
              transition={0}
              pointerEvents="none"
            />
          </View>

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
                {/* Phase 2: 继续对话按钮 —【AI 多轮对话已下线】用 false && 关闭渲染，恢复时删掉 false && 即可 */}
                {false && voice.continueChatContext && !voice.clarifyIntent && (
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
              {voice.isRecording ? '松开发送语音' : '长按光球，说出你想买的'}
            </Text>
          )}
        </Animated.View>

        {/* VIP 礼包轮播替换旧品牌使命文案；无数据时整块隐藏，避免空标题占位 */}
        {vipPackages.length > 0 ? (
          <Animated.View entering={FadeInDown.duration(300).delay(80)}>
            <View style={[styles.vipPromoSection, { marginTop: spacing['2xl'] }]}>
              <View style={styles.vipPromoHeader}>
                <Text style={[typography.headingSm, { color: colors.text.primary }]}>
                  精选 VIP 礼包
                </Text>
                <Text style={[typography.captionSm, { color: colors.muted }]}>
                  左右滑动查看
                </Text>
              </View>
              <VipHomePromoCarousel
                packages={vipPackages}
                onPressCard={handleVipPromoPress}
                mode={vipPromoMode}
              />
            </View>
          </Animated.View>
        ) : null}

        {/* 最近对话 —【AI 多轮对话已下线】用 false && 关闭整块，恢复时删掉 false && ( 和结尾的 ) 即可 */}
        {false && (
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
        )}

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
  heroStatementWrap: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  heroStatement: {
    flex: 1,
    minWidth: 0,
    marginRight: 16,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: 0,
  },
  heroStatementCompact: {
    fontSize: 23,
    lineHeight: 31,
  },
  cartBtn: {
    width: 46,
    height: 46,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCartBtn: {
    flexShrink: 0,
    marginTop: 7,
  },
  cartBadge: {
    position: 'absolute',
    top: -4,
    right: -3,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    minHeight: 54,
    overflow: 'hidden',
  },
  searchSeafoodIcon: {
    marginLeft: -2,
  },
  searchDivider: {
    width: 1,
    height: 24,
    marginLeft: 7,
    marginRight: 10,
    backgroundColor: 'rgba(45, 126, 82, 0.15)',
  },
  searchPrompt: {
    flex: 1,
    fontWeight: '500',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aiStage: {
    minHeight: 236,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  homeAiOrb: {
    alignSelf: 'center',
    zIndex: 2,
  },
  homeLobster: {
    position: 'absolute',
    opacity: 0.86,
    zIndex: 3,
    transform: [{ rotate: '-8deg' }],
  },
  homeCrab: {
    position: 'absolute',
    opacity: 0.78,
    zIndex: 1,
    transform: [{ rotate: '7deg' }],
  },
  vipPromoSection: {
    marginHorizontal: 0,
  },
  vipPromoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  vipReferralStrip: {
    minHeight: 58,
    paddingLeft: 9,
    paddingRight: 8,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    backgroundColor: '#F3FCF7',
    overflow: 'hidden',
  },
  vipReferralGlow: {
    position: 'absolute',
    width: 116,
    height: 116,
    borderRadius: 58,
    right: 74,
    top: -48,
    backgroundColor: 'rgba(255, 219, 113, 0.15)',
  },
  vipReferralIconHalo: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF3C9',
  },
  vipReferralCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 9,
  },
  vipReferralText: {
    color: '#143D28',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  vipReferralHint: {
    marginTop: 1,
    color: '#6B8778',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
  },
  vipReferralCta: {
    minWidth: 69,
    minHeight: 36,
    marginLeft: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#267B48',
  },
  vipReferralCtaText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
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
