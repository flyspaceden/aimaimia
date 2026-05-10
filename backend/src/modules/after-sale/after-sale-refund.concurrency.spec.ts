import { AfterSaleOperatorType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AfterSaleRefundService } from './after-sale-refund.service';
import { AfterSaleShippingPaymentService } from './after-sale-shipping-payment.service';
import { AfterSaleStatusHistoryService } from './after-sale-status-history.service';

const hasRealDatabaseUrl =
  process.env.RUN_DB_CONCURRENCY_TESTS === '1' &&
  !!process.env.DATABASE_URL &&
  !process.env.DATABASE_URL.includes('user:pass') &&
  /(?:test|nongmai_test)/i.test(process.env.DATABASE_URL);

// DB-backed concurrency coverage. Skipped unless explicitly enabled against a test database.
const describeDb = hasRealDatabaseUrl ? describe : describe.skip;

describeDb('AfterSaleRefundService DB concurrency', () => {
  let prisma: PrismaService;
  let service: AfterSaleRefundService;
  let paymentService: { initiateRefund: jest.Mock };
  const createdPrefixes: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    paymentService = {
      initiateRefund: jest.fn().mockResolvedValue({
        success: true,
        providerRefundId: 'provider_as_concurrent',
        message: 'OK',
      }),
    };
    const rewardService = {
      voidRewardsForOrder: jest.fn().mockResolvedValue(undefined),
      checkAndMarkOrderRefunded: jest.fn().mockResolvedValue(undefined),
    };
    const inboxService = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    service = new AfterSaleRefundService(
      prisma,
      paymentService as any,
      rewardService as any,
      new AfterSaleStatusHistoryService(),
      inboxService as any,
    );
  });

  afterEach(async () => {
    for (const prefix of createdPrefixes.splice(0)) {
      await cleanupSeedData(prisma, prefix);
    }
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  it('creates one refund when startRefund is called concurrently for the same afterSaleId', async () => {
    const prefix = `as_concurrent_${Date.now()}`;
    createdPrefixes.push(prefix);
    const afterSale = await seedRefundableAfterSale(prisma, { id: prefix });

    await Promise.all(
      Array.from({ length: 5 }, () =>
        service.startRefund(afterSale.id, { type: AfterSaleOperatorType.SYSTEM }),
      ),
    );

    const refunds = await prisma.refund.findMany({
      where: { merchantRefundNo: `AS-${afterSale.id}` },
    });
    expect(refunds).toHaveLength(1);
    expect(paymentService.initiateRefund).toHaveBeenCalledTimes(1);
  });

  it('creates one buyer return shipping payment when called concurrently for the same afterSaleId', async () => {
    const prefix = `as_ship_pay_concurrent_${Date.now()}`;
    createdPrefixes.push(prefix);
    const afterSale = await seedBuyerPaidReturnShippingAfterSale(prisma, { id: prefix });
    const shippingPaymentService = new AfterSaleShippingPaymentService(prisma);

    await Promise.all(
      Array.from({ length: 5 }, () =>
        shippingPaymentService.createOrGetPayment(afterSale.id),
      ),
    );

    const payments = await prisma.afterSaleShippingPayment.findMany({
      where: { merchantPaymentNo: `AS_SHIP_PAY_${afterSale.id}` },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toEqual(expect.objectContaining({
      afterSaleId: afterSale.id,
      amount: 12.34,
      status: 'UNPAID',
    }));
  });
});

async function seedRefundableAfterSale(
  prisma: PrismaService,
  input: { id: string },
) {
  const userId = `${input.id}_user`;
  const companyId = `${input.id}_company`;
  const productId = `${input.id}_product`;
  const skuId = `${input.id}_sku`;
  const orderId = `${input.id}_order`;
  const orderItemId = `${input.id}_item`;

  await prisma.user.create({ data: { id: userId } });
  await prisma.company.create({
    data: {
      id: companyId,
      name: '并发测试企业',
      status: 'ACTIVE',
    },
  });
  await prisma.product.create({
    data: {
      id: productId,
      companyId,
      title: '并发测试商品',
      status: 'ACTIVE',
      auditStatus: 'APPROVED',
      basePrice: 88,
    },
  });
  await prisma.productSKU.create({
    data: {
      id: skuId,
      productId,
      skuCode: `${input.id}_sku_code`,
      title: '默认规格',
      price: 88,
      cost: 60,
      stock: 10,
      status: 'ACTIVE',
    },
  });
  await prisma.order.create({
    data: {
      id: orderId,
      userId,
      status: 'DELIVERED',
      goodsAmount: 88,
      totalAmount: 88,
      shippingFee: 0,
      deliveredAt: new Date(),
    },
  });
  await prisma.orderItem.create({
    data: {
      id: orderItemId,
      orderId,
      skuId,
      unitPrice: 88,
      quantity: 1,
      companyId,
      productSnapshot: { title: '并发测试商品' },
    },
  });

  return prisma.afterSaleRequest.create({
    data: {
      id: input.id,
      orderId,
      userId,
      orderItemId,
      afterSaleType: 'QUALITY_RETURN',
      reason: '质量问题',
      photos: ['https://example.test/p.jpg'],
      status: 'RECEIVED_BY_SELLER',
      requiresReturn: true,
      refundAmount: 88,
    },
  });
}

async function seedBuyerPaidReturnShippingAfterSale(
  prisma: PrismaService,
  input: { id: string },
) {
  const userId = `${input.id}_user`;
  const companyId = `${input.id}_company`;
  const productId = `${input.id}_product`;
  const skuId = `${input.id}_sku`;
  const orderId = `${input.id}_order`;
  const orderItemId = `${input.id}_item`;

  await prisma.user.create({ data: { id: userId } });
  await prisma.company.create({
    data: {
      id: companyId,
      name: '并发测试企业',
      status: 'ACTIVE',
    },
  });
  await prisma.product.create({
    data: {
      id: productId,
      companyId,
      title: '并发测试商品',
      status: 'ACTIVE',
      auditStatus: 'APPROVED',
      basePrice: 88,
    },
  });
  await prisma.productSKU.create({
    data: {
      id: skuId,
      productId,
      skuCode: `${input.id}_sku_code`,
      title: '默认规格',
      price: 88,
      cost: 60,
      stock: 10,
      status: 'ACTIVE',
    },
  });
  await prisma.order.create({
    data: {
      id: orderId,
      userId,
      status: 'DELIVERED',
      goodsAmount: 88,
      totalAmount: 88,
      shippingFee: 0,
      deliveredAt: new Date(),
    },
  });
  await prisma.orderItem.create({
    data: {
      id: orderItemId,
      orderId,
      skuId,
      unitPrice: 88,
      quantity: 1,
      companyId,
      productSnapshot: { title: '并发测试商品' },
    },
  });

  return prisma.afterSaleRequest.create({
    data: {
      id: input.id,
      orderId,
      userId,
      orderItemId,
      afterSaleType: 'NO_REASON_EXCHANGE',
      reason: '七天无理由换货',
      photos: ['https://example.test/p.jpg'],
      status: 'APPROVED',
      requiresReturn: true,
      refundAmount: 88,
      approvedAt: new Date(),
      returnShippingPayer: 'BUYER',
      returnShippingFee: 12.34,
      returnShippingFeeDeducted: false,
    },
  });
}

async function cleanupSeedData(prisma: PrismaService, prefix: string) {
  const refunds = await prisma.refund.findMany({
    where: { merchantRefundNo: { startsWith: `AS-${prefix}` } },
    select: { id: true },
  });
  const refundIds = refunds.map((refund) => refund.id);

  if (refundIds.length > 0) {
    await prisma.refundStatusHistory.deleteMany({
      where: { refundId: { in: refundIds } },
    });
  }
  await prisma.refund.deleteMany({
    where: { merchantRefundNo: { startsWith: `AS-${prefix}` } },
  });
  await prisma.afterSaleShippingPayment.deleteMany({
    where: { afterSaleId: { startsWith: prefix } },
  });
  await prisma.afterSaleStatusHistory.deleteMany({
    where: { afterSaleId: { startsWith: prefix } },
  });
  await prisma.afterSaleRequest.deleteMany({
    where: { id: { startsWith: prefix } },
  });
  await prisma.orderItem.deleteMany({
    where: { orderId: { startsWith: prefix } },
  });
  await prisma.orderStatusHistory.deleteMany({
    where: { orderId: { startsWith: prefix } },
  });
  await prisma.order.deleteMany({
    where: { id: { startsWith: prefix } },
  });
  await prisma.productSKU.deleteMany({
    where: { productId: { startsWith: prefix } },
  });
  await prisma.product.deleteMany({
    where: { id: { startsWith: prefix } },
  });
  await prisma.company.deleteMany({
    where: { id: { startsWith: prefix } },
  });
  await prisma.user.deleteMany({
    where: { id: { startsWith: prefix } },
  });
}
