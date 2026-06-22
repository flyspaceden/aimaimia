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
