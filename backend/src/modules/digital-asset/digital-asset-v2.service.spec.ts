import { Prisma } from '@prisma/client';
import { DigitalAssetService } from './digital-asset.service';

type DataSet = {
  accounts: any[];
  ledgers: any[];
  orders: any[];
  refunds: any[];
  afterSales: any[];
  memberProfiles: any[];
  ruleConfigs: any[];
  vipPackages: any[];
};

const DEFAULT_CREDIT_TIERS = {
  value: {
    tiers: [
      { minAmount: 0, maxAmount: 500, multiplier: 3 },
      { minAmount: 500, maxAmount: 5000, multiplier: 5 },
      { minAmount: 5000, maxAmount: null, multiplier: 10 },
    ],
  },
};

const makeHarness = (initial?: Partial<DataSet>) => {
  const data: DataSet = {
    accounts: initial?.accounts ?? [],
    ledgers: initial?.ledgers ?? [],
    orders: initial?.orders ?? [],
    refunds: initial?.refunds ?? [],
    afterSales: initial?.afterSales ?? [],
    memberProfiles: initial?.memberProfiles ?? [],
    ruleConfigs: initial?.ruleConfigs ?? [{ key: 'DIGITAL_ASSET_CREDIT_TIERS', value: DEFAULT_CREDIT_TIERS }],
    vipPackages: initial?.vipPackages ?? [
      { id: 'pkg-399', price: 399, selfSeedAssetAmount: 1000, referralSeedAssetAmount: 2000, status: 'ACTIVE' },
      { id: 'pkg-699', price: 699, selfSeedAssetAmount: 2000, referralSeedAssetAmount: 4000, status: 'ACTIVE' },
      { id: 'pkg-999', price: 999, selfSeedAssetAmount: 3000, referralSeedAssetAmount: 8000, status: 'ACTIVE' },
    ],
  };

  const matchLedgerWhere = (ledger: any, where: any) => {
    if (!where) return true;
    if (where.idempotencyKey && ledger.idempotencyKey !== where.idempotencyKey) return false;
    if (where.id && ledger.id !== where.id) return false;
    if (where.orderId && ledger.orderId !== where.orderId) return false;
    if (where.refundId && ledger.refundId !== where.refundId) return false;
    if (where.afterSaleId && ledger.afterSaleId !== where.afterSaleId) return false;
    if (where.userId && ledger.userId !== where.userId) return false;
    if (where.accountId && ledger.accountId !== where.accountId) return false;
    if (where.direction && ledger.direction !== where.direction) return false;
    if (where.type) {
      if (typeof where.type === 'string' && ledger.type !== where.type) return false;
      if (where.type.in && !where.type.in.includes(ledger.type)) return false;
    }
    if (where.subjectType && ledger.subjectType !== where.subjectType) return false;
    return true;
  };

  const findAccount = (where: any) =>
    data.accounts.find((account) =>
      (where.userId && account.userId === where.userId) ||
      (where.id && account.id === where.id),
    ) ?? null;

  const tx: any = {
    order: {
      findUnique: jest.fn(({ where }: any) => data.orders.find((order) => order.id === where.id) ?? null),
    },
    memberProfile: {
      findUnique: jest.fn(({ where }: any) =>
        data.memberProfiles.find((profile) => profile.userId === where.userId) ?? null,
      ),
    },
    ruleConfig: {
      findUnique: jest.fn(({ where }: any) =>
        data.ruleConfigs.find((config) => config.key === where.key) ?? null,
      ),
    },
    vipPackage: {
      findUnique: jest.fn(({ where }: any) =>
        data.vipPackages.find((pkg) => pkg.id === where.id) ?? null,
      ),
      findFirst: jest.fn(({ where }: any) =>
        data.vipPackages.find((pkg) => {
          if (where?.status && pkg.status !== where.status) return false;
          if (where?.price !== undefined && pkg.price !== where.price) return false;
          return true;
        }) ?? null,
      ),
      findMany: jest.fn(({ where, orderBy }: any = {}) => {
        let items = [...data.vipPackages];
        if (where?.status) items = items.filter((pkg) => pkg.status === where.status);
        if (orderBy?.price) {
          items.sort((a, b) => orderBy.price === 'asc' ? a.price - b.price : b.price - a.price);
        }
        return items;
      }),
    },
    digitalAssetAccount: {
      findUnique: jest.fn(({ where }: any) => findAccount(where)),
      create: jest.fn(({ data: createData }: any) => {
        const account = {
          id: `account-${data.accounts.length + 1}`,
          cumulativeSpendAmount: 0,
          seedAssetBalance: 0,
          creditAssetBalance: 0,
          historicalCreditGrantedAt: null,
          historicalCreditGrantLedgerId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...createData,
        };
        data.accounts.push(account);
        return account;
      }),
      update: jest.fn(({ where, data: updateData }: any) => {
        const account = findAccount(where);
        Object.assign(account, updateData, { updatedAt: new Date() });
        return account;
      }),
    },
    digitalAssetLedger: {
      findUnique: jest.fn(({ where }: any) =>
        data.ledgers.find((ledger) => matchLedgerWhere(ledger, where)) ?? null,
      ),
      findMany: jest.fn(({ where, orderBy, skip, take }: any = {}) => {
        let items = data.ledgers.filter((ledger) => matchLedgerWhere(ledger, where));
        if (orderBy?.createdAt) {
          items = [...items].sort((a, b) =>
            orderBy.createdAt === 'desc'
              ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
        }
        if (skip) items = items.slice(skip);
        if (take !== undefined) items = items.slice(0, take);
        return items;
      }),
      count: jest.fn(({ where }: any) => data.ledgers.filter((ledger) => matchLedgerWhere(ledger, where)).length),
      create: jest.fn(({ data: createData }: any) => {
        const ledger = {
          id: `ledger-${data.ledgers.length + 1}`,
          createdAt: new Date(Date.now() + data.ledgers.length),
          ...createData,
        };
        data.ledgers.push(ledger);
        return ledger;
      }),
      update: jest.fn(({ where, data: updateData }: any) => {
        const ledger = data.ledgers.find((item) => item.id === where.id);
        Object.assign(ledger, updateData);
        return ledger;
      }),
    },
    refund: {
      findUnique: jest.fn(({ where }: any) => data.refunds.find((refund) => refund.id === where.id) ?? null),
    },
    afterSaleRequest: {
      findFirst: jest.fn(({ where }: any) =>
        data.afterSales.find((request) => request.refundId === where.refundId) ?? null,
      ),
      findUnique: jest.fn(({ where }: any) =>
        data.afterSales.find((request) => request.id === where.id) ?? null,
      ),
    },
  };

  const prisma: any = {
    ...tx,
    $transaction: jest.fn(async (callback: any, options: any) => callback(tx)),
  };

  return { data, prisma, tx, service: new DigitalAssetService(prisma as any) };
};

describe('DigitalAssetService V2 semantics', () => {
  it('normal user received normal order increases cumulative spend only', async () => {
    const { data, prisma, service } = makeHarness({
      memberProfiles: [{ userId: 'normal-user', tier: 'NORMAL' }],
      orders: [{
        id: 'order-normal',
        userId: 'normal-user',
        bizType: 'NORMAL_GOODS',
        status: 'RECEIVED',
        receivedAt: new Date(),
        goodsAmount: 120,
        shippingFee: 8,
        discountAmount: 10,
        vipDiscountAmount: 0,
        totalCouponDiscount: 10,
        items: [
          { id: 'item-1', skuId: 'sku-1', quantity: 1, unitPrice: 120, isPrize: false, createdAt: new Date('2026-06-01') },
        ],
      }],
    });

    await service.recordOrderReceived('order-normal', 'ORDER_RECEIVED');

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(data.accounts[0]).toMatchObject({
      userId: 'normal-user',
      cumulativeSpendAmount: 100,
      seedAssetBalance: 0,
      creditAssetBalance: 0,
    });
    expect(data.ledgers).toHaveLength(1);
    expect(data.ledgers[0]).toMatchObject({
      type: 'CONSUMPTION_CONFIRMED',
      subjectType: 'CUMULATIVE_SPEND',
      amount: 100,
      cumulativeSpendAfter: 100,
      balanceAfter: 100,
    });
  });

  it('VIP user received normal order increases cumulative spend and credit asset balance', async () => {
    const { data, service } = makeHarness({
      accounts: [{
        id: 'account-1',
        userId: 'vip-user',
        cumulativeSpendAmount: 480,
        seedAssetBalance: 1000,
        creditAssetBalance: 0,
        historicalCreditGrantedAt: new Date('2026-06-01T00:00:00.000Z'),
        historicalCreditGrantLedgerId: 'ledger-historical',
      }],
      memberProfiles: [{ userId: 'vip-user', tier: 'VIP' }],
      orders: [{
        id: 'order-vip',
        userId: 'vip-user',
        bizType: 'NORMAL_GOODS',
        status: 'RECEIVED',
        receivedAt: new Date(),
        goodsAmount: 100,
        shippingFee: 0,
        discountAmount: 0,
        vipDiscountAmount: 0,
        totalCouponDiscount: 0,
        items: [
          { id: 'item-1', skuId: 'sku-1', quantity: 1, unitPrice: 100, isPrize: false, createdAt: new Date('2026-06-02') },
        ],
      }],
    });

    await service.recordOrderReceived('order-vip', 'ORDER_RECEIVED');

    expect(data.accounts[0]).toMatchObject({
      cumulativeSpendAmount: 580,
      seedAssetBalance: 1000,
      creditAssetBalance: 460,
    });
    expect(data.ledgers).toHaveLength(2);
    expect(data.ledgers[1]).toMatchObject({
      type: 'CONSUMPTION_CONFIRMED',
      subjectType: 'CREDIT_ASSET',
      amount: 460,
      assetAmount: 460,
      creditAssetBalanceAfter: 460,
      balanceAfter: 460,
    });
  });

  it('VIP_PACKAGE order is ignored for cumulative spend and credit assets', async () => {
    const { data, service } = makeHarness({
      memberProfiles: [{ userId: 'vip-user', tier: 'VIP' }],
      orders: [{
        id: 'order-vip-package',
        userId: 'vip-user',
        bizType: 'VIP_PACKAGE',
        status: 'RECEIVED',
        receivedAt: new Date(),
        goodsAmount: 399,
        shippingFee: 0,
        discountAmount: 0,
        vipDiscountAmount: 0,
        totalCouponDiscount: 0,
        items: [
          { id: 'item-1', skuId: 'sku-vip', quantity: 1, unitPrice: 399, isPrize: false, createdAt: new Date('2026-06-03') },
        ],
      }],
    });

    await service.recordOrderReceived('order-vip-package', 'ORDER_RECEIVED');

    expect(data.accounts).toHaveLength(0);
    expect(data.ledgers).toHaveLength(0);
  });

  it('refund reverses cumulative spend and credit assets from original ledger snapshot', async () => {
    const { data, service } = makeHarness({
      memberProfiles: [{ userId: 'vip-user', tier: 'VIP' }],
      orders: [{
        id: 'order-refund',
        userId: 'vip-user',
        bizType: 'NORMAL_GOODS',
        status: 'RECEIVED',
        receivedAt: new Date(),
        goodsAmount: 100,
        shippingFee: 0,
        discountAmount: 0,
        vipDiscountAmount: 0,
        totalCouponDiscount: 0,
        items: [
          { id: 'item-1', skuId: 'sku-1', quantity: 1, unitPrice: 100, isPrize: false, createdAt: new Date('2026-06-04') },
        ],
      }],
      refunds: [{
        id: 'refund-1',
        orderId: 'order-refund',
        afterSaleId: null,
        amount: 100,
        items: [{ orderItemId: 'item-1', quantity: 1, amount: 100 }],
      }],
    });

    await service.recordOrderReceived('order-refund', 'ORDER_RECEIVED');
    await service.reverseRefund('refund-1');

    expect(data.accounts[0]).toMatchObject({
      cumulativeSpendAmount: 0,
      creditAssetBalance: 0,
    });
    expect(data.ledgers).toHaveLength(4);
    expect(data.ledgers[2]).toMatchObject({
      type: 'REFUND_REVERSAL',
      subjectType: 'CUMULATIVE_SPEND',
      amount: 100,
      cumulativeSpendAfter: 0,
      balanceAfter: 0,
    });
    expect(data.ledgers[3]).toMatchObject({
      type: 'REFUND_REVERSAL',
      subjectType: 'CREDIT_ASSET',
      amount: 300,
      assetAmount: 300,
      creditAssetBalanceAfter: 0,
      balanceAfter: 0,
    });
  });

  it('admin adjustment can target seed asset or credit asset without touching cumulative spend', async () => {
    const { data, service } = makeHarness({
      accounts: [{
        id: 'account-1',
        userId: 'vip-user',
        cumulativeSpendAmount: 580,
        seedAssetBalance: 1000,
        creditAssetBalance: 460,
        historicalCreditGrantedAt: new Date('2026-06-01T00:00:00.000Z'),
        historicalCreditGrantLedgerId: 'ledger-historical',
      }],
    });

    await service.adjustByAdmin({
      targetUserId: 'vip-user',
      adminUserId: 'admin-1',
      subjectType: 'SEED_ASSET',
      amount: 100,
      direction: 'DEBIT',
      reason: 'seed debit',
      clientIdempotencyKey: 'seed-adjust',
    });
    await service.adjustByAdmin({
      targetUserId: 'vip-user',
      adminUserId: 'admin-1',
      subjectType: 'CREDIT_ASSET',
      amount: 40,
      direction: 'CREDIT',
      reason: 'credit add',
      clientIdempotencyKey: 'credit-adjust',
    });

    expect(data.accounts[0]).toMatchObject({
      cumulativeSpendAmount: 580,
      seedAssetBalance: 900,
      creditAssetBalance: 500,
    });
    expect(data.ledgers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subjectType: 'SEED_ASSET',
        type: 'ADMIN_ADJUSTMENT',
        amount: 100,
        seedAssetBalanceAfter: 900,
      }),
      expect.objectContaining({
        subjectType: 'CREDIT_ASSET',
        type: 'ADMIN_ADJUSTMENT',
        amount: 40,
        creditAssetBalanceAfter: 500,
      }),
    ]));
  });

  it('getSummary zeroes asset balances for non-VIP users but returns rules and recent records', async () => {
    const { data, service } = makeHarness({
      accounts: [{
        id: 'account-1',
        userId: 'normal-user',
        cumulativeSpendAmount: 240,
        seedAssetBalance: 999,
        creditAssetBalance: 888,
        historicalCreditGrantedAt: null,
        historicalCreditGrantLedgerId: null,
      }],
      memberProfiles: [{ userId: 'normal-user', tier: 'NORMAL' }],
      ledgers: Array.from({ length: 6 }, (_, index) => ({
        id: `ledger-${index + 1}`,
        accountId: 'account-1',
        userId: 'normal-user',
        type: 'CONSUMPTION_CONFIRMED',
        subjectType: 'CUMULATIVE_SPEND',
        direction: 'CREDIT',
        amount: 10 + index,
        balanceAfter: 10 + index,
        cumulativeSpendAfter: 10 + index,
        idempotencyKey: `ledger-${index + 1}`,
        createdAt: new Date(`2026-06-0${index + 1}T00:00:00.000Z`),
      })),
    });

    const summary = await service.getSummary('normal-user');

    expect(summary).toMatchObject({
      isVip: false,
      totalAssetBalance: 0,
      seedAssetBalance: 0,
      creditAssetBalance: 0,
      cumulativeSpendAmount: 240,
      activationPrompt: {
        title: '让每一次消费，都成为你的数字资产基础',
        description: '成为 VIP 后，累计消费可按规则转化为信用资产。',
        actionLabel: '开通 VIP 激活资产',
      },
    });
    expect(summary.vipSeedRules).toHaveLength(3);
    expect(summary.recentRecords).toHaveLength(5);
    expect(summary.recentRecords[0].title).toBe('消费累计');
  });

  it('listLedgers filters by subjectType and sourceType and maps v2 titles', async () => {
    const { service } = makeHarness({
      ledgers: [
        {
          id: 'ledger-1',
          accountId: 'account-1',
          userId: 'vip-user',
          type: 'CONSUMPTION_CONFIRMED',
          subjectType: 'CUMULATIVE_SPEND',
          direction: 'CREDIT',
          amount: 100,
          balanceAfter: 100,
          cumulativeSpendAfter: 100,
          idempotencyKey: 'ledger-1',
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
        },
        {
          id: 'ledger-2',
          accountId: 'account-1',
          userId: 'vip-user',
          type: 'CONSUMPTION_CONFIRMED',
          subjectType: 'CREDIT_ASSET',
          direction: 'CREDIT',
          amount: 300,
          assetAmount: 300,
          balanceAfter: 300,
          creditAssetBalanceAfter: 300,
          idempotencyKey: 'ledger-2',
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
        },
        {
          id: 'ledger-3',
          accountId: 'account-1',
          userId: 'vip-user',
          type: 'ORDER_RECEIVED',
          subjectType: 'CUMULATIVE_SPEND',
          direction: 'CREDIT',
          amount: 50,
          balanceAfter: 150,
          cumulativeSpendAfter: 150,
          idempotencyKey: 'ledger-3',
          createdAt: new Date('2026-06-03T00:00:00.000Z'),
        },
      ],
    });

    const result = await service.listLedgers('vip-user', {
      subjectType: 'CREDIT_ASSET',
      sourceType: 'CONSUMPTION_CONFIRMED',
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: 'ledger-2',
      title: '信用资产入账',
      subjectType: 'CREDIT_ASSET',
      sourceType: 'CONSUMPTION_CONFIRMED',
      amount: 300,
    });
  });
});
