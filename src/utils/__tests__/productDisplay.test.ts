/// <reference types="jest" />

import {
  buildProductUnitLabel,
  buildProductWeightLabel,
  formatProductWeightGram,
} from '../productDisplay';

describe('product display helpers', () => {
  test('formats gram and kilogram weights without rounding away precision', () => {
    expect(formatProductWeightGram(400)).toBe('400克');
    expect(formatProductWeightGram(2500)).toBe('2.5千克');
    expect(formatProductWeightGram(1250)).toBe('1.25千克');
    expect(formatProductWeightGram(0)).toBeUndefined();
  });

  test('builds explicit unit and packaging labels', () => {
    expect(buildProductUnitLabel('斤')).toBe('单位 斤');
    expect(buildProductUnitLabel('  ')).toBeUndefined();
    expect(buildProductWeightLabel(400)).toBe('包装重量 400克');
  });
});
