import 'react-native-reanimated';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppState, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { ThemeProvider } from '../src/theme';
import { ToastProvider, EnvBanner } from '../src/components/feedback';
import { AiFloatingCompanion } from '../src/components/effects';
import { PrivacyConsentModal, PermissionRationaleModal } from '../src/components/overlay';
import { initAlipayEnv } from '../src/utils/alipay';
import {
  extractUnifiedInviteCodeFromURL,
  shouldTryNormalShareAfterVipResult,
  shouldTryVipReferralAfterNormalResult,
} from '../src/utils/inviteLink';
import { initWechat } from '../src/services/wechat';
import { appQueryClient } from '../src/queryClient';
import { useAuthStore } from '../src/store';
import { BonusRepo, GrowthRepo } from '../src/repos';
import {
  extractReferralCodeFromURL,
  extractNormalShareCodeFromURL,
  setPendingReferralCode,
  setPendingNormalShareCode,
  clearPendingReferralCode,
  clearPendingNormalShareCode,
  getPendingReferralCode,
  getPendingNormalShareCode,
  shouldAttemptDeferredMatch,
  recordDDLAttempt,
  markDDLResolved,
  readReferralCodeFromClipboard,
  readNormalShareCodeFromClipboard,
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

function invalidateInviteBindingQueries() {
  appQueryClient.invalidateQueries({ queryKey: ['bonus-member'] });
  appQueryClient.invalidateQueries({ queryKey: ['growth-me'] });
  appQueryClient.invalidateQueries({ queryKey: ['normal-share-records'] });
  appQueryClient.invalidateQueries({ queryKey: ['normal-share-stats'] });
}

async function handleReferralCode(code: string) {
  const { isLoggedIn } = useAuthStore.getState();
  if (!isLoggedIn) {
    await setPendingReferralCode(code);
    return;
  }
  // BonusRepo 走 Result 模式不 throw，必须看 result.ok 而非 try/catch
  const result = await BonusRepo.useReferralCode(code);
  if (result.ok) invalidateInviteBindingQueries();
  if (result.ok || !result.error.retryable) {
    // 成功 / 业务错误（已是 VIP / 推荐码无效，retryable=false）→ 清，避免堆积
    await clearPendingReferralCode();
  } else {
    // 可重试错误（NETWORK / 5xx / 限流，retryable=true）：保留 pending 供启动主动绑 effect 重试
    // 否则 /resolve 已 mark consumed 但绑定失败，推荐码彻底丢失
    await setPendingReferralCode(code);
  }
}

async function handleNormalShareCode(code: string) {
  const { isLoggedIn } = useAuthStore.getState();
  if (!isLoggedIn) {
    await setPendingNormalShareCode(code);
    return;
  }
  const result = await GrowthRepo.bindNormalShareCode(code);
  if (result.ok) invalidateInviteBindingQueries();
  if (result.ok || !result.error.retryable) {
    await clearPendingNormalShareCode();
  } else {
    await setPendingNormalShareCode(code);
  }
}

async function handleUnifiedInviteCode(code: string) {
  if (code.startsWith('S')) {
    await handleUnifiedInviteCodeWithNormalFirst(code);
    return;
  }
  await handleUnifiedInviteCodeWithVipFirst(code);
}

async function setPendingUnifiedInviteCode(code: string) {
  await Promise.all([
    setPendingNormalShareCode(code),
    setPendingReferralCode(code),
  ]);
}

async function clearPendingUnifiedInviteCode() {
  await Promise.all([
    clearPendingNormalShareCode(),
    clearPendingReferralCode(),
  ]);
}

async function settleUnifiedInviteResult(code: string, result: any) {
  if (result.ok) invalidateInviteBindingQueries();
  if (result.ok || !result.error?.retryable) {
    await clearPendingUnifiedInviteCode();
  } else {
    await setPendingUnifiedInviteCode(code);
  }
}

async function handleUnifiedInviteCodeWithNormalFirst(code: string) {
  const { isLoggedIn } = useAuthStore.getState();
  if (!isLoggedIn) {
    await setPendingUnifiedInviteCode(code);
    return;
  }

  const normalResult = await GrowthRepo.bindNormalShareCode(code);
  if (normalResult.ok || !shouldTryVipReferralAfterNormalResult(normalResult)) {
    await settleUnifiedInviteResult(code, normalResult);
    return;
  }

  const vipResult = await BonusRepo.useReferralCode(code);
  await settleUnifiedInviteResult(code, vipResult);
}

async function handleUnifiedInviteCodeWithVipFirst(code: string) {
  const { isLoggedIn } = useAuthStore.getState();
  if (!isLoggedIn) {
    await setPendingUnifiedInviteCode(code);
    return;
  }

  const vipResult = await BonusRepo.useReferralCode(code);
  if (vipResult.ok || !shouldTryNormalShareAfterVipResult(vipResult)) {
    await settleUnifiedInviteResult(code, vipResult);
    return;
  }

  const normalResult = await GrowthRepo.bindNormalShareCode(code);
  await settleUnifiedInviteResult(code, normalResult);
}

function handleIncomingURL(url: string | null) {
  if (!url) return;
  const unifiedInviteCode = extractUnifiedInviteCodeFromURL(url);
  if (unifiedInviteCode && unifiedInviteCode !== 'none') {
    handleUnifiedInviteCode(unifiedInviteCode);
    return;
  }
  const normalShareCode = extractNormalShareCodeFromURL(url);
  if (normalShareCode && normalShareCode !== 'none') {
    handleNormalShareCode(normalShareCode);
    return;
  }
  const code = extractReferralCodeFromURL(url);
  if (code && code !== 'none') {
    handleReferralCode(code);
  }
}

async function performDeferredLinkCheck() {
  // 两条静默路径共用 48h 重试窗口（剪贴板本地读 / 指纹一次 API 调用，
  // 都零打扰零成本，窗口内每次冷启动可重试，OTA 没赶上首启也有救）。
  // 历史：曾有 cookie 路径（WebBrowser 弹 Custom Tab 读 /resolve），因冷启动
  // 闪浏览器吓用户 + 跨 cookie 罐基本读不到，2026-06 移除。
  if (!(await shouldAttemptDeferredMatch())) return;

  let resolved = false;
  try {
    // 路径 1（首选）：剪贴板口令——落地页点「下载」时写入的推荐链接
    const clipboardCode = await readReferralCodeFromClipboard();
    if (clipboardCode && clipboardCode !== 'none') {
      await handleReferralCode(clipboardCode);
      resolved = true;
    }

    // 路径 2：普通分享口令。普通分享不走 VIP 推荐码接口，避免关系混淆。
    if (!resolved) {
      const normalShareCode = await readNormalShareCodeFromClipboard();
      if (normalShareCode && normalShareCode !== 'none') {
        await handleNormalShareCode(normalShareCode);
        resolved = true;
      }
    }

    // 路径 3（兜底）：VIP 设备指纹匹配
    if (!resolved) {
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
      const normalShareCode = await getPendingNormalShareCode();
      try {
        if (normalShareCode) {
          const normalResult = await GrowthRepo.bindNormalShareCode(normalShareCode);
          if (normalResult.ok) invalidateInviteBindingQueries();
          if (normalResult.ok || !normalResult.error.retryable) {
            await clearPendingNormalShareCode();
          }
        }
        if (!code) return;
        const result = await BonusRepo.useReferralCode(code);
        if (result.ok) invalidateInviteBindingQueries();
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
    // 延迟到 splash 动画（app/index.tsx, ~2.4s）结束后再触发 DDL：
    // 剪贴板读取要求 App 已持有窗口焦点（Android 10+ 限制），且让启动期
    // 网络/导航先就绪再发指纹匹配请求，更稳。
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
                <EnvBanner />
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
