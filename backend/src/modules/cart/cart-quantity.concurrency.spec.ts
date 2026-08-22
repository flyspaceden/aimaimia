import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from './cart.service';

const hasRealDatabaseUrl =
  process.env.RUN_DB_CONCURRENCY_TESTS === '1'
  && !!process.env.DATABASE_URL
  && /(?:test|nongmai_test|aimaimai_test)/i.test(process.env.DATABASE_URL);
const describeDb = hasRealDatabaseUrl ? describe : describe.skip;

describeDb('CartService quantity DB concurrency', () => {
  let prisma: PrismaService;
  let service: CartService;
  const prefixes: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new CartService(
      prisma,
      { get: (key: string) => (key === 'NODE_ENV' ? 'test' : undefined) } as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(async () => {
    for (const prefix of prefixes.splice(0)) {
      await prisma.cart.deleteMany({ where: { id: `${prefix}_cart` } });
      await prisma.productSKU.deleteMany({ where: { id: { startsWith: `${prefix}_sku_` } } });
      await prisma.product.deleteMany({ where: { id: { startsWith: `${prefix}_product_` } } });
      await prisma.company.deleteMany({ where: { id: `${prefix}_company` } });
      await prisma.user.deleteMany({ where: { id: `${prefix}_user` } });
    }
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  it('updates two cart rows concurrently without crossing quantities', async () => {
    const prefix = `cart_quantity_${Date.now()}`;
    prefixes.push(prefix);
    const userId = `${prefix}_user`;
    const companyId = `${prefix}_company`;
    const cartId = `${prefix}_cart`;
    const itemAId = `${prefix}_item_a`;
    const itemBId = `${prefix}_item_b`;

    await prisma.user.create({ data: { id: userId } });
    await prisma.company.create({
      data: { id: companyId, name: '购物车并发测试企业', status: 'ACTIVE' },
    });
    for (const suffix of ['a', 'b']) {
      await prisma.product.create({
        data: {
          id: `${prefix}_product_${suffix}`,
          companyId,
          title: `购物车并发商品 ${suffix}`,
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          basePrice: suffix === 'a' ? 10 : 20,
        },
      });
      await prisma.productSKU.create({
        data: {
          id: `${prefix}_sku_${suffix}`,
          productId: `${prefix}_product_${suffix}`,
          title: '默认规格',
          price: suffix === 'a' ? 10 : 20,
          cost: 5,
          stock: 20,
          weightGram: 500,
        },
      });
    }
    await prisma.cart.create({
      data: {
        id: cartId,
        userId,
        items: {
          create: [
            { id: itemAId, skuId: `${prefix}_sku_a`, quantity: 1 },
            { id: itemBId, skuId: `${prefix}_sku_b`, quantity: 2 },
          ],
        },
      },
    });

    const acknowledgements = await Promise.all([
      service.updateItemQuantityById(userId, itemAId, 4),
      service.updateItemQuantityById(userId, itemBId, 3),
    ]);

    expect(acknowledgements).toEqual(expect.arrayContaining([
      { cartItemId: itemAId, skuId: `${prefix}_sku_a`, quantity: 4 },
      { cartItemId: itemBId, skuId: `${prefix}_sku_b`, quantity: 3 },
    ]));
    await expect(prisma.cartItem.findMany({
      where: { cartId },
      orderBy: { id: 'asc' },
      select: { id: true, quantity: true },
    })).resolves.toEqual([
      { id: itemAId, quantity: 4 },
      { id: itemBId, quantity: 3 },
    ]);
  });
});
