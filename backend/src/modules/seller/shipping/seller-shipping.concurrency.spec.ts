import { PrismaService } from '../../../prisma/prisma.service';
import { SellerShippingService } from './seller-shipping.service';

const hasRealDatabaseUrl =
  process.env.RUN_DB_CONCURRENCY_TESTS === '1' &&
  !!process.env.DATABASE_URL &&
  /(?:test|nongmai_test)/i.test(process.env.DATABASE_URL);
const describeDb = hasRealDatabaseUrl ? describe : describe.skip;

describeDb('SellerShippingService DB concurrency', () => {
  let prisma: PrismaService;
  const createdPrefixes: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  afterEach(async () => {
    for (const prefix of createdPrefixes.splice(0)) {
      await prisma.shipment.deleteMany({ where: { orderId: `${prefix}_order` } });
      await prisma.orderItem.deleteMany({ where: { orderId: `${prefix}_order` } });
      await prisma.order.deleteMany({ where: { id: `${prefix}_order` } });
      await prisma.productSKU.deleteMany({ where: { id: `${prefix}_sku` } });
      await prisma.product.deleteMany({ where: { id: `${prefix}_product` } });
      await prisma.company.deleteMany({ where: { id: `${prefix}_company` } });
      await prisma.user.deleteMany({ where: { id: `${prefix}_user` } });
    }
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  it('only one concurrent request acquires the local lease and calls the carrier', async () => {
    const prefix = `waybill_concurrent_${Date.now()}`;
    createdPrefixes.push(prefix);
    const companyId = `${prefix}_company`;
    const userId = `${prefix}_user`;
    const productId = `${prefix}_product`;
    const skuId = `${prefix}_sku`;
    const orderId = `${prefix}_order`;

    await prisma.user.create({ data: { id: userId } });
    await prisma.company.create({
      data: {
        id: companyId,
        name: '面单并发测试企业',
        status: 'ACTIVE',
        servicePhone: '13800001001',
        contact: { name: '测试发件人', phone: '13800001001' },
        address: {
          province: '广东省',
          city: '深圳市',
          district: '南山区',
          detail: '科技园 1 号',
          text: '广东省深圳市南山区科技园 1 号',
        },
      },
    });
    await prisma.product.create({
      data: {
        id: productId,
        companyId,
        title: '面单并发测试商品',
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        basePrice: 18,
      },
    });
    await prisma.productSKU.create({
      data: {
        id: skuId,
        productId,
        title: '默认规格',
        price: 18,
        cost: 10,
        stock: 10,
        weightGram: 500,
      },
    });
    await prisma.order.create({
      data: {
        id: orderId,
        userId,
        status: 'PAID',
        totalAmount: 18,
        goodsAmount: 18,
        paidAt: new Date(),
        addressSnapshot: {
          receiverName: '测试收件人',
          phone: '13800001002',
          province: '广东省',
          city: '深圳市',
          district: '福田区',
          detail: '测试路 2 号',
        },
        items: {
          create: {
            id: `${prefix}_item`,
            skuId,
            companyId,
            unitPrice: 18,
            quantity: 1,
            productSnapshot: { title: '面单并发测试商品' },
          },
        },
      },
    });

    const sfExpress = {
      createOrder: jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          waybillNo: 'SF1234567890',
          sfOrderId: 'sf-order-concurrent-1',
        };
      }),
      printWaybill: jest.fn().mockRejectedValue(new Error('test print disabled')),
      cancelOrder: jest.fn().mockResolvedValue({ success: true }),
    };
    const service = new SellerShippingService(
      prisma,
      {
        get: (_key: string, fallback: unknown) => fallback,
        getOrThrow: () => 'test-seller-secret',
      } as any,
      { assertFeatureAllowed: jest.fn() } as any,
      sfExpress as any,
      { uploadBuffer: jest.fn() } as any,
      { recordPackage: jest.fn().mockResolvedValue({ id: 'cost-1' }) } as any,
      { emit: jest.fn().mockResolvedValue({ id: 'outbox-1' }) } as any,
    );

    const results = await Promise.allSettled([
      service.generateWaybill(companyId, 'staff-1', orderId, 'SF'),
      service.generateWaybill(companyId, 'staff-1', orderId, 'SF'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(sfExpress.createOrder).toHaveBeenCalledTimes(1);
    await expect(prisma.shipment.findUnique({
      where: { orderId_companyId: { orderId, companyId } },
    })).resolves.toEqual(expect.objectContaining({
      waybillNo: 'SF1234567890',
      sfOrderId: 'sf-order-concurrent-1',
    }));
  });
});
