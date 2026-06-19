import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHIPPING_REGION_OPTIONS,
  normalizeRuleRegionCodesForForm,
  normalizeSelectedRegionCodes,
  formatRuleRegionCodes,
} from '../src/pages/shipping-rules/regions.ts';

test('shipping rule region options use administrative division prefixes, not postal codes', () => {
  const guangdong = SHIPPING_REGION_OPTIONS.find((option) => option.label === '广东省');

  assert.equal(guangdong?.value, '44');
  assert.match(guangdong?.value ?? '', /^\d{2}$/);
});

test('normalizes persisted administrative region codes for province tag selection', () => {
  assert.deepEqual(normalizeRuleRegionCodesForForm(['440000', '35', '999999', '']), ['44', '35']);
});

test('does not treat postal codes as administrative region codes when hydrating persisted values', () => {
  assert.deepEqual(normalizeRuleRegionCodesForForm(['518000']), []);
  assert.equal(formatRuleRegionCodes(['518000']), '未知地区：518000');
});

test('normalizes selected province tags before submitting regionCodes', () => {
  assert.deepEqual(normalizeSelectedRegionCodes(['44', '440000', '35', '35', '518000']), ['44', '35']);
});

test('formats selected region codes as province labels and leaves empty as nationwide', () => {
  assert.equal(formatRuleRegionCodes([]), '全国');
  assert.equal(formatRuleRegionCodes(['44', '350000']), '广东省, 福建省');
});
