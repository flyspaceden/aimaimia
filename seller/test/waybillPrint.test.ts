import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPickingSheetHtml } from '../src/utils/waybillPrint.ts';
import type { Order } from '../src/types/index.ts';

test('renders bundle component rows and picking summary without prices', () => {
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

  assert.match(html, /水果礼盒[\s\S]*x2/);
  assert.match(html, /组合明细[\s\S]*红富士苹果[\s\S]*5斤装[\s\S]*x4/);
  assert.match(html, /组合明细[\s\S]*皇冠梨[\s\S]*3斤装[\s\S]*x2/);
  assert.match(html, /拣货汇总[\s\S]*红富士苹果[\s\S]*5斤装[\s\S]*x4/);
  assert.doesNotMatch(html, /¥88(?:\.00)?/);
});

test('aggregates normal and bundle quantities and falls back to quantityPerBundle', () => {
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

  assert.match(html, /拣货汇总[\s\S]*红富士苹果[\s\S]*5斤装[\s\S]*x5/);
  assert.match(html, /拣货汇总[\s\S]*皇冠梨[\s\S]*3斤装[\s\S]*x2/);
});
