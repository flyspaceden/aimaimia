import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';

interface AiDividerProps {
  style?: ViewStyle;
}

// AI 渐变分割线：水平渐变 + 动画光点从左到右循环
export function AiDivider({ style }: AiDividerProps) {
  const { colors } = useTheme();

  // 光点动画：从左到右，3s 循环
  const translateX = useSharedValue(0);

  useEffect(() => {
    translateX.value = withRepeat(
      withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
      -1,
      false
    );
  }, [translateX]);

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value * 200 }],
  }));

  return (
    <View style={[{ height: 2, overflow: 'hidden', borderRadius: 1 }, style]}>
      <LinearGradient
        colors={[colors.ai.start, colors.ai.end]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ flex: 1 }}
      />
      {/* 动画光点 */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: -1,
            left: -10,
            width: 20,
            height: 4,
            borderRadius: 2,
            backgroundColor: colors.ai.glow,
            opacity: 0.6,
          },
          dotStyle,
        ]}
      />
    </View>
  );
}
