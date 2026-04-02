import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';

type ScreenProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  statusBarStyle?: 'light' | 'dark' | 'auto';
  safeAreaTop?: boolean;
  safeAreaBottom?: boolean;
};

// 统一页面容器：处理安全区与状态栏
export const Screen = ({
  children,
  style,
  contentStyle,
  statusBarStyle = 'dark',
  safeAreaTop = true,
  safeAreaBottom = false,
}: ScreenProps) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const paddingTop = safeAreaTop ? insets.top : 0;
  const paddingBottom = safeAreaBottom ? insets.bottom : 0;

  return (
    <View
      style={[
        styles.safeArea,
        { backgroundColor: colors.background, paddingTop, paddingBottom },
        style,
      ]}
    >
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
