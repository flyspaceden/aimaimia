import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { usePathname, useRouter, useSegments } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useVoiceRecording } from '../../hooks/useVoiceRecording';
import { useAuthStore } from '../../store/useAuthStore';
import { VoiceOverlay } from '../overlay/VoiceOverlay';
import { AuthModal } from '../overlay/AuthModal';
import { AiOrb } from './AiOrb';
import type { AuthSession } from '../../types';

// ── 常量 ──────────────────────────────────────────────
// 停靠时光球大部分藏在右侧，仅露出左半圆（~24px）
const DOCKED_TX = 20;
// 展开时光球完全显示（等效原来的 right:16 位置）
const EXPANDED_TX = -52;
// 拖拽超过此比例（屏幕宽度）松手自动收回
const DOCK_THRESHOLD_RATIO = 0.15;
// 菜单关闭后自动收回延迟
const AUTO_DOCK_DELAY = 3000;
// 停靠时光球透明度（虚化，可透视页面内容）
const DOCKED_OPACITY = 0.35;
// 停靠 tab 的可见宽度和高度
const TAB_WIDTH = 28;
const TAB_HEIGHT = 72;

// ── 上下文菜单项 ─────────────────────────────────────
type MenuItem = {
  label: string;
  intent: import('../../types/domain/Ai').AiVoiceIntent;
};

