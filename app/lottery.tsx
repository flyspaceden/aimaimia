import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../src/components/layout';
import { EmptyState } from '../src/components/feedback';
import { AppBottomSheet } from '../src/components/overlay';
import { AiTypingEffect, Confetti, SpinWheel, WheelPointer } from '../src/components/effects';
import { LotteryRepo, type DrawResult, type LotteryPrize } from '../src/repos/LotteryRepo';
import { useAuthStore, useCartStore } from '../src/store';
import type { CartItem } from '../src/store/useCartStore';
import { useTheme } from '../src/theme';
import type { ColorScheme } from '../src/theme/colors';

// 状态机阶段
type Phase = 'idle' | 'spinning' | 'decelerating' | 'revealing' | 'result_shown';

// 计算目标停止角度：让转盘停在指定奖品扇区中心
function calcTargetAngle(prizeIndex: number, totalPrizes: number, currentRotation: number): number {
  const segAngle = 360 / totalPrizes;
  // 指针在顶部（0度），转盘顺时针旋转
  // 要让第 prizeIndex 个扇区对准顶部指针
  const targetCenter = 360 - (prizeIndex * segAngle + segAngle / 2);
  let target = currentRotation + 360 * 3; // 至少再转3圈
  target = target - (target % 360) + targetCenter;
  if (target <= currentRotation + 360) target += 360;
  return target;
}

// 奖品类型对应的色点颜色
function getPrizeDotColor(type: string, colors: ColorScheme): string {
  switch (type) {
    case 'RED_PACK':
      return colors.gold.primary;
    case 'COUPON':
      return colors.brand.primaryLight;
    case 'PRODUCT':
      return colors.danger;
    case 'NONE':
    default:
      return colors.bgSecondary;
  }
}

function buildPendingPrizeCartItem(prize: LotteryPrize, claimToken: string): CartItem {
  const isThresholdGift = prize.type === 'THRESHOLD_GIFT';
  const expiresAt = prize.expiresAt ?? undefined;
  const tokenKey = claimToken.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
  return {
    id: `pending-prize-${tokenKey}`,
    productId: `pending-prize-${tokenKey}`,
    skuId: `pending-prize-${tokenKey}`,
    title: prize.name,
    price: prize.prizePrice ?? 0,
    originalPrice: prize.originalPrice ?? undefined,
    image: prize.image ?? '',
    quantity: 1,
    isPrize: true,
    claimToken,
    pendingClaim: true,
    isLocked: isThresholdGift,
    threshold: isThresholdGift ? prize.threshold : undefined,
    expiresAt,
  };
}


