import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSellerWaybillPrintHtml, printSellerWaybill } from '../src/utils/waybillPrint.ts';

const order = {
  id: 'order-001',
  createdDate: '2026-06-18',
  buyerAlias: '买家 036',
  buyerNo: 'AIMM00000000000036',
  regionText: '广东省/深圳市/宝安区',
  totalAmount: 333.19,
  items: [
    {
      id: 'item-1',
      title: '龙虾 <鲜活>',
      unitPrice: 84.5,
      quantity: 2,
    },
    {
      id: 'item-2',
      title: '苏丹鱼-忘不了鱼',
      unitPrice: 34.45,
      quantity: 1,
      isPrize: true,
      prizeType: 'THRESHOLD_GIFT',
    },
  ],
  shipment: {
    carrierName: '顺丰速运',
    trackingNo: 'SF51***2959',
    waybillNo: 'SF510000002959',
  },
};

test('builds a one-page seller packing slip with order items and quantities', () => {
  const html = buildSellerWaybillPrintHtml(order);

  assert.match(html, /订单拣货单/);
  assert.match(html, /order-001/);
  assert.match(html, /AIMM00000000000036/);
  assert.match(html, /广东省\/深圳市\/宝安区/);
  assert.match(html, /龙虾 &lt;鲜活&gt;/);
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
  assert.match(html, /\.quantity\s*\{[\s\S]*font-size: 26px;/);
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
        ...order.shipment,
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
