import { Platform } from 'react-native';

/**
 * 初始化支付宝 SDK 环境
 * - 沙箱测试时需要在支付前调用一次
 * - 仅 Android 支持沙箱模式
 */
export function initAlipayEnv(sandbox: boolean) {
  try {
    const { setAlipaySandbox } = require('@uiw/react-native-alipay');
    if (Platform.OS === 'android' && setAlipaySandbox) {
      setAlipaySandbox(sandbox);
      console.log(`[Alipay] 沙箱模式: ${sandbox ? '开启' : '关闭'}`);
    }
  } catch {
    // 原生模块不可用，忽略
  }
}

/**
 * 调用支付宝 APP 支付
 * - 生产环境：使用 @uiw/react-native-alipay 原生 SDK 调起支付宝
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
  try {
    const { alipay } = require('@uiw/react-native-alipay');
    if (!alipay) {
      console.warn('[Alipay] 原生模块不可用（可能在 Expo Go 中运行）');
      return { success: false, memo: 'NATIVE_UNAVAILABLE' };
    }

    const result = await alipay(orderStr);
    // resultStatus: 9000=成功, 8000=处理中, 6001=用户取消, 6002=网络错误, 4000=失败
    const resultStatus = String(result?.resultStatus ?? '');
    return {
      success: resultStatus === '9000',
      resultStatus,
      memo: result?.memo || result?.result || '',
    };
  } catch (err: any) {
    // Expo Go / 原生模块未链接时会抛异常
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
