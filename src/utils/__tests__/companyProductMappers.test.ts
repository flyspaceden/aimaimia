/// <reference types="jest" />

import { toCartProductFromCompanyCardProduct } from '../companyProductMappers';

describe('toCartProductFromCompanyCardProduct', () => {
  test('preserves bundle fields from company card payloads', () => {
    const result = toCartProductFromCompanyCardProduct({
      id: 'bundle-1',
      title: '组合商品',
      price: 128,
      image: 'https://example.com/bundle.png',
      type: 'BUNDLE',
      bundleAvailableStock: 5,
      bundleTotalWeightGram: 1500,
      bundleItems: [
        {
          skuId: 'bundle-sku-1',
          productId: 'child-1',
          productTitle: '子商品',
          skuTitle: '默认规格',
          quantity: 2,
          image: 'https://example.com/item.png',
        },
      ],
      defaultSkuId: 'bundle-sku-1',
    });

    expect(result).toEqual({
      id: 'bundle-1',
      title: '组合商品',
      price: 128,
      image: 'https://example.com/bundle.png',
      type: 'BUNDLE',
      bundleAvailableStock: 5,
      bundleTotalWeightGram: 1500,
      bundleItems: [
        {
          skuId: 'bundle-sku-1',
          productId: 'child-1',
          productTitle: '子商品',
          skuTitle: '默认规格',
          quantity: 2,
          image: 'https://example.com/item.png',
        },
      ],
      defaultSkuId: 'bundle-sku-1',
      tags: [],
      unit: '',
      origin: '',
      stock: undefined,
      maxPerOrder: undefined,
    });
  });

  test('defaults missing type to SIMPLE', () => {
    const result = toCartProductFromCompanyCardProduct({
      id: 'simple-1',
      title: '普通商品',
      price: 32,
      image: 'https://example.com/simple.png',
    });

    expect(result.type).toBe('SIMPLE');
    expect(result.bundleItems).toBeUndefined();
    expect(result.tags).toEqual([]);
    expect(result.unit).toBe('');
    expect(result.origin).toBe('');
  });
});
