declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import {
  formatBundleQuantityLabel,
  getBundleSummaryLines,
  isBundleProductType,
} from '../bundleSnapshot';

describe('isBundleProductType', () => {
  it('returns true only for BUNDLE product type', () => {
    expect(isBundleProductType('BUNDLE')).toBe(true);
    expect(isBundleProductType('SIMPLE')).toBe(false);
    expect(isBundleProductType(undefined)).toBe(false);
  });
});

describe('formatBundleQuantityLabel', () => {
  it('prefers totalQuantity when present', () => {
    expect(formatBundleQuantityLabel({ totalQuantity: 6, quantityPerBundle: 2 })).toBe('x6');
  });

  it('falls back to quantityPerBundle when totalQuantity is missing', () => {
    expect(formatBundleQuantityLabel({ quantityPerBundle: 3 })).toBe('x3');
  });

  it('returns x1 when no valid quantity snapshot exists', () => {
    expect(formatBundleQuantityLabel({})).toBe('x1');
    expect(formatBundleQuantityLabel({ totalQuantity: 0, quantityPerBundle: 0 })).toBe('x1');
  });
});

describe('getBundleSummaryLines', () => {
  it('builds compact display lines with sku title and quantity', () => {
    expect(
      getBundleSummaryLines([
        { skuId: 'sku-tea', productTitle: '高山绿茶', skuTitle: '250g', totalQuantity: 2 },
        { skuId: 'sku-honey', productTitle: '百花蜜', skuTitle: '500g', quantityPerBundle: 1 },
      ]),
    ).toEqual(['高山绿茶 · 250g · x2', '百花蜜 · 500g · x1']);
  });

  it('returns an empty array for non-array inputs', () => {
    expect(getBundleSummaryLines(undefined)).toEqual([]);
  });
});
