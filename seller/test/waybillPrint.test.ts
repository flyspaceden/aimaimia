import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPickingSheetHtml, resolveBundleComponentQuantity } from '../src/utils/waybillPrint.ts';
import type { Order } from '../src/types/index.ts';

test('renders only the order item rows on the seller picking sheet', () => {
  const order: Order = {
    id: 'order-bundle-1',
    status: 'PAID',
    bizType: 'NORMAL_GOODS',
    totalAmount: 88,
    goodsAmount: 88,
    shippingFee: 0,
    createdDate: '2026-06-22',
    buyerAlias: '买家001',
    buyerNo: 'AIMM00000000000001',
    regionText: '浙江省杭州市西湖区',
    items: [
      {
        id: 'item-bundle',
        title: '水果礼盒',
        description: '红富士苹果 5斤装 + 皇冠梨 3斤装',
        unitPrice: 88,
        quantity: 2,
        productType: 'BUNDLE',
        bundleItems: [
          { productTitle: '红富士苹果', skuTitle: '5斤装', totalQuantity: 4 },
          { productTitle: '皇冠梨', skuTitle: '3斤装', totalQuantity: 2 },
        ],
      },
    ],
    shipment: null,
    refundSummary: null,
    invoiceStatus: null,
  };

  const html = buildPickingSheetHtml(order);

  assert.match(html, /水果礼盒/);
  assert.match(html, /<td class="quantity">2<\/td>/);
  assert.doesNotMatch(html, /详情清单/);
  assert.doesNotMatch(html, /红富士苹果 5斤装 \+ 皇冠梨 3斤装/);
  assert.doesNotMatch(html, /组合明细/);
  assert.doesNotMatch(html, /普通/);
  assert.doesNotMatch(html, /红富士苹果[\s\S]*5斤装[\s\S]*x4/);
  assert.doesNotMatch(html, /皇冠梨[\s\S]*3斤装[\s\S]*x2/);
  assert.doesNotMatch(html, /拣货汇总/);
  assert.doesNotMatch(html, /¥88(?:\.00)?/);
});

test('does not print a second picking summary for normal and bundle items', () => {
  const order: Order = {
    id: 'order-bundle-2',
    status: 'PAID',
    bizType: 'NORMAL_GOODS',
    totalAmount: 108,
    goodsAmount: 108,
    shippingFee: 0,
    createdDate: '2026-06-22',
    buyerAlias: '买家002',
    buyerNo: null,
    regionText: '广东省深圳市南山区',
    items: [
      {
        id: 'item-simple',
        title: '红富士苹果',
        skuTitle: '5斤装',
        unitPrice: 20,
        quantity: 1,
        productType: 'SIMPLE',
        bundleItems: [],
      },
      {
        id: 'item-bundle',
        title: '水果礼盒',
        unitPrice: 88,
        quantity: 2,
        productType: 'BUNDLE',
        bundleItems: [
          { productTitle: '红富士苹果', skuTitle: '5斤装', quantityPerBundle: 2 },
          { productTitle: '皇冠梨', skuTitle: '3斤装', quantityPerBundle: 1 },
        ],
      },
    ],
    shipment: null,
    refundSummary: null,
    invoiceStatus: null,
  };

  const html = buildPickingSheetHtml(order);

  assert.match(html, /红富士苹果/);
  assert.match(html, /水果礼盒/);
  assert.match(html, /<td class="quantity">1<\/td>/);
  assert.match(html, /<td class="quantity">2<\/td>/);
  assert.doesNotMatch(html, /普通/);
  assert.doesNotMatch(html, /拣货汇总/);
  assert.doesNotMatch(html, /5斤装[\s\S]*x5/);
  assert.doesNotMatch(html, /皇冠梨[\s\S]*3斤装[\s\S]*x2/);
});

test('keeps normal item sku text out of the printable picking sheet', () => {
  const order: Order = {
    id: 'order-live-normal-1',
    status: 'PAID',
    bizType: 'NORMAL_GOODS',
    totalAmount: 36,
    goodsAmount: 36,
    shippingFee: 0,
    createdDate: '2026-06-22',
    buyerAlias: '买家003',
    buyerNo: 'AIMM00000000000003',
    regionText: '山东省烟台市福山区',
    items: [
      {
        id: 'item-normal-live-shape',
        title: '烟台苹果',
        skuId: 'live-sku-apple-1',
        skuTitle: '脆甜款',
        unitPrice: 18,
        quantity: 2,
        productType: 'SIMPLE',
        bundleItems: [],
      },
    ],
    shipment: null,
    refundSummary: null,
    invoiceStatus: null,
  };

  const html = buildPickingSheetHtml(order);

  assert.match(html, /烟台苹果/);
  assert.match(html, /<td class="quantity">2<\/td>/);
  assert.doesNotMatch(html, /脆甜款/);
  assert.doesNotMatch(html, /普通/);
  assert.doesNotMatch(html, /拣货汇总/);
});

test('still resolves bundle component quantity for the seller order detail view', () => {
  assert.equal(
    resolveBundleComponentQuantity({ productTitle: '红富士苹果', quantityPerBundle: 2 }, 3),
    6,
  );
  assert.equal(
    resolveBundleComponentQuantity({ productTitle: '皇冠梨', totalQuantity: 5 }, 3),
    5,
  );
});
