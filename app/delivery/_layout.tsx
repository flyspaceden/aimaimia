import React from 'react';
import { Redirect, Stack, usePathname } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '../../src/components/layout';
import { DeliveryAuthRepo } from '../../src/repos/delivery';
import { useDeliveryAuthStore } from '../../src/store';
import { DeliveryLoading } from './_components';

export default function DeliveryLayout() {
  const pathname = usePathname();
  const hasHydrated = useDeliveryAuthStore((state) => state.hasHydrated);
  const isLoggedIn = useDeliveryAuthStore((state) => state.isLoggedIn);
  const currentUnitId = useDeliveryAuthStore((state) => state.currentUnitId);
  const requiresUnit = useDeliveryAuthStore((state) => state.requiresUnit);
  const updateProfile = useDeliveryAuthStore((state) => state.updateProfile);

  useQuery({
    queryKey: ['delivery-session-me'],
    queryFn: async () => {
      const result = await DeliveryAuthRepo.getMe();
      if (result.ok) {
        updateProfile(result.data);
        return result.data;
      }
      throw result.error;
    },
    enabled: hasHydrated && isLoggedIn,
    staleTime: 60_000,
  });

  if (!hasHydrated) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <DeliveryLoading label="配送模块加载中..." />
      </Screen>
    );
  }

  const inUnitFlow =
    pathname === '/delivery/unit-select' || pathname === '/delivery/unit-edit';

  if (!isLoggedIn) {
    if (pathname !== '/delivery/login') {
      return <Redirect href="/delivery/login" />;
    }
  } else if (requiresUnit || !currentUnitId) {
    if (!inUnitFlow) {
      return <Redirect href="/delivery/unit-select" />;
    }
  } else if (pathname === '/delivery' || pathname === '/delivery/login') {
    return <Redirect href="/delivery/(tabs)/products" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="unit-select" />
      <Stack.Screen name="unit-edit" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="product/[id]" />
      <Stack.Screen name="cart" />
      <Stack.Screen name="checkout" />
      <Stack.Screen name="payment-success" />
      <Stack.Screen name="orders/index" />
      <Stack.Screen name="orders/[id]" />
      <Stack.Screen name="manifests/index" />
    </Stack>
  );
}
