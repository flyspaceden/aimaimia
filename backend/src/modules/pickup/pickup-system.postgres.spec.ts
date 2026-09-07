import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PickupService } from './pickup.service';
import { OrderService } from '../order/order.service';
import { OrderReceivedEffectsService } from '../order/order-received-effects.service';
import { DigitalAssetService } from '../digital-asset/digital-asset.service';
import { BonusService } from '../bonus/bonus.service';
import { VipActivationRetryService } from '../bonus/vip-activation-retry.service';
import { CheckoutService } from '../order/checkout.service';
import { NotificationService } from '../notification/notification.service';

export function validatePickupTestUrl(raw: string) {
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^pickup_[a-z0-9_]+_test$/.test(url.pathname.slice(1))) throw new Error('必须使用本机 pickup_*_test 专用数据库');
  return url.pathname.slice(1);
}
describe('pickup PostgreSQL safety guard', () => {
  it('rejects remote and business database URLs', () => {
    expect(() => validatePickupTestUrl('postgresql://user@prod.example/pickup_system_test')).toThrow();
    expect(() => validatePickupTestUrl('postgresql://user@localhost/nongmai')).toThrow();
    expect(validatePickupTestUrl('postgresql://user@127.0.0.1:55487/pickup_system_test')).toBe('pickup_system_test');
  });
});
const url = process.env.PICKUP_POSTGRES_TEST_URL;
const databaseName = url ? validatePickupTestUrl(url) : null;
const dbDescribe = url ? describe : describe.skip;
// 只创建人工数据，不读取默认DATABASE_URL，不重置或删除任何数据库。
dbDescribe('pickup system real PostgreSQL invariants', () => {
  let db: PrismaClient, pickup: PickupService, orders: OrderService, effects: OrderReceivedEffectsService, digital: DigitalAssetService;
  const saved = { enabled: process.env.PICKUP_FULFILLMENT_ENABLED, secret: process.env.PICKUP_TOKEN_SECRET };
  beforeAll(async () => {
    process.env.PICKUP_FULFILLMENT_ENABLED = 'true'; process.env.PICKUP_TOKEN_SECRET = 'isolated-pickup-postgres-test-secret';
    db = new PrismaClient({ datasourceUrl: url }); await db.$connect();
    expect((await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`)[0].name).toBe(databaseName);
    const notification = new NotificationService(db as any);
    digital = new DigitalAssetService(db as any, notification);
    const allocation = { allocateForOrder: jest.fn(), rollbackForOrder: jest.fn() };
    orders = new OrderService(db as any, allocation as any, {} as any, {} as any, {} as any);
    effects = new OrderReceivedEffectsService(db as any, allocation as any, digital,
      { activateVipByCumulativeSpend: jest.fn() } as any, { evaluateOrderAfterReceive: jest.fn() } as any,
      { receive: jest.fn() } as any, { releaseForReceivedOrder: jest.fn().mockResolvedValue('released') } as any,
      { handleTrigger: jest.fn() } as any);
    jest.spyOn(effects, 'kick').mockImplementation(() => {}); // 显式驱动真实worker，检查持久化任务。
    pickup = new PickupService(db as any, { get: (token: unknown) => token === OrderService ? orders : effects } as any, notification);
    pickup.onModuleInit(); orders.setPickupService(pickup);
    orders.setPaymentService({ initiateRefund: jest.fn().mockResolvedValue({ success: false, message: 'test provider unavailable' }) });
  });
  afterAll(async () => {
    if (db) await db.$disconnect();
    if (saved.enabled === undefined) delete process.env.PICKUP_FULFILLMENT_ENABLED; else process.env.PICKUP_FULFILLMENT_ENABLED = saved.enabled;
    if (saved.secret === undefined) delete process.env.PICKUP_TOKEN_SECRET; else process.env.PICKUP_TOKEN_SECRET = saved.secret;
  });
  async function fixture() {
    const user = await db.user.create({ data: { memberProfile: { create: { tier: 'VIP' } } } });
    const company = await db.company.create({ data: { name: `pickup-audit-${randomUUID()}`, status: 'ACTIVE' } });
    const point = await db.pickupPoint.create({ data: { companyId: company.id, name: '隔离自提点', contactName: '测试员', contactPhone: '13800000000', regionCode: '330100', regionText: '测试地区', detail: '测试地址', businessHours: '09:00-18:00' } });
    const product = await db.product.create({ data: { companyId: company.id, title: '测试商品', basePrice: 20, status: 'ACTIVE', skus: { create: { title: '标准', price: 20, stock: 9, weightGram: 500 } } }, include: { skus: true } });
    const sku = product.skus[0];
    const input = await pickup.validateCheckoutFulfillment(db as any, [company.id], { mode: 'PICKUP', recipientName: '测试员', recipientPhone: '13800000000', selections: [{ companyId: company.id, pickupPointId: point.id }] });
    if (input.mode !== 'PICKUP') throw new Error('Expected pickup');
    const order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({ data: { userId: user.id, status: 'PAID', bizType: 'NORMAL_GOODS', fulfillmentMode: 'PICKUP', totalAmount: 20, goodsAmount: 20, shippingFee: 0, paidAt: new Date(), items: { create: { skuId: sku.id, companyId: company.id, unitPrice: 20, quantity: 1, productSnapshot: { title: product.title } } } }, include: { items: true } });
      await pickup.createForPaidOrder(tx, { orderId: created.id, companyId: company.id, recipientSnapshot: input.recipientSnapshot as any, selectionsSnapshot: input.selectionsSnapshot as any });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { user, company, point, sku, order };
  }
  async function ready(f: Awaited<ReturnType<typeof fixture>>) {
    await pickup.markReady(f.company.id, 'audit-staff', f.order.id);
    return pickup.getBuyerPass(f.user.id, f.order.id);
  }
  it('five concurrent verifications persist one receipt and exactly six effects', async () => {
    const f = await fixture(), pass = await ready(f);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => pickup.verify(f.company.id, 'audit-staff', f.order.id, { pickupCode: pass.pickupCode })));
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
    expect(await db.order.findUnique({ where: { id: f.order.id } })).toMatchObject({ status: 'RECEIVED', shippingFee: 0 });
    expect(await db.pickupFulfillment.findUnique({ where: { orderId: f.order.id } })).toMatchObject({ status: 'PICKED_UP' });
    expect(await db.orderStatusHistory.count({ where: { orderId: f.order.id, toStatus: 'RECEIVED' } })).toBe(1);
    expect(await db.orderReceivedEffectOutbox.count({ where: { orderId: f.order.id } })).toBe(6);
    expect(await db.refund.count({ where: { orderId: f.order.id } })).toBe(0);
    await expect(pickup.getBuyerPass(f.user.id, f.order.id)).rejects.toThrow();
  });
  it('verification versus platform cancellation has one consistent terminal state', async () => {
    for (let i = 0; i < 4; i++) {
      const f = await fixture(), pass = await ready(f);
      await Promise.allSettled([pickup.verify(f.company.id, 'audit-staff', f.order.id, { qrPayload: pass.qrPayload }), orders.adminCancelPickupAndRefund(f.order.id, 'audit-admin', '测试取消')]);
      const order = await db.order.findUniqueOrThrow({ where: { id: f.order.id } });
      const canceled = order.status === 'CANCELED'; expect(['RECEIVED', 'CANCELED']).toContain(order.status);
      expect((await db.pickupFulfillment.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe(canceled ? 'CANCELED' : 'PICKED_UP');
      expect(await db.refund.count({ where: { orderId: order.id } })).toBe(canceled ? 1 : 0);
      expect(await db.orderReceivedEffectOutbox.count({ where: { orderId: order.id } })).toBe(canceled ? 0 : 6);
      expect((await db.productSKU.findUniqueOrThrow({ where: { id: f.sku.id } })).stock).toBe(canceled ? 10 : 9);
    }
  }, 30000);
  it('ready versus buyer cancellation never leaves a canceled order with a usable pass', async () => {
    for (let i = 0; i < 4; i++) {
      const f = await fixture(); await Promise.allSettled([pickup.markReady(f.company.id, 'audit-staff', f.order.id), orders.cancelOrder(f.order.id, f.user.id)]);
      const order = await db.order.findUniqueOrThrow({ where: { id: f.order.id } });
      expect(['PAID', 'CANCELED']).toContain(order.status);
      const status = (await db.pickupFulfillment.findUniqueOrThrow({ where: { orderId: order.id } })).status;
      expect(status).toBe(order.status === 'CANCELED' ? 'CANCELED' : 'READY');
      if (order.status === 'CANCELED') await expect(pickup.getBuyerPass(f.user.id, f.order.id)).rejects.toThrow();
    }
  }, 30000);
  it('cross-company verification and cross-buyer pass access leave the order unchanged', async () => {
    const f = await fixture(), pass = await ready(f);
    await expect(pickup.verify('another-company', 'staff', f.order.id, { pickupCode: pass.pickupCode })).rejects.toThrow();
    await expect(pickup.getBuyerPass('another-user', f.order.id)).rejects.toThrow();
    expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('PAID');
  });
  it('worker replay credits actual digital ledgers once and refund reversal is idempotent', async () => {
    const f = await fixture(); await digital.recordOrderPaid(f.order.id);
    const pass = await ready(f); await pickup.verify(f.company.id, 'audit-staff', f.order.id, { pickupCode: pass.pickupCode });
    await Promise.all([effects.processOrder(f.order.id), effects.processOrder(f.order.id)]); await effects.processOrder(f.order.id);
    expect(await db.digitalAssetAccount.findUniqueOrThrow({ where: { userId: f.user.id } })).toMatchObject({ cumulativeSpendAmount: 20, frozenCumulativeSpendAmount: 0, creditAssetBalance: 60, frozenCreditAssetBalance: 0 });
    expect(await db.orderReceivedEffectOutbox.count({ where: { orderId: f.order.id, status: 'SUCCEEDED' } })).toBe(6);
    const before = await db.digitalAssetLedger.count({ where: { orderId: f.order.id } }); await effects.processOrder(f.order.id);
    expect(await db.digitalAssetLedger.count({ where: { orderId: f.order.id } })).toBe(before);
    const refund = await db.refund.create({ data: { orderId: f.order.id, amount: 20, reason: '测试已确认退款', status: 'REFUNDED', merchantRefundNo: `audit-${randomUUID()}`, items: { create: { orderItemId: f.order.items[0].id, skuId: f.sku.id, quantity: 1, amount: 20 } } } });
    await Promise.all([digital.reverseRefund(refund.id), digital.reverseRefund(refund.id)]);
    expect(await db.digitalAssetAccount.findUniqueOrThrow({ where: { userId: f.user.id } })).toMatchObject({ cumulativeSpendAmount: 0, creditAssetBalance: 0, frozenCumulativeSpendAmount: 0, frozenCreditAssetBalance: 0 });
  }, 30000);
  it('platform cancellation persists one refund task and restores stock only once', async () => {
    const f = await fixture(); await ready(f);
    await orders.adminCancelPickupAndRefund(f.order.id, 'audit-admin', '测试取消');
    await orders.adminCancelPickupAndRefund(f.order.id, 'audit-admin', '测试重复取消');
    expect(await db.refund.count({ where: { orderId: f.order.id, status: 'REFUNDING' } })).toBe(1);
    expect(await db.inventoryLedger.count({ where: { refId: f.order.id, type: 'RELEASE' } })).toBe(1);
    expect((await db.productSKU.findUniqueOrThrow({ where: { id: f.sku.id } })).stock).toBe(10);
    expect((await db.pickupFulfillment.findUniqueOrThrow({ where: { orderId: f.order.id } })).status).toBe('CANCELED');
  });

  async function vipFixture(channel: 'ALIPAY' | 'WECHAT_PAY' = 'ALIPAY') {
    const user = await db.user.create({ data: { memberProfile: { create: { tier: 'NORMAL' } } } });
    const pkg = await db.vipPackage.create({ data: { price: 399, selfSeedAssetAmount: 40 } });
    const gift = await db.vipGiftOption.create({ data: { title: '自提测试礼包', packageId: pkg.id } });
    const past = new Date(Date.now() - 20 * 60_000);
    const meta = { vipGiftOptionId: gift.id, vipPackageId: pkg.id, snapshotPrice: 399, giftTitle: '测试礼包', referralBonusRate: 0 };
    // 故障注入点：支付/订单事务已提交，但首次激活记录尚未持久化。
    const session = await db.checkoutSession.create({ data: { userId: user.id, status: 'COMPLETED', bizType: 'VIP_PACKAGE', bizMeta: meta, itemsSnapshot: [], fulfillmentMode: 'PICKUP', expectedTotal: 399, goodsAmount: 399, shippingFee: 0, paymentChannel: channel, paymentScene: 'APP', merchantOrderNo: `vip-audit-${randomUUID()}`, expiresAt: new Date(Date.now() + 300000), paidAt: past, createdAt: past } });
    const order = await db.order.create({ data: { userId: user.id, checkoutSessionId: session.id, status: 'PAID', bizType: 'VIP_PACKAGE', fulfillmentMode: 'PICKUP', totalAmount: 399, goodsAmount: 399, shippingFee: 0, paidAt: past, createdAt: past } });
    const config = { getConfig: jest.fn().mockResolvedValue({}) };
    const bonus = new BonusService(db as any, config as any, {} as any, new NotificationService(db as any), digital);
    return { user, pkg, gift, session, order, bonus, config, retry: new VipActivationRetryService(db as any, bonus) };
  }
  async function expectVipOnce(f: Awaited<ReturnType<typeof vipFixture>>) {
    expect((await db.memberProfile.findUniqueOrThrow({ where: { userId: f.user.id } })).tier).toBe('VIP');
    expect((await db.vipPurchase.findUniqueOrThrow({ where: { userId: f.user.id } })).activationStatus).toBe('SUCCESS');
    expect(await db.vipTreeNode.count({ where: { userId: f.user.id } })).toBe(1);
    expect((await db.digitalAssetAccount.findUniqueOrThrow({ where: { userId: f.user.id } })).seedAssetBalance).toBe(40);
  }
  it.each(['ALIPAY', 'WECHAT_PAY'] as const)('recovers missing VIP activation after committed %s payment, even without another callback', async channel => {
    const f = await vipFixture(channel);
    f.config.getConfig.mockRejectedValueOnce(new Error('injected config outage before prepare'));
    await f.retry.retryFailedActivations();
    expect(await db.vipPurchase.findUnique({ where: { userId: f.user.id } })).toBeNull();
    await f.retry.retryFailedActivations(); await f.retry.retryFailedActivations();
    await expectVipOnce(f);
    const checkout = new CheckoutService(db as any, f.config as any); checkout.setBonusService(f.bonus);
    await checkout.handlePaymentSuccess(f.session.merchantOrderNo!, `replay-${randomUUID()}`);
    await expectVipOnce(f);
  }, 30000);
  it('recovers an old PENDING activation and concurrent grants cannot overwrite SUCCESS', async () => {
    const f = await vipFixture();
    await db.vipPurchase.create({ data: { userId: f.user.id, orderId: f.order.id, amount: 399, status: 'PAID', giftOptionId: f.gift.id, packageId: f.pkg.id, giftSnapshot: {}, activationStatus: 'PENDING', createdAt: new Date(Date.now() - 20 * 60_000) } });
    await Promise.allSettled([
      f.bonus.activateVipAfterPayment(f.user.id, f.order.id, f.gift.id, 399, {}, f.pkg.id),
      f.bonus.activateVipAfterPayment(f.user.id, f.order.id, f.gift.id, 399, {}, f.pkg.id),
    ]);
    await f.retry.retryFailedActivations(); await expectVipOnce(f);
  }, 30000);
  it('never grants paid VIP benefits for a canceled or refunded order', async () => {
    for (const state of ['CANCELED', 'REFUNDED'] as const) {
      const f = await vipFixture(); await db.order.update({ where: { id: f.order.id }, data: { status: state } });
      await expect(f.bonus.activateVipAfterPayment(f.user.id, f.order.id, f.gift.id, 399, {}, f.pkg.id)).rejects.toThrow();
      await f.retry.retryFailedActivations();
      expect((await db.memberProfile.findUniqueOrThrow({ where: { userId: f.user.id } })).tier).toBe('NORMAL');
      expect(await db.digitalAssetAccount.findUnique({ where: { userId: f.user.id } })).toBeNull();
    }
  }, 30000);

  it('stale PENDING on a delivered VIP order is recovered by the worker alone', async () => {
    const f = await vipFixture();
    await db.order.update({ where: { id: f.order.id }, data: { status: 'DELIVERED', fulfillmentMode: 'DELIVERY' } });
    await db.vipPurchase.create({ data: { userId: f.user.id, orderId: f.order.id, amount: 399, status: 'PAID', giftOptionId: f.gift.id, packageId: f.pkg.id, giftSnapshot: {}, activationStatus: 'PENDING', createdAt: new Date(Date.now() - 20 * 60_000) } });
    await f.retry.retryFailedActivations(); await f.retry.retryFailedActivations();
    await expectVipOnce(f);
  }, 30000);
  it('malformed missing-purchase rows do not permanently starve the next paid order', async () => {
    const malformed: string[] = [];
    try {
      for (let i = 0; i < 10; i++) {
        const f = await vipFixture(); malformed.push(f.order.id);
        await db.checkoutSession.update({ where: { id: f.session.id }, data: { bizMeta: {} } });
        await db.order.update({ where: { id: f.order.id }, data: { createdAt: new Date(Date.now() - 60 * 60_000 - i * 1000) } });
      }
      const valid = await vipFixture();
      await valid.retry.retryFailedActivations();
      expect(await db.vipPurchase.findUnique({ where: { userId: valid.user.id } })).toBeNull();
      await valid.retry.retryFailedActivations(); await expectVipOnce(valid);
    } finally {
      // 只标记本用例自己的人工坏数据，避免污染下次独立用例的待补偿队列。
      await db.order.updateMany({ where: { id: { in: malformed } }, data: { status: 'CANCELED' } });
    }
  }, 30000);
  it('a pass generation overlapping a real verification rejects its obsolete response', async () => {
    const f = await fixture(), pass = await ready(f);
    let release!: () => void, started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const spy = jest.spyOn(pickup as any, 'buildBuyerPassQrImage').mockImplementationOnce(async () => {
      started(); await barrier; return { qrImageMimeType: null, qrImageBase64: null };
    });
    try {
      const reading = pickup.getBuyerPass(f.user.id, f.order.id);
      const rejected = expect(reading).rejects.toThrow('已失效');
      await began;
      await pickup.verify(f.company.id, 'audit-staff', f.order.id, { pickupCode: pass.pickupCode });
      release(); await rejected;
    } finally { release(); spy.mockRestore(); }
  }, 30000);

  it('activation recovery does not recreate benefits for deleted or banned buyers', async () => {
    for (const status of ['DELETED', 'BANNED'] as const) {
      const f = await vipFixture();
      await db.user.update({ where: { id: f.user.id }, data: { status, ...(status === 'DELETED' ? { deletionExecutedAt: new Date() } : {}) } });
      await expect(f.bonus.activateVipAfterPayment(f.user.id, f.order.id, f.gift.id, 399, {}, f.pkg.id)).rejects.toThrow();
      await f.retry.retryFailedActivations();
      expect((await db.memberProfile.findUniqueOrThrow({ where: { userId: f.user.id } })).tier).toBe('NORMAL');
      expect(await db.digitalAssetAccount.findUnique({ where: { userId: f.user.id } })).toBeNull();
      expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('PAID');
    }
  }, 30000);

});
