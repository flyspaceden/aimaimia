import React from 'react';
import { Tabs } from 'expo-router';
import { useTheme } from '../../src/theme';

// 底部五个主 Tab 的导航容器
export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen name="home" options={{ title: '首页' }} />
      <Tabs.Screen name="museum" options={{ title: '展览馆' }} />
      <Tabs.Screen name="wishes" options={{ title: '心愿池' }} />
      <Tabs.Screen name="circle" options={{ title: '爱买买圈' }} />
      <Tabs.Screen name="me" options={{ title: '我的' }} />
    </Tabs>
  );
}
