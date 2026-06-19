import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import { DeliveryProductsService } from './delivery-products.service';

describe('DeliveryProductsService', () => {
  let deliveryPrisma: any;
  let deliveryIdService: { next: jest.Mock };
  let service: DeliveryProductsService;

  beforeEach(() => {
    deliveryPrisma = {
      deliveryProduct: {
        create: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    deliveryIdService = {
      next: jest.fn().mockResolvedValue('PSSP0000000000001'),
    };
    service = new DeliveryProductsService(
      deliveryPrisma as DeliveryPrismaService,
      deliveryIdService as unknown as DeliveryIdService,
    );
  });

  it('creates seller products with a delivery readable id and stores seller-entered prices only', async () => {
    deliveryPrisma.deliveryProduct.create.mockResolvedValue({
      id: 'PSSP0000000000001',
      merchantId: 'merchant_1',
      title: '冷鲜牛腩',
      skus: [
        {
          id: 'sku_1',
          title: '5kg/箱',
          supplyPriceCents: 8800,
          basePriceCents: 10000,
          fixedFinalPriceCents: null,
        },
      ],
    });

    await service.createSellerProduct('merchant_1', 'staff_1', {
      categoryId: 'category_1',
      productUnitId: 'unit_1',
      title: '冷鲜牛腩',
      unitName: '箱',
      skus: [
        {
          title: '5kg/箱',
          supplyPriceCents: 8800,
          basePriceCents: 10000,
          stock: 12,
          weightGram: 5000,
        },
      ],
    });

    expect(deliveryIdService.next).toHaveBeenCalledWith('PSSP');
    expect(deliveryPrisma.deliveryProduct.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'PSSP0000000000001',
        merchantId: 'merchant_1',
        createdByStaffId: 'staff_1',
        title: '冷鲜牛腩',
        unitName: '箱',
        skus: {
          create: [
            expect.objectContaining({
              title: '5kg/箱',
              supplyPriceCents: 8800,
              basePriceCents: 10000,
            }),
          ],
        },
      }),
      include: expect.any(Object),
    });
  });

  it('never leaks final price, markup rate, or margin in seller product responses', async () => {
    deliveryPrisma.deliveryProduct.count.mockResolvedValue(1);
    deliveryPrisma.deliveryProduct.findMany.mockResolvedValue([
      {
        id: 'PSSP0000000000001',
        merchantId: 'merchant_1',
        title: '冷鲜牛腩',
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        unitName: '箱',
        merchant: {
          id: 'merchant_1',
          name: '华南仓',
          defaultMarkupBps: 2800,
        },
        skus: [
          {
            id: 'sku_1',
            title: '5kg/箱',
            supplyPriceCents: 8800,
            basePriceCents: 10000,
            fixedFinalPriceCents: 14500,
            stock: 12,
            isActive: true,
            priceRules: [
              {
                id: 'rule_1',
                markupBps: 4500,
              },
            ],
          },
        ],
      },
    ]);

    const result = await service.listSellerProducts('merchant_1');

    expect(result).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].skus[0]).toMatchObject({
      id: 'sku_1',
      supplyPriceCents: 8800,
      stock: 12,
    });
    expect(result.items[0].skus[0]).not.toHaveProperty('basePriceCents');
    expect(result.items[0].skus[0]).not.toHaveProperty('fixedFinalPriceCents');
    expect(result.items[0].skus[0]).not.toHaveProperty('finalPriceCents');
    expect(result.items[0].skus[0]).not.toHaveProperty('markupBps');
    expect(result.items[0].skus[0]).not.toHaveProperty('marginCents');
  });

  it('ignores query merchantId when listing seller-owned products', async () => {
    deliveryPrisma.deliveryProduct.count.mockResolvedValue(0);
    deliveryPrisma.deliveryProduct.findMany.mockResolvedValue([]);

    await service.listSellerProducts('merchant_1', { merchantId: 'merchant_2' });

    expect(deliveryPrisma.deliveryProduct.count).toHaveBeenCalledWith({
      where: {
        merchantId: 'merchant_1',
      },
    });
    expect(deliveryPrisma.deliveryProduct.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          merchantId: 'merchant_1',
        },
      }),
    );
  });

  it('loads a seller-owned product by id with only seller-visible fields', async () => {
    deliveryPrisma.deliveryProduct.findFirst = jest.fn().mockResolvedValue({
      id: 'PSSP0000000000001',
      merchantId: 'merchant_1',
      title: '冷鲜牛腩',
      subtitle: '现切',
      description: '仅供冷链配送',
      status: 'DRAFT',
      auditStatus: 'PENDING',
      auditNote: null,
      submissionCount: 1,
      unitName: '箱',
      minOrderQuantity: 1,
      orderStepQuantity: 1,
      createdAt: new Date('2026-06-19T10:00:00Z'),
      updatedAt: new Date('2026-06-19T11:00:00Z'),
      category: { id: 'cat_1', name: '牛肉', status: 'ACTIVE' },
      productUnit: { id: 'unit_1', name: '箱' },
      skus: [
        {
          id: 'sku_1',
          title: '5kg/箱',
          imageUrl: null,
          supplyPriceCents: 8800,
          basePriceCents: 10000,
          stock: 12,
          minOrderQuantity: 1,
          orderStepQuantity: 1,
          weightGram: 5000,
          isActive: true,
          createdAt: new Date('2026-06-19T10:00:00Z'),
          updatedAt: new Date('2026-06-19T11:00:00Z'),
        },
      ],
    });

    await expect(
      service.getSellerProduct('merchant_1', 'PSSP0000000000001'),
    ).resolves.toMatchObject({
      id: 'PSSP0000000000001',
      merchantId: 'merchant_1',
      title: '冷鲜牛腩',
      skus: [
        {
          id: 'sku_1',
          supplyPriceCents: 8800,
          stock: 12,
        },
      ],
    });

    const result = await service.getSellerProduct('merchant_1', 'PSSP0000000000001');
    expect(result.skus[0]).not.toHaveProperty('basePriceCents');
  });

  it('submitting a seller product re-enters audit and uses a serializable transaction', async () => {
    const tx = {
      deliveryProduct: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'PSSP0000000000001',
            merchantId: 'merchant_1',
            status: 'DRAFT',
            auditStatus: 'REJECTED',
            submissionCount: 2,
            skus: [{ id: 'sku_1' }],
          })
          .mockResolvedValueOnce({
            id: 'PSSP0000000000001',
            merchantId: 'merchant_1',
            title: '冷鲜牛腩',
            status: 'ACTIVE',
            auditStatus: 'PENDING',
            submissionCount: 3,
            auditNote: null,
            subtitle: null,
            description: null,
            unitName: '箱',
            minOrderQuantity: 1,
            orderStepQuantity: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            category: null,
            productUnit: null,
            skus: [],
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    deliveryPrisma.$transaction = jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    );

    await expect(service.submitSellerProduct('merchant_1', 'PSSP0000000000001')).resolves.toMatchObject({
      status: 'ACTIVE',
      auditStatus: 'PENDING',
      submissionCount: 3,
    });

    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('does not allow product PATCH to mutate stock for existing skus', async () => {
    deliveryPrisma.deliveryProduct.findUnique.mockResolvedValue({
      id: 'PSSP0000000000001',
    });
    deliveryPrisma.deliveryProduct.update.mockResolvedValue({
      id: 'PSSP0000000000001',
      merchantId: 'merchant_1',
      title: '冷鲜牛腩',
      status: 'DRAFT',
      auditStatus: 'PENDING',
      unitName: '箱',
      category: null,
      productUnit: null,
      skus: [
        {
          id: 'sku_1',
          title: '5kg/箱',
          supplyPriceCents: 8800,
          basePriceCents: 10000,
          stock: 12,
          isActive: true,
        },
      ],
    });

    await service.updateAdminProduct('PSSP0000000000001', {
      skus: [
        {
          id: 'sku_1',
          title: '新标题',
          stock: 99,
        },
      ],
    });

    expect(deliveryPrisma.deliveryProduct.update).toHaveBeenCalledWith({
      where: { id: 'PSSP0000000000001' },
      data: expect.objectContaining({
        skus: {
          update: [
            {
              where: { id: 'sku_1' },
              data: {
                title: '新标题',
              },
            },
          ],
        },
      }),
      include: expect.any(Object),
    });
  });
});
