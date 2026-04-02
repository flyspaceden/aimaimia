import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';

type ScreenProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  statusBarStyle?: 'light' | 'dark' | 'auto';
  safeAreaTop?: boolean;
  safeAreaBottom?: boolean;
  /** 启用背景渐变（surfaceGradient），默认纯色 */
  backgroundGradient?: boolean;
};

// 统一页面容器：处理安全区与状态栏，支持渐变背景
export const Screen = ({
  children,
  style,
  contentStyle,
  statusBarStyle = 'dark',
  safeAreaTop = true,
  safeAreaBottom = false,
  backgroundGradient = false,
}: ScreenProps) => {
  const { colors, gradients, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const paddingTop = safeAreaTop ? insets.top : 0;
  const paddingBottom = safeAreaBottom ? insets.bottom : 0;

  const baseStyle = [
    styles.safeArea,
    { paddingTop, paddingBottom },
    style,
  ];

  if (backgroundGradient) {
    const gradientColors = isDark
      ? gradients.surfaceGradient.dark
      : gradients.surfaceGradient.light;
    return (
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={baseStyle}
      >
        <StatusBar style={statusBarStyle} />
        <View style={[styles.content, contentStyle]}>{children}</View>
      </LinearGradient>
    );
  }

  return (
    <View style={[...baseStyle, { backgroundColor: colors.background }]}>
      <StatusBar style={statusBarStyle} />
      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
