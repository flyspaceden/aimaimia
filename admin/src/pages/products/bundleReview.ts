import type { Product, ProductBundleItem, ProductType } from '@/types';

export type BundleReviewRow = {
  key: string;
  skuId: string;
  quantity: number;
  productTitle: string;
  skuTitle: string;
  price: number | null;
  stock: number | null;
  subtotal: number | null;
  weightGram: number | null;
  totalWeightGram: number | null;
};

export type BundleReviewSourceItem = Pick<
  ProductBundleItem,
  'skuId' | 'quantity' | 'price' | 'stock' | 'weightGram' | 'productTitle' | 'skuTitle'
> & {
  sku?: ProductBundleItem['sku'];
};

export function productTypeOf(product?: Pick<Product, 'type'> | null): ProductType {
  return product?.type === 'BUNDLE' ? 'BUNDLE' : 'SIMPLE';
}

export function toBundleReviewRows(items?: BundleReviewSourceItem[] | null): BundleReviewRow[] {
  return (items ?? []).map((item, index) => {
    const sku = item.sku;
    const product = sku?.product;
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const price = item.price ?? sku?.price ?? null;
    const weightGram = item.weightGram ?? sku?.weightGram ?? null;
    const subtotal = typeof price === 'number' ? +(price * quantity).toFixed(2) : null;
    const totalWeightGram = typeof weightGram === 'number' ? weightGram * quantity : null;

    return {
      key: item.skuId || sku?.id || `${index}`,
      skuId: item.skuId || sku?.id || '-',
      quantity,
      productTitle: item.productTitle ?? product?.title ?? '-',
      skuTitle: item.skuTitle ?? sku?.title ?? '-',
      price,
      stock: item.stock ?? sku?.stock ?? null,
      subtotal,
      weightGram,
      totalWeightGram,
    };
  });
}

export function formatMoney(value?: number | null) {
  return typeof value === 'number' ? `¥${value.toFixed(2)}` : '-';
}

export function formatWeightGram(value?: number | null) {
  return typeof value === 'number' ? `${value}g` : '-';
}

export function getBundleBasePriceHelperText(type: ProductType) {
  return type === 'BUNDLE'
    ? '组合售价，按组合销售单元展示'
    : '自动 = 最低规格售价，保存规格后自动刷新';
}

export function getBundleSummaryText(product: Product) {
  const rows = toBundleReviewRows(product.bundleItems);
  if (rows.length === 0) return '组合内容待补充';

  const preview = rows
    .slice(0, 2)
    .map((row) => `${row.productTitle} / ${row.skuTitle} ×${row.quantity}`)
    .join('；');

  return rows.length > 2 ? `${preview} 等 ${rows.length} 项` : preview;
}

export function getBundleSellingSkuSummary(product: Pick<Product, 'basePrice' | 'unit'>): Array<[string, string]> {
  return [
    ['销售规格', '组合商品统一售价'],
    ['组合售价', `${formatMoney(product.basePrice)} / ${product.unit || '件'}`],
    ['销售单元', '1 个组合 = 1 个销售 SKU'],
    ['说明', '组件库存、重量与可售组合数以下方组合内容为准'],
  ];
}
