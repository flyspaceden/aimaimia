import React from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { useTheme } from '../../theme';

type AppHeaderProps = {
  title: string;
  subtitle?: string;
  tone?: 'light' | 'dark';
  showBack?: boolean;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
  leftSlot?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

// 顶部标题栏：毛玻璃背景 + 微妙阴影，统一返回/标题/右侧操作区
export const AppHeader = ({
  title,
  subtitle,
  tone = 'dark',
  showBack = true,
  onBack,
  rightSlot,
  leftSlot,
  style,
}: AppHeaderProps) => {
  const { colors, typography, shadow, isDark } = useTheme();
  const router = useRouter();
  const isLight = tone === 'light';
  const textColor = isLight ? colors.text.inverse : colors.text.primary;
  const secondaryColor = isLight ? colors.text.inverse : colors.text.secondary;
  const iconColor = textColor;

  // 半透明背景色（80% opacity）
  const surfaceOverlay = isLight
    ? 'transparent'
    : isDark
      ? 'rgba(20, 30, 20, 0.80)'
      : 'rgba(255, 255, 255, 0.80)';

  const content = (
    <View style={[styles.container, style]}>
      <View style={styles.side}>
        {showBack ? (
          <Pressable
            onPress={() => (onBack ? onBack() : router.back())}
            hitSlop={10}
            style={styles.backButton}
          >
            <MaterialCommunityIcons name="chevron-left" size={28} color={iconColor} />
          </Pressable>
        ) : (
          <View style={styles.backButton} />
        )}
        {leftSlot}
      </View>

      <View style={styles.center}>
        <Text style={[typography.bodyStrong, { color: textColor }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typography.caption, { color: secondaryColor, marginTop: 2 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={[styles.side, styles.rightSide]}>{rightSlot}</View>
    </View>
  );

  // light tone 模式不需要模糊背景（通常用于渐变/图片顶部）
  if (isLight) {
    return content;
  }

  // Android / Web 降级：不支持 BlurView 时用半透明 View
  if (Platform.OS === 'android' || Platform.OS === 'web') {
    return (
      <View style={[styles.androidBg, { backgroundColor: surfaceOverlay }, shadow.sm]}>
        {content}
      </View>
    );
  }

  // iOS：BlurView 毛玻璃效果
  return (
    <BlurView
      intensity={80}
      tint={isDark ? 'dark' : 'light'}
      style={[styles.blurBg, shadow.sm]}
    >
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: surfaceOverlay }]} />
      {content}
    </BlurView>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  blurBg: {
    overflow: 'hidden',
  },
  androidBg: {
    overflow: 'hidden',
  },
  side: {
    width: 72,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rightSide: {
    justifyContent: 'flex-end',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
