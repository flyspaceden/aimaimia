/**
 * 延迟深度链接服务
 *
 * App 启动时找回"未装 App 时扫推荐码"留下的推荐码，两条静默路径：
 * 1. 剪贴板口令（首选）：落地页在用户点「下载」时把推荐链接写进剪贴板，
 *    App 读出解析。跨浏览器、跨下载渠道（商店/直装 APK）都有效。
 * 2. 指纹匹配（兜底）：落地页上报的设备指纹与 App 端指纹模糊匹配。
 *
 * 历史：曾有 Cookie 路径（WebBrowser 打开 /resolve 读 _ddl_id cookie），
 * 因冷启动弹 Custom Tab 吓用户 + 落地页浏览器与 Custom Tab cookie 罐不互通
 * 基本读不到，2026-06 移除（网站 /resolve 页保留，兼容未升级的旧 bundle）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Dimensions } from 'react-native';
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import { ApiClient } from '../repos/http/ApiClient';

const PENDING_REFERRAL_KEY = 'pending_referral_code';
const DDL_FIRST_ATTEMPT_KEY = 'ddl_first_attempt_at';
const DDL_RESOLVED_KEY = 'ddl_resolved';
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
 * 是否还应尝试延迟匹配（剪贴板 + 指纹共用同一个 gate）。
 *
 * 两条路径都零打扰且开销极低（本地读剪贴板 / 一次 API 调用），48h 窗口内
 * 每次冷启动都可重试——网络瞬断 / OTA 没赶上首启 / 服务端延迟写入等都可能
 * 让首次失败、后续成功。窗口与后端 DeferredDeepLink.expiresAt 对齐。
 */
export async function shouldAttemptDeferredMatch(): Promise<boolean> {
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
 * 剪贴板口令路径（首选）。
 *
 * 落地页在用户点「下载」时把推荐链接（https://app.ai-maimai.com/r/XXXXXXXX）
 * 写进了剪贴板，这里读出并解析。**只认推荐链接 URL 格式，不认裸 8 位串**——
 * 避免把用户自己复制的任意 8 位文本（密码 / 取件码等）误当推荐码绑定。
 *
 * 注意：必须在隐私同意（consent granted）之后调用——读剪贴板属于敏感行为，
 * 同意前读取会被应用商店合规检测判违规。
 */
export async function readReferralCodeFromClipboard(): Promise<string | null> {
  try {
    const hasString = await Clipboard.hasStringAsync();
    if (!hasString) return null;
    const text = await Clipboard.getStringAsync();
    if (!text) return null;
    return extractReferralCodeFromURL(text);
  } catch {
    // 剪贴板不可用（系统限制 / 后台读取被拒等）静默跳过，走指纹兜底
    return null;
  }
}

/**
 * 指纹兜底匹配（当剪贴板口令未获取到推荐码时调用）
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