export default function LotteryScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const syncFromServer = useCartStore((state) => state.syncFromServer);
  const addPendingPrizeItem = useCartStore((state) => state.addPendingPrizeItem);
  const queryClient = useQueryClient();

  // 数据查询（未登录也可抽奖，登录态变化时重新请求）
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ['lottery-today-page', isLoggedIn],
    queryFn: () => LotteryRepo.getTodayStatus(),
  });
  const { data: prizesData, isLoading: prizesLoading } = useQuery({
    queryKey: ['lottery-prizes-page'],
    queryFn: () => LotteryRepo.getPrizes(),
  });

  const status = statusData?.ok ? statusData.data : null;
  const prizes = prizesData?.ok ? prizesData.data : [];
  // 加载中时默认显示有抽奖机会，避免闪烁"已抽完"
  const remainingDraws = statusLoading
    ? 1
    : status
      ? (status as any).remainingDraws ?? (status as any).remainingChances ?? 0
      : 0;

  // 用 ref 追踪最新 prizes，避免 startDeceleration 回调中闭包过期
  const prizesRef = useRef(prizes);
  useEffect(() => {
    prizesRef.current = prizes;
  }, [prizes]);

  // 状态机
  const [phase, setPhase] = useState<Phase>('idle');
  const [showResult, setShowResult] = useState(false);
  const [confettiActive, setConfettiActive] = useState(false);
  const [prizeListExpanded, setPrizeListExpanded] = useState(false);

  // 抽奖结果存储
  const drawResultRef = useRef<DrawResult | null>(null);
  const apiResolvedRef = useRef(false);
  const spinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 记录快速旋转开始时间，用于计算剩余等待时间
  const spinStartTimeRef = useRef(0);

  // 动画值
  const rotation = useSharedValue(0);
  const buttonScale = useSharedValue(1);
  const revealOpacity = useSharedValue(1);

  // 按钮脉冲动画（空闲时）
  useEffect(() => {
    if (phase === 'idle' && remainingDraws > 0) {
      buttonScale.value = withRepeat(
        withSequence(
          withTiming(1.05, { duration: 750, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.0, { duration: 750, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
    } else {
      buttonScale.value = withTiming(1, { duration: 200 });
    }
  }, [phase, remainingDraws, buttonScale]);

  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  // 转盘透明度动画样式（从 JSX 内联移出）
  const wheelOpacityStyle = useAnimatedStyle(() => ({
    opacity: revealOpacity.value,
  }));

  // 清理所有定时器和动画
  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
      if (apiTimeoutRef.current) clearTimeout(apiTimeoutRef.current);
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
      cancelAnimation(rotation);
      cancelAnimation(buttonScale);
      cancelAnimation(revealOpacity);
    };
  }, [rotation, buttonScale, revealOpacity]);

  // 进入揭晓阶段
  const enterRevealPhase = useCallback(() => {
    setPhase('revealing');
    const result = drawResultRef.current;

    // 防御性检查：结果应当在此时已存在
    if (!result) {
      drawResultRef.current = { won: false, message: '异常状态' };
    }

    if (result?.won) {
      // 中奖：触发庆祝粒子 + 转盘闪烁
      setConfettiActive(true);
      revealOpacity.value = withRepeat(
        withSequence(
          withTiming(0.6, { duration: 150 }),
          withTiming(1, { duration: 150 }),
        ),
        3,
        false,
      );
    } else {
      // 未中奖：轻微透明度呼吸
      revealOpacity.value = withSequence(
        withTiming(0.7, { duration: 300 }),
        withTiming(1, { duration: 300 }),
      );
    }

    // 700ms 后显示结果弹窗
    if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
    revealTimeoutRef.current = setTimeout(() => {
      setPhase('result_shown');
      setShowResult(true);
    }, 700);
  }, [revealOpacity]);

  // 开始减速阶段
  const startDeceleration = useCallback(() => {
    const result = drawResultRef.current;
    if (!result) return;

    // 使用 ref 读取最新 prizes，避免闭包过期
    const currentPrizes = prizesRef.current;
    if (currentPrizes.length === 0) return;

    setPhase('decelerating');

    // 找到中奖奖品在列表中的索引
    let targetIndex = 0;
    if (result.won && result.prize) {
      const idx = currentPrizes.findIndex((p) => p.id === result.prize?.id);
      if (idx >= 0) targetIndex = idx;
    } else {
      // 未中奖：停在"谢谢参与"扇区
      const noneIdx = currentPrizes.findIndex((p) => p.type === 'NONE');
      targetIndex = noneIdx >= 0 ? noneIdx : currentPrizes.length - 1;
    }

    const targetAngle = calcTargetAngle(targetIndex, currentPrizes.length, rotation.value);

    // 减速旋转到目标角度，2500ms
    rotation.value = withTiming(
      targetAngle,
      {
        duration: 2500,
        easing: Easing.bezier(0.15, 0.85, 0.25, 1),
      },
      (finished) => {
        if (finished) {
          runOnJS(enterRevealPhase)();
        }
      },
    );
  }, [rotation, enterRevealPhase]);

  // 当 API 返回后，等待快速旋转阶段结束再减速
  const scheduleDeceleration = useCallback(() => {
    const elapsed = Date.now() - spinStartTimeRef.current;
    const minSpinDuration = 2000;
    const remaining = Math.max(0, minSpinDuration - elapsed + 100); // +100ms 缓冲

    spinTimeoutRef.current = setTimeout(() => {
      startDeceleration();
    }, remaining);
  }, [startDeceleration]);

  // 抽奖主流程
  const handleDraw = useCallback(async () => {
    if (phase !== 'idle' || remainingDraws <= 0 || prizes.length < 2) return;

    // 重置状态
    drawResultRef.current = null;
    apiResolvedRef.current = false;
    setConfettiActive(false);
    setPhase('spinning');
    spinStartTimeRef.current = Date.now();

    // 快速匀速旋转（5圈/2秒）
    const fastSpinTarget = rotation.value + 360 * 5;
    rotation.value = withTiming(fastSpinTarget, {
      duration: 2000,
      easing: Easing.linear,
    });

    // 超时保护：10秒后强制设置失败结果
    apiTimeoutRef.current = setTimeout(() => {
      if (!apiResolvedRef.current) {
        drawResultRef.current = { won: false, message: '网络超时，请重试' };
        apiResolvedRef.current = true;
        scheduleDeceleration();
      }
    }, 10000);

    // 同时发起 API 调用
    try {
      const result = await LotteryRepo.draw();
      if (result.ok) {
        if (!useAuthStore.getState().isLoggedIn && result.data.won) {
          if (!result.data.prize || !result.data.claimToken) {
            drawResultRef.current = { won: false, message: '奖品领取异常，请稍后重试' };
          } else {
            addPendingPrizeItem(buildPendingPrizeCartItem(result.data.prize, result.data.claimToken));
            drawResultRef.current = result.data;
          }
        } else {
          drawResultRef.current = result.data;
        }
      } else {
        // 安全访问错误对象
        const errorMsg =
          result.error && typeof result.error === 'object' && 'displayMessage' in result.error
            ? (result.error as any).displayMessage ?? '抽奖失败'
            : '抽奖失败';
        drawResultRef.current = { won: false, message: errorMsg };
      }
    } catch {
      drawResultRef.current = { won: false, message: '网络异常，请重试' };
    }

    apiResolvedRef.current = true;
    if (apiTimeoutRef.current) clearTimeout(apiTimeoutRef.current);

    // API 完成后，计算剩余快速旋转时间再减速
    scheduleDeceleration();
  }, [addPendingPrizeItem, phase, remainingDraws, prizes.length, rotation, scheduleDeceleration]);

  // 关闭结果弹窗
  const handleCloseResult = useCallback(async () => {
    setShowResult(false);
    setConfettiActive(false);
    drawResultRef.current = null;

    if (useAuthStore.getState().isLoggedIn) {
      // 已登录：后端已自动加入购物车，同步即可
      await syncFromServer();
    }

    // 先刷新状态再恢复 idle，防止按钮在旧 remainingDraws 下短暂可用
    await refetchStatus();
    // 同步刷新首页抽奖状态，使 FAB 隐藏
    queryClient.invalidateQueries({ queryKey: ['lottery-today'] });
    queryClient.invalidateQueries({ queryKey: ['lottery-today-page'] });
    setPhase('idle');
  }, [syncFromServer, refetchStatus, queryClient]);

  const result = drawResultRef.current;
  const isSpinning = phase === 'spinning' || phase === 'decelerating';
  const isDisabled = phase !== 'idle' || remainingDraws <= 0;

  // 奖品列表太少则直接显示提示
  if (!prizesLoading && prizes.length < 2) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="每日抽奖" />
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl }}>
          <EmptyState title="奖品配置中" description="奖池正在准备，请稍后再来" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="每日抽奖" />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: spacing.lg }]}
        showsVerticalScrollIndicator={false}
      >
        {/* 剩余次数胶囊 */}
        <View style={styles.badgeRow}>
          <View
            style={[
              styles.badge,
              {
                backgroundColor: colors.gold.light,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
              },
            ]}
          >
            <Text style={[typography.caption, { color: colors.gold.primary, fontWeight: '700' }]}>
              {remainingDraws > 0 ? `剩余${remainingDraws}次` : '今日已抽完'}
            </Text>
          </View>
        </View>

        {/* 转盘区域 */}
        <View style={styles.wheelArea}>
          {/* 指针 */}
          <WheelPointer spinning={isSpinning} />

          {/* 转盘 + 庆祝粒子 */}
          <Animated.View style={[styles.wheelWrapper, wheelOpacityStyle]}>
            <SpinWheel prizes={prizes} rotation={rotation} size={280} />
            <Confetti active={confettiActive} />
          </Animated.View>
        </View>

        {/* 抽奖按钮 */}
        <View style={styles.buttonRow}>
          <Animated.View style={buttonAnimatedStyle}>
            <Pressable
              onPress={handleDraw}
              disabled={isDisabled}
              onPressIn={() => {
                if (!isDisabled) buttonScale.value = withTiming(0.95, { duration: 100 });
              }}
              onPressOut={() => {
                if (!isDisabled && phase === 'idle') {
                  buttonScale.value = withTiming(1, { duration: 100 });
                }
              }}
              style={[
                styles.drawButton,
                {
                  backgroundColor: isDisabled ? colors.border : colors.gold.primary,
                  opacity: remainingDraws <= 0 && phase === 'idle' ? 0.6 : 1,
                },
              ]}
            >
              <Text
                style={[
                  typography.bodyStrong,
                  {
                    color: isDisabled ? colors.text.secondary : colors.text.inverse,
                    fontSize: 16,
                  },
                ]}
              >
                {phase === 'spinning' || phase === 'decelerating'
                  ? '抽奖中...'
                  : remainingDraws <= 0
                    ? '已抽完'
                    : '抽奖'}
              </Text>
            </Pressable>
          </Animated.View>
        </View>

        {/* 可折叠奖品列表 */}
        <Pressable
          onPress={() => setPrizeListExpanded(!prizeListExpanded)}
          style={[
            styles.prizeHeader,
            {
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              marginTop: spacing.xl,
            },
            shadow.sm,
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>奖品列表</Text>
          <Text style={[typography.caption, { color: colors.text.tertiary }]}>
            {prizeListExpanded ? '收起' : '展开'}
          </Text>
        </Pressable>

        {prizeListExpanded && (
          <View
            style={[
              styles.prizeList,
              {
                backgroundColor: colors.surface,
                borderBottomLeftRadius: radius.lg,
                borderBottomRightRadius: radius.lg,
                paddingHorizontal: spacing.md,
                paddingBottom: spacing.md,
              },
              shadow.sm,
            ]}
          >
            {prizes.map((p) => (
              <View key={p.id} style={[styles.prizeRow, { borderBottomColor: colors.divider }]}>
                <View
                  style={[
                    styles.prizeTypeDot,
                    { backgroundColor: getPrizeDotColor(p.type, colors) },
                  ]}
                />
                <Text
                  style={[typography.body, { color: colors.text.primary, flex: 1 }]}
                  numberOfLines={1}
                >
                  {p.name}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: spacing['3xl'] }} />
      </ScrollView>

      {/* 结果底部弹窗 */}
      <AppBottomSheet open={showResult} onClose={handleCloseResult} mode="auto">
        <View style={styles.resultContent}>
          {result?.won ? (
            <>
              {/* 中奖结果 */}
              <Text style={{ fontSize: 64, textAlign: 'center', marginBottom: spacing.md }}>
                🎁
              </Text>
              <View style={{ marginBottom: spacing.sm }}>
                <AiTypingEffect
                  text={`恭喜获得：${result.prize?.name ?? '神秘奖品'}`}
                  speed={60}
                  style={{
                    ...typography.title3,
                    color: colors.gold.primary,
                    textAlign: 'center',
                  }}
                />
              </View>
              <Text
                style={[
                  typography.caption,
                  {
                    color: colors.text.secondary,
                    textAlign: 'center',
                    marginBottom: spacing.xl,
                  },
                ]}
              >
                {isLoggedIn
                  ? '奖品已自动发放到您的账户'
                  : '奖品已加入本地购物车，登录后确认领取'}
              </Text>
              <Pressable
                onPress={handleCloseResult}
                style={[
                  styles.resultButton,
                  {
                    backgroundColor: colors.gold.primary,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>太棒了!</Text>
              </Pressable>
            </>
          ) : (
            <>
              {/* 未中奖结果 */}
              <Text style={{ fontSize: 48, textAlign: 'center', marginBottom: spacing.md }}>
                😊
              </Text>
              <Text
                style={[
                  typography.title3,
                  {
                    color: colors.text.primary,
                    textAlign: 'center',
                    marginBottom: spacing.xs,
                  },
                ]}
              >
                谢谢参与
              </Text>
              <Text
                style={[
                  typography.caption,
                  {
                    color: colors.text.secondary,
                    textAlign: 'center',
                    marginBottom: spacing.xl,
                  },
                ]}
              >
                {result?.message ?? '明天再来试试运气吧'}
              </Text>
              <Pressable
                onPress={handleCloseResult}
                style={[
                  styles.resultButton,
                  {
                    backgroundColor: colors.border,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>好的</Text>
              </Pressable>
            </>
          )}
        </View>
      </AppBottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 40,
  },
  badgeRow: {
    alignItems: 'center',
    marginBottom: 20,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wheelArea: {
    alignItems: 'center',
    marginBottom: 24,
  },
  wheelWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -4,
  },
  buttonRow: {
    alignItems: 'center',
    marginBottom: 8,
  },
  drawButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  prizeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  prizeList: {
    alignSelf: 'stretch',
    marginTop: -1,
  },
  prizeRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  prizeTypeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  resultContent: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  resultButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 48,
    alignSelf: 'center',
  },
});
