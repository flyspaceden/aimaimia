import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

// CTA 按钮流光扫光：一道半透明白色高光从左扫到右，循环
// 用法：用 overflow:hidden 的 wrapper 包按钮，把本组件 absoluteFill 叠在按钮上
type GoldShineSweepProps = {
  /** 扫光条宽度（dp） */
  width?: number;
  /** 单轮扫动毫秒 */
  duration?: number;
  /** 扫动范围（应略大于按钮宽度） */
  travel?: number;
};

export function GoldShineSweep({
  width = 80,
  duration = 3500,
  travel = 360,
}: GoldShineSweepProps) {
  const offset = useSharedValue(0);

  useEffect(() => {
    offset.value = withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }),
      -1,
      false,
    );
  }, [duration, offset]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          offset.value,
          [0, 1],
          [-travel / 2, travel / 2],
        ),
      },
    ],
    opacity: interpolate(offset.value, [0, 0.5, 1], [0, 1, 0]),
  }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.sweepWrap, { width }, animatedStyle]}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.55)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sweepWrap: {
    height: '100%',
  },
});
