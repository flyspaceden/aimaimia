import { NotificationEvent } from './notification.types';
import { NotificationRegistry } from './notification.registry';

describe('NotificationRegistry', () => {
  const registry = new NotificationRegistry();

  const event = (eventType: string, payload: Record<string, unknown> = {}): NotificationEvent => ({
    eventType,
    aggregateType: 'test',
    aggregateId: 'entity-1',
    actor: { kind: 'system' },
    payload,
  });

  it('builds buyer order shipped notification with a registered route key', async () => {
    const result = await registry.resolve(
      event('order.shipped', { orderId: 'order-1', buyerUserId: 'buyer-1' }),
    );

    expect(result.messages).toEqual([
      expect.objectContaining({
        recipientKind: 'BUYER_USER',
        recipientKey: 'buyer:buyer-1',
        audience: 'BUYER_APP',
        category: 'order',
        eventType: 'order.shipped',
        action: { routeKey: 'ORDER_DETAIL', params: { id: 'order-1' } },
      }),
    ]);
  });

  it('registers every existing migrated event type', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['order.newPaidForSeller', { orderId: 'order-1', sellerUserIds: ['seller-1'] }],
      ['order.stockShortage', { skuId: 'sku-1', sellerUserIds: ['seller-1'] }],
      ['order.shipped', { orderId: 'order-1', buyerUserId: 'buyer-1' }],
      ['order.delivered', { orderId: 'order-1', buyerUserId: 'buyer-1' }],
      ['order.receiverInfoRequired', { orderId: 'order-1', buyerUserId: 'buyer-1' }],
      ['logistics.exception', { shipmentId: 'shipment-1', orderId: 'order-1', buyerUserId: 'buyer-1' }],
      ['logistics.stale', { shipmentId: 'shipment-1', orderId: 'order-1', buyerUserId: 'buyer-1' }],
      ['coupon.granted', { couponInstanceId: 'coupon-1', userId: 'buyer-1' }],
      ['coupon.expired', { couponInstanceId: 'coupon-1', userId: 'buyer-1' }],
      ['reward.credited', { ledgerId: 'ledger-1', userId: 'buyer-1', amount: 12.34 }],
      ['reward.unfrozen', { ledgerId: 'ledger-1', userId: 'buyer-1', amount: 12.34 }],
      ['reward.expired', { ledgerId: 'ledger-1', userId: 'buyer-1' }],
      ['withdraw.approved', { withdrawId: 'withdraw-1', userId: 'buyer-1' }],
      ['withdraw.rejected', { withdrawId: 'withdraw-1', userId: 'buyer-1' }],
      ['withdraw.processing', { withdrawId: 'withdraw-1', userId: 'buyer-1' }],
      ['withdraw.paid', { withdrawId: 'withdraw-1', userId: 'buyer-1' }],
      ['withdraw.failed', { withdrawId: 'withdraw-1', userId: 'buyer-1' }],
      ['withdraw.yearlyAlert', { userId: 'buyer-1', adminUserIds: ['admin-1'], withdrawId: 'withdraw-1' }],
      ['vip.activated', { orderId: 'order-1', userId: 'buyer-1' }],
      ['refund.credited', { refundId: 'refund-1', orderId: 'order-1', userId: 'buyer-1' }],
      ['order.canceledByBuyerForSeller', { orderId: 'order-1', sellerUserIds: ['seller-1'] }],
    ];

    for (const [eventType, payload] of cases) {
      const result = await registry.resolve(event(eventType, payload));
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages.every((message) => message.eventType === eventType)).toBe(true);
    }
  });

  it('registers high-value after-sale, invoice, group-buy, digital-asset, and customer-service events', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['afterSale.approved', { afterSaleId: 'as-1', userId: 'buyer-1' }],
      ['afterSale.rejected', { afterSaleId: 'as-1', userId: 'buyer-1' }],
      ['afterSale.returnRequired', { afterSaleId: 'as-1', userId: 'buyer-1' }],
      ['afterSale.receivedBySeller', { afterSaleId: 'as-1', userId: 'buyer-1' }],
      ['afterSale.sellerRejectedReturn', { afterSaleId: 'as-1', userId: 'buyer-1' }],
      ['afterSale.replacementShipped', { afterSaleId: 'as-1', userId: 'buyer-1' }],
      ['afterSale.arbitrationRequested', { afterSaleId: 'as-1', adminUserIds: ['admin-1'] }],
      ['afterSale.arbitrationResolved', { afterSaleId: 'as-1', userId: 'buyer-1', sellerUserIds: ['seller-1'] }],
      ['afterSale.closedByTimeout', { afterSaleId: 'as-1', userId: 'buyer-1' }],
      ['afterSale.refunded', { afterSaleId: 'as-1', userId: 'buyer-1' }],
      ['invoice.issued', { invoiceId: 'invoice-1', userId: 'buyer-1' }],
      ['invoice.failed', { invoiceId: 'invoice-1', userId: 'buyer-1' }],
      ['groupBuy.codeActivated', { groupBuyInstanceId: 'gb-1', userId: 'buyer-1' }],
      ['groupBuy.rebateReleased', { groupBuyReferralId: 'ref-1', userId: 'buyer-1', amount: 12.34 }],
      ['digitalAsset.released', { orderId: 'order-1', userId: 'buyer-1', amount: 12.34 }],
      ['digitalAsset.reversed', { orderId: 'order-1', userId: 'buyer-1', amount: 12.34 }],
      ['digitalAsset.adjusted', { adjustmentId: 'adjust-1', userId: 'buyer-1', amount: 12.34 }],
      ['cs.agentReplyOffline', { sessionId: 'cs-1', userId: 'buyer-1' }],
    ];

    for (const [eventType, payload] of cases) {
      const result = await registry.resolve(event(eventType, payload));
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages.every((message) => message.eventType === eventType)).toBe(true);
    }
  });

  it('routes after-sale events to each relevant audience without leaking private contact data', async () => {
    const result = await registry.resolve(
      event('afterSale.arbitrationResolved', {
        afterSaleId: 'as-1',
        userId: 'buyer-1',
        sellerUserIds: ['seller-1'],
        adminUserIds: ['admin-1'],
        phone: '13800138000',
        address: '广东省深圳市南山区详细地址',
      }),
    );

    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recipientKind: 'BUYER_USER',
          recipientKey: 'buyer:buyer-1',
          audience: 'BUYER_APP',
          category: 'after_sale',
          action: { routeKey: 'AFTER_SALE_DETAIL', params: { id: 'as-1' } },
        }),
        expect.objectContaining({
          recipientKind: 'SELLER_STAFF',
          recipientKey: 'seller:seller-1',
          audience: 'SELLER_CENTER',
          action: { routeKey: 'SELLER_AFTER_SALE_DETAIL', params: { id: 'as-1' } },
        }),
        expect.objectContaining({
          recipientKind: 'ADMIN_USER',
          recipientKey: 'admin:admin-1',
          audience: 'ADMIN_CENTER',
          action: { routeKey: 'ADMIN_AFTER_SALE_DETAIL', params: { id: 'as-1' } },
        }),
      ]),
    );
    expect(result.messages.map((message) => `${message.title} ${message.body}`).join('\n')).not.toMatch(
      /13800138000|南山区详细地址/,
    );
  });

  it('builds seller center notifications for seller recipients', async () => {
    const result = await registry.resolve(
      event('order.stockShortage', { skuId: 'sku-1', sellerUserIds: ['seller-1', 'seller-2'] }),
    );

    expect(result.messages).toEqual([
      expect.objectContaining({
        recipientKind: 'SELLER_STAFF',
        recipientKey: 'seller:seller-1',
        audience: 'SELLER_CENTER',
        action: { routeKey: 'SELLER_PRODUCT_DETAIL', params: { id: 'sku-1' } },
      }),
      expect.objectContaining({
        recipientKind: 'SELLER_STAFF',
        recipientKey: 'seller:seller-2',
        audience: 'SELLER_CENTER',
      }),
    ]);
  });

  it('routes buyer-canceled order notifications to seller order detail', async () => {
    const result = await registry.resolve(
      event('order.canceledByBuyerForSeller', {
        orderId: 'order-1',
        sellerUserIds: ['seller-1'],
      }),
    );

    expect(result.messages).toEqual([
      expect.objectContaining({
        recipientKind: 'SELLER_STAFF',
        recipientKey: 'seller:seller-1',
        audience: 'SELLER_CENTER',
        category: 'order',
        eventType: 'order.canceledByBuyerForSeller',
        action: { routeKey: 'SELLER_ORDER_DETAIL', params: { id: 'order-1' } },
      }),
    ]);
  });

  it('builds admin risk notifications when admin recipients are provided', async () => {
    const result = await registry.resolve(
      event('withdraw.yearlyAlert', {
        userId: 'buyer-1',
        adminUserIds: ['admin-1'],
        withdrawId: 'withdraw-1',
      }),
    );

    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recipientKind: 'BUYER_USER',
          recipientKey: 'buyer:buyer-1',
          audience: 'BUYER_APP',
        }),
        expect.objectContaining({
          recipientKind: 'ADMIN_USER',
          recipientKey: 'admin:admin-1',
          audience: 'ADMIN_CENTER',
          category: 'risk',
          action: { routeKey: 'ADMIN_WITHDRAW_DETAIL', params: { id: 'withdraw-1' } },
        }),
      ]),
    );
  });

  it('throws for unregistered event types', async () => {
    await expect(
      registry.resolve({
        eventType: 'unknown.event',
        aggregateType: 'unknown',
        aggregateId: 'x',
        actor: { kind: 'system' },
        payload: {},
      }),
    ).rejects.toThrow('未注册的通知事件');
  });
});
