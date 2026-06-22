/// <reference types="jest" />

jest.mock('../../utils/sleep', () => ({
  sleep: () => Promise.resolve(),
}));

jest.mock('../http/ApiClient', () => ({
  ApiClient: {
    get: jest.fn(),
  },
}));

import { ProductRepo } from '../ProductRepo';
import { mockProducts } from '../../mocks/products';

describe('ProductRepo normalization', () => {
  const originalRandom = Math.random;

  beforeAll(() => {
    Math.random = () => 0.99;
  });

  afterAll(() => {
    Math.random = originalRandom;
  });

  afterEach(() => {
    const injectedIndex = mockProducts.findIndex((item) => item.id === 'legacy-bundle');
    if (injectedIndex >= 0) {
      mockProducts.splice(injectedIndex, 1);
    }
  });

  test('defaults missing product type to SIMPLE', async () => {
    mockProducts.push({
      id: 'legacy-bundle',
      title: '兼容旧商品',
      price: 88,
      unit: '件',
      origin: '测试产地',
      image: 'https://example.com/product.png',
      tags: ['测试'],
      type: undefined,
      bundleItems: [],
    } as unknown as (typeof mockProducts)[number]);

    const result = await ProductRepo.getById('legacy-bundle');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.type).toBe('SIMPLE');
  });

  test('accepts imageUrl and drops invalid bundle rows', async () => {
    mockProducts.push({
      id: 'legacy-bundle',
      title: '兼容旧组合商品',
      price: 128,
      unit: '盒',
      origin: '测试产地',
      image: 'https://example.com/bundle.png',
      tags: ['组合'],
      type: 'BUNDLE',
      bundleItems: [
        {
          skuId: 'bundle-sku-1',
          productId: 'child-1',
          productTitle: '组合子商品 1',
          skuTitle: '默认规格',
          quantity: 2,
          imageUrl: 'https://example.com/item-1.png',
        },
        {
          skuId: '',
          productId: 'child-2',
          productTitle: '无效行',
          skuTitle: '空 sku',
          quantity: 1,
        },
        {
          skuId: 'bundle-sku-3',
          productId: 'child-3',
          productTitle: '无效数量',
          skuTitle: '数量为 0',
          quantity: 0,
        },
      ],
    } as unknown as (typeof mockProducts)[number]);

    const result = await ProductRepo.getById('legacy-bundle');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
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
