import React from 'react';
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDeliveryTheme } from '../_components';

export default function DeliveryTabsLayout() {
  const { palette } = useDeliveryTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.brand.primary,
        tabBarInactiveTintColor: palette.text.tertiary,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom + 4,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="products"
        options={{
          title: '商品',
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="storefront-outline" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: '我的',
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="account-circle-outline" size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
