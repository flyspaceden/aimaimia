import 'react-native-reanimated';
import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { ThemeProvider } from '../src/theme';
import { ToastProvider } from '../src/components/feedback';
import { AiFloatingCompanion } from '../src/components/effects';
import { appQueryClient } from '../src/queryClient';
import { useAuthStore } from '../src/store';
import { BonusRepo } from '../src/repos';
import {
  extractReferralCodeFromURL,
  setPendingReferralCode,
  clearPendingReferralCode,
  isDDLChecked,
  markDDLChecked,
  matchByFingerprint,
} from '../src/services/deferredLink';

const APP_DOMAIN = 'app.xn--ckqa175y.com';

async function handleReferralCode(code: string) {
  const { isLoggedIn } = useAuthStore.getState();
  if (isLoggedIn) {
    try {
      await BonusRepo.useReferralCode(code);
    } catch {
      // 静默失败
    }
    await clearPendingReferralCode();
  } else {
    await setPendingReferralCode(code);
  }
}

function handleIncomingURL(url: string | null) {
  if (!url) return;
  const code = extractReferralCodeFromURL(url);
  if (code && code !== 'none') {
    handleReferralCode(code);
  }
}

async function performDeferredLinkCheck() {
  const checked = await isDDLChecked();
  if (checked) return;

  try {
    let cookieResolved = false;

    const resolveUrl = `https://${APP_DOMAIN}/resolve`;
    const result = await Promise.race([
      WebBrowser.openAuthSessionAsync(resolveUrl, 'aimaimai://referral'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);

    if (
      result &&
      typeof result === 'object' &&
      'type' in result &&
      result.type === 'success' &&
      'url' in result &&
      typeof result.url === 'string'
    ) {
      const code = extractReferralCodeFromURL(result.url);
      if (code && code !== 'none') {
        await handleReferralCode(code);
        cookieResolved = true;
      }
    }

    // 如果超时，确保关闭浏览器会话
    if (!result) {
      WebBrowser.dismissBrowser().catch(() => {});
    }

    if (!cookieResolved) {
      const code = await matchByFingerprint();
      if (code) {
        await handleReferralCode(code);
      }
    }
  } catch {
    // 静默失败
  } finally {
    await markDDLChecked();
  }
}

// 根布局：挂载全局 Provider（数据层/主题/Toast/安全区）
export default function RootLayout() {
  useEffect(() => {
    Linking.getInitialURL().then(handleIncomingURL);

    const subscription = Linking.addEventListener('url', (event) => {
      handleIncomingURL(event.url);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    performDeferredLinkCheck();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={appQueryClient}>
          <ThemeProvider>
            <ToastProvider>
              <View style={{ flex: 1 }}>
                <Stack screenOptions={{
                  headerShown: false,
                  animation: 'slide_from_right',
                  animationDuration: 250,
                }} />
                <AiFloatingCompanion />
              </View>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
