declare const describe: any;
declare const it: any;
declare const expect: any;

import {
  buildOptimisticCartItem,
  mapServerCartItemToLocal,
} from '../cartItemMapping';

describe('cart bundle hydration', () => {
  it('reads bundle metadata from nested server product payloads', () => {
    const local = mapServerCartItemToLocal({
      id: 'cart-item-1',
      skuId: 'bundle-selling-sku',
      quantity: 2,
      product: {
        id: 'bundle-product',
        title: '海鲜组合',
        type: 'BUNDLE',
        image: 'https://img/bundle.png',
        price: 199,
        originalPrice: null,
        stock: 3,
        maxPerOrder: null,
        categoryId: 'cat-1',
        companyId: 'company-1',
        bundleItems: [
          {
            skuId: 'component-sku-1',
            quantityPerBundle: 2,
            productTitle: '小青龙',
            skuTitle: '300g',
            image: 'https://img/component.png',
          },
        ],
      },
      sku: { stock: 3, maxPerOrder: null },
    } as any);

    expect(local.productType).toBe('BUNDLE');
    expect(local.bundleItems).toEqual([
      {
        skuId: 'component-sku-1',
        quantityPerBundle: 2,
        productTitle: '小青龙',
        skuTitle: '300g',
        image: 'https://img/component.png',
      },
    ]);
  });

  it('normalizes legacy server bundle component rows into snapshot rows', () => {
    const local = mapServerCartItemToLocal({
      id: 'cart-item-1',
      skuId: 'bundle-selling-sku',
      quantity: 1,
      product: {
        id: 'bundle-product',
        title: '海鲜组合',
        type: 'BUNDLE',
        image: null,
        price: 199,
        originalPrice: null,
        stock: 3,
        maxPerOrder: null,
        bundleItems: [
          {
            skuId: 'component-sku-1',
            quantity: 3,
            sku: {
              title: '500g',
              product: {
                title: '忘不了鱼',
                image: 'https://img/fish.png',
              },
            },
          },
        ],
      },
      sku: { stock: 3, maxPerOrder: null },
    } as any);

    expect(local.bundleItems).toEqual([
      {
        skuId: 'component-sku-1',
        quantityPerBundle: 3,
        productTitle: '忘不了鱼',
        skuTitle: '500g',
        image: 'https://img/fish.png',
      },
    ]);
  });

  it('keeps bundle metadata for local optimistic cart items', () => {
    const local = buildOptimisticCartItem({
      product: {
        id: 'bundle-product',
        title: '海鲜组合',
        type: 'BUNDLE',
        price: 199,
        image: 'https://img/bundle.png',
        unit: '套',
        origin: '广东',
        tags: [],
        bundleItems: [
          {
            skuId: 'component-sku-1',
            productId: 'component-product-1',
            productTitle: '小青龙',
            skuTitle: '300g',
            quantity: 2,
            image: 'https://img/component.png',
          },
        ],
      },
      quantity: 1,
      skuId: 'bundle-selling-sku',
      skuPrice: 188,
    });

    expect(local.productType).toBe('BUNDLE');
    expect(local.bundleItems).toEqual([
      {
        skuId: 'component-sku-1',
        productTitle: '小青龙',
        skuTitle: '300g',
        quantityPerBundle: 2,
        image: 'https://img/component.png',
      },
    ]);
  });
});
