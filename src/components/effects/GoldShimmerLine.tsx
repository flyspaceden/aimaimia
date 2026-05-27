import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

const SCREEN_WIDTH = Dimensions.get('window').width;

// 金箔流光金线：水平 7 色金渐变 + 持续左右扫动，模拟真金箔反光
// 用法：放在卡片顶部 3px 装饰条位置
type GoldShimmerLineProps = {
  height?: number;
  duration?: number; // 单轮扫动毫秒数
};

export function GoldShimmerLine({ height = 3, duration = 4000 }: GoldShimmerLineProps) {
  const offset = useSharedValue(0);

  useEffect(() => {
    offset.value = withRepeat(
      withTiming(1, { duration, easing: Easing.linear }),
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
          [-SCREEN_WIDTH, SCREEN_WIDTH],
        ),
      },
    ],
  }));

  return (
    <View style={[styles.container, { height }]}>
      <Animated.View
        style={[
          { width: SCREEN_WIDTH * 3, height },
          animatedStyle,
        ]}
      >
        <LinearGradient
          colors={[
            '#B8860B',
            '#D4A017',
            '#FFEB99',
            '#FFD700',
            '#FFEB99',
            '#D4A017',
            '#B8860B',
            '#D4A017',
            '#B8860B',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ width: '100%', height }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
  },
});
