import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from './captain.constants';
import { CaptainAttributionService } from './captain-attribution.service';

function makeConfig(overrides: any = {}) {
  return {
    ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
    enabled: true,
    scope: {
      ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.scope,
      productIds: ['product-1'],
    },
    ...overrides,
  };
}

function makeOrder(overrides: any = {}) {
  return {
    id: 'order-1',
    userId: 'buyer-1',
    bizType: 'NORMAL_GOODS',
    goodsAmount: 100,
    totalAmount: 80,
    shippingFee: 0,
    discountAmount: 10,
    vipDiscountAmount: 5,
    totalCouponDiscount: 5,
    items: [
      {
        id: 'item-1',
        unitPrice: 100,
        quantity: 1,
        isPrize: false,
        companyId: 'company-1',
        sku: {
          productId: 'product-1',
          product: {
            id: 'product-1',
            categoryId: 'category-1',
            companyId: 'company-1',
          },
        },
      },
    ],
    ...overrides,
  };
}

function createHarness(options: {
  config?: any;
  order?: any;
  existingAttribution?: any;
  relation?: any;
} = {}) {
  const configService = {
    getSnapshot: jest.fn().mockResolvedValue(options.config ?? makeConfig()),
  };
  const tx: any = {
    captainOrderAttribution: {
      findUnique: jest.fn().mockResolvedValue(options.existingAttribution ?? null),
      create: jest.fn().mockResolvedValue({ id: 'attr-1' }),
    },
    order: {
      findUnique: jest.fn().mockResolvedValue(options.order ?? makeOrder()),
    },
    captainRelation: {
      findUnique: jest.fn().mockResolvedValue(
        options.relation ?? {
          buyerUserId: 'buyer-1',
          directCaptainUserId: 'captain-1',
          legacyIndirectCaptainUserId: 'captain-0',
          status: 'ACTIVE',
        },
      ),
    },
    captainProfile: {
      findMany: jest.fn().mockResolvedValue([
        { userId: 'captain-1', status: 'ACTIVE' },
        { userId: 'captain-0', status: 'ACTIVE' },
      ]),
    },
    captainAccount: {
      upsert: jest
        .fn()
        .mockResolvedValueOnce({ id: 'account-direct', userId: 'captain-1' })
        .mockResolvedValueOnce({ id: 'account-indirect', userId: 'captain-0' }),
      update: jest.fn().mockResolvedValue({}),
    },
    captainCommissionLedger: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  return {
    tx,
    configService,
    service: new CaptainAttributionService(configService as any),
  };
}

describe('CaptainAttributionService', () => {
  it('does nothing when captain config is disabled', async () => {
    const { service, tx } = createHarness({
      config: { ...makeConfig(), enabled: false },
    });

    await expect(service.createFrozenForPaidOrder(tx, 'order-1')).resolves.toBe('skipped');
    expect(tx.order.findUnique).not.toHaveBeenCalled();
    expect(tx.captainOrderAttribution.create).not.toHaveBeenCalled();
  });

  it('does nothing for non-normal-good orders', async () => {
    const { service, tx } = createHarness({
      order: makeOrder({ bizType: 'VIP_PACKAGE' }),
    });

    await expect(service.createFrozenForPaidOrder(tx, 'order-1')).resolves.toBe('skipped');
    expect(tx.captainOrderAttribution.create).not.toHaveBeenCalled();
  });

  it('creates only one direct frozen ledger from net eligible goods GMV', async () => {
    const { service, tx } = createHarness();

    await expect(service.createFrozenForPaidOrder(tx, 'order-1')).resolves.toBe('credited');

    expect(tx.captainOrderAttribution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        buyerUserId: 'buyer-1',
        directCaptainUserId: 'captain-1',
        legacyIndirectCaptainUserId: null,
        commissionBase: 80,
        eligibleGoodsAmount: 100,
        couponDiscountAmount: 5,
        rewardDeductionAmount: 10,
        directRate: 0.11,
        legacyIndirectRate: 0,
        status: 'FROZEN',
      }),
    });
    expect(tx.captainOrderAttribution.create.mock.calls[0][0].data).not.toHaveProperty('indirectCaptainUserId');
    expect(tx.captainOrderAttribution.create.mock.calls[0][0].data).not.toHaveProperty('indirectRate');
    expect(tx.captainCommissionLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.captainCommissionLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'captain-1',
        type: 'DIRECT_ORDER',
        status: 'FROZEN',
        amount: 8.8,
        commissionBase: 80,
        rate: 0.11,
        idempotencyKey: 'captain:order:order-1:direct',
      }),
    });
    expect(tx.captainAccount.update).toHaveBeenCalledTimes(1);
  });

  it('never creates an indirect ledger when a legacy relation has an upstream captain', async () => {
    const { service, tx } = createHarness({
      relation: {
        buyerUserId: 'buyer-1',
        directCaptainUserId: 'captain-1',
        legacyIndirectCaptainUserId: 'captain-0',
        ignoredThirdCaptainUserId: 'captain-third',
        status: 'ACTIVE',
      },
    });

    await service.createFrozenForPaidOrder(tx, 'order-1');

    expect(tx.captainCommissionLedger.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tx.captainCommissionLedger.create.mock.calls)).not.toContain('captain-0');
    expect(JSON.stringify(tx.captainCommissionLedger.create.mock.calls)).not.toContain('captain-third');
  });

  it('skips duplicate attribution by order and program', async () => {
    const { service, tx } = createHarness({
      existingAttribution: { id: 'attr-existing' },
    });

    await expect(service.createFrozenForPaidOrder(tx, 'order-1')).resolves.toBe('skipped');
    expect(tx.order.findUnique).not.toHaveBeenCalled();
    expect(tx.captainCommissionLedger.create).not.toHaveBeenCalled();
  });
});
