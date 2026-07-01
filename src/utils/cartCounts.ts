export type CartCountItem = {
  quantity: number;
  isPrize?: boolean;
  isLocked?: boolean;
  unavailableReason?: unknown;
};

export function getCartDisplayQuantity(items: CartCountItem[]): number {
  return items
    .filter((item) => !item.isPrize && !item.unavailableReason)
    .reduce((sum, item) => sum + item.quantity, 0);
}
