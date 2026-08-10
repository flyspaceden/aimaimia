import type { CartItem, CheckoutEligibleCoupon, CheckoutPreview, OrderStatus } from '@/types';

export function formatMoney(value: number): string {
  return Number.isFinite(value) ? Math.max(0, value).toFixed(2) : '0.00';
}

export function isCartItemPurchasable(item: CartItem, selectedNonPrizeTotal = 0): boolean {
  const thresholdLocked = Boolean(
    item.isPrize
    && item.isLocked
    && (!item.threshold || selectedNonPrizeTotal < item.threshold),
  );
  // THRESHOLD_GIFT keeps its persisted isLocked flag after the threshold has
  // been reached. The cart API's generic `selectable` field therefore remains
  // false even though its dynamic lockedGiftsInfo says it is unlocked. For
  // those gifts only, the threshold calculation is the authoritative gate.
  const dynamicallyUnlockedGift = Boolean(
    item.isPrize
    && item.isLocked
    && item.threshold
    && selectedNonPrizeTotal >= item.threshold,
  );
  return (item.selectable !== false || dynamicallyUnlockedGift)
    && !item.unavailableReason
    && item.stockStatus !== 'OUT_OF_STOCK'
    && !thresholdLocked;
}

export function toggleCheckoutCoupon(
  currentIds: string[],
  coupon: CheckoutEligibleCoupon,
  coupons: CheckoutEligibleCoupon[],
): string[] {
  if (!coupon.eligible) return currentIds;
  if (currentIds.includes(coupon.id)) return currentIds.filter((id) => id !== coupon.id);

  const group = coupon.stackGroup || '__default__';
  const selectedInGroup = coupons.filter(
    (item) => currentIds.includes(item.id) && (item.stackGroup || '__default__') === group,
  );
  // Backend only forbids multiple coupons inside one group when at least one
  // member of that same group is non-stackable. Coupons in other groups stay.
  if (!coupon.stackable || selectedInGroup.some((item) => !item.stackable)) {
    return [
      ...currentIds.filter((id) => !selectedInGroup.some((item) => item.id === id)),
      coupon.id,
    ];
  }
  return [...currentIds, coupon.id];
}

export function newCheckoutIdempotencyKey(): string {
  return `mini-checkout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type CartPrizeSelections = Readonly<Record<string, boolean>>;

export function isCartItemSelected(
  item: CartItem,
  prizeSelections: CartPrizeSelections = {},
): boolean {
  if (!item.isPrize) return item.isSelected === true;
  const localSelection = prizeSelections[item.id];
  return typeof localSelection === 'boolean' ? localSelection : item.isSelected !== false;
}

export function selectedCartItems(
  items: CartItem[],
  prizeSelections: CartPrizeSelections = {},
): CartItem[] {
  const selectedNonPrizeTotal = items
    .filter((item) => !item.isPrize && item.isSelected && isCartItemPurchasable(item))
    .reduce((total, item) => total + Number(item.product.price || 0) * item.quantity, 0);
  return items.filter((item) => {
    if (!isCartItemPurchasable(item, selectedNonPrizeTotal)) return false;
    // 门槛赠品解锁后强制进入结算，与 App 保持一致，不受旧 isSelected 值影响。
    if (item.isPrize && item.threshold) return true;
    return isCartItemSelected(item, prizeSelections);
  });
}

export function selectedCartTotal(
  items: CartItem[],
  prizeSelections: CartPrizeSelections = {},
): number {
  return selectedCartItems(items, prizeSelections).reduce(
    (total, item) => total + Number(item.product.price || 0) * item.quantity,
    0,
  );
}

export function clampDeduction(raw: string, preview?: CheckoutPreview): number {
  const requested = /^\d+(?:\.\d{0,2})?$/.test(raw.trim()) ? Number(raw) : 0;
  if (!preview || !Number.isFinite(requested)) return 0;
  return Number(Math.min(
    Math.max(0, requested),
    Math.max(0, preview.maxDeductible || 0),
    Math.max(0, preview.summary.totalPayable || 0),
  ).toFixed(2));
}

export function payableAfterDeduction(preview: CheckoutPreview, deduction: number): number {
  return Number(Math.max(0, preview.summary.totalPayable - deduction).toFixed(2));
}

export const orderStatusMeta: Record<OrderStatus, { label: string; tone: string }> = {
  PENDING_PAYMENT: { label: '历史待付款', tone: 'muted' },
  PAID: { label: '待发货', tone: 'warning' },
  SHIPPED: { label: '已发货', tone: 'info' },
  DELIVERED: { label: '待确认收货', tone: 'success' },
  RECEIVED: { label: '已完成', tone: 'success' },
  CANCELED: { label: '已取消', tone: 'muted' },
  REFUNDED: { label: '已退款', tone: 'muted' },
};

export function isUserCancelledPayment(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'errMsg' in error
      ? String((error as { errMsg?: unknown }).errMsg || '')
      : String(error || '');
  return message.toLowerCase().includes('cancel');
}
