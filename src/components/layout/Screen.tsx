import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { KeyboardAvoidingView, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
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
  /**
   * 启用键盘适配：包 KeyboardAvoidingView，让被键盘遮挡的输入框上移
   * 适用于含 TextInput 的页面（账号安全/地址表单/结算/AI 聊天/客服/发票/售后等）
   *
   * **页面必须自己提供 ScrollView/FlatList 处理滚动**（避免与 Screen 包 ScrollView 嵌套导致冲突）。
   * 建议在自己的 ScrollView 上加 `keyboardShouldPersistTaps="handled"` + `keyboardDismissMode="on-drag"`。
   *
   * 默认 false，保持现有页面行为不变。
   */
  keyboardAvoiding?: boolean;
  /**
   * 键盘适配的 vertical offset，遇到自定义 header 时按 header 高度传入避免错位
   * 默认 0
   */
  keyboardVerticalOffset?: number;
};

// 统一页面容器：处理安全区与状态栏，支持渐变背景与键盘适配
export const Screen = ({
  children,
  style,
  contentStyle,
  statusBarStyle = 'dark',
  safeAreaTop = true,
  safeAreaBottom = false,
  backgroundGradient = false,
  keyboardAvoiding = false,
  keyboardVerticalOffset = 0,
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

  // keyboardAvoiding=true 时，把 children 包进 KAV（仅 KAV，不嵌 ScrollView）：
  // - iOS 用 'padding' 让内容上移
  // - Android 用 'height' 配合 windowSoftInputMode=adjustResize（APK Manifest 已声明）
  // - 不自动包 ScrollView：项目里 12/14 含 TextInput 的页面已有自己的 ScrollView/FlatList，
  //   嵌套 ScrollView 是反模式（会触发 RN 警告 + 滚动手势冲突）
  // - 页面侧自行在 ScrollView 上加 keyboardShouldPersistTaps="handled" + keyboardDismissMode="on-drag"
  const renderContent = () => {
    const inner = <View style={[styles.content, contentStyle]}>{children}</View>;
    if (!keyboardAvoiding) return inner;
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={keyboardVerticalOffset}
        style={styles.content}
      >
        {inner}
      </KeyboardAvoidingView>
    );
  };

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
        {renderContent()}
      </LinearGradient>
    );
  }

  return (
    <View style={[...baseStyle, { backgroundColor: colors.background }]}>
      <StatusBar style={statusBarStyle} />
      {renderContent()}
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
