import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDeliveryManifestCustomizationEntries,
  normalizeDeliveryPricingRulePayload,
  validateDeliveryManifestCustomizationEntries,
  validateDeliveryManifestTemplateColumns,
  validateDeliveryPricingRuleDraft,
} from '../src/pages/delivery-admin/formValidation.ts';

test('delivery pricing validation accepts merchant quantity-tier markup rules', () => {
  assert.equal(
    validateDeliveryPricingRuleDraft({
      scope: 'MERCHANT',
      ruleType: 'MARKUP_RATE',
      merchantId: ' PSSJ0000000000001 ',
      minQuantity: 10,
      maxQuantity: 99,
      markupBps: 1200,
    }),
    null,
  );

  assert.deepEqual(
    normalizeDeliveryPricingRulePayload({
      scope: 'MERCHANT',
      ruleType: 'MARKUP_RATE',
      merchantId: ' PSSJ0000000000001 ',
      productId: 'ignored_product',
      skuId: 'ignored_sku',
      minQuantity: 10,
      maxQuantity: null,
      fixedPriceCents: 999,
      markupBps: 1200,
      note: ' 阶梯价 ',
    }),
    {
      scope: 'MERCHANT',
      ruleType: 'MARKUP_RATE',
      merchantId: 'PSSJ0000000000001',
      productId: undefined,
      skuId: undefined,
      minQuantity: 10,
      maxQuantity: null,
      fixedPriceCents: undefined,
      markupBps: 1200,
      priority: undefined,
      isActive: undefined,
      note: '阶梯价',
    },
  );
});

test('seller fulfillment manifest template columns reject money and pricing labels', () => {
  assert.match(
    validateDeliveryManifestTemplateColumns(
      [
        { key: 'quantity', label: '数量', sortOrder: 100, visible: true },
        { key: 'packingFee', label: '装箱费用', sortOrder: 110, visible: true },
      ],
      'SELLER_FULFILLMENT',
    ) ?? '',
    /不能包含金额/,
  );
  assert.equal(
    validateDeliveryManifestTemplateColumns(
      [
        { key: 'quantity', label: '数量', sortOrder: 100, visible: true },
        { key: 'memo', label: '配货备注', sortOrder: 110, visible: true },
      ],
      'SELLER_FULFILLMENT',
    ),
    null,
  );
});

test('delivery pricing validation rejects mismatched scope fields and missing pricing values', () => {
  assert.match(
    validateDeliveryPricingRuleDraft({
      scope: 'PLATFORM',
      ruleType: 'MARKUP_RATE',
      merchantId: 'PSSJ0000000000001',
      minQuantity: 1,
      markupBps: 1000,
    }) ?? '',
    /平台级/,
  );
  assert.match(
    validateDeliveryPricingRuleDraft({
      scope: 'MERCHANT',
      ruleType: 'MARKUP_RATE',
      minQuantity: 1,
      markupBps: 1000,
    }) ?? '',
    /merchantId/,
  );
  assert.match(
    validateDeliveryPricingRuleDraft({
      scope: 'SKU',
      ruleType: 'FIXED_PRICE',
      skuId: 'sku_1',
      minQuantity: 1,
    }) ?? '',
    /固定价/,
  );
  assert.match(
    validateDeliveryPricingRuleDraft({
      scope: 'MERCHANT',
      ruleType: 'MARKUP_RATE',
      merchantId: 'PSSJ0000000000001',
      minQuantity: 100,
      maxQuantity: 10,
      markupBps: 1000,
    }) ?? '',
    /最大数量/,
  );
});

test('delivery manifest customization validation rejects blank or duplicate custom columns', () => {
  assert.match(
    validateDeliveryManifestCustomizationEntries([
      { key: '', label: '备注', value: '冷藏', sortOrder: 500, visible: true },
    ]) ?? '',
    /key 不能为空/,
  );
  assert.match(
    validateDeliveryManifestCustomizationEntries([
      { key: 'memo', label: '备注', value: '冷藏', sortOrder: 500, visible: true },
      { key: 'memo', label: '备注2', value: '上午送', sortOrder: 510, visible: true },
    ]) ?? '',
    /重复/,
  );
  assert.match(
    validateDeliveryManifestCustomizationEntries([
      { key: '1memo', label: '备注', value: '冷藏', sortOrder: 500, visible: true },
    ]) ?? '',
    /英文字母开头/,
  );
});

test('delivery manifest customization validation trims valid entries', () => {
  const entries = [
    { key: ' memo ', label: ' 配货备注 ', value: ' 冷藏保存 ', sortOrder: 500, visible: true },
  ];

  assert.equal(validateDeliveryManifestCustomizationEntries(entries), null);
  assert.deepEqual(normalizeDeliveryManifestCustomizationEntries(entries), [
    {
      key: 'memo',
      label: '配货备注',
      value: '冷藏保存',
      sortOrder: 500,
      visible: true,
    },
  ]);
});

test('seller fulfillment manifest customization rejects money and pricing fields', () => {
  assert.match(
    validateDeliveryManifestCustomizationEntries(
      [
        { key: 'finalPrice', label: '最终售价', value: '100 元', sortOrder: 500, visible: true },
      ],
      'SELLER_FULFILLMENT',
    ) ?? '',
    /不能包含金额/,
  );
  assert.match(
    validateDeliveryManifestCustomizationEntries(
      [
        { key: 'memo', label: '备注', value: '结算金额待确认', sortOrder: 500, visible: true },
      ],
      'SELLER_FULFILLMENT',
    ) ?? '',
    /不能包含金额/,
  );
  assert.equal(
    validateDeliveryManifestCustomizationEntries(
      [
        { key: 'packingMemo', label: '配货备注', value: '冷藏保存', sortOrder: 500, visible: true },
      ],
      'SELLER_FULFILLMENT',
    ),
    null,
  );
});
