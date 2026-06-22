declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import {
  formatBundleQuantityLabel,
  isBundleProductType,
  resolveBundleAwareStock,
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

describe('resolveBundleAwareStock', () => {
  it('uses derived bundle availability instead of selling sku stock for bundle products', () => {
    expect(resolveBundleAwareStock('BUNDLE', 0, 4)).toBe(4);
  });

  it('keeps zero derived bundle availability as sold out', () => {
    expect(resolveBundleAwareStock('BUNDLE', 8, 0)).toBe(0);
  });

  it('uses sku stock for simple products', () => {
    expect(resolveBundleAwareStock('SIMPLE', 8, 0)).toBe(8);
  });

  it('falls back to sku stock when bundle availability is missing', () => {
    expect(resolveBundleAwareStock('BUNDLE', 3, null)).toBe(3);
    expect(resolveBundleAwareStock(undefined, 2, 9)).toBe(2);
  });
});
