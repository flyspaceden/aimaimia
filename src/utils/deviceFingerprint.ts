/**
 * 设备指纹工具
 *
 * 从 SecureStore 读取或生成持久化 UUID，用于：
 * - 未登录用户的抽奖限流（替代游客账户）
 * - 设备级别的唯一标识
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const FP_KEY = 'nongmai-device-fp';

/** 并发安全：只生成一次 */
let fingerprintPromise: Promise<string> | null = null;

/** 获取或生成设备指纹（UUID） */
export function getDeviceFingerprint(): Promise<string> {
  if (!fingerprintPromise) {
    fingerprintPromise = (async () => {
      if (Platform.OS === 'web') {
        let fp = localStorage.getItem(FP_KEY);
        if (!fp) {
          fp = generateUUID();
          localStorage.setItem(FP_KEY, fp);
        }
        return fp;
      }
      let fp = await SecureStore.getItemAsync(FP_KEY);
      if (!fp) {
        fp = generateUUID();
        await SecureStore.setItemAsync(FP_KEY, fp);
      }
      return fp;
    })();
  }
  return fingerprintPromise;
}

/** 简易 UUID v4 生成 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
