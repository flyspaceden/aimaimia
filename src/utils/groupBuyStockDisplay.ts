export const GROUP_BUY_LOW_STOCK_THRESHOLD = 10;

export function getGroupBuyLowStockText(stock: number | null | undefined): string | null {
  if (stock == null || !Number.isFinite(stock)) return null;

  const normalizedStock = Math.max(0, Math.floor(stock));
  if (normalizedStock >= GROUP_BUY_LOW_STOCK_THRESHOLD) return null;

  return `库存 ${normalizedStock}`;
}
