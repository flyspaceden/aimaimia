export type StockStatus = 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export function getStockStatus(stock: number | undefined | null, threshold: number): StockStatus {
  if (stock == null) return 'NORMAL';
  const value = Number(stock);
  if (value <= 0) return 'OUT_OF_STOCK';
  if (threshold > 0 && value <= threshold) return 'LOW_STOCK';
  return 'NORMAL';
}

export function getStockText(stock: number | undefined | null, threshold: number): string | null {
  if (stock == null) return null;
  const value = Number(stock);
  const status = getStockStatus(value, threshold);
  if (status === 'OUT_OF_STOCK') return '无库存';
  if (status === 'LOW_STOCK') return `仅剩 ${value} 件`;
  return null;
}
