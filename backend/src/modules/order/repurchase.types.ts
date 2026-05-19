export type RepurchaseSkipReason =
  | 'PRIZE_ITEM'
  | 'SKU_MISSING'
  | 'SKU_INACTIVE'
  | 'PRODUCT_INACTIVE'
  | 'COMPANY_INACTIVE'
  | 'PLATFORM_PRODUCT'
  | 'MAX_PER_ORDER_EXCEEDED'
  | 'LOW_STOCK_ADJUSTED'
  | 'OUT_OF_STOCK_VIRTUAL';

export type RepurchaseResultItem = {
  orderItemId: string;
  skuId: string;
  title: string;
  quantity: number;
  status: 'ADDED' | 'SKIPPED';
  reason?: RepurchaseSkipReason;
  stockStatus?: 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  stock?: number;
  adjustedQuantity?: number;
  virtual?: boolean;
  priceChanged?: boolean;
  originalPrice?: number;
  currentPrice?: number;
  message?: string;
};

export type RepurchaseResult = {
  addedItemCount: number;
  addedQuantity: number;
  skippedItemCount: number;
  skippedQuantity: number;
  priceChangedCount: number;
  cart: unknown;
  items: RepurchaseResultItem[];
};
