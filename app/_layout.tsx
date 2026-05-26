import 'react-native-reanimated';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppState, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { ThemeProvider } from '../src/theme';
import { ToastProvider } from '../src/components/feedback';
import { AiFloatingCompanion } from '../src/components/effects';
import { PrivacyConsentModal, PermissionRationaleModal } from '../src/components/overlay';
import { initAlipayEnv } from '../src/utils/alipay';
import { initWechat } from '../src/services/wechat';
import { appQueryClient } from '../src/queryClient';
import { useAuthStore } from '../src/store';
import { BonusRepo } from '../src/repos';
import {
  extractReferralCodeFromURL,
  setPendingReferralCode,
  clearPendingReferralCode,
  getPendingReferralCode,
  shouldAttemptCookiePath,
  markCookiePathAttempted,
  shouldAttemptFingerprintPath,
  recordDDLAttempt,
  markDDLResolved,
  matchByFingerprint,
} from '../src/services/deferredLink';
import { needsPrivacyConsent } from '../src/services/privacyConsent';

// 全局兜底：所有 <Text> 默认最大字体放大不超过 1.2x（无障碍合规 + 防爆）。
// 写死 fontSize 的页面即使忘加 priceTextProps / fitTextProps，也不会被系统
// 超大字体设置（华为/小米的 1.5-2x）爆掉布局。
// 仅作为迁移期兜底，新代码仍应显式使用 src/theme/responsive.ts 的预设。
// 详见 docs/architecture/responsive-design.md §3.4
(Text as any).defaultProps = (Text as any).defaultProps || {};
(Text as any).defaultProps.maxFontSizeMultiplier = 1.2;

const APP_DOMAIN = 'app.ai-maimai.com';

async function handleReferralCode(code: string) {
  const { isLoggedIn } = useAuthStore.getState();
  if (!isLoggedIn) {
    await setPendingReferralCode(code);
    return;
  }
  // BonusRepo 走 Result 模式不 throw，必须看 result.ok 而非 try/catch
  const result = await BonusRepo.useReferralCode(code);
  if (result.ok || !result.error.retryable) {
    // 成功 / 业务错误（已是 VIP / 推荐码无效，retryable=false）→ 清，避免堆积
    await clearPendingReferralCode();
  } else {
    // 可重试错误（NETWORK / 5xx / 限流，retryable=true）：保留 pending 供启动主动绑 effect 重试
    // 否则 /resolve 已 mark consumed 但绑定失败，推荐码彻底丢失
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
  // 两条路径独立 gate：cookie 一次性消费（浏览器状态静态，重试无意义且打扰用户），
  // fingerprint 48h 内可重试（API 调用，网络瞬断/IP 变化等场景重试有救）
  const wantCookie = await shouldAttemptCookiePath();
  const wantFingerprint = await shouldAttemptFingerprintPath();
  if (!wantCookie && !wantFingerprint) return;

  let resolved = false;
  try {
    if (wantCookie) {
      try {
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
            resolved = true;
          }
        }

        // 如果超时，确保关闭浏览器会话
        if (!result) {
          WebBrowser.dismissBrowser().catch(() => {});
        }
      } finally {
        // 一次性消费——无论成功失败，下次冷启动不再开浏览器
        await markCookiePathAttempted();
      }
    }

    if (!resolved && wantFingerprint) {
      const code = await matchByFingerprint();
      if (code) {
        await handleReferralCode(code);
        resolved = true;
      }
    }
  } catch {
    // 静默失败
  } finally {
    await recordDDLAttempt();
    if (resolved) await markDDLResolved();
  }
}

