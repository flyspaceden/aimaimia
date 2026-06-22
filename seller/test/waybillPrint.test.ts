import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPickingSheetHtml,
  buildSellerWaybillPrintHtml,
  printSellerWaybill,
} from '../src/utils/waybillPrint.ts';
import type { Order } from '../src/types/index.ts';

const order: Order = {
  id: 'order-001',
  status: 'PAID',
  bizType: 'NORMAL_GOODS',
  createdDate: '2026-06-18',
  buyerAlias: '买家 036',
  buyerNo: 'AIMM00000000000036',
  regionText: '广东省/深圳市/宝安区',
  totalAmount: 333.19,
  goodsAmount: 333.19,
  shippingFee: 0,
  items: [
    {
      id: 'item-1',
      title: '龙虾 <鲜活>',
      description: '多样海产品组合：有进口印度小青龙<300克>4只，苏丹鱼-忘不了鱼500克2条。',
      unitPrice: 84.5,
      quantity: 2,
      productType: 'SIMPLE',
      bundleItems: [],
    },
    {
      id: 'item-2',
      title: '苏丹鱼-忘不了鱼',
      unitPrice: 34.45,
      quantity: 1,
      isPrize: true,
      prizeType: 'THRESHOLD_GIFT',
      productType: 'SIMPLE',
      bundleItems: [],
    },
  ],
  shipment: {
    id: 'shipment-1',
    status: 'PRINTED',
    carrierCode: 'SF',
    carrierName: '顺丰速运',
    trackingNo: 'SF51***2959',
    waybillNo: 'SF510000002959',
  },
  refundSummary: null,
  invoiceStatus: null,
};

test('builds a one-page seller packing slip with order items and quantities', () => {
  const html = buildSellerWaybillPrintHtml(order);

  assert.match(html, /订单拣货单/);
  assert.match(html, /order-001/);
  assert.match(html, /AIMM00000000000036/);
  assert.match(html, /广东省\/深圳市\/宝安区/);
  assert.match(html, /龙虾 &lt;鲜活&gt;/);
  assert.match(html, /详情清单/);
  assert.match(html, /多样海产品组合：有进口印度小青龙&lt;300克&gt;4只，苏丹鱼-忘不了鱼500克2条。/);
  assert.match(html, /<td class="quantity">2<\/td>/);
  assert.match(html, /满额赠品/);
  assert.doesNotMatch(html, /普通/);
  assert.match(html, /SF510000002959/);
  assert.doesNotMatch(html, /waybill-frame/);
  assert.doesNotMatch(html, /waybill-page/);
  assert.doesNotMatch(html, /<iframe/);
  assert.doesNotMatch(html, /page-break-before/);
  assert.doesNotMatch(html, /https:\/\/api\.ai-maimai\.com/);
});

test('uses larger print typography for warehouse picking', () => {
  const html = buildSellerWaybillPrintHtml(order);

  assert.match(html, /body\s*\{[\s\S]*font-size: 16px;/);
  assert.match(html, /h1\s*\{[\s\S]*font-size: 34px;/);
  assert.match(html, /\.meta\s*\{[\s\S]*font-size: 16px;/);
  assert.match(html, /table\s*\{[\s\S]*font-size: 17px;/);
  assert.match(html, /\.item-title\s*\{[\s\S]*font-size: 22px;/);
  assert.match(html, /\.quantity,[\s\S]*font-size: 26px;/);
});

test('does not expose seller platform prices on the printable packing slip', () => {
  const html = buildSellerWaybillPrintHtml(order);

  assert.doesNotMatch(html, /单价/);
  assert.doesNotMatch(html, /小计/);
  assert.doesNotMatch(html, /商品金额/);
  assert.doesNotMatch(html, /¥/);
  assert.doesNotMatch(html, /84\.50/);
  assert.doesNotMatch(html, /169\.00/);
  assert.doesNotMatch(html, /333\.19/);
});

test('triggers browser print from the generated page', () => {
  const html = buildSellerWaybillPrintHtml(order);

  assert.match(html, /window\.print\(\)/);
  assert.match(html, /setTimeout\(printNow, 1800\)/);
});

test('opens a writable print window for the seller packing slip', () => {
  let openArgs: unknown[] | undefined;
  let writtenHtml = '';
  const originalWindow = globalThis.window;

  globalThis.window = {
    open: (...args: unknown[]) => {
      openArgs = args;
      return {
        document: {
          write: (html: string) => {
            writtenHtml = html;
          },
          close: () => undefined,
        },
      };
    },
  } as unknown as Window & typeof globalThis;

  try {
    const result = printSellerWaybill({
      ...order,
      shipment: {
        ...order.shipment!,
        waybillPrintUrl: 'https://api.ai-maimai.com/api/v1/seller/orders/order-001/waybill/print?sig=abc',
      },
    });

    assert.equal(result, 'opened');
    assert.deepEqual(openArgs, ['', '_blank']);
    assert.match(writtenHtml, /订单拣货单/);
    assert.doesNotMatch(writtenHtml, /waybill-frame/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('renders bundle component rows and picking summary without prices', () => {
  const bundleOrder: Order = {
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

  const html = buildPickingSheetHtml(bundleOrder);

  assert.match(html, /水果礼盒[\s\S]*x2/);
  assert.match(html, /组合明细[\s\S]*红富士苹果[\s\S]*5斤装[\s\S]*x4/);
  assert.match(html, /组合明细[\s\S]*皇冠梨[\s\S]*3斤装[\s\S]*x2/);
  assert.match(html, /拣货汇总[\s\S]*红富士苹果[\s\S]*5斤装[\s\S]*x4/);
  assert.doesNotMatch(html, /¥88(?:\.00)?/);
});

test('aggregates normal and bundle quantities and falls back to quantityPerBundle', () => {
  const aggregateOrder: Order = {
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

  const html = buildPickingSheetHtml(aggregateOrder);

  assert.match(html, /拣货汇总[\s\S]*红富士苹果[\s\S]*5斤装[\s\S]*x5/);
  assert.match(html, /拣货汇总[\s\S]*皇冠梨[\s\S]*3斤装[\s\S]*x2/);
});

test('shows skuTitle in picking summary for live seller detail normal items', () => {
  const liveOrder: Order = {
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

  const html = buildPickingSheetHtml(liveOrder);

  assert.match(html, /拣货汇总[\s\S]*烟台苹果[\s\S]*脆甜款[\s\S]*x2/);
});

test('does not merge picking rows when distinct skuIds share the same title and skuTitle', () => {
  const splitOrder: Order = {
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

  const html = buildPickingSheetHtml(splitOrder);
  const summarySection = html.match(/<h2>拣货汇总<\/h2>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  const appleRows = Array.from(
    summarySection.matchAll(/红富士苹果[\s\S]*?礼盒装\s*\(([^)]*?)\)[\s\S]*?x(\d+)/g),
  ).map((match) => ({
    label: match[1],
    qty: Number(match[2]),
  }));

  assert.equal(appleRows.length, 3);
  assert.deepEqual(
    appleRows.map((row) => row.qty).sort((a, b) => a - b),
    [1, 2, 3],
  );
  appleRows.forEach((row) => {
    assert.match(row.label, /^#/);
  });
  assert.deepEqual(new Set(appleRows.map((row) => row.label)).size, 3);
});
