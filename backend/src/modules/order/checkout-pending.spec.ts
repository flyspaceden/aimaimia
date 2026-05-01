import { CheckoutService } from './checkout.service';

describe('CheckoutService.getPendingForUser', () => {
  it('returns null when no active session', async () => {
    const prisma = { checkoutSession: { findFirst: async () => null } };
    const svc = new CheckoutService(prisma as any, {} as any);
    const result = await svc.getPendingForUser('user1');
    expect(result).toBeNull();
  });

  it('returns serialized summary when active session exists', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const session = {
      id: 'cs1',
      merchantOrderNo: 'MO123',
      expectedTotal: 130,
      goodsAmount: 130,
      shippingFee: 0,
      expiresAt,
      bizType: 'NORMAL_GOODS',
      itemsSnapshot: [
        { quantity: 1, unitPrice: 58, productSnapshot: { image: 'http://i1', title: '猕猴桃', skuTitle: '5斤装' } },
        { quantity: 2, unitPrice: 36, productSnapshot: { image: 'http://i2', title: '脐橙', skuTitle: '10斤' } },
      ],
    };
    const prisma = { checkoutSession: { findFirst: async () => session } };
    const svc = new CheckoutService(prisma as any, {} as any);
    const result = await svc.getPendingForUser('user1');
    expect(result).toMatchObject({
      sessionId: 'cs1',
      expectedTotal: 130,
      itemCount: 3,
      preview: { firstItemImage: 'http://i1', firstItemTitle: '猕猴桃', extraCount: 1 },
    });
    expect(result!.items.length).toBe(2);
  });
});
