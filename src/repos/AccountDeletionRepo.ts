/**
 * 账号注销仓储（Repo）
 *
 * 后端接口：
 * - `GET  /api/v1/me/deletion/preview`   → 注销预览（阻塞项 + 资产快照 + 核验方式）
 * - `POST /api/v1/me/deletion/sms-code`  → 发送注销短信验证码（identityVerify=SMS 时）
 * - `POST /api/v1/me/deletion/execute`   → 执行注销，成功后客户端强制登出
 */
import {
  AccountDeletionExecutePayload,
  AccountDeletionExecuteResult,
  AccountDeletionPreview,
  Result,
} from '../types';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

// Mock 预览：无阻塞 + 一组示例资产，用于无后端时验证 UI 三态
const mockPreview: AccountDeletionPreview = {
  canDelete: true,
  blockers: [],
  assets: {
    points: 0,
    coupons: 0,
    withdrawableRewards: 0,
    frozenRewards: 0,
    lotteryQuota: 0,
    pendingWithdrawAmount: 0,
    activeCheckoutCount: 0,
  },
  pending: { paidOrders: 0, activeAfterSales: 0 },
  identityVerify: 'SMS',
  maskedPhone: '138****1234',
};

export const AccountDeletionRepo = {
  /**
   * 注销预览
   * - 后端接口：`GET /api/v1/me/deletion/preview`
   */
  preview: async (): Promise<Result<AccountDeletionPreview>> => {
    if (USE_MOCK) return simulateRequest({ ...mockPreview }, { delay: 400 });
    return ApiClient.get<AccountDeletionPreview>('/me/deletion/preview');
  },

  /**
   * 发送注销短信验证码（仅 identityVerify=SMS）
   * - 后端接口：`POST /api/v1/me/deletion/sms-code`
   */
  sendCode: async (): Promise<Result<{ ok: boolean }>> => {
    if (USE_MOCK) return simulateRequest({ ok: true }, { delay: 300 });
    return ApiClient.post<{ ok: boolean }>('/me/deletion/sms-code');
  },

  /**
   * 执行注销（成功后客户端须强制登出）
   * - 后端接口：`POST /api/v1/me/deletion/execute`
   */
  execute: async (
    payload: AccountDeletionExecutePayload,
  ): Promise<Result<AccountDeletionExecuteResult>> => {
    if (USE_MOCK) return simulateRequest({ ok: true, message: '账号已注销' }, { delay: 600 });
    return ApiClient.post<AccountDeletionExecuteResult>('/me/deletion/execute', payload);
  },
};
