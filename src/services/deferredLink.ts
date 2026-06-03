/**
 * 延迟深度链接服务
 *
 * App 首次启动时，通过指纹匹配获取未装 App 时扫码的推荐码。
 * Cookie 方式由 WebBrowser 打开 /resolve 页面处理（见 _layout.tsx）。
 * 本模块封装指纹兜底匹配逻辑。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Dimensions } from 'react-native';
import Constants from 'expo-constants';
import { ApiClient } from '../repos/http/ApiClient';

const PENDING_REFERRAL_KEY = 'pending_referral_code';
const DDL_FIRST_ATTEMPT_KEY = 'ddl_first_attempt_at';
const DDL_RESOLVED_KEY = 'ddl_resolved';
const DDL_COOKIE_ATTEMPTED_KEY = 'ddl_cookie_attempted';
// 与后端 DeferredDeepLink.expiresAt 对齐：超过 48h 服务端记录已被 cron 清理，重试无意义
const DDL_RETRY_WINDOW_MS = 48 * 60 * 60 * 1000;

/** 获取待绑定的推荐码 */
export async function getPendingReferralCode(): Promise<string | null> {
  return AsyncStorage.getItem(PENDING_REFERRAL_KEY);
}

/** 保存待绑定的推荐码 */
export async function setPendingReferralCode(code: string): Promise<void> {
  await AsyncStorage.setItem(PENDING_REFERRAL_KEY, code);
}

/** 清除待绑定的推荐码 */
export async function clearPendingReferralCode(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);
}

/**
 * Cookie 路径是否还应尝试。
 *
 * Cookie 在系统浏览器里写一次后状态静态——用户在两次冷启动之间没回访 *.ai-maimai.com，
 * cookie 内容不会变。所以 cookie 路径**一次性消费**：开浏览器试过就标记 attempted，
 * 永远不再触发 WebBrowser.openAuthSessionAsync。
 *
 * 这避免了"每次冷启动都弹 Chrome Custom Tab → 跳网页 → 跳回 App"的 UX 灾难
 * （绝大多数用户从应用商店装 App，从没扫过推荐 QR，永远不会 resolved=true）
 */
export async function shouldAttemptCookiePath(): Promise<boolean> {
  const resolved = await AsyncStorage.getItem(DDL_RESOLVED_KEY);
  if (resolved === 'true') return false;
  const attempted = await AsyncStorage.getItem(DDL_COOKIE_ATTEMPTED_KEY);
  return attempted !== 'true';
}

/** 标记 cookie 路径已消费（无论成功失败，仅触发一次） */
export async function markCookiePathAttempted(): Promise<void> {
  await AsyncStorage.setItem(DDL_COOKIE_ATTEMPTED_KEY, 'true');
}

/**
 * Fingerprint 路径是否还应尝试。
 *
 * 与 cookie 不同，fingerprint 是 API 调用（matchByFingerprint），重试有价值——
 * 网络瞬断 / 服务端延迟写入 / 客户端被切换网络后 IP 变化等都可能让首次失败、
 * 后续成功。48h 内允许多次尝试，与后端 DeferredDeepLink.expiresAt 对齐。
 */
export async function shouldAttemptFingerprintPath(): Promise<boolean> {
  const resolved = await AsyncStorage.getItem(DDL_RESOLVED_KEY);
  if (resolved === 'true') return false;

  const firstAttemptStr = await AsyncStorage.getItem(DDL_FIRST_ATTEMPT_KEY);
  if (!firstAttemptStr) return true;

  const firstAttempt = parseInt(firstAttemptStr, 10);
  if (isNaN(firstAttempt)) return true;

  return Date.now() - firstAttempt < DDL_RETRY_WINDOW_MS;
}

/** 记录本次尝试发生（首次写 timestamp，后续保持不变） */
export async function recordDDLAttempt(): Promise<void> {
  const existing = await AsyncStorage.getItem(DDL_FIRST_ATTEMPT_KEY);
  if (!existing) {
    await AsyncStorage.setItem(DDL_FIRST_ATTEMPT_KEY, String(Date.now()));
  }
}

/** 标记 DDL 匹配成功（之后永远 skip 两条路径） */
export async function markDDLResolved(): Promise<void> {
  await AsyncStorage.setItem(DDL_RESOLVED_KEY, 'true');
}

/**
 * 指纹兜底匹配（当 Cookie 方式未获取到推荐码时调用）
 */
export async function matchByFingerprint(): Promise<string | null> {
  try {
    const { width, height } = Dimensions.get('screen');
    const ua = await Constants.getWebViewUserAgentAsync() || `ReactNative/${Platform.OS}`;

    const result = await ApiClient.post<{ referralCode: string | null }>('/deferred-link/match', {
      userAgent: ua,
      screenWidth: Math.round(width),
      screenHeight: Math.round(height),
      language: 'zh-CN',
    });

    if (result.ok && result.data.referralCode) {
      return result.data.referralCode;
    }
  } catch {
    // 静默失败
  }
  return null;
}

/**
 * 从 URL 中提取推荐码
 * 支持格式：https://app.ai-maimai.com/r/{CODE} 和 aimaimai://referral?code={CODE}
 * 兼容旧域名 app.xn--ckqa175y.com（爱买买.com 迁移前的链接）
 */
export function extractReferralCodeFromURL(url: string): string | null {
  const match = url.match(/app\.(ai-maimai|xn--ckqa175y)\.com\/r\/([A-Za-z0-9]{8})/);
  if (match) return match[2].toUpperCase();

  const schemeMatch = url.match(/aimaimai:\/\/referral\?code=([A-Za-z0-9]{8})/);
  if (schemeMatch) return schemeMatch[1].toUpperCase();

  return null;
}
