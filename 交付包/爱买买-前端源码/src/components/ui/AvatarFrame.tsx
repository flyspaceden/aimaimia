import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { AvatarFrame as AvatarFrameType } from '../../types';

type AvatarFrameProps = {
  uri?: string | null;
  size?: number;
  frame?: AvatarFrameType | null;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
};

// 头像框组件：用于“身份名片”的头像展示（公共组件需中文注释）
// - 普通用户：静态边框
// - VIP/任务/限时：带轻微呼吸动效（占位，后续可替换为更精致的动效/素材）
export const AvatarFrame = ({ uri, size = 72, frame, style }: AvatarFrameProps) => {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  const ringColors = useMemo(() => {
    if (!frame) {
      return { border: colors.brand.primary, soft: colors.brand.primarySoft, badge: colors.brand.primary };
    }
    if (frame.type === 'vip') {
      return { border: colors.accent.blue, soft: colors.accent.blueSoft, badge: colors.accent.blue };
    }
    if (frame.type === 'task') {
      return { border: colors.brand.primaryDark, soft: colors.brand.primarySoft, badge: colors.brand.primaryDark };
    }
    return { border: colors.warning, soft: colors.border, badge: colors.warning };
  }, [colors, frame]);

  useEffect(() => {
    if (!frame) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [frame, pulse]);

  const outerSize = size;
  const innerSize = Math.max(0, size - 8);

  return (
    <View style={[{ width: outerSize, height: outerSize }, style]}>
      {frame ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pulseRing,
            {
              borderColor: ringColors.border,
              transform: [
                {
                  scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }),
                },
              ],
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.15] }),
            },
          ]}
        />
      ) : null}
      <View
        style={[
          styles.frame,
          {
            width: outerSize,
            height: outerSize,
            borderRadius: outerSize / 2,
            borderColor: ringColors.border,
            backgroundColor: ringColors.soft,
          },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} style={{ width: innerSize, height: innerSize, borderRadius: innerSize / 2 }} />
        ) : (
          <View style={{ width: innerSize, height: innerSize, borderRadius: innerSize / 2, backgroundColor: colors.border }} />
        )}
        {frame ? (
          <View style={[styles.badge, { backgroundColor: colors.surface }]}>
            <MaterialCommunityIcons name="star-four-points" size={10} color={ringColors.badge} />
          </View>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  frame: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderRadius: 999,
  },
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

