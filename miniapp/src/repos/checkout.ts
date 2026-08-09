import { ApiClient } from '@/api/client';
import type {
  CheckoutPreview,
  CheckoutPreviewInput,
  CheckoutSession,
  CheckoutStatusResult,
  CrossSceneCheckoutResult,
  MiniProgramCheckoutInput,
  MiniProgramResumeResult,
  MiniProgramVipCheckoutInput,
  PendingCheckout,
  PendingVipCheckout,
  Result,
} from '@/types';
import { isCheckoutSession, isMiniProgramPaymentParams } from '@/types';
import { invalidContract } from './contracts';

function isResumeResult(value: unknown): value is MiniProgramResumeResult {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.sessionId === 'string'
    && typeof raw.merchantOrderNo === 'string'
    && typeof raw.expectedTotal === 'number'
    && raw.paymentScene === 'MINI_PROGRAM'
    && isMiniProgramPaymentParams(raw.paymentParams);
}

function isPendingVipCheckout(value: unknown): value is PendingVipCheckout {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.sessionId === 'string'
    && raw.sessionId.length > 0
    && (typeof raw.merchantOrderNo === 'string' || raw.merchantOrderNo === null)
    && typeof raw.expectedTotal === 'number'
    && Number.isFinite(raw.expectedTotal)
    && typeof raw.expiresAt === 'string'
    && Number.isFinite(Date.parse(raw.expiresAt))
    && raw.bizType === 'VIP_PACKAGE'
    && raw.paymentScene === 'MINI_PROGRAM';
}

async function createSession(
  path: '/orders/checkout/mini-program' | '/orders/vip-checkout/mini-program',
  input: MiniProgramCheckoutInput | MiniProgramVipCheckoutInput,
): Promise<Result<CheckoutSession>> {
  const result = await ApiClient.post<unknown>(path, input);
  if (!result.ok) return result;
  return isCheckoutSession(result.data)
    ? { ok: true, data: result.data }
    : invalidContract('mini-program checkout');
}

export const CheckoutRepo = {
  preview: (input: CheckoutPreviewInput): Promise<Result<CheckoutPreview>> =>
    ApiClient.post<CheckoutPreview>('/orders/preview', input),

  create: (input: MiniProgramCheckoutInput): Promise<Result<CheckoutSession>> =>
    createSession('/orders/checkout/mini-program', {
      items: input.items.map((item) => ({
        skuId: item.skuId,
        quantity: item.quantity,
        ...(item.cartItemId !== undefined && { cartItemId: item.cartItemId }),
      })),
      ...(input.checkoutSource !== undefined && { checkoutSource: input.checkoutSource }),
      addressId: input.addressId,
      expectedTotal: input.expectedTotal,
      ...(input.couponInstanceIds !== undefined && {
        couponInstanceIds: input.couponInstanceIds,
      }),
      ...(input.deductionAmount !== undefined && { deductionAmount: input.deductionAmount }),
      ...(input.idempotencyKey !== undefined && { idempotencyKey: input.idempotencyKey }),
      ...(input.buyerNote !== undefined && { buyerNote: input.buyerNote }),
    }),

  createVip: (input: MiniProgramVipCheckoutInput): Promise<Result<CheckoutSession>> =>
    createSession('/orders/vip-checkout/mini-program', {
      packageId: input.packageId,
      giftOptionId: input.giftOptionId,
      addressId: input.addressId,
      expectedTotal: input.expectedTotal,
      ...(input.idempotencyKey !== undefined && { idempotencyKey: input.idempotencyKey }),
      ...(input.buyerNote !== undefined && { buyerNote: input.buyerNote }),
    }),

  getStatus: (sessionId: string): Promise<Result<CheckoutStatusResult>> =>
    ApiClient.get<CheckoutStatusResult>(`/orders/checkout/${sessionId}/status`),

  activeQuery: (sessionId: string): Promise<Result<CheckoutStatusResult>> =>
    ApiClient.post<CheckoutStatusResult>(`/orders/checkout/${sessionId}/active-query`),

  getPending: (): Promise<Result<PendingCheckout | null>> =>
    ApiClient.get<PendingCheckout | null>('/orders/checkout/me/pending/mini-program'),

  async getPendingVip(): Promise<Result<PendingVipCheckout | null>> {
    const result = await ApiClient.get<unknown>('/orders/vip-checkout/me/pending/mini-program');
    if (!result.ok) return result;
    if (result.data === null) return { ok: true, data: null };
    return isPendingVipCheckout(result.data)
      ? { ok: true, data: result.data }
      : invalidContract('mini-program VIP pending checkout');
  },

  async resume(sessionId: string): Promise<Result<MiniProgramResumeResult>> {
    const result = await ApiClient.post<unknown>(
      `/orders/checkout/${sessionId}/resume/mini-program`,
    );
    if (!result.ok) return result;
    return isResumeResult(result.data)
      ? { ok: true, data: result.data }
      : invalidContract('mini-program checkout resume');
  },

  cancel: (sessionId: string): Promise<Result<{ success: boolean }>> =>
    ApiClient.post<{ success: boolean }>(`/orders/checkout/${sessionId}/cancel`),

  switchFromApp: (sessionId: string): Promise<Result<CrossSceneCheckoutResult>> =>
    ApiClient.post<CrossSceneCheckoutResult>(
      `/orders/checkout/${sessionId}/switch-to-mini-program`,
    ),
};
