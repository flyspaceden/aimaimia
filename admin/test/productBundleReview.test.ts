import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBundleBasePriceHelperText,
  getBundleSellingSkuSummary,
  toBundleReviewRows,
  type BundleReviewSourceItem,
} from '../src/pages/products/bundleReview.ts';

const bundleItems: BundleReviewSourceItem[] = [
  {
    skuId: 'sku-1',
    quantity: 2,
    price: 19.5,
    weightGram: 250,
    productTitle: '苹果礼盒',
    skuTitle: '单果 250g',
    stock: 8,
  },
];

test('bundle review rows include unit and total weight details', () => {
  const [row] = toBundleReviewRows(bundleItems);

  assert.equal(row.weightGram, 250);
  assert.equal(row.totalWeightGram, 500);
  assert.equal(row.subtotal, 39);
});

test('bundle products use selling price helper copy instead of lowest sku wording', () => {
  assert.equal(getBundleBasePriceHelperText('BUNDLE'), '组合售价，按组合销售单元展示');
  assert.equal(getBundleBasePriceHelperText('SIMPLE'), '自动 = 最低规格售价，保存规格后自动刷新');
});

test('bundle selling sku summary is read-only and avoids operational stock wording', () => {
  const summary = getBundleSellingSkuSummary({
    basePrice: 88,
    unit: '盒',
  });

  assert.deepEqual(summary, [
    ['销售规格', '组合商品统一售价'],
    ['组合售价', '¥88.00 / 盒'],
    ['销售单元', '1 个组合 = 1 个销售 SKU'],
    ['说明', '组件库存、重量与可售组合数以下方组合内容为准'],
  ]);
});
