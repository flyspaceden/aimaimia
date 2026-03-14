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
type MenuItem = { label: string; prompt: string };

// 根据路由返回不同的上下文菜单
function getMenuItems(pathname: string): MenuItem[] {
  if (pathname.startsWith('/product/')) {
    return [
      { label: '这个值得买吗？', prompt: '帮我分析一下这个商品值不值得买' },
      { label: '有没有类似的？', prompt: '帮我推荐类似的商品' },
    ];
  }
  if (pathname === '/cart' || pathname.startsWith('/cart')) {
    return [
      { label: '帮我凑个满减', prompt: '帮我看看怎么凑满减更划算' },
      { label: '推荐搭配商品', prompt: '根据购物车内容推荐搭配商品' },
    ];
  }
  if (pathname.startsWith('/orders/') || pathname.startsWith('/order/')) {
    return [
      { label: '我的快递到哪了？', prompt: '帮我查询最新的物流信息' },
      { label: '申请售后', prompt: '我想申请售后服务' },
    ];
  }
  return [
    { label: '帮我找商品', prompt: '帮我搜索商品' },
    { label: '今天吃什么？', prompt: '根据时令推荐今天吃什么' },
  ];
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

  // 菜单项
  const menuItems = getMenuItems(pathname);

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

  // 显示菜单
  const showMenu = useCallback(() => {
    setMenuVisible(true);
    menuOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) });
    menuScale.value = withSpring(1, { damping: 15, stiffness: 200 });
  }, [menuOpacity, menuScale]);

  // 隐藏菜单（动画完成后再更新状态，避免瞬间消失）
  const hideMenu = useCallback(() => {
    menuOpacity.value = withTiming(0, { duration: 150 });
    menuScale.value = withTiming(0.8, { duration: 150 });
    setTimeout(() => setMenuVisible(false), 160);
  }, [menuOpacity, menuScale]);

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

  // 菜单项点击
  const handleMenuItemPress = useCallback(
    (prompt: string) => {
      hideMenu();
      dock();
      router.push({ pathname: '/ai/chat', params: { prompt } });
    },
    [hideMenu, dock, router]
  );

  // 关闭菜单遮罩
  const handleBackdropPress = useCallback(() => {
    hideMenu();
    startAutoDock();
  }, [hideMenu, startAutoDock]);

  // ── 手势 ──
  const composed = useMemo(() => {
    const longPress = Gesture.LongPress()
      .minDuration(400)
      .shouldCancelWhenOutside(false) // 手指移出视图范围时不取消手势
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
        // 停靠状态：从 DOCKED_TX 向左拖出（负方向）
        // 展开状态：从 EXPANDED_TX 向右拖回（正方向）
        const base = orbTranslateX.value;
        const newTx = base + e.changeX;
        // 限制范围：不超过展开位置（左边界）和停靠位置（右边界）
        orbTranslateX.value = Math.min(DOCKED_TX, Math.max(EXPANDED_TX, newTx));
      })
      .onEnd(() => {
        // 根据当前位置决定停靠还是展开
        const mid = (DOCKED_TX + EXPANDED_TX) / 2;
        if (orbTranslateX.value > mid) {
          // 偏右 → 收回停靠
          runOnJS(dock)();
        } else {
          // 偏左 → 展开
          runOnJS(expand)();
        }
      });

    const tap = Gesture.Tap().onEnd(() => {
      runOnJS(handleTap)();
    });

    return Gesture.Exclusive(longPress, Gesture.Race(pan, tap));
  }, [handleTap, handleLongPressStart, handleLongPressEnd, dock, expand, orbTranslateX, voice.isRecording]);

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

      {/* 上下文菜单 */}
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
              onPress={() => handleMenuItemPress(item.prompt)}
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

      {/* 浮动光球 + 手势 */}
      <GestureDetector gesture={composed}>
        <Animated.View
          style={[styles.orbContainer, orbAnimStyle]}
          // 扩大触摸区域：停靠时大范围，展开时也加大防止长按偏移
          hitSlop={isDocked ? { left: 24, top: 20, bottom: 20, right: 8 } : { left: 16, top: 16, bottom: 16, right: 16 }}
        >
          <AiOrb size="small" interactive={false} />
        </Animated.View>
      </GestureDetector>
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
