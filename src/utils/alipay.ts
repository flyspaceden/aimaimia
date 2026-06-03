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
  // 诊断：打印 env 内联结果，验证 OTA 命令的 EXPO_PUBLIC_ALIPAY_SANDBOX 是否被 Metro 正确内联
  // 期望看到 raw env 'true' / 'false'，sandbox=boolean 派生
  console.log(
    `[Alipay] initAlipayEnv called sandbox=${sandbox} ` +
    `(EXPO_PUBLIC_ALIPAY_SANDBOX raw=${JSON.stringify(process.env.EXPO_PUBLIC_ALIPAY_SANDBOX)}) ` +
    `Platform=${Platform.OS}`,
  );
  const Alipay = loadAlipay();
  if (!Alipay || typeof Alipay.setAlipaySandbox !== 'function') {
    // 原生模块不可用（如 Expo Go），忽略
    console.warn('[Alipay] initAlipayEnv 跳过：原生模块不可用 / setAlipaySandbox 不是函数');
    return;
  }
  try {
    if (Platform.OS === 'android') {
      Alipay.setAlipaySandbox(sandbox);
      console.log(`[Alipay] 沙箱模式: ${sandbox ? '开启' : '关闭'} (Android)`);
    } else {
      console.log(`[Alipay] iOS 不支持 setAlipaySandbox，跳过`);
    }
  } catch (err: any) {
    console.warn('[Alipay] 设置沙箱模式失败:', err?.message);
  }
}

/**
 * SDK 调用最长等待时间（毫秒）。超时后返回 memo='TIMEOUT'，由 caller 走 active-query 兜底。
 *
 * 设计理由：
 * - SDK 的 Promise 在「支付宝 App 启动失败被系统拦截」时永远不 resolve（如沙箱钱包被 MIUI 杀后台）
 * - 不加超时 → 用户卡在"提交中" spinner 永远，连取消按钮都点不到
 * - 90s 覆盖典型支付时长（用户在支付宝里 30~60s 完成支付 + 切回 App 几秒）
 * - 超时后不 cancel session，让 confirmPaymentAndNavigate 的 active-query + 90 轮询继续兜底
 *   （即使 SDK 没返回，只要用户在支付宝完成支付，notify / 主动查询都能确认）
 */
const ALIPAY_SDK_TIMEOUT_MS = 90000;

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
  // ⚠️ TODO(沙箱诊断专用): 以下两条 console.log 仅用于 Bug 7-B 真机定位（2026-04-30 加）
  // 调起前打印 orderStr 预览：长度异常短 → 后端没生成成功；缺 app_id/sign/biz_content → 签名错
  // 拿到 result 后打印全文：9000=成功 / 4000=失败 / 6001=取消 / 6002=网络错误 / 8000=处理中
  // ⚠️ 上线前必须移除或加 debug flag（含签名参数与交易返回信息，不应进生产长期日志）
  console.log(
    `[Alipay] payWithAlipay called orderStr length=${orderStr.length} ` +
    `preview="${orderStr.slice(0, 80)}..."`,
  );
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race<AlipayResult>([
      Alipay.alipay(orderStr),
      new Promise<AlipayResult>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error('ALIPAY_SDK_TIMEOUT')),
          ALIPAY_SDK_TIMEOUT_MS,
        );
      }),
    ]);
    console.log(`[Alipay] result: ${JSON.stringify(result)}`);
    const resultStatus = String(result?.resultStatus ?? '');
    return {
      success: resultStatus === '9000',
      resultStatus,
      memo: result?.memo || result?.result || '',
    };
  } catch (err: any) {
    // 90s 内 SDK 没 resolve：通常是支付宝 App 启动失败被系统拦截（沙箱钱包 / 后台启动权限）
    if (err?.message === 'ALIPAY_SDK_TIMEOUT') {
      console.warn(`[Alipay] SDK ${ALIPAY_SDK_TIMEOUT_MS}ms 无响应，超时返回 TIMEOUT`);
      return { success: false, memo: 'TIMEOUT' };
    }
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
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
