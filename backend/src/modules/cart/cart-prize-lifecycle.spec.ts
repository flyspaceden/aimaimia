import { BadRequestException } from '@nestjs/common';
import { CartService } from './cart.service';
import { claimTokenHash, generateClaimToken } from '../../common/utils/claim-token.util';

describe('CartService prize lifecycle guards', () => {
  function createService(prismaOverrides: any = {}, redisOverrides: any = {}) {
    const prisma: any = {
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
      cartItem: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      productSKU: { findUnique: jest.fn() },
      lotteryPrize: { findUnique: jest.fn() },
      lotteryRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'lr-created' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      ...prismaOverrides,
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const config: any = { get: jest.fn((key: string) => key === 'NODE_ENV' ? 'test' : undefined) };
    const redisCoord: any = {
      acquireLock: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      releaseLock: jest.fn(),
      ...redisOverrides,
    };
    const bonusConfig: any = {
      getSystemConfig: jest.fn().mockResolvedValue({ lotteryDailyChances: 1 }),
    };
    const service = new CartService(prisma, config, redisCoord, bonusConfig);
    jest.spyOn(service, 'getCart').mockResolvedValue({ id: 'cart1', items: [] } as any);
    return { service, prisma, redisCoord };
  }

  function todayDateUTC8(): string {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  it('allows deleting locked prize when SKU is inactive and expires its lottery record', async () => {
    const { service, prisma } = createService();
    prisma.cartItem.findFirst.mockResolvedValue({
      id: 'ci-prize',
      cartId: 'cart1',
      skuId: 'sku1',
      isPrize: true,
      isLocked: true,
      threshold: 100,
      prizeRecordId: 'lr1',
      sku: {
        id: 'sku1',
        status: 'INACTIVE',
        product: { id: 'p1', status: 'ACTIVE' },
      },
    });

    await service.removePrizeItem('user1', 'ci-prize');

    expect(prisma.cartItem.delete).toHaveBeenCalledWith({ where: { id: 'ci-prize' } });
    expect(prisma.lotteryRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'lr1', status: { in: ['WON', 'IN_CART'] } },
      data: { status: 'EXPIRED' },
    });
  });

  it('allows deleting locked orphaned prize cart item when LotteryRecord is missing', async () => {
    const { service, prisma } = createService();
    prisma.cartItem.findFirst.mockResolvedValue({
      id: 'ci-orphan-prize',
      cartId: 'cart1',
      skuId: 'sku1',
      isPrize: true,
      isLocked: true,
      threshold: 100,
      prizeRecordId: 'missing-lr',
      sku: {
        id: 'sku1',
        status: 'ACTIVE',
        product: { id: 'p1', status: 'ACTIVE' },
      },
    });
    prisma.cartItem.findMany.mockResolvedValue([]);
    prisma.lotteryRecord.findUnique.mockResolvedValue(null);

    await service.removePrizeItem('user1', 'ci-orphan-prize');

    expect(prisma.cartItem.delete).toHaveBeenCalledWith({ where: { id: 'ci-orphan-prize' } });
    expect(prisma.lotteryRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'missing-lr', status: { in: ['WON', 'IN_CART'] } },
      data: { status: 'EXPIRED' },
    });
  });

  it('allows deleting locked prize cart item when LotteryRecord exists but prize relation is missing', async () => {
    const { service, prisma } = createService();
    prisma.cartItem.findFirst.mockResolvedValue({
      id: 'ci-missing-prize',
      cartId: 'cart1',
      skuId: 'sku1',
      isPrize: true,
      isLocked: true,
      threshold: 100,
      prizeRecordId: 'lr-missing-prize',
      sku: {
        id: 'sku1',
        status: 'ACTIVE',
        product: { id: 'p1', status: 'ACTIVE' },
      },
    });
    prisma.cartItem.findMany.mockResolvedValue([]);
    prisma.lotteryRecord.findUnique.mockResolvedValue({
      id: 'lr-missing-prize',
      status: 'IN_CART',
      prize: null,
    });

    await service.removePrizeItem('user1', 'ci-missing-prize');

    expect(prisma.cartItem.delete).toHaveBeenCalledWith({ where: { id: 'ci-missing-prize' } });
    expect(prisma.lotteryRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'lr-missing-prize', status: { in: ['WON', 'IN_CART'] } },
      data: { status: 'EXPIRED' },
    });
  });

  it('keeps locked usable threshold gift when threshold is still unmet', async () => {
    const { service, prisma } = createService();
    prisma.cartItem.findFirst.mockResolvedValue({
      id: 'ci-prize',
      cartId: 'cart1',
      skuId: 'sku1',
      isPrize: true,
      isLocked: true,
      threshold: 100,
      prizeRecordId: 'lr1',
      sku: {
        id: 'sku1',
        status: 'ACTIVE',
        product: { id: 'p1', status: 'ACTIVE' },
      },
    });
    prisma.cartItem.findMany.mockResolvedValue([
      { quantity: 1, sku: { price: 30 } },
    ]);
    prisma.lotteryRecord.findUnique.mockResolvedValue({
      id: 'lr1',
      status: 'IN_CART',
      prize: {
        id: 'prize1',
        type: 'THRESHOLD_GIFT',
        isActive: true,
        skuId: 'sku1',
        sku: {
          id: 'sku1',
          status: 'ACTIVE',
          product: { id: 'p1', status: 'ACTIVE' },
        },
      },
    });

    await expect(service.removePrizeItem('user1', 'ci-prize')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.cartItem.delete).not.toHaveBeenCalled();
  });

  it('clearCart keeps locked usable threshold gift when threshold is unmet', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const { service, prisma } = createService({
      cartItem: {
        findFirst: jest.fn(),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'ci-locked-prize',
              cartId: 'cart1',
              skuId: 'sku1',
              isPrize: true,
              isLocked: true,
              threshold: 100,
              prizeRecordId: 'lr1',
              sku: {
                id: 'sku1',
                status: 'ACTIVE',
                product: { id: 'p1', status: 'ACTIVE' },
              },
            },
          ])
          .mockResolvedValueOnce([]),
        delete: jest.fn(),
        deleteMany,
        update: jest.fn(),
      },
      lotteryRecord: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'lr1',
            status: 'IN_CART',
            prize: {
              id: 'prize1',
              type: 'THRESHOLD_GIFT',
              isActive: true,
              skuId: 'sku1',
              sku: {
                id: 'sku1',
                status: 'ACTIVE',
                product: { id: 'p1', status: 'ACTIVE' },
              },
            },
          },
        ]),
        updateMany,
      },
    });

    await service.clearCart('user1');

    expect(deleteMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('clearCart removes locked orphaned prize cart item and expires its missing record id', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const { service } = createService({
      cartItem: {
        findFirst: jest.fn(),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'ci-orphan-prize',
              cartId: 'cart1',
              skuId: 'sku1',
              isPrize: true,
              isLocked: true,
              threshold: 100,
              prizeRecordId: 'missing-lr',
              sku: {
                id: 'sku1',
                status: 'ACTIVE',
                product: { id: 'p1', status: 'ACTIVE' },
              },
            },
          ])
          .mockResolvedValueOnce([]),
        delete: jest.fn(),
        deleteMany,
        update: jest.fn(),
      },
      lotteryRecord: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany,
      },
    });

    await service.clearCart('user1');

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['ci-orphan-prize'] }, cartId: 'cart1' },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['missing-lr'] }, status: { in: ['WON', 'IN_CART'] } },
      data: { status: 'EXPIRED' },
    });
  });

  it('rejects quantity updates for inactive SKU', async () => {
    const { service, prisma } = createService();
    prisma.cartItem.findFirst.mockResolvedValue({ id: 'ci-normal', skuId: 'sku1' });
    prisma.productSKU.findUnique.mockResolvedValue({
      id: 'sku1',
      status: 'INACTIVE',
      stock: 100,
      maxPerOrder: null,
      product: { id: 'p1', status: 'ACTIVE' },
    });

    await expect(service.updateItemQuantity('user1', 'sku1', 2)).rejects.toThrow('该规格已下架');
    expect(prisma.cartItem.update).not.toHaveBeenCalled();
  });

  it('allows reducing quantity when cart quantity already exceeds current stock', async () => {
    const { service, prisma } = createService();
    prisma.cartItem.findFirst.mockResolvedValue({ id: 'ci-normal', skuId: 'sku1', quantity: 3 });
    prisma.productSKU.findUnique.mockResolvedValue({
      id: 'sku1',
      status: 'ACTIVE',
      stock: 1,
      maxPerOrder: null,
      product: { id: 'p1', status: 'ACTIVE' },
    });

    await expect(service.updateItemQuantity('user1', 'sku1', 2)).resolves.toEqual({ id: 'cart1', items: [] });
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-normal' },
      data: { quantity: 2 },
    });
  });

  it('deletes Redis claim data when prize claim becomes inactive before merge', async () => {
    const claimToken = generateClaimToken(
      {
        fp: 'fingerprint-1',
        prizeId: 'prize-inactive',
        drawDate: todayDateUTC8(),
        ts: Date.now(),
      },
      'dev-claim-secret-do-not-use-in-production',
    );
    const hash = claimTokenHash(claimToken);
    const claimKey = `lottery:claim:${hash}`;
    const lockKey = `${claimKey}:lock`;
    const { service, prisma, redisCoord } = createService(
      {
        lotteryPrize: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'prize-inactive',
            type: 'THRESHOLD_GIFT',
            isActive: false,
            skuId: 'sku-prize',
            sku: {
              id: 'sku-prize',
              status: 'ACTIVE',
              product: { id: 'p1', status: 'ACTIVE' },
            },
          }),
        },
      },
      {
        acquireLock: jest.fn().mockResolvedValue(true),
        get: jest.fn().mockResolvedValue(JSON.stringify({
          prizeId: 'prize-inactive',
          prizeType: 'THRESHOLD_GIFT',
          prizePrice: 0,
          originalPrice: 39,
          skuId: 'sku-prize',
          threshold: 99,
          prizeQuantity: 1,
        })),
        del: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(true),
      },
    );

    const result = await service.mergeItems('user1', [
      {
        skuId: 'sku-prize',
        quantity: 1,
        isPrize: true,
        claimToken,
      },
    ] as any);

    expect((result as any).mergeResults).toEqual([
      expect.objectContaining({
        skuId: 'sku-prize',
        status: 'REJECTED_PRIZE_INACTIVE',
      }),
    ]);
    expect(prisma.lotteryPrize.findUnique).toHaveBeenCalledWith({
      where: { id: 'prize-inactive' },
      include: {
        sku: { include: { product: true } },
        product: true,
      },
    });
    expect(redisCoord.del).toHaveBeenCalledWith(claimKey, lockKey);
    expect(redisCoord.releaseLock).not.toHaveBeenCalledWith(lockKey, 'merge');
  });

  it('clamps DISCOUNT_BUY claim quantity to one when prizeQuantity is configured as total availability', async () => {
    const claimToken = generateClaimToken(
      {
        fp: 'fingerprint-1',
        prizeId: 'discount-prize',
        drawDate: todayDateUTC8(),
        ts: Date.now(),
      },
      'dev-claim-secret-do-not-use-in-production',
    );
    const hash = claimTokenHash(claimToken);
    const { service, prisma, redisCoord } = createService(
      {
        lotteryPrize: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'discount-prize',
            type: 'DISCOUNT_BUY',
            isActive: true,
            skuId: 'sku-discount',
            sku: {
              id: 'sku-discount',
              status: 'ACTIVE',
              product: { id: 'p1', status: 'ACTIVE' },
            },
          }),
        },
      },
      {
        acquireLock: jest.fn().mockResolvedValue(true),
        get: jest.fn().mockResolvedValue(JSON.stringify({
          prizeId: 'discount-prize',
          prizeType: 'DISCOUNT_BUY',
          prizePrice: 12,
          originalPrice: 20.8,
          skuId: 'sku-discount',
          threshold: null,
          prizeQuantity: 100,
        })),
        del: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(true),
      },
    );

    const result = await service.mergeItems('user1', [
      {
        localKey: 'pending-prize-local',
        skuId: 'pending-prize-local',
        quantity: 1,
        isPrize: true,
        claimToken,
      },
    ] as any);

    expect((result as any).mergeResults).toEqual([
      expect.objectContaining({
        localKey: 'pending-prize-local',
        skuId: 'pending-prize-local',
        status: 'MERGED',
      }),
    ]);
    expect(prisma.lotteryRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        meta: expect.objectContaining({
          prizeQuantity: 1,
        }),
      }),
    });
    expect(prisma.cartItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        skuId: 'sku-discount',
        quantity: 1,
        isPrize: true,
        prizeRecordId: 'lr-created',
      }),
    });
    expect(redisCoord.del).toHaveBeenCalledWith(
      `lottery:claim:${hash}`,
      `lottery:claim:${hash}:lock`,
    );
  });
});
