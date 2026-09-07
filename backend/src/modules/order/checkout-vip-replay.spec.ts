import { CheckoutService } from './checkout.service';

describe('VIP payment replay recovery', () => {
  it('replays VIP activation metadata without freezing ordinary-order assets', async () => {
    const session = { id: 's', userId: 'u', status: 'COMPLETED', bizType: 'VIP_PACKAGE', bizMeta: { vipGiftOptionId: 'gift', snapshotPrice: 399, vipPackageId: 'pkg' }, itemsSnapshot: [{ skuId: 'sku', title: 'Gift', quantity: 1, unitPrice: 9 }] };
    const tx = { checkoutSession: { findUnique: jest.fn().mockResolvedValue(session), updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, order: { findMany: jest.fn().mockResolvedValue([{ id: 'o' }]) } };
    const service = Object.create(CheckoutService.prototype) as CheckoutService;
    const activate = jest.fn().mockResolvedValue(undefined);
    const paidAssets = jest.fn().mockResolvedValue(undefined);
    Object.assign(service, { prisma: { $transaction: jest.fn(async (fn) => fn(tx)) }, logger: { log: jest.fn(), error: jest.fn() }, bonusService: { activateVipAfterPayment: activate }, digitalAssetService: { recordOrderPaid: paidAssets } });
    await expect(service.handlePaymentSuccess('merchant', 'provider')).resolves.toEqual({ orderIds: ['o'] });
    expect(activate).toHaveBeenCalledWith('u', 'o', 'gift', 399, expect.objectContaining({ items: [expect.objectContaining({ skuId: 'sku' })] }), 'pkg', undefined);
    expect(paidAssets).not.toHaveBeenCalled();
  });
});
