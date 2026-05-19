declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import { getStockStatus, getStockText } from '../stockDisplay';

describe('getStockStatus', () => {
  it('returns OUT_OF_STOCK for zero, negative, null, or undefined stock', () => {
    expect(getStockStatus(0, 10)).toBe('OUT_OF_STOCK');
    expect(getStockStatus(-1, 10)).toBe('OUT_OF_STOCK');
    expect(getStockStatus(null, 10)).toBe('OUT_OF_STOCK');
    expect(getStockStatus(undefined, 10)).toBe('OUT_OF_STOCK');
  });

  it('returns LOW_STOCK for 1..threshold when threshold > 0', () => {
    expect(getStockStatus(1, 10)).toBe('LOW_STOCK');
    expect(getStockStatus(10, 10)).toBe('LOW_STOCK');
  });

  it('returns NORMAL when stock exceeds threshold', () => {
    expect(getStockStatus(11, 10)).toBe('NORMAL');
    expect(getStockStatus(1000, 10)).toBe('NORMAL');
  });

  it('disables LOW_STOCK band when threshold is 0 but still reports OUT_OF_STOCK at zero', () => {
    expect(getStockStatus(5, 0)).toBe('NORMAL');
    expect(getStockStatus(0, 0)).toBe('OUT_OF_STOCK');
  });
});

describe('getStockText', () => {
  it('returns 无库存 for zero or negative stock', () => {
    expect(getStockText(0, 10)).toBe('无库存');
    expect(getStockText(-1, 10)).toBe('无库存');
  });

  it('returns 仅剩 x 件 inside the low-stock band', () => {
    expect(getStockText(3, 10)).toBe('仅剩 3 件');
    expect(getStockText(10, 10)).toBe('仅剩 10 件');
  });

  it('returns null when stock exceeds threshold', () => {
    expect(getStockText(20, 10)).toBeNull();
  });

  it('returns null in the low band when threshold is 0', () => {
    expect(getStockText(5, 0)).toBeNull();
  });
});
