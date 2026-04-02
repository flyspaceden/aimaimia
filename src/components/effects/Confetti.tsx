import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';

interface ConfettiParticle {
  colorIndex: number;
  size: number;
  angle: number; // 弹射方向（弧度）
  distance: number; // 弹射距离
}

interface ConfettiProps {
  /** true 触发一次爆发 */
  active: boolean;
  /** 粒子数量 */
  count?: number;
}

function generateParticles(count: number): ConfettiParticle[] {
  return Array.from({ length: count }, () => ({
    colorIndex: Math.floor(Math.random() * 4),
    size: 4 + Math.random() * 4, // 4-8px
    angle: Math.random() * Math.PI * 2, // 360度随机方向
    distance: 80 + Math.random() * 120, // 80-200px 弹射距离
  }));
}

// 单个庆祝粒子
function ConfettiPiece({ particle, active, confettiColors }: {
  particle: ConfettiParticle;
  active: boolean;
  confettiColors: string[];
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      // 取消进行中的动画后重置
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      cancelAnimation(opacity);
      cancelAnimation(scale);
      translateX.value = 0;
      translateY.value = 0;
      opacity.value = 0;
      scale.value = 0;
      return;
    }

    const targetX = Math.cos(particle.angle) * particle.distance;
    const targetY = Math.sin(particle.angle) * particle.distance;
    const randomDelay = Math.random() * 100;

    // 弹射
    translateX.value = withDelay(
      randomDelay,
      withTiming(targetX, { duration: 600, easing: Easing.out(Easing.cubic) }),
    );

    // Y轴：先弹射再下落（重力效果）
    translateY.value = withDelay(
      randomDelay,
      withSequence(
        withTiming(targetY - 30, { duration: 400, easing: Easing.out(Easing.cubic) }),
        withTiming(targetY + 60, { duration: 600, easing: Easing.in(Easing.quad) }),
      ),
    );

    // 出现 → 保持 → 淡出
    opacity.value = withDelay(
      randomDelay,
      withSequence(
        withTiming(1, { duration: 100 }),
        withDelay(500, withTiming(0, { duration: 400 })),
      ),
    );

    // 弹出缩放
    scale.value = withDelay(
      randomDelay,
      withSequence(
        withTiming(1.2, { duration: 200, easing: Easing.out(Easing.back(2)) }),
        withTiming(0.6, { duration: 800, easing: Easing.out(Easing.ease) }),
      ),
    );
  }, [active, particle, translateX, translateY, opacity, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: particle.size,
          height: particle.size,
          borderRadius: particle.size / 2,
          backgroundColor: confettiColors[particle.colorIndex],
        },
        animatedStyle,
      ]}
    />
  );
}

// 中奖庆祝粒子爆发效果
export function Confetti({ active, count = 25 }: ConfettiProps) {
  const { colors } = useTheme();
  const safeCount = Math.min(Math.max(count, 1), 100);
  const particles = useMemo(() => generateParticles(safeCount), [safeCount]);

  // 使用设计令牌颜色
  const confettiColors = useMemo(
    () => [colors.gold.primary, colors.brand.primaryLight, colors.danger, colors.ai.end],
    [colors],
  );

  return (
    <View style={styles.container} pointerEvents="none">
      {particles.map((particle, index) => (
        <ConfettiPiece
          key={index}
          particle={particle}
          active={active}
          confettiColors={confettiColors}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
