import { Platform } from 'react-native';

// @uiw/react-native-alipay 是 default export 的 Alipay class（含 static alipay / setAlipaySandbox）
// 之前用具名解构 const { alipay, setAlipaySandbox } = require(...) 永远拿到 undefined
// （CommonJS interop 下 require() 返回 { default: Alipay, __esModule: true }，顶层无字段）
// 修复：用 .default 拿 class，再调 static 方法
type AlipayResult = { resultStatus?: string | number; memo?: string; result?: string };
type AlipayClass = {
  alipay: (orderStr: string) => Promise<AlipayResult>;
  setAlipaySandbox: (sandbox: boolean) => void;
};

function loadAlipay(): AlipayClass | null {
  try {
    const mod = require('@uiw/react-native-alipay');
    return (mod?.default ?? mod) as AlipayClass;
  } catch {
    return null;
  }
}

/**
 * 初始化支付宝 SDK 环境
 * - 沙箱测试时需要在支付前调用一次
 * - 仅 Android 支持沙箱模式
 */
export function initAlipayEnv(sandbox: boolean) {
  const Alipay = loadAlipay();
  if (!Alipay || typeof Alipay.setAlipaySandbox !== 'function') {
    // 原生模块不可用（如 Expo Go），忽略
    return;
  }
  try {
    if (Platform.OS === 'android') {
      Alipay.setAlipaySandbox(sandbox);
      console.log(`[Alipay] 沙箱模式: ${sandbox ? '开启' : '关闭'}`);
    }
  } catch (err: any) {
    console.warn('[Alipay] 设置沙箱模式失败:', err?.message);
  }
}

/**
 * 调用支付宝 APP 支付
 * - preview/production APK：使用 @uiw/react-native-alipay 原生 SDK 调起支付宝
 * - 开发环境（Expo Go）：原生模块不可用，返回 false 走模拟支付
 *
 * @param orderStr 后端通过 alipay-sdk sdkExecute 生成的完整支付参数字符串
 * @returns 支付是否成功（resultStatus === '9000'）
 */
export async function payWithAlipay(orderStr: string): Promise<{
  success: boolean;
  resultStatus?: string;
  memo?: string;
}> {
  const Alipay = loadAlipay();
  if (!Alipay || typeof Alipay.alipay !== 'function') {
    console.warn('[Alipay] 原生模块不可用（可能在 Expo Go 中运行）');
    return { success: false, memo: 'NATIVE_UNAVAILABLE' };
  }
  try {
    const result = await Alipay.alipay(orderStr);
    // resultStatus: 9000=成功, 8000=处理中, 6001=用户取消, 6002=网络错误, 4000=失败
    const resultStatus = String(result?.resultStatus ?? '');
    return {
      success: resultStatus === '9000',
      resultStatus,
      memo: result?.memo || result?.result || '',
    };
  } catch (err: any) {
    // 原生模块未链接时（理论上 loadAlipay 已拦截，这里兜底）
    if (
      err?.message?.includes('Cannot find native module') ||
      err?.message?.includes('NativeModule') ||
      err?.code === 'MODULE_NOT_FOUND'
    ) {
      console.warn('[Alipay] 原生模块不可用，需要 EAS Build 自定义客户端');
      return { success: false, memo: 'NATIVE_UNAVAILABLE' };
    }
    console.error('[Alipay] 支付异常:', err);
    return { success: false, memo: err?.message || 'UNKNOWN_ERROR' };
  }
}
