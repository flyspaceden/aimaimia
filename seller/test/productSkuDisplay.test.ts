import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBundleSkuOptionLabel,
  buildSkuMetaText,
  formatSkuWeight,
  hasMeaningfulSingleSkuDraftInput,
  normalizeSkuTitle,
} from '../src/utils/productSkuDisplay.ts';

test('uses weight and unit as fallback metadata when sku title is default', () => {
  assert.equal(normalizeSkuTitle('默认规格'), '默认规格');
  assert.equal(formatSkuWeight(400), '400克');
  assert.equal(buildSkuMetaText({ skuTitle: '默认规格', weightGram: 400, unit: '斤' }), '默认规格 · 重量 400克 · 单位 斤');
  assert.equal(
    buildBundleSkuOptionLabel({
      productTitle: '黄花鲈鱼',
      skuTitle: '默认规格',
      weightGram: 400,
      unit: '斤',
      approved: true,
    }),
    '黄花鲈鱼 / 默认规格 · 重量 400克 · 单位 斤',
  );
});

test('keeps meaningful sku title primary and avoids duplicate unit when unit is missing', () => {
  assert.equal(
    buildSkuMetaText({ skuTitle: '袋装2500克', weightGram: 2500 }),
    '袋装2500克 · 重量 2.5千克',
  );
  assert.equal(
    buildBundleSkuOptionLabel({
      productTitle: '海红香米',
      skuTitle: '袋装2500克',
      weightGram: 2500,
      approved: false,
    }),
    '海红香米 / 袋装2500克 · 重量 2.5千克（未审核通过）',
  );
});

test('does not treat default single sku title as meaningful draft input', () => {
  assert.equal(hasMeaningfulSingleSkuDraftInput({ skuTitle: '默认规格' }), false);
  assert.equal(hasMeaningfulSingleSkuDraftInput({ skuTitle: '  ' }), false);
  assert.equal(hasMeaningfulSingleSkuDraftInput({ skuTitle: '400克装' }), true);
  assert.equal(hasMeaningfulSingleSkuDraftInput({ skuTitle: '默认规格', stock: 0 }), true);
});
