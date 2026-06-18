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

test('builds seller packing slip with order items before the waybill iframe', () => {
  const html = buildSellerWaybillPrintHtml(
    order,
    'https://api.ai-maimai.com/api/v1/seller/orders/order-001/waybill/print?sig=abc',
  );

  assert.match(html, /订单拣货单/);
  assert.match(html, /order-001/);
  assert.match(html, /AIMM00000000000036/);
  assert.match(html, /广东省\/深圳市\/宝安区/);
  assert.match(html, /龙虾 &lt;鲜活&gt;/);
  assert.match(html, /84\.50 × 2/);
  assert.match(html, /169\.00/);
  assert.match(html, /满额赠品/);
  assert.match(html, /SF510000002959/);
  assert.ok(html.indexOf('订单拣货单') < html.indexOf('waybill-frame'));
});

test('escapes waybill URL and triggers browser print from the generated page', () => {
  const html = buildSellerWaybillPrintHtml(
    order,
    'https://api.ai-maimai.com/print?sig=<bad>&next="x"',
  );

  assert.match(html, /sig=&lt;bad&gt;&amp;next=&quot;x&quot;/);
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
    assert.match(writtenHtml, /waybill-frame/);
  } finally {
    globalThis.window = originalWindow;
  }
});
