import Taro from '@tarojs/taro';
import { ApiClient } from '@/api/client';
import type { Result } from '@/types/result';

export type MiniProgramCodeKind = 'REFERRAL' | 'GROUP_BUY' | 'CAPTAIN';
export type MiniProgramCodeResult = {
  scene: string;
  kind: MiniProgramCodeKind;
  mimeType: 'image/png';
  imageBase64: string;
  expiresAt: string;
};
export type MiniProgramSceneResult = {
  kind: MiniProgramCodeKind;
  path: string;
  expiresAt: string;
};

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const SCENE_PATTERN = /^[A-Za-z0-9_-]{16,32}$/;

function invalid<T>(): Result<T> {
  return { ok: false, error: { code: 'INVALID_MINI_PROGRAM_CODE_RESPONSE', message: 'invalid mini program code response', displayMessage: '小程序码服务响应异常', retryable: true } };
}

function isCodeResult(value: unknown): value is MiniProgramCodeResult {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return SCENE_PATTERN.test(String(item.scene || ''))
    && ['REFERRAL', 'GROUP_BUY', 'CAPTAIN'].includes(String(item.kind))
    && item.mimeType === 'image/png'
    && typeof item.imageBase64 === 'string'
    && item.imageBase64.length >= 12
    && item.imageBase64.length <= 1_500_000
    && BASE64_PATTERN.test(item.imageBase64)
    && typeof item.expiresAt === 'string';
}

export function isAllowedMiniProgramScenePath(path: string): boolean {
  return [
    /^\/packages\/referral\/landing\/index\?code=[A-Z0-9]{8}&kind=(normal|vip)$/,
    /^\/packages\/community\/captain-landing\/index\?code=[A-Z0-9]{3,40}$/,
    /^\/packages\/group-buy\/activity-detail\/index\?activityId=[A-Za-z0-9%_-]{1,128}&shareCode=[A-Z2-9]{10}$/,
  ].some((pattern) => pattern.test(path));
}

export const MiniProgramCodeRepo = {
  async create(kind: MiniProgramCodeKind): Promise<Result<MiniProgramCodeResult>> {
    const result = await ApiClient.post<unknown>('/mini-program/codes', { kind });
    if (!result.ok) return result;
    return isCodeResult(result.data) ? { ok: true, data: result.data } : invalid();
  },
  async resolve(scene: string): Promise<Result<MiniProgramSceneResult>> {
    if (!SCENE_PATTERN.test(scene)) return invalid();
    const result = await ApiClient.get<unknown>(`/mini-program/scenes/${encodeURIComponent(scene)}`);
    if (!result.ok) return result;
    if (!result.data || typeof result.data !== 'object') return invalid();
    const item = result.data as Record<string, unknown>;
    if (!['REFERRAL', 'GROUP_BUY', 'CAPTAIN'].includes(String(item.kind))
      || typeof item.path !== 'string' || !isAllowedMiniProgramScenePath(item.path)
      || typeof item.expiresAt !== 'string') return invalid();
    return { ok: true, data: item as MiniProgramSceneResult };
  },
};

export function persistMiniProgramCode(result: MiniProgramCodeResult): Promise<string> {
  const filePath = `${Taro.env.USER_DATA_PATH}/aim-mini-code-${result.scene}.png`;
  return new Promise((resolve, reject) => {
    Taro.getFileSystemManager().writeFile({
      filePath,
      data: result.imageBase64,
      encoding: 'base64',
      success: () => resolve(filePath),
      fail: (error) => reject(new Error(error.errMsg || '小程序码保存失败')),
    });
  });
}

export function removePersistedMiniProgramCode(filePath: string): Promise<void> {
  if (!filePath) return Promise.resolve();
  return new Promise((resolve) => {
    Taro.getFileSystemManager().unlink({
      filePath,
      success: () => resolve(),
      fail: () => resolve(),
    });
  });
}
