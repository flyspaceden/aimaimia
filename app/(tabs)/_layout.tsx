import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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

  // 2026-05-20 v3：与 src/theme/responsive.ts useBottomInset 同步。
  // 取消 edge-to-edge 检测（华为 HarmonyOS / 小米 MIUI 在该检测下不可靠），
  // Android 无条件 Math.max(insets.bottom, 64)，保证 tab bar 不被虚拟键挡。
  // 副作用：非 edge-to-edge 老机 tab 区底部多 64dp，可接受。
  const safeBottomPad = Platform.OS === 'android'
    ? Math.max(insets.bottom, 64)
    : insets.bottom;

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
