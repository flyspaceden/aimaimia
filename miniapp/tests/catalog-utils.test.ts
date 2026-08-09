import { describe, expect, it } from 'vitest';
import {
  catalogStockText,
  companyProductToProduct,
  defaultSelectedSkuId,
  filterCompanies,
  formatCatalogPrice,
  paginateCatalog,
  productHeadlinePrice,
  resolveProductStock,
} from '@/components/catalog-utils';
import type { Company, ProductDetail } from '@/types';

const detail: ProductDetail = {
  id: 'product-1', title: '高山蓝莓', price: 26.5, basePrice: 26.5, type: 'SIMPLE',
  defaultSkuId: 'sku-small', unit: '盒', origin: '贵州', image: 'https://img/1.jpg', tags: [], images: [],
  skus: [
    { id: 'sku-small', title: '125g', price: 26.5, stock: 9 },
    { id: 'sku-large', title: '250g', price: 48, stock: 20 },
  ],
};

const company: Company = {
  id: 'company-1', name: '黔东南山野农业', shortName: '山野农业', cover: 'https://img/c.jpg',
  mainBusiness: '蓝莓与刺梨', location: '贵州黔东南', distanceKm: 0, badges: ['产地直供'], certifications: ['绿色食品'],
};

describe('catalog presentation contracts', () => {
  it('formats prices without inventing trailing decimals', () => {
    expect(formatCatalogPrice(26)).toBe('26');
    expect(formatCatalogPrice(26.5)).toBe('26.5');
    expect(formatCatalogPrice(26.58)).toBe('26.58');
  });

  it('uses bundle available stock instead of a synthetic product stock', () => {
    expect(resolveProductStock({ type: 'BUNDLE', stock: 99, bundleAvailableStock: 3 })).toBe(3);
    expect(resolveProductStock({ type: 'SIMPLE', stock: 99 })).toBe(99);
    expect(catalogStockText(0)).toBe('暂时缺货');
    expect(catalogStockText(7)).toBe('仅剩 7 件');
  });

  it('does not preselect one of multiple SKUs and shows a real minimum price', () => {
    expect(defaultSelectedSkuId(detail)).toBeUndefined();
    expect(productHeadlinePrice(detail)).toEqual({ value: 26.5, from: true });
    expect(productHeadlinePrice(detail, 'sku-large')).toEqual({ value: 48, from: false });
    expect(defaultSelectedSkuId({ ...detail, skus: [detail.skus[0]] })).toBe('sku-small');
  });

  it('filters the live company array locally across visible App fields', () => {
    expect(filterCompanies([company], '蓝莓')).toEqual([company]);
    expect(filterCompanies([company], '绿色食品')).toEqual([company]);
    expect(filterCompanies([company], '海鲜')).toEqual([]);
  });

  it('reveals client-paginated company data without changing server semantics', () => {
    const items = Array.from({ length: 13 }, (_, index) => index + 1);
    expect(paginateCatalog(items, 1, 6)).toEqual({ items: [1, 2, 3, 4, 5, 6], hasMore: true });
    expect(paginateCatalog(items, 3, 6)).toEqual({ items, hasMore: false });
  });

  it('maps a company product without dropping bundle snapshots', () => {
    const mapped = companyProductToProduct({
      id: 'bundle-1', title: '丰收礼盒', price: 88, image: 'https://img/b.jpg', type: 'BUNDLE',
      bundleItems: [{ skuId: 'child-1', productId: 'p-1', productTitle: '蓝莓', skuTitle: '125g', quantity: 2 }],
      bundleAvailableStock: 4, defaultSkuId: 'bundle-sku', tags: ['礼盒'], unit: '盒', origin: '贵州', categoryName: '组合商品',
    }, company);
    expect(mapped).toMatchObject({ type: 'BUNDLE', companyId: 'company-1', companyName: '黔东南山野农业', bundleAvailableStock: 4 });
    expect(mapped.bundleItems).toHaveLength(1);
  });
});
