import type { Product } from '../types';

const DEFAULT_PRODUCT_TYPE = 'SIMPLE' as const;

export type CompanyCardCartProductInput = Pick<Product, 'id' | 'title' | 'price' | 'image'> &
  Partial<
    Pick<
      Product,
      | 'type'
      | 'bundleItems'
      | 'bundleAvailableStock'
      | 'bundleTotalWeightGram'
      | 'defaultSkuId'
      | 'tags'
      | 'unit'
      | 'origin'
      | 'stock'
      | 'maxPerOrder'
    >
  >;

export const toCartProductFromCompanyCardProduct = (
  input: CompanyCardCartProductInput,
): Product => ({
  id: input.id,
  title: input.title,
  price: input.price,
  type: input.type ?? DEFAULT_PRODUCT_TYPE,
  image: input.image,
  bundleItems: input.bundleItems,
  bundleAvailableStock: input.bundleAvailableStock,
  bundleTotalWeightGram: input.bundleTotalWeightGram,
  defaultSkuId: input.defaultSkuId,
  tags: input.tags ?? [],
  unit: input.unit ?? '',
  origin: input.origin ?? '',
  stock: input.stock,
  maxPerOrder: input.maxPerOrder,
});
