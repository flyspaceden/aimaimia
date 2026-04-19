import 'react-native-reanimated';
import React, { useCallback, useEffect, useState } from 'react';
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
import { PrivacyConsentModal } from '../src/components/overlay';
import { initAlipayEnv } from '../src/utils/alipay';
import { initWechat } from '../src/services/wechat';
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
import { needsPrivacyConsent } from '../src/services/privacyConsent';

const APP_DOMAIN = 'app.ai-maimai.com';

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
  // 隐私合规状态：未知 / 需要弹窗 / 已同意
  const [consentState, setConsentState] = useState<'unknown' | 'needed' | 'granted'>('unknown');

  // 首启检查：是否已同意隐私政策和用户协议
  useEffect(() => {
    (async () => {
      const needs = await needsPrivacyConsent();
      setConsentState(needs ? 'needed' : 'granted');
    })();
  }, []);

  const handleConsent = useCallback(() => {
    setConsentState('granted');
  }, []);

  // 以下副作用都必须在用户同意隐私政策后才能执行（合规要求：未同意前不得收集任何信息）
  useEffect(() => {
    if (consentState !== 'granted') return;

    Linking.getInitialURL().then(handleIncomingURL);

    const subscription = Linking.addEventListener('url', (event) => {
      handleIncomingURL(event.url);
    });

    return () => subscription.remove();
  }, [consentState]);

  useEffect(() => {
    if (consentState !== 'granted') return;
    // 加 .catch 防 WebBrowser / fetch / setDDLChecked 异步失败炸到 React 顶层
    performDeferredLinkCheck().catch((err) => {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[DDL] performDeferredLinkCheck failed:', err);
      }
    });
  }, [consentState]);

  // 支付宝沙箱环境（测试时设为 true，上线前改为 false）
  useEffect(() => {
    if (consentState !== 'granted') return;
    initAlipayEnv(__DEV__);
  }, [consentState]);

  // 微信 SDK 注册（Mock 模式会跳过真实注册；Expo Go 无原生模块也会静默失败）
  useEffect(() => {
    if (consentState !== 'granted') return;
    initWechat().catch(() => {
      // 静默失败，不影响 App 启动
    });
  }, [consentState]);

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
                <PrivacyConsentModal open={consentState === 'needed'} onAgree={handleConsent} />
              </View>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
