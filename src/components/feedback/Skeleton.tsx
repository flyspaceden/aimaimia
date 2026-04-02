import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';

type SkeletonDimension = number | `${number}%` | 'auto';

type SkeletonProps = {
  width?: SkeletonDimension;
  height?: SkeletonDimension;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

// 骨架屏：用于列表与详情页加载占位
export const Skeleton = ({
  width = '100%',
  height = 16,
  radius = 12,
  style,
}: SkeletonProps) => {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.6,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { width, height, borderRadius: radius, backgroundColor: colors.skeleton, opacity },
        style,
      ]}
    />
  );
};

const styles = StyleSheet.create({
  skeleton: {
    overflow: 'hidden',
  },
});
