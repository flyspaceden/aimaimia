export const DELIVERY_PAYMENT_PREFIX = 'PSZF';
export type DeliveryCallbackChannel = 'ALIPAY' | 'WECHAT_PAY';

export function isDeliveryMerchantOrderNo(merchantOrderNo?: string | null): boolean {
  return typeof merchantOrderNo === 'string' && merchantOrderNo.startsWith(DELIVERY_PAYMENT_PREFIX);
}

export function isDeliveryCallbackChannel(value: unknown): value is DeliveryCallbackChannel {
  return value === 'ALIPAY' || value === 'WECHAT_PAY';
}

export function parseDeliveryYuanAmountToCents(amount: unknown): number | null {
  if (typeof amount !== 'string' && typeof amount !== 'number') {
    return null;
  }

  const normalized = typeof amount === 'number' ? amount.toFixed(2) : amount.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  return Math.round(Number(normalized) * 100);
}

export function extractDeliveryClaimedAmountCents(
  rawPayload: unknown,
  channel: DeliveryCallbackChannel,
): number | null {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return null;
  }

  if (channel === 'ALIPAY') {
    const payload = rawPayload as Record<string, unknown>;
    return (
      parseDeliveryYuanAmountToCents(payload.total_amount) ??
      parseDeliveryYuanAmountToCents(payload.totalAmount)
    );
  }

  const payload = rawPayload as Record<string, unknown>;
  if (typeof payload.amountFen === 'number' && Number.isInteger(payload.amountFen)) {
    return payload.amountFen;
  }
  if (typeof payload.amount === 'number' && Number.isInteger(payload.amount)) {
    return payload.amount;
  }

  return null;
}
