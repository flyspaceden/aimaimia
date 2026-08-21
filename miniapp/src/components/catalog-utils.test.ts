import { describe, expect, it } from 'vitest';
import { displayCompanyCertifications, resolveCatalogQuickAddAction } from './catalog-utils';

describe('catalog display and quick actions', () => {
  it('uses the App-aligned certifications field before legacy badges', () => {
    expect(displayCompanyCertifications({
      certifications: ['有机认证', '  绿色食品  ', '有机认证'],
      badges: ['企业优选'],
    })).toEqual(['有机认证', '绿色食品']);
  });

  it('falls back to legacy badges only when certifications are absent', () => {
    expect(displayCompanyCertifications({ certifications: [], badges: ['企业优选'] })).toEqual(['企业优选']);
  });

  it.each([
    ['single available SKU', { defaultSkuId: 'sku-1', type: 'SIMPLE' as const, stock: 1 }, { kind: 'add', label: '加入购物车' }],
    ['out of stock SKU', { defaultSkuId: 'sku-1', type: 'SIMPLE' as const, stock: 0 }, { kind: 'detail', label: '查看商品' }],
    ['multiple SKU product', { defaultSkuId: null, type: 'SIMPLE' as const, stock: 3 }, { kind: 'detail', label: '选择规格' }],
    ['out of stock bundle', { defaultSkuId: 'sku-1', type: 'BUNDLE' as const, bundleAvailableStock: 0 }, { kind: 'detail', label: '查看商品' }],
  ])('routes %s to the correct safe card action', (_case, product, expected) => {
    expect(resolveCatalogQuickAddAction(product)).toEqual(expected);
  });
});
