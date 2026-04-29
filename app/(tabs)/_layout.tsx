import React from 'react';
import { StyleSheet, View } from 'react-native';
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
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom + 4,
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