// 根布局：挂载全局 Provider（数据层/主题/Toast/安全区）
export default function RootLayout() {
  // 隐私合规状态：未知 / 需要弹窗 / 已同意
  const [consentState, setConsentState] = useState<'unknown' | 'needed' | 'granted'>('unknown');
  // 订阅 isLoggedIn：zustand persist rehydrate 是 async，
  // 冷启动时 effect 可能在恢复完成前先跑（看到 false），订阅后 rehydrate 完成会重跑
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  // 首启检查：是否已同意隐私政策和用户协议
  useEffect(() => {
    (async () => {
      const needs = await needsPrivacyConsent();
      setConsentState(needs ? 'needed' : 'granted');
    })();
  }, []);

  // App 回到前台时重新检查隐私同意状态
  // 场景：设置页"撤回隐私同意" → BackHandler.exitApp() 只 finish Activity，进程可能仍在
  //       → 重开 App 时 useEffect 不会重跑，需要靠 AppState 监听把状态拉回 'needed' 重弹弹窗
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        const needs = await needsPrivacyConsent();
        if (needs) {
          setConsentState('needed');
        }
      }
    });
    return () => sub.remove();
  }, []);

  const handleConsent = useCallback(() => {
    setConsentState('granted');
  }, []);

  // URL 监听器立刻挂（防止待同意期间外部唤起 URL 丢失），
  // 但 handleIncomingURL 涉及网络调用（已登录 → 立即绑推荐码），需待 consent granted 后才处理
  const pendingURLsRef = useRef<string[]>([]);
  const consentRef = useRef<typeof consentState>('unknown');
  useEffect(() => {
    consentRef.current = consentState;
    if (consentState === 'granted' && pendingURLsRef.current.length > 0) {
      const buffered = pendingURLsRef.current;
      pendingURLsRef.current = [];
      buffered.forEach(handleIncomingURL);
    }
  }, [consentState]);

  useEffect(() => {
    const enqueueOrHandle = (url: string | null) => {
      if (!url) return;
      if (consentRef.current === 'granted') {
        handleIncomingURL(url);
      } else {
        pendingURLsRef.current.push(url);
      }
    };

    Linking.getInitialURL().then(enqueueOrHandle);

    const subscription = Linking.addEventListener('url', (event) => {
      enqueueOrHandle(event.url);
    });

    return () => subscription.remove();
  }, []);

  // 启动后已登录态主动尝试绑定 pending referral code
  // 场景：用户首启 → DDL 匹配成功写入 pending → 没立即注册 → 关 App
  //   → 下次启动直接进首页（已是登录态），useAuthStore.setLoggedIn 不会再触发
  //   → 没有这段逻辑则 pending code 永远不会绑
  useEffect(() => {
    if (consentState !== 'granted') return;
    if (!isLoggedIn) return;

    (async () => {
      const code = await getPendingReferralCode();
      if (!code) return;
      try {
        const result = await BonusRepo.useReferralCode(code);
        if (result.ok || !result.error.retryable) {
          // 成功 / 业务错误（已是 VIP / 推荐码无效，retryable=false）→ 清，避免堆积
          await clearPendingReferralCode();
        }
        // 可重试错误（NETWORK / 5xx / 限流）：保留 pending 供下次启动重试
      } catch {
        // 兜底：未知异常保留 pending
      }
    })();
  }, [consentState, isLoggedIn]);

  useEffect(() => {
    if (consentState !== 'granted') return;
    // 延迟到 splash 动画（app/index.tsx, ~2.4s）结束后再触发 DDL，避免
    // WebBrowser.openAuthSessionAsync 拉起 Custom Tab 打断首屏动画 + 回跳
    // 落到 unmatched 路由（历史 bug：首启闪网页 + no router 页）。
    const timer = setTimeout(() => {
      performDeferredLinkCheck().catch((err) => {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn('[DDL] performDeferredLinkCheck failed:', err);
        }
      });
    }, 3000);
    return () => clearTimeout(timer);
  }, [consentState]);

  // 支付宝沙箱环境
  // ⚠️ 不能用 __DEV__：preview/production APK 是 release build，__DEV__ === false → 沙箱被强制关掉
  // 用 EXPO_PUBLIC_ALIPAY_SANDBOX env var 控制（在 eas update / build 命令上显式带入）
  // 沙箱测试期间设 true，上线前改 false
  useEffect(() => {
    if (consentState !== 'granted') return;
    const sandbox = process.env.EXPO_PUBLIC_ALIPAY_SANDBOX === 'true';
    initAlipayEnv(sandbox);
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
                <PermissionRationaleModal />
              </View>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
