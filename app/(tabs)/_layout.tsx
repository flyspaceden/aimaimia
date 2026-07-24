import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SeafoodIcon } from '../../src/components/ui';
import { useTheme } from '../../src/theme';

// 底部三个主 Tab 的导航容器
export default function TabsLayout() {
  const { colors } = useTheme();
  // 适配底部安全区（手势条 / 小白条 / 三大金刚键），避免 tab bar 被系统按钮遮挡
  const insets = useSafeAreaInsets();

  // 只信任系统 safe-area；不根据 Android Dimensions 推断虚拟导航栏，
  // 否则部分手势条设备会被误补 64dp，所有 tab 页面底部出现统一 gap。
  const safeBottomPad = insets.bottom;

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
            <View style={[styles.iconWrap, focused && styles.iconWrapFocused]}>
              <SeafoodIcon name="puffer" size={30} opacity={focused ? 1 : 0.68} />
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
          tabBarIcon: ({ focused }) => (
            <View style={[styles.iconWrap, focused && styles.iconWrapFocused]}>
              <SeafoodIcon name="starfish" size={30} opacity={focused ? 1 : 0.68} />
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
          tabBarIcon: ({ focused }) => (
            <View style={[styles.iconWrap, focused && styles.iconWrapFocused]}>
              <SeafoodIcon name="oyster" size={30} opacity={focused ? 1 : 0.68} />
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
  iconWrapFocused: {
    transform: [{ translateY: -1 }, { scale: 1.06 }],
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 2,
  },
});
