import React, { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface FloatingParticlesProps {
  count?: number;
  color?: string;
}

// 单个粒子数据
interface ParticleConfig {
  x: number;
  y: number;
  size: number;
  opacity: number;
  duration: number;
  delay: number;
  driftX: number;
  driftY: number;
}

// 生成随机粒子配置（屏幕尺寸通过参数传入，避免在模块顶层使用 Dimensions.get）
function generateParticles(count: number, screenWidth: number, screenHeight: number): ParticleConfig[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * screenWidth,
    y: Math.random() * screenHeight,
    size: 3 + Math.random() * 4, // 3-7pt
    opacity: 0.08 + Math.random() * 0.07, // 0.08-0.15
    duration: 6000 + Math.random() * 2000, // 6-8s
    delay: Math.random() * 3000, // 随机延迟启动
    driftX: -20 + Math.random() * 40, // 水平漂移幅度
    driftY: -30 + Math.random() * 60, // 垂直漂移幅度
  }));
}

// 单个粒子组件
function Particle({ config, color }: { config: ParticleConfig; color: string }) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const particleOpacity = useSharedValue(config.opacity);

  useEffect(() => {
    // 缓慢漂浮动画
    translateX.value = withDelay(
      config.delay,
      withRepeat(
        withSequence(
          withTiming(config.driftX, {
            duration: config.duration,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(0, {
            duration: config.duration,
            easing: Easing.inOut(Easing.ease),
          })
        ),
        -1,
        true
      )
    );

    translateY.value = withDelay(
      config.delay,
      withRepeat(
        withSequence(
          withTiming(config.driftY, {
            duration: config.duration * 1.2,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(0, {
            duration: config.duration * 1.2,
            easing: Easing.inOut(Easing.ease),
          })
        ),
        -1,
        true
      )
    );

    // 微弱呼吸闪烁
    particleOpacity.value = withDelay(
      config.delay,
      withRepeat(
        withSequence(
          withTiming(config.opacity * 0.4, {
            duration: config.duration * 0.8,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(config.opacity, {
            duration: config.duration * 0.8,
            easing: Easing.inOut(Easing.ease),
          })
        ),
        -1,
        true
      )
    );
  }, [translateX, translateY, particleOpacity, config]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
    opacity: particleOpacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: config.x,
          top: config.y,
          width: config.size,
          height: config.size,
          borderRadius: config.size / 2,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

// 背景漂浮粒子层
export function FloatingParticles({
  count = 18,
  color = '#2F8F4E',
}: FloatingParticlesProps) {
  // 响应式屏幕尺寸（分屏/旋转/字体放大时实时更新，禁止在模块顶层使用 Dimensions.get）
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const particles = useMemo(
    () => generateParticles(count, SCREEN_WIDTH, SCREEN_HEIGHT),
    [count, SCREEN_WIDTH, SCREEN_HEIGHT],
  );

  return (
    <View style={styles.container} pointerEvents="none">
      {particles.map((config, index) => (
        <Particle key={index} config={config} color={color} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
});
