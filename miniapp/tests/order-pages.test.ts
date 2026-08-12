import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Order, OrderItem, RepurchaseResult, TrackingEvent } from '@/types';
import {
  ORDER_STATUS_META,
  canCancelPaidOrder,
  canConfirmReplacementOrder,
  canConfirmOrder,
  canRepurchaseOrder,
  dedupeTrackingEvents,
  groupOrderItems,
  normalizeOrderDateValue,
  parsePaymentSuccessOrderIds,
  paymentSuccessPresentation,
  repurchasePresentation,
} from '@/packages/orders/_components/order-utils';

const normalOrder: Order = {
  id: 'order-1',
  status: 'PAID',
  bizType: 'NORMAL_GOODS',
  totalPrice: 88,
  createdAt: '2026-08-02T10:00:00.000Z',
  items: [],
};

function repurchaseResult(overrides: Partial<RepurchaseResult> = {}): RepurchaseResult {
  return {
    addedItemCount: 0,
    addedQuantity: 0,
    skippedItemCount: 0,
    skippedQuantity: 0,
    priceChangedCount: 0,
    cart: { id: 'cart-1', items: [] },
    items: [],
    ...overrides,
  };
}

describe('order page business boundaries', () => {
  it('keeps historical pending-payment orders read-only', () => {
    const historicalOrder: Order = { ...normalOrder, status: 'PENDING_PAYMENT' };

    expect(ORDER_STATUS_META.PENDING_PAYMENT).toMatchObject({
      label: '历史待支付',
      tone: 'muted',
    });
    expect(canCancelPaidOrder(historicalOrder)).toBe(false);
    expect(canConfirmOrder(historicalOrder)).toBe(false);
    expect(canRepurchaseOrder(historicalOrder)).toBe(false);
  });

  it('allows only eligible paid normal orders to cancel before shipment', () => {
    expect(canCancelPaidOrder(normalOrder)).toBe(true);
    expect(canCancelPaidOrder({ ...normalOrder, bizType: 'VIP_PACKAGE' })).toBe(false);
    expect(canCancelPaidOrder({ ...normalOrder, bizType: 'GROUP_BUY' })).toBe(false);
    expect(canCancelPaidOrder({ ...normalOrder, status: 'SHIPPED' })).toBe(false);
    expect(canCancelPaidOrder({ ...normalOrder, receiverInfoEditable: false })).toBe(false);
  });

  it('gates confirmation and repurchase by fulfillment state and business type', () => {
    expect(canConfirmOrder({ ...normalOrder, status: 'SHIPPED' })).toBe(true);
    expect(canConfirmOrder({ ...normalOrder, status: 'DELIVERED' })).toBe(true);
    expect(canConfirmOrder({ ...normalOrder, status: 'RECEIVED' })).toBe(false);
    expect(canRepurchaseOrder({ ...normalOrder, status: 'RECEIVED' })).toBe(true);
    expect(canRepurchaseOrder({ ...normalOrder, status: 'RECEIVED', bizType: 'VIP_PACKAGE' })).toBe(false);
    expect(canRepurchaseOrder({ ...normalOrder, status: 'RECEIVED', repurchasable: false })).toBe(false);
    expect(canConfirmReplacementOrder({
      ...normalOrder,
      status: 'RECEIVED',
      afterSaleStatus: 'shipped',
      afterSaleSummary: { id: 'as-1', status: 'REPLACEMENT_SHIPPED', type: 'QUALITY_EXCHANGE', requiresReturn: true },
    })).toBe(true);
  });

  it('derives payment-success copy and destination only from verified orders', () => {
    expect(paymentSuccessPresentation([{ ...normalOrder, status: 'PAID', bizType: 'VIP_PACKAGE' }])).toMatchObject({
      title: 'VIP 开通成功',
      destination: 'VIP_CENTER',
    });
    expect(paymentSuccessPresentation([{ ...normalOrder, id: 'single' }])).toMatchObject({
      primaryLabel: '查看订单',
      destination: 'ORDER_DETAIL',
    });
    expect(paymentSuccessPresentation([{ ...normalOrder, id: 'one' }, { ...normalOrder, id: 'two' }])).toMatchObject({
      copy: '已为您创建 2 笔商家订单',
      destination: 'ORDER_LIST',
    });
  });

  it('groups merchant items without merging different companies', () => {
    const items: OrderItem[] = [
      { id: 'i-1', productId: 'p-1', title: '苹果', image: '', price: 12, quantity: 1, companyId: 'c-1', companyName: '甲商家' },
      { id: 'i-2', productId: 'p-2', title: '梨', image: '', price: 8, quantity: 2, companyId: 'c-1', companyName: '甲商家' },
      { id: 'i-3', productId: 'p-3', title: '米', image: '', price: 30, quantity: 1, companyId: 'c-2', companyName: '乙商家' },
    ];

    const groups = groupOrderItems(items);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ key: 'c-1', companyName: '甲商家' });
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items[0].title).toBe('米');
  });

  it('bounds and validates payment-success order IDs from route parameters', () => {
    expect(parsePaymentSuccessOrderIds('order-1%2Corder-2%2Corder-1')).toEqual(['order-1', 'order-2']);
    expect(parsePaymentSuccessOrderIds('%E0%A4%A')).toEqual([]);
    expect(parsePaymentSuccessOrderIds('order-1,../admin,order%202')).toEqual(['order-1']);
    expect(parsePaymentSuccessOrderIds('x'.repeat(8_193))).toEqual([]);
  });

  it('normalizes the backend minute-precision timestamp to a WeChat/iOS-safe ISO local timestamp', () => {
    expect(normalizeOrderDateValue('2026-08-11 00:58')).toBe('2026-08-11T00:58:00');
    expect(normalizeOrderDateValue('2026-08-11T00:58:00.000Z')).toBe('2026-08-11T00:58:00.000Z');
    expect(normalizeOrderDateValue('not-a-date')).toBe('not-a-date');
  });

  it('explains partial repurchase, low-stock quantity adjustment and virtual skips', () => {
    const presentation = repurchasePresentation(repurchaseResult({
      addedItemCount: 1,
      addedQuantity: 2,
      skippedItemCount: 1,
      skippedQuantity: 1,
      items: [
        {
          orderItemId: 'i-1', skuId: 'sku-1', title: '苹果', quantity: 4, status: 'ADDED',
          reason: 'LOW_STOCK_ADJUSTED', adjustedQuantity: 2,
        },
        {
          orderItemId: 'i-2', skuId: 'sku-2', title: '梨', quantity: 1, status: 'SKIPPED',
          reason: 'OUT_OF_STOCK_VIRTUAL', virtual: true, message: '暂时无货',
        },
      ],
    }));

    expect(presentation.title).toBe('部分商品已加购');
    expect(presentation.canOpenCart).toBe(true);
    expect(presentation.lines).toEqual(expect.arrayContaining([
      '已将 2 件商品加入购物车',
      '苹果：库存不足，数量已调整为 2',
      '梨：暂时无货',
    ]));
  });

  it('deduplicates repeated tracking content and keeps the newest occurrence first', () => {
    const events: TrackingEvent[] = [
      { id: 'event-1', message: '已揽收', location: '昆明', occurredAt: '2026-08-01T09:00:00.000Z' },
      { id: 'event-2', message: '已揽收', location: '昆明', occurredAt: '2026-08-01T10:00:00.000Z' },
      { id: 'event-3', message: '运输中', location: '长沙', occurredAt: '2026-08-02T10:00:00.000Z' },
    ];

    expect(dedupeTrackingEvents(events)).toEqual([
      events[2],
      events[1],
    ]);
  });

  it('contains no forbidden payment or delivery entry in order pages', () => {
    const orderRoot = path.resolve(process.cwd(), 'src/packages/orders');
    const pageSources = [
      'order-list/index.tsx',
      'order-detail/index.tsx',
      'order-track/index.tsx',
      'receiver-info/index.tsx',
    ].map((file) => fs.readFileSync(path.join(orderRoot, file), 'utf8')).join('\n');

    expect(pageSources).not.toMatch(/支付宝|alipay|\/delivery|DeliveryRepo/i);
    expect(pageSources).not.toMatch(/resume\s*\(/i);
    expect(pageSources).toContain('历史待支付记录不支持续付');
  });

  it('uses server-provided invoice and after-sale state and exposes order customer service', () => {
    const detailSource = fs.readFileSync(path.resolve(process.cwd(), 'src/packages/orders/order-detail/index.tsx'), 'utf8');

    expect(detailSource).toContain('order.invoiceEligible === true');
    expect(detailSource).toContain('order.invoiceStatus');
    expect(detailSource).toContain('order.afterSaleSummary');
    expect(detailSource).toContain('/packages/invoices/invoice-detail/index');
    expect(detailSource).toContain('/packages/invoices/invoice-request/index');
    expect(detailSource).toContain('/packages/after-sales/after-sale-detail/index');
    expect(detailSource).toContain('source=ORDER_DETAIL');
  });
});
