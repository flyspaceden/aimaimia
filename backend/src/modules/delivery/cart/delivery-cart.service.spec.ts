import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryPricingService } from '../pricing/delivery-pricing.service';
import { DeliveryCartService } from './delivery-cart.service';

describe('DeliveryCartService', () => {
  let tx: any;
  let deliveryPrisma: any;
  let pricingService: { resolvePrice: jest.Mock };
  let service: DeliveryCartService;

  beforeEach(() => {
    tx = {
      deliveryUser: {
        findUnique: jest.fn(),
      },
      deliveryCartItem: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      deliveryProductSku: {
        findUnique: jest.fn(),
      },
      deliveryPriceRule: {
        findMany: jest.fn(),
      },
    };
    deliveryPrisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      deliveryUser: {
        findUnique: jest.fn(),
      },
      deliveryCartItem: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      deliveryProductSku: {
        findUnique: jest.fn(),
      },
      deliveryPriceRule: {
        findMany: jest.fn(),
      },
    };
    pricingService = {
      resolvePrice: jest.fn().mockReturnValue({
        finalPriceCents: 12600,
        matchedSource: 'MERCHANT_DEFAULT_MARKUP',
        matchedRuleId: null,
        appliedMarkupBps: 2600,
      }),
    };

    service = new DeliveryCartService(
      deliveryPrisma as DeliveryPrismaService,
      pricingService as unknown as DeliveryPricingService,
    );
  });

  it('rejects cart access when the delivery buyer has not selected a current unit', async () => {
    deliveryPrisma.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      currentUnitId: null,
    });

    await expect(service.getCart('PSYH0000000000001')).rejects.toBeInstanceOf(BadRequestException);
    expect(deliveryPrisma.deliveryCartItem.findMany).not.toHaveBeenCalled();
  });

  it('lists only current-unit cart items and resolves buyer prices in cents', async () => {
    deliveryPrisma.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      currentUnitId: 'unit_1',
    });
    deliveryPrisma.deliveryCartItem.findMany.mockResolvedValue([
      {
        id: 'cart_1',
        userId: 'PSYH0000000000001',
        unitId: 'unit_1',
        skuId: 'sku_1',
        quantity: 2,
        isSelected: true,
        sku: {
          id: 'sku_1',
          title: '5kg/箱',
          imageUrl: null,
          basePriceCents: 10000,
          stock: 30,
          minOrderQuantity: 2,
          orderStepQuantity: 2,
          weightGram: 400,
          isActive: true,
          fixedFinalPriceCents: null,
          priceRules: [],
          product: {
            id: 'PSSP0000000000001',
            title: '冷鲜牛腩',
            unitName: '箱',
            minOrderQuantity: 1,
            orderStepQuantity: 1,
            status: 'ACTIVE',
            auditStatus: 'APPROVED',
            priceRules: [],
            merchant: {
              id: 'PSSJ0000000000001',
              name: '华南仓',
              defaultMarkupBps: 2600,
              status: 'ACTIVE',
            },
          },
        },
      },
    ]);
    deliveryPrisma.deliveryPriceRule.findMany.mockResolvedValue([]);

    const result = await service.getCart('PSYH0000000000001');

    expect(deliveryPrisma.deliveryCartItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'PSYH0000000000001',
          unitId: 'unit_1',
        },
      }),
    );
    expect(pricingService.resolvePrice).toHaveBeenCalledWith(
      expect.objectContaining({
        basePriceCents: 10000,
        quantity: 2,
        merchantDefaultMarkupBps: 2600,
      }),
    );
    expect(result).toMatchObject({
      currentUnitId: 'unit_1',
      items: [
        {
          id: 'cart_1',
          quantity: 2,
          finalPriceCents: 12600,
          lineAmountCents: 25200,
        },
      ],
      summary: {
        selectedGoodsAmountCents: 25200,
      },
    });
  });

  it('rejects add quantity that violates sku or product ordering rules', async () => {
    deliveryPrisma.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      currentUnitId: 'unit_1',
    });
    deliveryPrisma.deliveryProductSku.findUnique.mockResolvedValue({
      id: 'sku_1',
      stock: 20,
      minOrderQuantity: 4,
      orderStepQuantity: 2,
      isActive: true,
      product: {
        id: 'PSSP0000000000001',
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        minOrderQuantity: 1,
        orderStepQuantity: 1,
        merchant: {
          id: 'PSSJ0000000000001',
          status: 'ACTIVE',
        },
      },
    });

    await expect(
      service.addItem('PSYH0000000000001', {
        skuId: 'sku_1',
        quantity: 3,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deliveryPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects adding inactive delivery merchandise or quantities above stock', async () => {
    deliveryPrisma.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      currentUnitId: 'unit_1',
    });
    deliveryPrisma.deliveryProductSku.findUnique
      .mockResolvedValueOnce({
        id: 'sku_1',
        stock: 20,
        minOrderQuantity: 1,
        orderStepQuantity: 1,
        isActive: true,
        product: {
          id: 'PSSP0000000000001',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          minOrderQuantity: 1,
          orderStepQuantity: 1,
          merchant: {
            id: 'PSSJ0000000000001',
            status: 'SUSPENDED',
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'sku_2',
        stock: 1,
        minOrderQuantity: 1,
        orderStepQuantity: 1,
        isActive: true,
        product: {
          id: 'PSSP0000000000002',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          minOrderQuantity: 1,
          orderStepQuantity: 1,
          merchant: {
            id: 'PSSJ0000000000002',
            status: 'ACTIVE',
          },
        },
      });

    await expect(
      service.addItem('PSYH0000000000001', {
        skuId: 'sku_1',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.addItem('PSYH0000000000001', {
        skuId: 'sku_2',
        quantity: 2,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates only cart items in the current delivery unit and enforces stock', async () => {
    deliveryPrisma.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      currentUnitId: 'unit_1',
    });
    deliveryPrisma.deliveryCartItem.findUnique
      .mockResolvedValueOnce({
        id: 'cart_1',
        userId: 'PSYH0000000000001',
        unitId: 'unit_2',
        skuId: 'sku_1',
      })
      .mockResolvedValueOnce({
        id: 'cart_2',
        userId: 'PSYH0000000000001',
        unitId: 'unit_1',
        skuId: 'sku_2',
        quantity: 1,
        sku: {
          id: 'sku_2',
          stock: 3,
          minOrderQuantity: 1,
          orderStepQuantity: 1,
          isActive: true,
          product: {
            id: 'PSSP0000000000002',
            status: 'ACTIVE',
            auditStatus: 'APPROVED',
            minOrderQuantity: 1,
            orderStepQuantity: 1,
            merchant: {
              id: 'PSSJ0000000000002',
              status: 'ACTIVE',
            },
          },
        },
      });

    await expect(
      service.updateItem('PSYH0000000000001', 'cart_1', {
        quantity: 2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.updateItem('PSYH0000000000001', 'cart_2', {
        quantity: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes cart mutations in Serializable transactions', async () => {
    deliveryPrisma.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      currentUnitId: 'unit_1',
    });
    deliveryPrisma.deliveryProductSku.findUnique.mockResolvedValue({
      id: 'sku_1',
      stock: 20,
      minOrderQuantity: 1,
      orderStepQuantity: 1,
      isActive: true,
      product: {
        id: 'PSSP0000000000001',
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        minOrderQuantity: 1,
        orderStepQuantity: 1,
        merchant: {
          id: 'PSSJ0000000000001',
          status: 'ACTIVE',
        },
      },
    });
    tx.deliveryCartItem.findUnique.mockResolvedValue(null);
    tx.deliveryCartItem.create.mockResolvedValue({
      id: 'cart_1',
      skuId: 'sku_1',
      quantity: 1,
    });
    tx.deliveryProductSku.findUnique.mockResolvedValue({
      id: 'sku_1',
      stock: 20,
      minOrderQuantity: 1,
      orderStepQuantity: 1,
      isActive: true,
      product: {
        id: 'PSSP0000000000001',
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        minOrderQuantity: 1,
        orderStepQuantity: 1,
        merchant: {
          id: 'PSSJ0000000000001',
          status: 'ACTIVE',
        },
      },
    });

    await service.addItem('PSYH0000000000001', {
      skuId: 'sku_1',
      quantity: 1,
    });

    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });
});
