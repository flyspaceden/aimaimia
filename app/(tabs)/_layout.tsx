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

  // 2026-05-20 v4：回退到原 edge-to-edge 条件兜底，仅在 insets=0 + edge-to-edge
  // 模式时强制 32dp。之前的无条件 Math.max(insets, 64) 让 Xiaomi 手势条这类正确
  // 报 insets 的设备（24-34dp）被强制提到 64dp，tab bar 底部出现明显可见的 gap，
  // 用户反馈 home / discover / me tab 下方多出 30-40dp 空白条。
  // 现在：信任 insets 报的值，仅在 OEM bug 场景兜底。
  let safeBottomPad = insets.bottom;
  if (Platform.OS === 'android' && insets.bottom === 0) {
    const window = Dimensions.get('window');
    const screen = Dimensions.get('screen');
    const isEdgeToEdge = Math.abs(window.height - screen.height) < 2;
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
