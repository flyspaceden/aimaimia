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
const DDL_CHECKED_KEY = 'ddl_checked';

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

/** 是否已完成延迟匹配检查 */
export async function isDDLChecked(): Promise<boolean> {
  const val = await AsyncStorage.getItem(DDL_CHECKED_KEY);
  return val === 'true';
}

/** 标记延迟匹配检查已完成 */
export async function markDDLChecked(): Promise<void> {
  await AsyncStorage.setItem(DDL_CHECKED_KEY, 'true');
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
