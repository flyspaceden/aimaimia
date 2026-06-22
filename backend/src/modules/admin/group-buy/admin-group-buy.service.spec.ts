import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PLATFORM_COMPANY_ID } from '../../bonus/engine/constants';
import { AdminGroupBuyService } from './admin-group-buy.service';

describe('AdminGroupBuyService', () => {
  const serializableOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  };

  const createDto = {
    title: '大龙虾团购',
    productId: 'product_1',
    skuId: 'sku_1',
    price: 1000,
    freeShipping: true,
    status: 'ACTIVE',
    displayOrder: 10,
    tiers: [
      { sequence: 1, basisPoints: 1000, label: '第一位好友' },
      { sequence: 2, basisPoints: 2000, label: '第二位好友' },
      { sequence: 3, basisPoints: 7000, label: '第三位好友' },
    ],
  };

  const buildPrisma = () => {
    const tx = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product_1',
          companyId: PLATFORM_COMPANY_ID,
          status: 'ACTIVE',
        }),
      },
      productSKU: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sku_1',
          productId: 'product_1',
          status: 'ACTIVE',
        }),
      },
      groupBuyActivity: {
        create: jest.fn().mockResolvedValue({ id: 'activity_1' }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'activity_1',
          productId: 'product_1',
          skuId: 'sku_1',
          startAt: null,
          endAt: null,
          deletedAt: null,
          tiers: [],
        }),
        update: jest.fn().mockResolvedValue({ id: 'activity_1' }),
      },
      groupBuyTier: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      groupBuyInstance: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const prisma = {
      $transaction: jest.fn((fn) => fn(tx)),
      groupBuyActivity: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    return { prisma, tx, service: new AdminGroupBuyService(prisma as any) };
  };

  it('creates an activity with tiers inside a Serializable transaction', async () => {
    const { prisma, tx, service } = buildPrisma();

    await service.create(createDto as any);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), serializableOptions);
    expect(tx.groupBuyActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: '大龙虾团购',
        productId: 'product_1',
        skuId: 'sku_1',
        price: 1000,
        freeShipping: true,
        status: 'ACTIVE',
        tiers: expect.objectContaining({
          create: expect.arrayContaining([
            expect.objectContaining({ sequence: 1, basisPoints: 1000 }),
            expect.objectContaining({ sequence: 3, basisPoints: 7000 }),
          ]),
        }),
      }),
    }));
  });

  it('rejects non-platform products before writing', async () => {
    const { tx, service } = buildPrisma();
    tx.product.findUnique.mockResolvedValueOnce({
      id: 'product_1',
      companyId: 'merchant_company',
      status: 'ACTIVE',
    });

    await expect(service.create(createDto as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.groupBuyActivity.create).not.toHaveBeenCalled();
  });

  it('rejects tier totals other than 10000 basis points', async () => {
    const { tx, service } = buildPrisma();

    await expect(service.create({
      ...createDto,
      tiers: [
        { sequence: 1, basisPoints: 1000 },
        { sequence: 2, basisPoints: 2000 },
        { sequence: 3, basisPoints: 8000 },
      ],
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.groupBuyActivity.create).not.toHaveBeenCalled();
  });

  it('updates activity price and tiers without mutating existing instances', async () => {
    const { tx, service } = buildPrisma();

    await service.update('activity_1', {
      price: 1200,
      tiers: [
        { sequence: 1, basisPoints: 5000 },
        { sequence: 2, basisPoints: 5000 },
      ],
    } as any);

    expect(tx.groupBuyTier.deleteMany).toHaveBeenCalledWith({ where: { activityId: 'activity_1' } });
    expect(tx.groupBuyTier.createMany).toHaveBeenCalledWith({
      data: [
        { activityId: 'activity_1', sequence: 1, basisPoints: 5000, label: null },
        { activityId: 'activity_1', sequence: 2, basisPoints: 5000, label: null },
      ],
    });
    expect(tx.groupBuyActivity.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'activity_1' },
      data: expect.objectContaining({ price: 1200 }),
    }));
    expect(tx.groupBuyInstance.updateMany).not.toHaveBeenCalled();
  });

  it('can pause and end an activity without deleting it', async () => {
    const { tx, service } = buildPrisma();

    await service.updateStatus('activity_1', 'PAUSED' as any);
    await service.updateStatus('activity_1', 'ENDED' as any);

    expect(tx.groupBuyActivity.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'activity_1' },
      data: expect.objectContaining({ status: 'PAUSED' }),
    }));
    expect(tx.groupBuyActivity.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'activity_1' },
      data: expect.objectContaining({ status: 'ENDED' }),
    }));
  });
});
