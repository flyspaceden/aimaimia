import { ApiClient } from '@/api/client';
import { isMiniProgramPaymentParams } from '@/types';
import type { Result } from '@/types';
import type {
  GroupBuyActivity,
  GroupBuyActivityPage,
  GroupBuyCheckoutInput,
  GroupBuyCheckoutPreview,
  GroupBuyCheckoutSession,
  GroupBuyCurrentState,
  GroupBuyLanding,
  GroupBuyLedgerPage,
  GroupBuyRebateAccount,
} from './types';

function invalidContract<T>(label: string): Result<T> {
  return {
    ok: false,
    error: {
      code: 'INVALID_CONTRACT',
      message: `${label} returned an invalid response`,
      displayMessage: '服务响应异常，请稍后重试',
      retryable: true,
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCheckoutSession(value: unknown): value is GroupBuyCheckoutSession {
  if (!isObject(value)) return false;
  return typeof value.sessionId === 'string'
    && typeof value.merchantOrderNo === 'string'
    && typeof value.expectedTotal === 'number'
    && typeof value.goodsAmount === 'number'
    && typeof value.shippingFee === 'number'
    && typeof value.discountAmount === 'number'
    && value.paymentScene === 'MINI_PROGRAM'
    && isMiniProgramPaymentParams(value.paymentParams);
}

function normalizePage<T>(value: unknown): GroupBuyLedgerPage | null {
  if (!isObject(value) || !Array.isArray(value.items)) return null;
  if (!Number.isInteger(value.total) || !Number.isInteger(value.page) || !Number.isInteger(value.pageSize)) return null;
  const page = Number(value.page);
  const pageSize = Number(value.pageSize);
  const total = Number(value.total);
  return {
    items: value.items as T[] as GroupBuyLedgerPage['items'],
    total,
    page,
    pageSize,
    nextPage: typeof value.nextPage === 'number'
      ? value.nextPage
      : page * pageSize < total ? page + 1 : undefined,
  };
}

function checkoutBody(input: GroupBuyCheckoutInput, includeIdempotency = false) {
  return {
    activityId: input.activityId,
    ...(input.addressId ? { addressId: input.addressId } : {}),
    ...(input.fulfillment ? { fulfillment: input.fulfillment } : input.addressId ? { fulfillment: { mode: 'DELIVERY' as const, addressId: input.addressId } } : {}),
    expectedTotal: input.expectedTotal,
    ...(input.shareCode ? { shareCode: input.shareCode } : {}),
    ...(includeIdempotency && input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  };
}

export const MiniGroupBuyRepo = {
  listActivities: (): Promise<Result<GroupBuyActivityPage>> =>
    ApiClient.get<GroupBuyActivityPage>('/group-buy/activities'),

  async getActivity(activityId: string): Promise<Result<GroupBuyActivity>> {
    const result = await MiniGroupBuyRepo.listActivities();
    if (!result.ok) return result;
    const activity = result.data.items.find((item) => item.id === activityId);
    return activity
      ? { ok: true, data: activity }
      : { ok: false, error: { code: 'NOT_FOUND', message: 'group-buy activity not found', displayMessage: '团购商品不存在或已结束' } };
  },

  getLanding: (code: string): Promise<Result<GroupBuyLanding>> =>
    ApiClient.get<GroupBuyLanding>(`/group-buy/landing/${encodeURIComponent(code)}`),

  getCurrent: (): Promise<Result<GroupBuyCurrentState>> =>
    ApiClient.get<GroupBuyCurrentState>('/group-buy/me/current'),

  previewCheckout: (input: GroupBuyCheckoutInput): Promise<Result<GroupBuyCheckoutPreview>> =>
    ApiClient.post<GroupBuyCheckoutPreview>('/group-buy/checkout/preview', checkoutBody(input)),

  async createMiniProgramCheckout(input: GroupBuyCheckoutInput): Promise<Result<GroupBuyCheckoutSession>> {
    const result = await ApiClient.post<unknown>('/group-buy/checkout/mini-program', checkoutBody(input, true));
    if (!result.ok) return result;
    return isCheckoutSession(result.data)
      ? { ok: true, data: result.data }
      : invalidContract('mini-program group-buy checkout');
  },

  terminateCurrent: (): Promise<Result<{ status: string }>> =>
    ApiClient.post<{ status: string }>('/group-buy/me/current/terminate'),

  abandonCurrent: (instanceId: string): Promise<Result<{ status: string }>> =>
    ApiClient.post<{ status: string }>(`/group-buy/me/current/${encodeURIComponent(instanceId)}/abandon`),

  getRebateAccount: (): Promise<Result<GroupBuyRebateAccount>> =>
    ApiClient.get<GroupBuyRebateAccount>('/group-buy/me/rebate-account'),

  async listRebateLedgers(page = 1, pageSize = 20): Promise<Result<GroupBuyLedgerPage>> {
    const result = await ApiClient.get<unknown>('/group-buy/me/rebate-ledgers', { page, pageSize });
    if (!result.ok) return result;
    const normalized = normalizePage(result.data);
    return normalized ? { ok: true, data: normalized } : invalidContract('group-buy rebate ledger page');
  },
};
