import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { WechatShippingOutboxService } from './wechat-shipping-outbox.service';

function validateTestUrl(raw: string) {
  const url = new URL(raw);
  const database = url.pathname.slice(1);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^pickup_[a-z0-9_]+_test$/.test(database)
  ) {
    throw new Error('必须使用本机 pickup_*_test 专用数据库');
  }
  return database;
}

describe('WechatShippingOutboxService PostgreSQL safety guard', () => {
  it('rejects remote and business database URLs', () => {
    expect(() => validateTestUrl('postgresql://user@prod.example/pickup_wechat_test')).toThrow();
    expect(() => validateTestUrl('postgresql://user@localhost/aimaimai')).toThrow();
    expect(validateTestUrl('postgresql://user@127.0.0.1:55491/pickup_wechat_test'))
      .toBe('pickup_wechat_test');
  });
});

const testUrl = process.env.PICKUP_POSTGRES_TEST_URL;
if (testUrl) validateTestUrl(testUrl);
const dbDescribe = testUrl ? describe : describe.skip;

dbDescribe('WechatShippingOutboxService real PostgreSQL invariants', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: testUrl });
    await db.$connect();
  });

  afterAll(async () => {
    if (db) await db.$disconnect();
  });

  it('persists and sends one user-pickup report without logistics identifiers', async () => {
    const suffix = randomUUID();
    const user = await db.user.create({ data: {} });
    const company = await db.company.create({
      data: { name: `wechat-pickup-${suffix}`, status: 'ACTIVE' },
    });
    const point = await db.pickupPoint.create({
      data: {
        companyId: company.id,
        name: '微信自提测试点',
        contactName: '测试员',
        contactPhone: '13800000000',
        regionCode: '440300',
        regionText: '广东省深圳市',
        detail: '隔离测试地址',
        businessHours: { summary: '09:00-18:00' },
      },
    });
    const product = await db.product.create({
      data: {
        companyId: company.id,
        title: '真实数据库海鲜礼盒',
        basePrice: 88,
        status: 'ACTIVE',
        skus: { create: { title: '标准装', price: 88, stock: 1, weightGram: 500 } },
      },
      include: { skus: true },
    });
    const session = await db.checkoutSession.create({
      data: {
        userId: user.id,
        status: 'COMPLETED',
        fulfillmentMode: 'PICKUP',
        itemsSnapshot: [],
        pickupRecipientSnapshot: {},
        pickupSelectionsSnapshot: [],
        expectedTotal: 88,
        goodsAmount: 88,
        shippingFee: 0,
        merchantOrderNo: `WX-PICKUP-${suffix}`,
        paymentChannel: 'WECHAT_PAY',
        paymentScene: 'MINI_PROGRAM',
        providerTxnId: `wx-txn-${suffix}`,
        miniProgramPayerOpenId: `openid-${suffix}`,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        paidAt: new Date(),
      },
    });
    const order = await db.order.create({
      data: {
        userId: user.id,
        checkoutSessionId: session.id,
        status: 'RECEIVED',
        fulfillmentMode: 'PICKUP',
        totalAmount: 88,
        goodsAmount: 88,
        shippingFee: 0,
        paidAt: new Date(),
        receivedAt: new Date(),
        deliveredAt: new Date(),
        items: {
          create: {
            skuId: product.skus[0].id,
            companyId: company.id,
            unitPrice: 88,
            quantity: 1,
            productSnapshot: { title: product.title },
          },
        },
      },
    });
    await db.pickupFulfillment.create({
      data: {
        orderId: order.id,
        pickupPointId: point.id,
        status: 'PICKED_UP',
        pickupPointSnapshot: { id: point.id, name: point.name },
        recipientSnapshot: {},
        pickupCodeDigest: 'a'.repeat(64),
        pickupTokenDigest: 'b'.repeat(64),
        pickupCredentialEncrypted: {},
        pickedUpAt: new Date(),
      },
    });

    const wechatApi = {
      postJson: jest.fn().mockResolvedValue({ errcode: 0, errmsg: 'ok' }),
    };
    const service = new WechatShippingOutboxService(db as any, wechatApi as any);

    try {
      await expect(db.$transaction(
        (tx) => service.enqueueForOrderTx(tx, order.id),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )).resolves.toEqual({ enqueued: true });

      const outbox = await db.wechatShippingOutbox.findUniqueOrThrow({
        where: { checkoutSessionId: session.id },
      });
      expect(outbox.status).toBe('PENDING');
      expect(outbox.payload).toMatchObject({
        logistics_type: 4,
        delivery_mode: 1,
        shipping_list: [{ item_desc: '真实数据库海鲜礼盒*1件' }],
      });

      await service.processPendingBatch();

      const processedOutbox = await db.wechatShippingOutbox.findUniqueOrThrow({
        where: { checkoutSessionId: session.id },
      });
      expect(processedOutbox).toMatchObject({
        status: 'SUCCEEDED',
        lastErrorCode: null,
        lastError: null,
      });

      expect(wechatApi.postJson).toHaveBeenCalledWith(
        '/wxa/sec/order/upload_shipping_info',
        expect.objectContaining({
          logistics_type: 4,
          delivery_mode: 1,
          shipping_list: [{ item_desc: '真实数据库海鲜礼盒*1件' }],
        }),
      );
    } finally {
      await db.$transaction(async (tx) => {
        await tx.wechatShippingOutbox.deleteMany({ where: { checkoutSessionId: session.id } });
        await tx.pickupFulfillmentEvent.deleteMany({
          where: { fulfillment: { orderId: order.id } },
        });
        await tx.pickupFulfillment.deleteMany({ where: { orderId: order.id } });
        await tx.orderItem.deleteMany({ where: { orderId: order.id } });
        await tx.order.deleteMany({ where: { id: order.id } });
        await tx.checkoutSession.deleteMany({ where: { id: session.id } });
        await tx.productSKU.deleteMany({ where: { productId: product.id } });
        await tx.product.deleteMany({ where: { id: product.id } });
        await tx.pickupPoint.deleteMany({ where: { id: point.id } });
        await tx.company.deleteMany({ where: { id: company.id } });
        await tx.user.deleteMany({ where: { id: user.id } });
      });
    }
  });

  it('concurrent sibling collections converge to exactly one payment-level outbox', async () => {
    const suffix = randomUUID();
    const user = await db.user.create({ data: {} });
    const company = await db.company.create({
      data: { name: `wechat-pickup-concurrent-${suffix}`, status: 'ACTIVE' },
    });
    const point = await db.pickupPoint.create({
      data: {
        companyId: company.id,
        name: '并发核销测试点',
        contactName: '测试员',
        contactPhone: '13800000000',
        regionCode: '440300',
        regionText: '广东省深圳市',
        detail: '隔离测试地址',
        businessHours: { summary: '09:00-18:00' },
      },
    });
    const product = await db.product.create({
      data: {
        companyId: company.id,
        title: '并发自提商品',
        basePrice: 44,
        status: 'ACTIVE',
        skus: { create: { title: '标准装', price: 44, stock: 2, weightGram: 500 } },
      },
      include: { skus: true },
    });
    const session = await db.checkoutSession.create({
      data: {
        userId: user.id,
        status: 'COMPLETED',
        fulfillmentMode: 'PICKUP',
        itemsSnapshot: [],
        pickupRecipientSnapshot: {},
        pickupSelectionsSnapshot: [],
        expectedTotal: 88,
        goodsAmount: 88,
        shippingFee: 0,
        merchantOrderNo: `WX-PICKUP-CONCURRENT-${suffix}`,
        paymentChannel: 'WECHAT_PAY',
        paymentScene: 'MINI_PROGRAM',
        providerTxnId: `wx-concurrent-${suffix}`,
        miniProgramPayerOpenId: `openid-concurrent-${suffix}`,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        paidAt: new Date(),
      },
    });
    const orders: Array<{ id: string }> = [];
    for (let index = 0; index < 2; index += 1) {
      const order = await db.order.create({
        data: {
          userId: user.id,
          checkoutSessionId: session.id,
          status: 'PAID',
          fulfillmentMode: 'PICKUP',
          totalAmount: 44,
          goodsAmount: 44,
          shippingFee: 0,
          paidAt: new Date(),
          items: {
            create: {
              skuId: product.skus[0].id,
              companyId: company.id,
              unitPrice: 44,
              quantity: 1,
              productSnapshot: { title: `${product.title}${index + 1}` },
            },
          },
        },
      });
      await db.pickupFulfillment.create({
        data: {
          orderId: order.id,
          pickupPointId: point.id,
          status: 'READY',
          pickupPointSnapshot: { id: point.id, name: point.name },
          recipientSnapshot: {},
          pickupCodeDigest: String(index + 1).repeat(64),
          pickupTokenDigest: String(index + 3).repeat(64),
          pickupCredentialEncrypted: {},
          readyAt: new Date(),
        },
      });
      orders.push(order);
    }

    const service = new WechatShippingOutboxService(
      db as any,
      { postJson: jest.fn() } as any,
    );
    const collectWithRetry = async (orderId: string) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db.$transaction(async (tx) => {
            await tx.pickupFulfillment.update({
              where: { orderId },
              data: { status: 'PICKED_UP', pickedUpAt: new Date() },
            });
            await tx.order.update({
              where: { id: orderId },
              data: { status: 'RECEIVED', receivedAt: new Date(), deliveredAt: new Date() },
            });
            return service.enqueueForOrderTx(tx, orderId);
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error: any) {
          if (error?.code === 'P2034' && attempt < 2) continue;
          throw error;
        }
      }
      throw new Error('并发核销重试耗尽');
    };

    try {
      const results = await Promise.all(orders.map((order) => collectWithRetry(order.id)));
      expect(results).toContainEqual({ enqueued: true });
      expect(await db.wechatShippingOutbox.count({
        where: { checkoutSessionId: session.id },
      })).toBe(1);
      const outbox = await db.wechatShippingOutbox.findUniqueOrThrow({
        where: { checkoutSessionId: session.id },
      });
      expect(outbox.payload).toMatchObject({
        logistics_type: 4,
        delivery_mode: 1,
        shipping_list: [{ item_desc: '并发自提商品1*1件，并发自提商品2*1件' }],
      });
    } finally {
      await db.$transaction(async (tx) => {
        await tx.wechatShippingOutbox.deleteMany({ where: { checkoutSessionId: session.id } });
        await tx.pickupFulfillment.deleteMany({ where: { orderId: { in: orders.map((order) => order.id) } } });
        await tx.orderItem.deleteMany({ where: { orderId: { in: orders.map((order) => order.id) } } });
        await tx.order.deleteMany({ where: { id: { in: orders.map((order) => order.id) } } });
        await tx.checkoutSession.deleteMany({ where: { id: session.id } });
        await tx.productSKU.deleteMany({ where: { productId: product.id } });
        await tx.product.deleteMany({ where: { id: product.id } });
        await tx.pickupPoint.deleteMany({ where: { id: point.id } });
        await tx.company.deleteMany({ where: { id: company.id } });
        await tx.user.deleteMany({ where: { id: user.id } });
      });
    }
  }, 30_000);
});
