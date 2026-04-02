import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';

export type AiBadgeVariant = 'recommend' | 'score' | 'trace' | 'analysis' | 'curated';

interface AiBadgeProps {
  variant: AiBadgeVariant;
  style?: any;
}

const VARIANT_LABELS: Record<AiBadgeVariant, string> = {
  recommend: '✦ AI推荐',
  score: '✦ AI评分',
  trace: '✦ AI溯源',
  analysis: '✦ AI分析',
  curated: '✦ 脉脉精选',
};

// AI 标签组件：渐变边框 + shimmer 动效
export function AiBadge({ variant, style }: AiBadgeProps) {
  const { colors, radius, typography } = useTheme();

  // shimmer 动画：高光从左到右扫过
  const shimmerX = useSharedValue(-1);

  useEffect(() => {
    shimmerX.value = withRepeat(
      withTiming(1, { duration: 3500, easing: Easing.inOut(Easing.ease) }),
      -1,
      false
    );
  }, [shimmerX]);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerX.value * 60 }],
    opacity: 0.3,
  }));

  return (
    <View style={[styles.wrapper, style]}>
      {/* 渐变边框 */}
      <LinearGradient
        colors={[colors.ai.start, colors.ai.end]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.gradientBorder, { borderRadius: radius.pill }]}
      >
        <View
          style={[
            styles.inner,
            {
              backgroundColor: colors.ai.soft,
              borderRadius: radius.pill - 1,
            },
          ]}
        >
          <Text style={[typography.captionSm, { color: colors.ai.start }]}>
            {VARIANT_LABELS[variant]}
          </Text>

          {/* shimmer 高光层 */}
          <Animated.View
            style={[
              styles.shimmer,
              { backgroundColor: colors.ai.glow },
              shimmerStyle,
            ]}
          />
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'flex-start',
  },
  gradientBorder: {
    padding: 1,
  },
  inner: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 20,
    borderRadius: 10,
  },
});
