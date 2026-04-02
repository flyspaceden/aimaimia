import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';

interface WheelPointerProps {
  /** 转盘是否正在旋转（控制指针摆动） */
  spinning: boolean;
}

// 转盘指针组件：定位在转盘正上方的倒三角，旋转时左右摆动模拟物理弹片
export function WheelPointer({ spinning }: WheelPointerProps) {
  const { colors } = useTheme();
  const wobble = useSharedValue(0);

  useEffect(() => {
    if (spinning) {
      // 旋转时指针左右摆动 ±3度，100ms/半周期
      wobble.value = withRepeat(
        withSequence(
          withTiming(3, { duration: 100, easing: Easing.inOut(Easing.ease) }),
          withTiming(-3, { duration: 100, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
    } else {
      // 停止摆动，回到中心
      wobble.value = withTiming(0, { duration: 200 });
    }
  }, [spinning, wobble]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${wobble.value}deg` }],
  }));

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      {/* 倒三角指针 */}
      <View
        style={[
          styles.triangle,
          {
            borderTopColor: colors.gold.primary,
          },
        ]}
      />
      {/* 底部小圆点装饰 */}
      <View
        style={[
          styles.dot,
          {
            backgroundColor: colors.gold.primary,
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    zIndex: 10,
  },
  triangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderTopWidth: 20,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: -2,
  },
});
