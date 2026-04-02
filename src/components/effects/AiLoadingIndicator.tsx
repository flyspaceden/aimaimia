import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { AiOrb } from './AiOrb';

interface AiLoadingIndicatorProps {
  style?: any;
}

// AI 思考态指示器：mini AiOrb + 3 个脉动圆点
export function AiLoadingIndicator({ style }: AiLoadingIndicatorProps) {
  const { colors } = useTheme();

  const dot1 = useSharedValue(0.3);
  const dot2 = useSharedValue(0.3);
  const dot3 = useSharedValue(0.3);

  useEffect(() => {
    const duration = 600;
    dot1.value = withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    dot2.value = withDelay(
      200,
      withRepeat(
        withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      )
    );
    dot3.value = withDelay(
      400,
      withRepeat(
        withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      )
    );
  }, [dot1, dot2, dot3]);

  const dot1Style = useAnimatedStyle(() => ({ opacity: dot1.value }));
  const dot2Style = useAnimatedStyle(() => ({ opacity: dot2.value }));
  const dot3Style = useAnimatedStyle(() => ({ opacity: dot3.value }));

  return (
    <View style={[styles.container, style]}>
      <AiOrb size="mini" state="thinking" />
      <View style={styles.dots}>
        <Animated.View style={[styles.dot, { backgroundColor: colors.ai.start }, dot1Style]} />
        <Animated.View style={[styles.dot, { backgroundColor: colors.ai.start }, dot2Style]} />
        <Animated.View style={[styles.dot, { backgroundColor: colors.ai.start }, dot3Style]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 2,
  },
});
