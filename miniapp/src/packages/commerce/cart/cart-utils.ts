import { isCartItemPurchasable, selectedCartItems, type CartPrizeSelections } from '@/components/commerce-utils';
import type { CartItem } from '@/types';

export type CartCheckboxState = {
  checked: boolean;
  disabled: boolean;
  locked: boolean;
  unavailable: boolean;
  isThresholdGift: boolean;
};

/**
 * Mirrors the App's cart checkbox rules. A THRESHOLD_GIFT is automatically
 * included after its normal-goods threshold is met, so it is shown checked but
 * never becomes a user-controlled checkbox.
 */
export function getCartCheckboxState(
  item: CartItem,
  selectedNonPrizeTotal: number,
  selectedOverride?: boolean,
): CartCheckboxState {
  const locked = Boolean(
    item.isPrize
      && item.isLocked
      && (!item.threshold || selectedNonPrizeTotal < item.threshold),
  );
  const unavailable = !locked && !isCartItemPurchasable(item, selectedNonPrizeTotal);
  const isThresholdGift = Boolean(item.isPrize && item.threshold);
  const disabled = unavailable || locked || isThresholdGift;

  return {
    checked: unavailable || locked ? false : isThresholdGift ? true : selectedOverride ?? Boolean(item.isSelected),
    disabled,
    locked,
    unavailable,
    isThresholdGift,
  };
}

/** Only normal goods have a server-side selection endpoint in the current API. */
export function selectableNormalCartItems(
  items: CartItem[],
  selectedNonPrizeTotal: number,
): CartItem[] {
  return items.filter(
    (item) => !item.isPrize && isCartItemPurchasable(item, selectedNonPrizeTotal),
  );
}

export function cartSelectedQuantity(
  items: CartItem[],
  prizeSelections: CartPrizeSelections = {},
): number {
  return selectedCartItems(items, prizeSelections).reduce((total, item) => total + item.quantity, 0);
}

export function cartLowStockText(
  item: CartItem,
  lowStockThreshold: number,
): string | null {
  const stock = Number(item.product.stock);
  if (!Number.isFinite(stock) || stock <= 0) return null;
  if (lowStockThreshold > 0 && stock <= lowStockThreshold) return `仅剩 ${stock} 件`;
  return null;
}

export function cartExpiryText(expiresAt: string | null | undefined, now: number): string | null {
  if (!expiresAt) return null;
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return null;
  const remaining = expiresAtMs - now;
  if (remaining <= 0) return '已过期';
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `剩余 ${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
