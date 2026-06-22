/// <reference types="jest" />

jest.mock('../../utils/sleep', () => ({
  sleep: () => Promise.resolve(),
}));

jest.mock('../http/config', () => ({
  USE_MOCK: false,
}));

jest.mock('../http/ApiClient', () => ({
  ApiClient: {
    get: jest.fn(),
  },
}));

import { ProductRepo } from '../ProductRepo';
import { ApiClient } from '../http/ApiClient';

describe('ProductRepo normalization', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('normalizes remote list payloads and preserves bundle metadata', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            id: 'bundle-list-1',
            title: '远端组合列表商品',
            price: 188,
            imageUrl: 'https://example.com/list-bundle.png',
            unit: '盒',
            origin: '测试产地',
            tags: ['组合'],
            type: 'BUNDLE',
            bundleAvailableStock: 6,
            bundleTotalWeightGram: 1800,
            bundleItems: [
              {
                skuId: 'bundle-item-sku-1',
                productId: 'child-list-1',
                productTitle: '组合子商品 A',
                skuTitle: '默认规格',
                quantity: 3,
                imageUrl: 'https://example.com/list-item-1.png',
              },
            ],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 8,
      },
    });

    const result = await ProductRepo.list();

    expect(ApiClient.get).toHaveBeenCalledWith('/products', {
      page: 1,
      pageSize: 8,
      categoryId: undefined,
      keyword: undefined,
      preferRecommended: undefined,
      constraints: undefined,
      maxPrice: undefined,
      recommendThemes: undefined,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toEqual([
      expect.objectContaining({
        id: 'bundle-list-1',
        type: 'BUNDLE',
        image: 'https://example.com/list-bundle.png',
        bundleAvailableStock: 6,
        bundleTotalWeightGram: 1800,
        bundleItems: [
          {
            skuId: 'bundle-item-sku-1',
            productId: 'child-list-1',
            productTitle: '组合子商品 A',
            skuTitle: '默认规格',
            quantity: 3,
            image: 'https://example.com/list-item-1.png',
          },
        ],
      }),
    ]);
  });

  test('normalizes remote legacy payloads with missing type and imageUrl fields', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue({
      ok: true,
      data: {
        id: 'bundle-1',
        title: '远端组合商品',
        price: 128,
        imageUrl: 'https://example.com/bundle.png',
        unit: '盒',
        origin: '测试产地',
        tags: ['组合'],
        type: undefined,
        bundleItems: [
          {
            skuId: 'bundle-sku-1',
            productId: 'child-1',
            productTitle: '组合子商品 1',
            skuTitle: '默认规格',
            quantity: 2,
            imageUrl: 'https://example.com/item-1.png',
          },
        ],
        images: [],
        skus: [],
        basePrice: 128,
      },
    });

    const result = await ProductRepo.getById('bundle-1');

    expect(ApiClient.get).toHaveBeenCalledWith('/products/bundle-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.type).toBe('SIMPLE');
    expect(result.data.image).toBe('https://example.com/bundle.png');
    expect(result.data.bundleItems).toEqual([
      {
        skuId: 'bundle-sku-1',
        productId: 'child-1',
        productTitle: '组合子商品 1',
        skuTitle: '默认规格',
        quantity: 2,
        image: 'https://example.com/item-1.png',
      },
    ]);
  });
});
