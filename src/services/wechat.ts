/**
 * 微信 SDK 封装
 *
 * - App 启动时调 `initWechat()` 注册 AppID
 * - 登录时调 `requestWechatAuth()` 拉起微信授权拿 code
 *
 * 需要 react-native-wechat-lib + 自定义 Expo Config Plugin（plugins/withWechat.js）
 * Mock 模式（USE_MOCK=true 或 SDK 未初始化）会返回假 code，便于本地开发不依赖真微信
 */

import { Platform } from 'react-native';
import { USE_MOCK } from '../repos/http/config';

// Lazy import so that running in Expo Go (without the native module) doesn't crash
let WeChat: any = null;
let _initialized = false;

/** WeChat AppID：与微信开放平台注册一致（密码本 §5.1） */
const WECHAT_APP_ID = 'wxeb8e8dc219da02dd';

/** iOS Universal Link：iOS 登录时需配（目前 iOS 集成延后，Android 不使用此值） */
const WECHAT_UNIVERSAL_LINK = 'https://app.ai-maimai.com/app/';

/**
 * 注册 WeChat SDK。建议在 App 启动时调一次。
 * - 成功：返回 true
 * - 失败（Expo Go、USE_MOCK 下无原生模块等）：返回 false，不会抛异常
 */
export async function initWechat(): Promise<boolean> {
  if (_initialized) return true;
  if (USE_MOCK) {
    // Mock 模式不需要真实 SDK
    _initialized = true;
    return true;
  }
  try {
    WeChat = require('react-native-wechat-lib').default;
    const ok = await WeChat.registerApp(WECHAT_APP_ID, WECHAT_UNIVERSAL_LINK);
    _initialized = !!ok;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[WeChat] registerApp result:', ok);
    }
    return _initialized;
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[WeChat] SDK 不可用（可能是 Expo Go 或未打包原生模块）:', err);
    }
    return false;
  }
}

/** 检查设备是否安装了微信 */
export async function isWechatInstalled(): Promise<boolean> {
  if (USE_MOCK) return true;
  if (!_initialized) await initWechat();
  if (!WeChat) return false;
  try {
    return !!(await WeChat.isWXAppInstalled());
  } catch {
    return false;
  }
}

/**
 * 拉起微信授权，返回 code（传给后端 /auth/oauth/wechat 换登录态）
 *
 * @returns code 字符串；Mock 模式返回模拟 code
 * @throws 微信未安装、用户取消、SDK 错误时抛出
 */
export async function requestWechatAuth(): Promise<string> {
  if (USE_MOCK) {
    return `wx_auth_${Date.now()}`;
  }
  if (!_initialized) {
    const ok = await initWechat();
    if (!ok) {
      throw new Error('微信 SDK 初始化失败');
    }
  }
  if (!WeChat) {
    throw new Error('微信 SDK 未加载（请在打包的 APK / IPA 中使用）');
  }

  // Android 需要先确认微信已安装，否则 sendAuthRequest 会静默失败
  if (Platform.OS === 'android') {
    const installed = await WeChat.isWXAppInstalled();
    if (!installed) {
      throw new Error('请先安装微信 App');
    }
  }

  const result = await WeChat.sendAuthRequest('snsapi_userinfo', 'aimaimai_login');
  if (!result || !result.code) {
    const msg = (result && (result.errStr || result.errMsg)) || '微信授权失败';
    throw new Error(msg);
  }
  return result.code;
}
