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

test('shows skuTitle in picking summary for live seller detail normal items', () => {
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

  assert.match(html, /拣货汇总[\s\S]*烟台苹果[\s\S]*脆甜款[\s\S]*x2/);
});

test('does not merge picking rows when distinct skuIds share the same title and skuTitle', () => {
  const order: Order = {
    id: 'order-sku-split-1',
    status: 'PAID',
    bizType: 'NORMAL_GOODS',
    totalAmount: 126,
    goodsAmount: 126,
    shippingFee: 0,
    createdDate: '2026-06-22',
    buyerAlias: '买家004',
    buyerNo: null,
    regionText: '陕西省西安市雁塔区',
    items: [
      {
        id: 'item-normal-1',
        title: '红富士苹果',
        skuId: 'sku-normal-1',
        skuTitle: '礼盒装',
        unitPrice: 20,
        quantity: 1,
        productType: 'SIMPLE',
        bundleItems: [],
      },
      {
        id: 'item-bundle-1',
        title: '水果礼盒A',
        unitPrice: 50,
        quantity: 1,
        productType: 'BUNDLE',
        bundleItems: [
          { productTitle: '红富士苹果', skuId: 'sku-bundle-2', skuTitle: '礼盒装', quantityPerBundle: 2 },
        ],
      },
      {
        id: 'item-bundle-2',
        title: '水果礼盒B',
        unitPrice: 56,
        quantity: 1,
        productType: 'BUNDLE',
        bundleItems: [
          { productTitle: '红富士苹果', skuId: 'sku-bundle-3', skuTitle: '礼盒装', totalQuantity: 3 },
        ],
      },
    ],
    shipment: null,
    refundSummary: null,
    invoiceStatus: null,
  };

  const html = buildPickingSheetHtml(order);
  const summarySection = html.match(/<h2>拣货汇总<\/h2>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  const appleRows = Array.from(summarySection.matchAll(/红富士苹果[\s\S]*?礼盒装[\s\S]*?x(\d+)/g))
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);

  assert.deepEqual(appleRows, [1, 2, 3]);
});
