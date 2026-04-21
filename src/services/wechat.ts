/**
 * 微信 SDK 封装
 *
 * - App 启动时调 `initWechat()` 注册 AppID
 * - 登录时调 `requestWechatAuth()` 拉起微信授权拿 code
 *
 * 需要 react-native-wechat-lib + 自定义 Expo Config Plugin（plugins/withWechat.js）
 * Mock 模式（USE_MOCK=true 或 SDK 未初始化）会返回假 code，便于本地开发不依赖真微信
 */

import { Platform, NativeModules } from 'react-native';
import { USE_MOCK } from '../repos/http/config';

// Lazy import so that running in Expo Go (without the native module) doesn't crash
// 注意：react-native-wechat-lib 只有 named exports，没有 default export
let WeChatLib: typeof import('react-native-wechat-lib') | null = null;
let _initialized = false;

/** 检查原生模块是否已链接（autolinking 成功）
 *
 * 注意：react-native-wechat-lib 的 WeChatModule.getName() 返回 "RCTWeChat"，
 * 不是 "WeChat"。早期这里写成 `.WeChat` 导致首版 APK 永远认为模块未注册，
 * 直接抛"微信 SDK 初始化失败"。 */
function isWechatNativeAvailable(): boolean {
  return !!(NativeModules as any)?.RCTWeChat;
}

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
  // 先检查原生模块是否被 autolinking 注册到 NativeModules（Expo Go 或打包失败时缺失）
  // 若缺失则直接返回 false，避免 require index.js 时顶层 WeChat.registerApp 炸栈
  if (!isWechatNativeAvailable()) {
    // eslint-disable-next-line no-console
    console.warn('[WeChat] NativeModules.WeChat 未注册，SDK 不可用。检查 autolinking / rebuild 是否包含原生模块');
    return false;
  }
  try {
    // react-native-wechat-lib 用 named exports，不是 default
    WeChatLib = require('react-native-wechat-lib');
    const ok = await WeChatLib!.registerApp(WECHAT_APP_ID, WECHAT_UNIVERSAL_LINK);
    _initialized = !!ok;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[WeChat] registerApp result:', ok);
    }
    return _initialized;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[WeChat] SDK 初始化失败:', err);
    return false;
  }
}

/** 检查设备是否安装了微信 */
export async function isWechatInstalled(): Promise<boolean> {
  if (USE_MOCK) return true;
  if (!_initialized) await initWechat();
  if (!WeChatLib) return false;
  try {
    return !!(await WeChatLib.isWXAppInstalled());
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
      throw new Error('微信 SDK 初始化失败（请在打包的 APK / IPA 中使用，或检查微信开放平台配置）');
    }
  }
  if (!WeChatLib) {
    throw new Error('微信 SDK 未加载');
  }

  // Android 需要先确认微信已安装，否则 sendAuthRequest 会静默失败
  if (Platform.OS === 'android') {
    const installed = await WeChatLib.isWXAppInstalled();
    if (!installed) {
      throw new Error('请先安装微信 App');
    }
  }

  const result = await WeChatLib.sendAuthRequest('snsapi_userinfo', 'aimaimai_login');
  if (!result || !(result as any).code) {
    const msg = (result && ((result as any).errStr || (result as any).errMsg)) || '微信授权失败';
    throw new Error(msg);
  }
  return (result as any).code;
}
