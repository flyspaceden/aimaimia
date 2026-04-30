import React from 'react';
import { Dimensions, Platform, StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AiOrb } from '../../src/components/effects';
import { useTheme } from '../../src/theme';

// 底部三个主 Tab 的导航容器
export default function TabsLayout() {
  const { colors } = useTheme();
  // 适配底部安全区（手势条 / 小白条 / 三大金刚键），避免 tab bar 被系统按钮遮挡
  const insets = useSafeAreaInsets();

  // Android OEM 精准兜底：仅在 edge-to-edge 模式（系统栏覆盖 app 窗口）且
  // useSafeAreaInsets() 错误返回 0 时强制 32dp。避免在非 edge-to-edge 旧机型/
  // 全屏沉浸 App 上引入无意义的 32dp 空白。
  //
  // 判定方法：window.height (app 可绘制区) === screen.height (整屏含系统栏)
  //   - 相等 → edge-to-edge 开启，app 画到系统栏后面，必须靠 inset 自适应
  //   - 不等 → 系统栏在 app 窗口外，inset 自然为 0 是正确行为，无需兜底
  //
  // 三键虚拟键 + OEM 错把 insets 报 0 时（华为/小米/OPPO）→ 32dp 救场
  // 现代 Android 手势条（insets 正常返回 24-48）→ max 取大值不变
  // iOS home indicator → 直接用 insets.bottom（约 34dp 或 0）
  let safeBottomPad = insets.bottom;
  if (Platform.OS === 'android' && insets.bottom === 0) {
    const window = Dimensions.get('window');
    const screen = Dimensions.get('screen');
    const isEdgeToEdge = Math.abs(window.height - screen.height) < 2; // 容忍 1px 误差
    if (isEdgeToEdge) {
      safeBottomPad = 32; // OEM bug 兜底
    }
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        animation: 'shift',
        tabBarActiveTintColor: colors.brand.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: 'rgba(255,255,255,0.92)',
          borderTopColor: colors.border,
          height: 56 + safeBottomPad,
          paddingBottom: safeBottomPad + 4,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
        tabBarIconStyle: {
          marginBottom: -2,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: '首页',
          tabBarAccessibilityLabel: '首页，AI 农业助手',
          tabBarIcon: ({ focused }) => (
            <View style={styles.iconWrap}>
              <AiOrb size="mini" state={focused ? 'idle' : 'idle'} />
              {focused && (
                <View style={[styles.dot, { backgroundColor: colors.brand.primary }]} />
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="museum"
        options={{
          title: '发现',
          tabBarAccessibilityLabel: '发现，浏览商品与企业',
          tabBarIcon: ({ focused, color }) => (
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons
                name="compass-outline"
                size={24}
                color={color}
              />
              {focused && (
                <View style={[styles.dot, { backgroundColor: colors.brand.primary }]} />
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: '我的',
          tabBarAccessibilityLabel: '我的，个人中心',
          tabBarIcon: ({ focused, color }) => (
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons
                name="account-circle-outline"
                size={24}
                color={color}
              />
              {focused && (
                <View style={[styles.dot, { backgroundColor: colors.brand.primary }]} />
              )}
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 32,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 2,
  },
});
