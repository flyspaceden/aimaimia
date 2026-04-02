import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';

export type AiOrbSize = 'large' | 'small' | 'mini';
export type AiOrbState = 'idle' | 'listening' | 'thinking' | 'responding' | 'error';

interface AiOrbProps {
  size: AiOrbSize;
  state?: AiOrbState;
  onPress?: () => void;
  onLongPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  showLabel?: boolean;
  /** 当 false 时用 View 替代 Pressable，让父级 GestureDetector 接管触摸 */
  interactive?: boolean;
  style?: any;
}

// 尺寸配置
const SIZE_MAP = {
  large: { orb: 160, halo: 200 },
  small: { orb: 48, halo: 64 },
  mini: { orb: 24, halo: 32 },
};

// AI 光球组件：支持 large/small/mini 三种尺寸
export function AiOrb({
  size,
  state = 'idle',
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  showLabel,
  interactive = true,
  style,
}: AiOrbProps) {
  const { colors, typography, shadow } = useTheme();
  const dim = SIZE_MAP[size];

  // 脉动光环动画
  const haloScale = useSharedValue(1);
  const haloOpacity = useSharedValue(0.4);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    // idle 和 listening 状态都有脉动
    if (state === 'idle' || state === 'listening') {
      const duration = state === 'listening' ? 1200 : 1800;
      haloScale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
      haloOpacity.value = withRepeat(
        withSequence(
          withTiming(0.15, { duration, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.4, { duration, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    } else {
      haloScale.value = withTiming(1, { duration: 300 });
      haloOpacity.value = withTiming(0.2, { duration: 300 });
    }
  }, [state, haloScale, haloOpacity]);

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: haloScale.value }],
    opacity: haloOpacity.value,
  }));

  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const handlePressIn = () => {
    buttonScale.value = withTiming(1.08, { duration: 150 });
    onPressIn?.();
  };

  const handlePressOut = () => {
    buttonScale.value = withTiming(1, { duration: 150 });
    onPressOut?.();
  };

  const isListening = state === 'listening';
  const orbBg = isListening ? colors.brand.primaryDark : colors.brand.primary;

  // mini 尺寸：简化圆形 + 内部亮点
  if (size === 'mini') {
    return (
      <View style={[styles.miniContainer, { width: dim.halo, height: dim.halo }, style]}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              backgroundColor: colors.ai.start,
              width: dim.halo,
              height: dim.halo,
              borderRadius: dim.halo / 2,
            },
            haloStyle,
          ]}
        />
        <View
          style={{
            width: dim.orb,
            height: dim.orb,
            borderRadius: dim.orb / 2,
            backgroundColor: orbBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: dim.orb * 0.4,
              height: dim.orb * 0.4,
              borderRadius: dim.orb * 0.2,
              backgroundColor: colors.ai.glow,
              opacity: 0.7,
            }}
          />
        </View>
      </View>
    );
  }

  // small 尺寸：中等光球，无文字
  if (size === 'small') {
    const orbInner = (
      <View
        style={{
          width: dim.orb * 0.35,
          height: dim.orb * 0.35,
          borderRadius: dim.orb * 0.175,
          backgroundColor: colors.ai.glow,
          opacity: 0.6,
        }}
      />
    );

    const orbStyle = [
      {
        width: dim.orb,
        height: dim.orb,
        borderRadius: dim.orb / 2,
        backgroundColor: orbBg,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
      },
      shadow.md,
    ];

    return (
      <View style={[styles.container, { width: dim.halo + 8, height: dim.halo + 8 }, style]}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              backgroundColor: colors.ai.start,
              width: dim.halo,
              height: dim.halo,
              borderRadius: dim.halo / 2,
            },
            haloStyle,
          ]}
        />
        <Animated.View style={buttonAnimatedStyle}>
          {interactive ? (
            <Pressable
              onPress={onPress}
              onLongPress={onLongPress}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              style={orbStyle}
            >
              {orbInner}
            </Pressable>
          ) : (
            <View style={orbStyle} pointerEvents="none">{orbInner}</View>
          )}
        </Animated.View>
      </View>
    );
  }

  // large 尺寸：完整光球，显示文字/麦克风
  return (
    <View style={[styles.container, { width: dim.halo + 20, height: dim.halo + 20 }, style]}>
      {/* 脉动光环 */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            backgroundColor: colors.ai.start,
            width: dim.halo,
            height: dim.halo,
            borderRadius: dim.halo / 2,
          },
          haloStyle,
        ]}
      />

      {/* 主按钮 */}
      <Animated.View style={buttonAnimatedStyle}>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onLongPress={onLongPress}
          onPress={onPress}
          delayLongPress={400}
          style={[
            styles.orbButton,
            shadow.lg,
            {
              backgroundColor: orbBg,
              width: dim.orb,
              height: dim.orb,
              borderRadius: dim.orb / 2,
            },
          ]}
        >
          {isListening ? (
            <>
              <MaterialCommunityIcons
                name="microphone"
                size={48}
                color={colors.text.inverse}
              />
              <Text
                style={[
                  typography.bodySm,
                  { color: colors.text.inverse, marginTop: 2 },
                ]}
              >
                正在听...
              </Text>
            </>
          ) : showLabel !== false ? (
            <>
              <Text
                style={{
                  fontSize: 36,
                  fontWeight: '800',
                  color: colors.text.inverse,
                  letterSpacing: 2,
                }}
              >
                AI
              </Text>
              <Text
                style={[
                  typography.bodyLg,
                  { color: colors.text.inverse, marginTop: -2 },
                ]}
              >
                买买
              </Text>
            </>
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
