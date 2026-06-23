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
    description: '鲜活大龙虾冷链配送到家',
    productId: 'product_1',
    skuId: 'sku_1',
    price: 1000,
    freeShipping: true,
    status: 'ACTIVE',
    displayOrder: 10,
    items: [
      { productId: 'product_1', skuId: 'sku_1', quantity: 1, sortOrder: 0 },
      { productId: 'product_2', skuId: 'sku_2', quantity: 2, sortOrder: 1 },
    ],
    tiers: [
      { sequence: 1, basisPoints: 1000, label: '第一位好友' },
      { sequence: 2, basisPoints: 2000, label: '第二位好友' },
      { sequence: 3, basisPoints: 7000, label: '第三位好友' },
    ],
  };

  const buildPrisma = () => {
    const tx = {
      product: {
        findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve({
          id: where.id,
          companyId: PLATFORM_COMPANY_ID,
          status: 'ACTIVE',
        })),
      },
      productSKU: {
        findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve({
          id: where.id,
          productId: where.id === 'sku_2' ? 'product_2' : 'product_1',
          status: 'ACTIVE',
          weightGram: 1000,
        })),
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
      groupBuyActivityItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
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
      groupBuyInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'instance_1',
            status: 'SHARING',
            validReferralCount: 1,
            candidateCount: 2,
            user: {
              id: 'user_1',
              buyerNo: 'AIMM202606220001',
              profile: { nickname: '分享用户' },
            },
            activity: { id: 'activity_1', title: '大龙虾团购', price: 1000 },
            code: { code: 'GB123456', status: 'ACTIVE' },
            initiatorOrder: { id: 'order_1', status: 'RECEIVED', totalAmount: 1000 },
            _count: { referrals: 2, rebateLedgers: 1 },
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'order_1',
            user: { id: 'user_1', buyerNo: 'AIMM202606220001', profile: { nickname: '分享用户' } },
            status: 'RECEIVED',
            bizType: 'GROUP_BUY',
            totalAmount: 1000,
            goodsAmount: 1000,
            shippingFee: 0,
            groupBuyInitiatedInstance: { id: 'instance_1', status: 'SHARING' },
            groupBuyReferredPurchase: null,
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      groupBuyRebateLedger: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ledger_1',
            user: { id: 'user_1', buyerNo: 'AIMM202606220001', profile: { nickname: '分享用户' } },
            type: 'RELEASE',
            status: 'AVAILABLE',
            amount: 100,
            instance: { id: 'instance_1', activity: { id: 'activity_1', title: '大龙虾团购' } },
            referral: { id: 'referral_1', referredOrderId: 'order_2' },
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      ruleConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
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
        description: '鲜活大龙虾冷链配送到家',
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
    expect(tx.groupBuyActivityItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          activityId: 'activity_1',
          productId: 'product_1',
          skuId: 'sku_1',
          quantity: 1,
          sortOrder: 0,
        }),
        expect.objectContaining({
          activityId: 'activity_1',
          productId: 'product_2',
          skuId: 'sku_2',
          quantity: 2,
          sortOrder: 1,
        }),
      ],
    });
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

  it('rejects empty activity items', async () => {
    const { tx, service } = buildPrisma();

    await expect(service.create({ ...createDto, items: [] } as any)).rejects.toThrow('请至少添加一个团购商品');
    expect(tx.groupBuyActivity.create).not.toHaveBeenCalled();
  });

  it('rejects an item whose sku does not belong to the selected product', async () => {
    const { tx, service } = buildPrisma();
    tx.productSKU.findUnique.mockResolvedValueOnce({
      id: 'sku_2',
      productId: 'other_product',
      status: 'ACTIVE',
      weightGram: 1000,
    });

    await expect(service.create({
      ...createDto,
      items: [{ productId: 'product_1', skuId: 'sku_2', quantity: 1 }],
    } as any)).rejects.toThrow('SKU 不属于所选商品');
  });

  it('accepts tier totals above 10000 basis points for admin-configured activities', async () => {
    const { tx, service } = buildPrisma();

    await service.create({
      ...createDto,
      tiers: [
        { sequence: 1, basisPoints: 1000 },
        { sequence: 2, basisPoints: 2000 },
        { sequence: 3, basisPoints: 8000 },
      ],
    } as any);

    expect(tx.groupBuyActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tiers: expect.objectContaining({
          create: expect.arrayContaining([
            expect.objectContaining({ sequence: 3, basisPoints: 8000 }),
          ]),
        }),
      }),
    }));
  });

  it('updates activity price and tiers without mutating existing instances', async () => {
    const { tx, service } = buildPrisma();

    await service.update('activity_1', {
      price: 1200,
      description: '  新的团购商品详情  ',
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
      data: expect.objectContaining({ price: 1200, description: '新的团购商品详情' }),
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

  it('lists group-buy instances with share code and direct referral counters', async () => {
    const { prisma, service } = buildPrisma();

    const result = await service.findInstances({ page: 1, pageSize: 20, status: 'SHARING' });

    expect(prisma.groupBuyInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'SHARING' }),
      include: expect.objectContaining({
        user: expect.any(Object),
        activity: expect.any(Object),
        code: expect.any(Object),
        _count: expect.any(Object),
      }),
    }));
    expect(result).toEqual(expect.objectContaining({
      total: 1,
      items: [expect.objectContaining({
        id: 'instance_1',
        code: expect.objectContaining({ code: 'GB123456' }),
      })],
    }));
  });

  it('lists only GROUP_BUY orders for the admin group-buy order page', async () => {
    const { prisma, service } = buildPrisma();

    const result = await service.findOrders({ page: 1, pageSize: 20, status: 'RECEIVED' });

    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ bizType: 'GROUP_BUY', status: 'RECEIVED' }),
    }));
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: 'order_1',
      bizType: 'GROUP_BUY',
      groupBuyInitiatedInstance: expect.objectContaining({ id: 'instance_1' }),
    }));
  });

  it('lists group-buy rebate ledgers with user and instance context', async () => {
    const { prisma, service } = buildPrisma();

    const result = await service.findRebateLedgers({ page: 1, pageSize: 20, type: 'RELEASE' });

    expect(prisma.groupBuyRebateLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ deletedAt: null, type: 'RELEASE' }),
    }));
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: 'ledger_1',
      type: 'RELEASE',
      instance: expect.objectContaining({ id: 'instance_1' }),
    }));
  });

  it('returns default group-buy settings when RuleConfig is absent', async () => {
    const { service } = buildPrisma();

    await expect(service.getSettings()).resolves.toEqual({
      maxMonthlyLaunches: 4,
    });
  });

  it('updates max monthly launches through RuleConfig', async () => {
    const { prisma, service } = buildPrisma();

    await service.updateSettings({ maxMonthlyLaunches: 6 });

    expect(prisma.ruleConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'GROUP_BUY_MAX_MONTHLY_LAUNCHES' },
      update: {
        value: {
          value: 6,
          description: '每个用户每月最多可发起的团购次数',
        },
      },
      create: {
        key: 'GROUP_BUY_MAX_MONTHLY_LAUNCHES',
        value: {
          value: 6,
          description: '每个用户每月最多可发起的团购次数',
        },
      },
    });
  });
});
