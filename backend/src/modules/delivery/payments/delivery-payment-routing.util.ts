export const DELIVERY_PAYMENT_PREFIX = 'PSZF';

export function isDeliveryMerchantOrderNo(merchantOrderNo?: string | null): boolean {
  return typeof merchantOrderNo === 'string' && merchantOrderNo.startsWith(DELIVERY_PAYMENT_PREFIX);
}