// 按页面上下文 × 意图类型组织的建议词池，每次弹出随机抽 2 条
const SUGGESTION_POOLS: Record<string, MenuItem[]> = {
  default: [
    // search 意图
    { label: '帮我找新鲜水果', intent: { type: 'search', transcript: '帮我找新鲜水果', feedback: '正在为你搜索新鲜水果...', search: { query: '新鲜水果' } } },
    { label: '有什么时令蔬菜？', intent: { type: 'search', transcript: '有什么时令蔬菜', feedback: '正在为你搜索时令蔬菜...', search: { query: '时令蔬菜', preferRecommended: true } } },
    { label: '搜一下有机食品', intent: { type: 'search', transcript: '搜一下有机食品', feedback: '正在为你搜索有机食品...', search: { query: '有机食品' } } },
    { label: '找点好吃的零食', intent: { type: 'search', transcript: '找点好吃的零食', feedback: '正在为你搜索零食...', search: { query: '零食' } } },
    { label: '有没有本地特产？', intent: { type: 'search', transcript: '有没有本地特产', feedback: '正在为你搜索本地特产...', search: { query: '特产' }, slots: { categoryHint: '特产', originPreference: '本地' } } },
    { label: '找点新鲜海鲜', intent: { type: 'search', transcript: '找点新鲜海鲜', feedback: '正在为你搜索新鲜海鲜...', search: { query: '海鲜', constraints: ['fresh'] }, slots: { categoryHint: '海鲜' } } },
    { label: '有什么五谷杂粮？', intent: { type: 'search', transcript: '有什么五谷杂粮', feedback: '正在为你搜索五谷杂粮...', search: { query: '五谷杂粮' } } },
    // recommend 意图
    { label: '100块能买什么？', intent: { type: 'recommend', transcript: '100块能买什么', feedback: '正在为你推荐100元好物...', recommend: { budget: 100 } } },
    { label: '今晚做饭买什么？', intent: { type: 'recommend', transcript: '今晚做饭买什么', feedback: '正在为你推荐做饭食材...', recommend: {}, slots: { usageScenario: '晚餐做饭' } } },
    { label: '有什么应季好物？', intent: { type: 'recommend', transcript: '有什么应季好物', feedback: '正在为你推荐应季商品...', recommend: { recommendThemes: ['seasonal'] } } },
    { label: '性价比高的推荐', intent: { type: 'recommend', transcript: '性价比高的推荐', feedback: '正在为你推荐高性价比商品...', recommend: { recommendThemes: ['discount'] } } },
    { label: '50块买点水果', intent: { type: 'recommend', transcript: '50块买点水果', feedback: '正在为你推荐水果...', recommend: { budget: 50, query: '水果' } } },
    // company 意图
    { label: '有什么好店推荐？', intent: { type: 'company', transcript: '有什么好店推荐', feedback: '先带你看看有哪些好店铺...', company: { mode: 'list' } } },
    { label: '哪家农场评价好？', intent: { type: 'company', transcript: '哪家农场评价好', feedback: '先带你看看评价好的农场...', company: { mode: 'list', companyType: 'farm' } } },
    // chat 意图
    { label: '今天吃什么？', intent: { type: 'chat', transcript: '今天吃什么', feedback: '让我根据时令帮你推荐...' } },
    { label: '什么水果正当季？', intent: { type: 'chat', transcript: '什么水果正当季', feedback: '让我看看当季水果...' } },
    { label: '下雨天适合吃什么？', intent: { type: 'chat', transcript: '下雨天适合吃什么', feedback: '下雨天适合吃点暖身的...' } },
  ],
  product: [
    { label: '这个值得买吗？', intent: { type: 'chat', transcript: '这个值得买吗', feedback: '让我帮你分析一下...' } },
    { label: '有没有类似的？', intent: { type: 'search', transcript: '有没有类似的', feedback: '正在为你搜索类似商品...', search: { query: '类似商品', preferRecommended: true } } },
    { label: '有更便宜的吗？', intent: { type: 'recommend', transcript: '有更便宜的吗', feedback: '正在为你搜索更划算的...', recommend: {}, slots: { promotionIntent: 'best-deal' } } },
    { label: '这个怎么做好吃？', intent: { type: 'chat', transcript: '这个怎么做好吃', feedback: '让我推荐几种做法...' } },
    { label: '搭配什么一起买？', intent: { type: 'recommend', transcript: '搭配什么一起买', feedback: '正在为你推荐搭配...', recommend: {}, slots: { bundleIntent: 'complement' } } },
    { label: '适合送人吗？', intent: { type: 'chat', transcript: '适合送人吗', feedback: '让我帮你分析一下...' } },
    { label: '和别家比怎么样？', intent: { type: 'chat', transcript: '和别家比怎么样', feedback: '让我帮你对比一下...' } },
  ],
  cart: [
    { label: '帮我凑个满减', intent: { type: 'recommend', transcript: '帮我凑个满减', feedback: '正在为你推荐凑单商品...', recommend: {}, slots: { promotionIntent: 'threshold-optimization' } } },
    { label: '推荐搭配商品', intent: { type: 'recommend', transcript: '推荐搭配商品', feedback: '正在为你推荐搭配...', recommend: {}, slots: { bundleIntent: 'complement' } } },
    { label: '还需要买点什么？', intent: { type: 'recommend', transcript: '还需要买点什么', feedback: '正在为你推荐补充商品...', recommend: {} } },
    { label: '哪个可以不买？', intent: { type: 'chat', transcript: '哪个可以不买', feedback: '让我帮你看看购物车...' } },
    { label: '有更划算的替代吗？', intent: { type: 'recommend', transcript: '有更划算的替代吗', feedback: '正在为你寻找替代...', recommend: { recommendThemes: ['discount'] } } },
    { label: '这些够几个人吃？', intent: { type: 'chat', transcript: '这些够几个人吃', feedback: '让我帮你估算一下...' } },
  ],
  order: [
    { label: '快递到哪了？', intent: { type: 'transaction', transcript: '快递到哪了', feedback: '正在查询物流信息...', transaction: { action: 'track-order' } } },
    { label: '申请售后', intent: { type: 'transaction', transcript: '申请售后', feedback: '正在为你打开售后...', transaction: { action: 'after-sale' } } },
    { label: '帮我催发货', intent: { type: 'transaction', transcript: '帮我催发货', feedback: '正在查询待发货订单...', transaction: { action: 'track-order' } } },
    { label: '怎么申请退款？', intent: { type: 'transaction', transcript: '怎么申请退款', feedback: '正在为你查询退款...', transaction: { action: 'refund' } } },
    { label: '再买一单同样的', intent: { type: 'navigate', transcript: '再买一单同样的', feedback: '正在打开订单列表...', resolved: { navigateTarget: 'orders' } } },
    { label: '预计什么时候到？', intent: { type: 'transaction', transcript: '预计什么时候到', feedback: '正在查询物流信息...', transaction: { action: 'track-order' } } },
  ],
};

// 从词池中随机抽取 count 条不重复建议
function pickRandom(items: MenuItem[], count: number): MenuItem[] {
  const shuffled = [...items];
  // Fisher-Yates 洗牌（只洗前 count 个位置即可）
  for (let i = 0; i < Math.min(count, shuffled.length); i++) {
    const j = i + Math.floor(Math.random() * (shuffled.length - i));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

// 根据路由匹配词池 key
function getPoolKey(pathname: string): string {
  if (pathname.startsWith('/product/')) return 'product';
  if (pathname === '/cart' || pathname.startsWith('/cart')) return 'cart';
  if (pathname.startsWith('/orders/') || pathname.startsWith('/order/')) return 'order';
  return 'default';
}

// ── AI 浮动伴侣：边缘收纳 + 手势驱动 ────────────────
export function AiFloatingCompanion() {
  const { colors, radius, spacing, typography, shadow } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // ── 语音录音 ──
  const voice = useVoiceRecording({ page: pathname });
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const queryClient = useQueryClient();

  // ── React 状态 ──
  const [isDocked, setIsDocked] = useState(true);
  const [menuVisible, setMenuVisible] = useState(false);

  // ── 动画共享值 ──
  const orbTranslateX = useSharedValue(DOCKED_TX);
  const menuOpacity = useSharedValue(0);
  const menuScale = useSharedValue(0.8);
  // 停靠 tab 辉光脉冲
  const glowOpacity = useSharedValue(0.4);
  // 长按时放大光球
  const orbScale = useSharedValue(1);

  // ── 计时器 ──
  const autoDockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 菜单项：每次弹出随机抽取 2 条
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  // ── 辅助函数 ──
  const clearAutoDock = useCallback(() => {
    if (autoDockTimerRef.current) {
      clearTimeout(autoDockTimerRef.current);
      autoDockTimerRef.current = null;
    }
  }, []);

  const startAutoDock = useCallback(() => {
    clearAutoDock();
    autoDockTimerRef.current = setTimeout(() => {
      orbTranslateX.value = withSpring(DOCKED_TX, { damping: 20, stiffness: 150 });
      setIsDocked(true);
      setMenuVisible(false);
    }, AUTO_DOCK_DELAY);
  }, [clearAutoDock, orbTranslateX]);

  // 展开光球
  const expand = useCallback(() => {
    clearAutoDock();
    orbTranslateX.value = withSpring(EXPANDED_TX, { damping: 15, stiffness: 150 });
    setIsDocked(false);
  }, [clearAutoDock, orbTranslateX]);

  // 收回光球
  const dock = useCallback(() => {
    clearAutoDock();
    orbTranslateX.value = withSpring(DOCKED_TX, { damping: 20, stiffness: 150 });
    setIsDocked(true);
    setMenuVisible(false);
    menuOpacity.value = withTiming(0, { duration: 150 });
  }, [clearAutoDock, orbTranslateX, menuOpacity]);

  // 显示菜单：每次弹出从当前页面对应词池随机抽 2 条
  const showMenu = useCallback(() => {
    const pool = SUGGESTION_POOLS[getPoolKey(pathname)] ?? SUGGESTION_POOLS.default;
    setMenuItems(pickRandom(pool, 2));
    setMenuVisible(true);
    menuOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) });
    menuScale.value = withSpring(1, { damping: 15, stiffness: 200 });
  }, [menuOpacity, menuScale, pathname]);

  // 隐藏菜单（动画完成后再更新状态，避免瞬间消失）
  const hideMenu = useCallback(() => {
    menuOpacity.value = withTiming(0, { duration: 150 });
    menuScale.value = withTiming(0.8, { duration: 150 });
    setTimeout(() => setMenuVisible(false), 160);
  }, [menuOpacity, menuScale]);

  // 拖拽展开后显示菜单（弹性动画由 Pan.onEnd 的 withSpring 处理）
  const expandAfterDrag = useCallback(() => {
    clearAutoDock();
    setIsDocked(false);
    // 延迟显示菜单，等弹性动画稳定
    setTimeout(() => showMenu(), 150);
  }, [clearAutoDock, showMenu]);

  // 点击处理：停靠→展开+菜单 / 展开→切换菜单
  const handleTap = useCallback(() => {
    if (isDocked) {
      expand();
      // 短暂延迟后显示菜单，等光球滑出
      setTimeout(() => showMenu(), 200);
    } else {
      if (menuVisible) {
        hideMenu();
        startAutoDock();
      } else {
        clearAutoDock();
        showMenu();
      }
    }
  }, [isDocked, menuVisible, expand, showMenu, hideMenu, startAutoDock, clearAutoDock]);

  // 长按开始录音：放大光球 2x 防止偏移
  const handleLongPressStart = useCallback(() => {
    hideMenu();
    if (isDocked) {
      expand();
    }
    orbScale.value = withSpring(2, { damping: 12, stiffness: 180 });
    void voice.startRecording();
  }, [hideMenu, isDocked, expand, voice, orbScale]);

  // 长按结束停止录音：缩回原始大小
  const handleLongPressEnd = useCallback(() => {
    orbScale.value = withSpring(1, { damping: 15, stiffness: 200 });
    void voice.stopRecording();
  }, [voice, orbScale]);

  // 拖拽结束后判断是否收回
  const handlePanEnd = useCallback(
    (translationX: number) => {
      const threshold = screenWidth * DOCK_THRESHOLD_RATIO;
      if (translationX > threshold) {
        dock();
      } else {
        // 弹回展开位置
        orbTranslateX.value = withSpring(EXPANDED_TX, { damping: 15, stiffness: 150 });
      }
    },
    [screenWidth, dock, orbTranslateX]
  );

  // 菜单项点击：通过意图解析链路执行真实操作
  const handleMenuItemPress = useCallback(
    (item: MenuItem) => {
      hideMenu();
      dock();
      void voice.processIntent(item.intent);
    },
    [hideMenu, dock, voice]
  );

  // 关闭菜单遮罩
  const handleBackdropPress = useCallback(() => {
    hideMenu();
    startAutoDock();
  }, [hideMenu, startAutoDock]);

  // ── 手势 ──
  const composed = useMemo(() => {
    // 用 Pan + activateAfterLongPress 替代 LongPress 手势：
    // LongPress 有内置移动距离阈值（~10px），手指稍动就取消，无法配置。
    // Pan 天然跟踪手指移动，activateAfterLongPress(400) 让它等待 400ms 后才激活，
    // 激活后手指可以自由移动不会取消，只有真正抬手才触发 onEnd。
    const longPress = Gesture.Pan()
      .activateAfterLongPress(400)
      .shouldCancelWhenOutside(false)
      .onStart(() => {
        runOnJS(handleLongPressStart)();
      })
      .onEnd(() => {
        runOnJS(handleLongPressEnd)();
      });

    const pan = Gesture.Pan()
      .enabled(!voice.isRecording)
      .activeOffsetX([-20, 20])
      .failOffsetY([-30, 30])
      .onChange((e) => {
        const base = orbTranslateX.value;
        const newTx = base + e.changeX;
        // 橡皮筋阻力：拖过边界时 0.3x 衰减，不硬截止
        if (newTx < EXPANDED_TX) {
          const overshoot = EXPANDED_TX - newTx;
          orbTranslateX.value = EXPANDED_TX - overshoot * 0.3;
        } else if (newTx > DOCKED_TX) {
          const overshoot = newTx - DOCKED_TX;
          orbTranslateX.value = DOCKED_TX + overshoot * 0.3;
        } else {
          orbTranslateX.value = newTx;
        }
      })
      .onEnd((e) => {
        const mid = (DOCKED_TX + EXPANDED_TX) / 2;
        const movingLeft = e.velocityX < -50;
        const movingRight = e.velocityX > 50;
        const shouldExpand = movingLeft || (!movingRight && orbTranslateX.value < mid);

        // 速度越快 → 阻尼越低 → 弹跳次数越多、幅度越大
        // 慢松手 (~0): damping≈16, 轻微回弹 1-2 次
        // 中速 (~600): damping≈10, 明显弹跳 2-3 次
        // 快甩 (~1200+): damping≈5, 连弹 3-4 次
        const speed = Math.min(Math.abs(e.velocityX), 1400);
        const damping = 16 - (speed / 1400) * 11; // 16 → 5

        if (shouldExpand) {
          orbTranslateX.value = withSpring(EXPANDED_TX, {
            velocity: e.velocityX,
            damping,
            stiffness: 150,
            mass: 0.7,
          });
          runOnJS(expandAfterDrag)();
        } else {
          orbTranslateX.value = withSpring(DOCKED_TX, {
            velocity: e.velocityX,
            damping,
            stiffness: 150,
            mass: 0.7,
          });
          runOnJS(dock)();
        }
      });

    const tap = Gesture.Tap().onEnd(() => {
      runOnJS(handleTap)();
    });

    // Race: 三个手势同时竞争，谁先满足条件谁激活
    // - pan: 手指移动 >20px → 拖拽（在 400ms 前快速移动可抢先于长按）
    // - longPress: 按住 400ms → 录音
    // - tap: 快速点击释放
    return Gesture.Race(longPress, pan, tap);
  }, [handleTap, handleLongPressStart, handleLongPressEnd, dock, expandAfterDrag, orbTranslateX, voice.isRecording]);

  // ── 反馈浮层操作按钮点击 ──
  const handleVoiceActionPress = useCallback(() => {
    if (voice.actionRoute) {
      router.push({ pathname: voice.actionRoute as any, params: voice.actionParams || {} });
    }
    voice.dismissFeedback();
    dock();
  }, [voice, router, dock]);

  // ── 继续对话 ──
  const handleVoiceContinueChat = useCallback(() => {
    if (voice.continueChatContext) {
      router.push({
        pathname: '/ai/chat',
        params: {
          initialTranscript: voice.continueChatContext.initialTranscript,
          initialReply: voice.continueChatContext.initialReply,
        },
      });
    } else {
      router.push('/ai/chat');
    }
    voice.dismissFeedback();
    dock();
  }, [voice, router, dock]);

  // ── navigate 意图自动跳转（幂等性保护：防止同一路由重复跳转）──
  const lastNavigatedRef = useRef<string | null>(null);
  useEffect(() => {
    if (voice.actionRoute && !voice.feedbackVisible && !voice.needsAuth) {
      const key = `${voice.actionRoute}:${JSON.stringify(voice.actionParams)}`;
      if (lastNavigatedRef.current === key) return;
      lastNavigatedRef.current = key;
      router.push({ pathname: voice.actionRoute as any, params: voice.actionParams || {} });
      voice.dismissFeedback();
      dock();
    } else {
      lastNavigatedRef.current = null;
    }
  }, [voice.actionRoute, voice.feedbackVisible, voice.needsAuth, voice.actionParams, voice.dismissFeedback, router, dock]);

  // ── 登录保护 ──
  useEffect(() => {
    if (voice.needsAuth) {
      const timer = setTimeout(() => setAuthModalOpen(true), 400);
      return () => clearTimeout(timer);
    }
  }, [voice.needsAuth]);

  const handleAuthSuccess = useCallback((session: AuthSession) => {
    setAuthModalOpen(false);
    useAuthStore.getState().setLoggedIn({
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
  }, [voice, queryClient]);

  // ── 停靠辉光脉冲 ──
  // 停靠辉光也保持低透明度，不遮挡页面内容
  useEffect(() => {
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.15, { duration: 1500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, [glowOpacity]);

  // ── 首次引导动画 ──
  useEffect(() => {
    // 0.5s 后展开，2s 后收回
    const expandTimer = setTimeout(() => {
      orbTranslateX.value = withSpring(EXPANDED_TX, { damping: 15, stiffness: 150 });
      setIsDocked(false);
    }, 500);

    // 500ms 等待 + ~300ms 展开弹簧 + 2000ms 展示 = 2800ms
    const dockTimer = setTimeout(() => {
      orbTranslateX.value = withSpring(DOCKED_TX, { damping: 20, stiffness: 150 });
      setIsDocked(true);
    }, 2800);

    return () => {
      clearTimeout(expandTimer);
      clearTimeout(dockTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 清理计时器
  useEffect(() => {
    return () => clearAutoDock();
  }, [clearAutoDock]);

  // ── 动画样式 ──
  // 光球位移 + 停靠时虚化（透明度随位置平滑变化）
  const orbAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: orbTranslateX.value },
      { scale: orbScale.value },
    ],
    opacity: interpolate(
      orbTranslateX.value,
      [DOCKED_TX, EXPANDED_TX],
      [DOCKED_OPACITY, 1]
    ),
  }));

  const menuAnimStyle = useAnimatedStyle(() => ({
    opacity: menuOpacity.value,
    transform: [{ scale: menuScale.value }],
  }));

  const glowAnimStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  // ── 首页 tab 隐藏 ──
  const segArr = segments as string[];
  const isHomeTab = segArr[0] === '(tabs)' && (segArr[1] === 'home' || segArr[1] === undefined);
  if (isHomeTab) return null;

  const bottomOffset = insets.bottom + 80 + 16;

  return (
    <View style={[styles.wrapper, { bottom: bottomOffset, right: 0 }]} pointerEvents="box-none">
      {/* 全屏遮罩：菜单打开时覆盖整个屏幕 */}
      {menuVisible && (
        <Pressable
          onPress={handleBackdropPress}
          style={[
            styles.backdrop,
            {
              width: screenWidth,
              right: 0,
              bottom: -bottomOffset,
              height: screenHeight + bottomOffset,
            },
          ]}
        />
      )}

      {/* 语音录音 UI */}
      <VoiceOverlay
        isRecording={voice.isRecording}
        isProcessing={voice.isProcessing}
        feedbackVisible={voice.feedbackVisible}
        feedbackText={voice.feedbackText}
        userTranscript={voice.userTranscript}
        actionLabel={voice.actionLabel}
        onActionPress={handleVoiceActionPress}
        onContinueChat={voice.continueChatContext ? handleVoiceContinueChat : undefined}
        onDismiss={voice.dismissFeedback}
        clarifyIntent={voice.clarifyIntent}
        onClarifySelect={voice.selectClarify}
        anchorBottom={56}
      />

      {/* 登录弹窗 */}
      <AuthModal
        open={authModalOpen}
        onClose={() => { setAuthModalOpen(false); voice.dismissFeedback(); }}
        onSuccess={handleAuthSuccess}
      />

      {/* 停靠辉光指示器：停靠状态显示，提示用户 AI 在这里 */}
      {isDocked && (
        <Animated.View
          style={[
            styles.dockedGlow,
            {
              backgroundColor: colors.ai.start,
              borderTopLeftRadius: TAB_HEIGHT / 2,
              borderBottomLeftRadius: TAB_HEIGHT / 2,
            },
            glowAnimStyle,
          ]}
          pointerEvents="none"
        />
      )}

      {/* 浮动光球 + 手势（渲染在菜单之前，菜单在其上方覆盖） */}
      <GestureDetector gesture={composed}>
        <Animated.View
          style={[styles.orbContainer, orbAnimStyle]}
          hitSlop={isDocked ? { left: 24, top: 20, bottom: 20, right: 8 } : { left: 16, top: 16, bottom: 16, right: 16 }}
        >
          <AiOrb size="small" interactive={false} />
        </Animated.View>
      </GestureDetector>

      {/* 上下文菜单（渲染在光球之后，z-index 更高，触摸优先级高于光球） */}
      {menuVisible && (
        <Animated.View
          style={[
            styles.menu,
            shadow.md,
            {
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              borderColor: colors.border,
              bottom: 64,
              right: 16,
            },
            menuAnimStyle,
          ]}
        >
          {menuItems.map((item, index) => (
            <Pressable
              key={item.label}
              onPress={() => handleMenuItemPress(item)}
              style={[
                styles.menuItem,
                {
                  borderBottomWidth: index < menuItems.length - 1 ? 1 : 0,
                  borderBottomColor: colors.divider,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                },
              ]}
            >
              <Text style={[typography.bodySm, { color: colors.text.primary }]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    zIndex: 999,
    alignItems: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
  },
  orbContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    position: 'absolute',
    minWidth: 160,
    borderWidth: 1,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dockedGlow: {
    position: 'absolute',
    right: 0,
    width: TAB_WIDTH,
    height: TAB_HEIGHT,
    alignSelf: 'center',
  },
});
