import { Prisma } from '@prisma/client';
import { DigitalAssetService } from './digital-asset.service';

type DataSet = {
  accounts: any[];
  ledgers: any[];
  orders: any[];
  refunds: any[];
  afterSales: any[];
  memberProfiles: any[];
  users: any[];
  ruleConfigs: any[];
  vipPackages: any[];
  reversalFailures: any[];
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
    users: initial?.users ?? [],
    ruleConfigs: initial?.ruleConfigs ?? [{ key: 'DIGITAL_ASSET_CREDIT_TIERS', value: DEFAULT_CREDIT_TIERS }],
    vipPackages: initial?.vipPackages ?? [
      { id: 'pkg-399', price: 399, selfSeedAssetAmount: 1000, referralSeedAssetAmount: 2000, status: 'ACTIVE' },
      { id: 'pkg-699', price: 699, selfSeedAssetAmount: 2000, referralSeedAssetAmount: 4000, status: 'ACTIVE' },
      { id: 'pkg-999', price: 999, selfSeedAssetAmount: 3000, referralSeedAssetAmount: 8000, status: 'ACTIVE' },
    ],
    reversalFailures: initial?.reversalFailures ?? [],
  };

  const matchLedgerWhere = (ledger: any, where: any) => {
    if (!where) return true;
    if (where.AND) {
      const clauses = Array.isArray(where.AND) ? where.AND : [where.AND];
      if (!clauses.every((clause: any) => matchLedgerWhere(ledger, clause))) return false;
    }
    if (where.OR) {
      const clauses = Array.isArray(where.OR) ? where.OR : [where.OR];
      if (!clauses.some((clause: any) => matchLedgerWhere(ledger, clause))) return false;
    }
    if (where.NOT) {
      const clauses = Array.isArray(where.NOT) ? where.NOT : [where.NOT];
      if (clauses.some((clause: any) => matchLedgerWhere(ledger, clause))) return false;
    }
    if (where.idempotencyKey && ledger.idempotencyKey !== where.idempotencyKey) return false;
    if (where.id && ledger.id !== where.id) return false;
    if (where.orderId && ledger.orderId !== where.orderId) return false;
    if (where.refundId && ledger.refundId !== where.refundId) return false;
    if (where.afterSaleId && ledger.afterSaleId !== where.afterSaleId) return false;
    if (where.userId && ledger.userId !== where.userId) return false;
    if (where.accountId && ledger.accountId !== where.accountId) return false;
    if (where.direction && ledger.direction !== where.direction) return false;
    if (where.amount !== undefined && ledger.amount !== where.amount) return false;
    if (where.type) {
      if (typeof where.type === 'string' && ledger.type !== where.type) return false;
      if (where.type.in && !where.type.in.includes(ledger.type)) return false;
    }
    if (where.subjectType && ledger.subjectType !== where.subjectType) return false;
    return true;
  };

  const memberTierOf = (userId: string) =>
    data.memberProfiles.find((profile) => profile.userId === userId)?.tier ?? null;

  const matchesAccountWhere = (account: any, where: any) => {
    if (!where) return true;
    if (where.userId && account.userId !== where.userId) return false;
    if (where.id && account.id !== where.id) return false;
    if (where.cumulativeSpendAmount?.gt !== undefined && !(account.cumulativeSpendAmount > where.cumulativeSpendAmount.gt)) {
      return false;
    }
    const requiredTier = where.user?.memberProfile?.is?.tier;
    if (requiredTier && memberTierOf(account.userId) !== requiredTier) return false;
    return true;
  };

  const findAccount = (where: any) =>
    data.accounts.find((account) => matchesAccountWhere(account, where)) ?? null;

  const tx: any = {
    order: {
      findUnique: jest.fn(({ where }: any) => data.orders.find((order) => order.id === where.id) ?? null),
    },
    memberProfile: {
      findUnique: jest.fn(({ where }: any) =>
        data.memberProfiles.find((profile) => profile.userId === where.userId) ?? null,
      ),
    },
    user: {
      findUnique: jest.fn(({ where }: any) =>
        data.users.find((user) => user.id === where.id) ?? null,
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
      count: jest.fn(({ where }: any) =>
        data.accounts.filter((account) => matchesAccountWhere(account, where)).length,
      ),
      create: jest.fn(({ data: createData }: any) => {
        const account = {
          id: `account-${data.accounts.length + 1}`,
          cumulativeSpendAmount: 0,
          seedAssetBalance: 0,
          creditAssetBalance: 0,
          frozenCreditAssetBalance: 0,
          frozenCumulativeSpendAmount: 0,
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
    digitalAssetRefundReversalFailure: {
      upsert: jest.fn(({ where, create, update }: any) => {
        const existing = data.reversalFailures.find((item) => item.refundId === where.refundId);
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        const row = {
          id: `reversal-failure-${data.reversalFailures.length + 1}`,
          retryCount: 0,
          status: 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...create,
        };
        data.reversalFailures.push(row);
        return row;
      }),
      findMany: jest.fn(({ where, take, orderBy }: any = {}) => {
        let items = data.reversalFailures.filter((item) => {
          if (where?.status && item.status !== where.status) return false;
          if (where?.nextRetryAt?.lte && item.nextRetryAt > where.nextRetryAt.lte) return false;
          return true;
        });
        if (orderBy?.nextRetryAt) {
          items = [...items].sort((a, b) =>
            orderBy.nextRetryAt === 'asc'
              ? new Date(a.nextRetryAt).getTime() - new Date(b.nextRetryAt).getTime()
              : new Date(b.nextRetryAt).getTime() - new Date(a.nextRetryAt).getTime(),
          );
        }
        if (take !== undefined) items = items.slice(0, take);
        return items;
      }),
      update: jest.fn(({ where, data: updateData }: any) => {
        const row = data.reversalFailures.find((item) => item.id === where.id);
        Object.assign(row, updateData, { updatedAt: new Date() });
        return row;
      }),
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

  it('VIP user paid normal goods freezes credit assets without changing released balances', async () => {
    const { data, service } = makeHarness({
      accounts: [{
        id: 'account-1',
        userId: 'vip-user',
        cumulativeSpendAmount: 480,
        frozenCumulativeSpendAmount: 0,
        seedAssetBalance: 1000,
        creditAssetBalance: 0,
        frozenCreditAssetBalance: 0,
        historicalCreditGrantedAt: new Date('2026-06-01T00:00:00.000Z'),
        historicalCreditGrantLedgerId: 'ledger-historical',
      }],
      memberProfiles: [{ userId: 'vip-user', tier: 'VIP' }],
      orders: [{
        id: 'order-paid',
        userId: 'vip-user',
        bizType: 'NORMAL_GOODS',
        status: 'PAID',
        receivedAt: null,
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

    await service.recordOrderPaid('order-paid');
    const summary = await service.getSummary('vip-user');

    expect(data.accounts[0]).toMatchObject({
      cumulativeSpendAmount: 480,
      frozenCumulativeSpendAmount: 100,
      seedAssetBalance: 1000,
      creditAssetBalance: 0,
      frozenCreditAssetBalance: 460,
    });
    expect(summary).toMatchObject({
      totalAssetBalance: 1000,
      seedAssetBalance: 1000,
      creditAssetBalance: 0,
      frozenCreditAssetBalance: 460,
      cumulativeSpendAmount: 480,
    });
    expect(data.ledgers).toHaveLength(1);
    expect(data.ledgers[0]).toMatchObject({
      type: 'CONSUMPTION_PAID_FROZEN',
      subjectType: 'CREDIT_ASSET',
      amount: 460,
      assetAmount: 460,
      balanceAfter: 460,
      creditAssetBalanceAfter: 0,
      frozenCreditAssetBalanceAfter: 460,
      frozenCumulativeSpendAfter: 100,
      idempotencyKey: 'order:order-paid:credit-asset-frozen',
    });
  });

  it('received order releases existing frozen credit assets instead of minting twice', async () => {
    const { data, service } = makeHarness({
      accounts: [{
        id: 'account-1',
        userId: 'vip-user',
        cumulativeSpendAmount: 480,
        frozenCumulativeSpendAmount: 0,
        seedAssetBalance: 1000,
        creditAssetBalance: 0,
        frozenCreditAssetBalance: 0,
        historicalCreditGrantedAt: new Date('2026-06-01T00:00:00.000Z'),
        historicalCreditGrantLedgerId: 'ledger-historical',
      }],
      memberProfiles: [{ userId: 'vip-user', tier: 'VIP' }],
      orders: [{
        id: 'order-release',
        userId: 'vip-user',
        bizType: 'NORMAL_GOODS',
        status: 'PAID',
        receivedAt: null,
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

    await service.recordOrderPaid('order-release');
    data.orders[0].status = 'RECEIVED';
    data.orders[0].receivedAt = new Date('2026-06-21T00:00:00.000Z');
    await service.recordOrderReceived('order-release', 'ORDER_RECEIVED');
    await service.recordOrderReceived('order-release', 'ORDER_RECEIVED');

    expect(data.accounts[0]).toMatchObject({
      cumulativeSpendAmount: 580,
      frozenCumulativeSpendAmount: 0,
      seedAssetBalance: 1000,
      creditAssetBalance: 460,
      frozenCreditAssetBalance: 0,
    });
    expect(data.ledgers).toHaveLength(3);
    expect(data.ledgers[1]).toMatchObject({
      type: 'CONSUMPTION_CONFIRMED',
      subjectType: 'CUMULATIVE_SPEND',
      amount: 100,
      cumulativeSpendAfter: 580,
      frozenCumulativeSpendAfter: 0,
      idempotencyKey: 'order:order-release:spend-credit',
    });
    expect(data.ledgers[2]).toMatchObject({
      type: 'CONSUMPTION_FROZEN_RELEASED',
      subjectType: 'CREDIT_ASSET',
      amount: 460,
      assetAmount: 460,
      balanceAfter: 460,
      creditAssetBalanceAfter: 460,
      frozenCreditAssetBalanceAfter: 0,
      idempotencyKey: 'order:order-release:credit-asset-release',
    });
  });

  it('refund before receipt voids frozen assets without touching released balances', async () => {
    const { data, service } = makeHarness({
      accounts: [{
        id: 'account-1',
        userId: 'vip-user',
        cumulativeSpendAmount: 480,
        frozenCumulativeSpendAmount: 0,
        seedAssetBalance: 1000,
        creditAssetBalance: 0,
        frozenCreditAssetBalance: 0,
        historicalCreditGrantedAt: new Date('2026-06-01T00:00:00.000Z'),
        historicalCreditGrantLedgerId: 'ledger-historical',
      }],
      memberProfiles: [{ userId: 'vip-user', tier: 'VIP' }],
      orders: [{
        id: 'order-refund-before-receipt',
        userId: 'vip-user',
        bizType: 'NORMAL_GOODS',
        status: 'PAID',
        receivedAt: null,
        goodsAmount: 100,
        shippingFee: 0,
        discountAmount: 0,
        vipDiscountAmount: 0,
        totalCouponDiscount: 0,
        items: [
          { id: 'item-1', skuId: 'sku-1', quantity: 1, unitPrice: 100, isPrize: false, createdAt: new Date('2026-06-02') },
        ],
      }],
      refunds: [{
        id: 'refund-before-receipt',
        orderId: 'order-refund-before-receipt',
        afterSaleId: null,
        amount: 100,
        items: [{ orderItemId: 'item-1', quantity: 1, amount: 100 }],
      }],
    });

    await service.recordOrderPaid('order-refund-before-receipt');
    await service.reverseRefund('refund-before-receipt');

    expect(data.accounts[0]).toMatchObject({
      cumulativeSpendAmount: 480,
      frozenCumulativeSpendAmount: 0,
      creditAssetBalance: 0,
      frozenCreditAssetBalance: 0,
    });
    expect(data.ledgers).toHaveLength(2);
    expect(data.ledgers[1]).toMatchObject({
      type: 'CONSUMPTION_FROZEN_VOIDED',
      subjectType: 'CREDIT_ASSET',
      direction: 'DEBIT',
      amount: 460,
      assetAmount: 460,
      balanceAfter: 0,
      creditAssetBalanceAfter: 0,
      frozenCreditAssetBalanceAfter: 0,
      frozenCumulativeSpendAfter: 0,
      refundId: 'refund-before-receipt',
      idempotencyKey: 'refund:refund-before-receipt:digital-asset-frozen-void:credit',
    });
  });

  it('partial refund before receipt only releases the remaining frozen assets after receipt', async () => {
    const { data, service } = makeHarness({
      accounts: [{
        id: 'account-1',
        userId: 'vip-user',
        cumulativeSpendAmount: 480,
        frozenCumulativeSpendAmount: 0,
        seedAssetBalance: 1000,
        creditAssetBalance: 0,
        frozenCreditAssetBalance: 0,
        historicalCreditGrantedAt: new Date('2026-06-01T00:00:00.000Z'),
        historicalCreditGrantLedgerId: 'ledger-historical',
      }],
      memberProfiles: [{ userId: 'vip-user', tier: 'VIP' }],
      orders: [{
        id: 'order-partial-refund-before-receipt',
        userId: 'vip-user',
        bizType: 'NORMAL_GOODS',
        status: 'PAID',
        receivedAt: null,
        goodsAmount: 100,
        shippingFee: 0,
        discountAmount: 0,
        vipDiscountAmount: 0,
        totalCouponDiscount: 0,
        items: [
          { id: 'item-1', skuId: 'sku-1', quantity: 1, unitPrice: 100, isPrize: false, createdAt: new Date('2026-06-02') },
        ],
      }],
      refunds: [{
        id: 'refund-partial-before-receipt',
        orderId: 'order-partial-refund-before-receipt',
        afterSaleId: null,
        amount: 30,
        items: [{ orderItemId: 'item-1', quantity: 1, amount: 30 }],
      }],
    });

    await service.recordOrderPaid('order-partial-refund-before-receipt');
    await service.reverseRefund('refund-partial-before-receipt');
    data.orders[0].status = 'RECEIVED';
    data.orders[0].receivedAt = new Date('2026-06-21T00:00:00.000Z');
    await service.recordOrderReceived('order-partial-refund-before-receipt', 'ORDER_RECEIVED');

    expect(data.accounts[0]).toMatchObject({
      cumulativeSpendAmount: 550,
      frozenCumulativeSpendAmount: 0,
      creditAssetBalance: 322,
      frozenCreditAssetBalance: 0,
    });
    expect(data.ledgers).toHaveLength(4);
    expect(data.ledgers[1]).toMatchObject({
      type: 'CONSUMPTION_FROZEN_VOIDED',
      amount: 138,
      frozenCreditAssetBalanceAfter: 322,
      frozenCumulativeSpendAfter: 70,
      refundId: 'refund-partial-before-receipt',
    });
    expect(data.ledgers[2]).toMatchObject({
      type: 'CONSUMPTION_CONFIRMED',
      subjectType: 'CUMULATIVE_SPEND',
      amount: 70,
      cumulativeSpendAfter: 550,
      frozenCumulativeSpendAfter: 0,
    });
    expect(data.ledgers[3]).toMatchObject({
      type: 'CONSUMPTION_FROZEN_RELEASED',
      subjectType: 'CREDIT_ASSET',
      amount: 322,
      assetAmount: 322,
      creditAssetBalanceAfter: 322,
      frozenCreditAssetBalanceAfter: 0,
    });
  });

  it('replaying an order after ordinary user becomes VIP does not mint historical credit asset for that old order', async () => {
    const { data, service } = makeHarness({
      memberProfiles: [{ userId: 'buyer-1', tier: 'NORMAL' }],
      orders: [{
        id: 'order-replay',
        userId: 'buyer-1',
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

    await service.recordOrderReceived('order-replay', 'ORDER_RECEIVED');
    data.memberProfiles[0].tier = 'VIP';

    await service.recordOrderReceived('order-replay', 'ORDER_RECEIVED');

    expect(data.accounts[0]).toMatchObject({
      cumulativeSpendAmount: 100,
      seedAssetBalance: 0,
      creditAssetBalance: 0,
    });
    expect(data.ledgers).toHaveLength(1);
    expect(data.ledgers[0]).toMatchObject({
      type: 'CONSUMPTION_CONFIRMED',
      subjectType: 'CUMULATIVE_SPEND',
      amount: 100,
    });
  });

  it('VIP_PACKAGE order is ignored by received-order accounting to avoid duplicate VIP payment assets', async () => {
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

  it('GROUP_BUY order is ignored by paid and received-order digital asset accounting', async () => {
    const { data, service } = makeHarness({
      memberProfiles: [{ userId: 'vip-user', tier: 'VIP' }],
      orders: [{
        id: 'order-group-buy',
        userId: 'vip-user',
        bizType: 'GROUP_BUY',
        status: 'RECEIVED',
        receivedAt: new Date(),
        goodsAmount: 1000,
        shippingFee: 0,
        discountAmount: 0,
        vipDiscountAmount: 0,
        totalCouponDiscount: 0,
        items: [
          { id: 'item-1', skuId: 'sku-group-buy', quantity: 1, unitPrice: 1000, isPrize: false, createdAt: new Date('2026-06-04') },
        ],
      }],
    });

    await service.recordOrderPaid('order-group-buy');
    await service.recordOrderReceived('order-group-buy', 'ORDER_RECEIVED');

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

  it('records a pending retry row when refund reversal fails after refund success', async () => {
    const { data, service } = makeHarness({
      refunds: [{
        id: 'refund-1',
        orderId: 'order-1',
        afterSaleId: 'after-sale-1',
      }],
      afterSales: [{
        id: 'after-sale-1',
        refundId: 'refund-1',
        userId: 'buyer-1',
        orderId: 'order-1',
      }],
    });

    await (service as any).recordRefundReversalFailure('refund-1', new Error('asset down'), {
      source: 'AFTER_SALE_REFUND',
    });

    expect(data.reversalFailures).toHaveLength(1);
    expect(data.reversalFailures[0]).toMatchObject({
      refundId: 'refund-1',
      orderId: 'order-1',
      afterSaleId: 'after-sale-1',
      userId: 'buyer-1',
      status: 'PENDING',
      retryCount: 0,
      lastError: 'asset down',
      source: 'AFTER_SALE_REFUND',
    });
    expect(data.reversalFailures[0].nextRetryAt).toBeInstanceOf(Date);
  });

  it('retryPendingRefundReversals resolves pending rows without duplicate debits', async () => {
    const { data, service } = makeHarness({
      reversalFailures: [{
        id: 'failure-1',
        refundId: 'refund-1',
        orderId: 'order-1',
        userId: 'buyer-1',
        afterSaleId: 'after-sale-1',
        source: 'AUTO_REFUND',
        status: 'PENDING',
        retryCount: 1,
        nextRetryAt: new Date('2026-06-17T00:00:00.000Z'),
        lastError: 'temporary down',
        createdAt: new Date('2026-06-17T00:00:00.000Z'),
        updatedAt: new Date('2026-06-17T00:00:00.000Z'),
      }],
    });
    const reverseRefund = jest.spyOn(service, 'reverseRefund').mockResolvedValue(undefined);

    const result = await (service as any).retryPendingRefundReversals(new Date('2026-06-17T00:10:00.000Z'));

    expect(result).toEqual({ scanned: 1, resolved: 1, failed: 0 });
    expect(reverseRefund).toHaveBeenCalledWith('refund-1');
    expect(data.reversalFailures[0]).toMatchObject({
      status: 'RESOLVED',
      retryCount: 1,
      lastError: null,
    });
    expect(data.reversalFailures[0].resolvedAt).toBeInstanceOf(Date);
  });

  it('getSummary zeroes asset balances for non-VIP users and recent records only include cumulative spend rows', async () => {
    const { data, service } = makeHarness({
      ruleConfigs: [
        { key: 'DIGITAL_ASSET_CREDIT_TIERS', value: DEFAULT_CREDIT_TIERS },
        {
          key: 'DIGITAL_ASSET_MODULE_SETTINGS',
          value: {
            modules: [
              { key: 'equity', title: '工资/期权/股权', enabled: true, description: '现金兑换规则待定' },
              { key: 'futureRights', title: '未来权益模块', enabled: false, description: '规则待开放' },
            ],
          },
        },
      ],
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
      ledgers: [
        ...Array.from({ length: 4 }, (_, index) => ({
          id: `ledger-spend-${index + 1}`,
          accountId: 'account-1',
          userId: 'normal-user',
          type: 'CONSUMPTION_CONFIRMED',
          subjectType: 'CUMULATIVE_SPEND',
          direction: 'CREDIT',
          amount: 10 + index,
          balanceAfter: 10 + index,
          cumulativeSpendAfter: 10 + index,
          idempotencyKey: `ledger-spend-${index + 1}`,
          createdAt: new Date(`2026-06-0${index + 1}T00:00:00.000Z`),
        })),
        {
          id: 'ledger-credit-1',
          accountId: 'account-1',
          userId: 'normal-user',
          type: 'HISTORICAL_CONSUMPTION_GRANT',
          subjectType: 'CREDIT_ASSET',
          direction: 'CREDIT',
          amount: 888,
          assetAmount: 888,
          balanceAfter: 888,
          creditAssetBalanceAfter: 888,
          idempotencyKey: 'ledger-credit-1',
          createdAt: new Date('2026-06-09T00:00:00.000Z'),
        },
        {
          id: 'ledger-seed-1',
          accountId: 'account-1',
          userId: 'normal-user',
          type: 'SELF_VIP_PURCHASE',
          subjectType: 'SEED_ASSET',
          direction: 'CREDIT',
          amount: 999,
          assetAmount: 999,
          balanceAfter: 999,
          seedAssetBalanceAfter: 999,
          idempotencyKey: 'ledger-seed-1',
          createdAt: new Date('2026-06-10T00:00:00.000Z'),
        },
      ],
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
        description: '成为 VIP 后，累计消费可按规则转化为消费资产。',
        actionLabel: '开通 VIP 激活资产',
      },
    });
    expect(summary.vipSeedRules).toHaveLength(3);
    expect(summary.modules.filter((item: any) => item.key === 'futureRights')).toEqual([
      {
        key: 'futureRights',
        title: '未来权益模块',
        enabled: false,
        status: 'COMING_SOON',
        description: '规则待开放',
      },
    ]);
    expect(summary.recentRecords).toHaveLength(4);
    expect(summary.recentRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subjectType: 'CUMULATIVE_SPEND',
        title: '消费累计',
      }),
    ]));
    expect(summary.recentRecords.every((item: any) => item.subjectType === 'CUMULATIVE_SPEND')).toBe(true);
    expect(summary.recentRecords.some((item: any) => item.title === '历史消费转入' || item.title === '自购 VIP 种子资产')).toBe(false);
  });

  it('listLedgers for non-VIP buyers excludes seed and credit asset rows', async () => {
    const { service } = makeHarness({
      memberProfiles: [{ userId: 'normal-user', tier: 'NORMAL' }],
      ledgers: [
        {
          id: 'ledger-spend-1',
          accountId: 'account-1',
          userId: 'normal-user',
          type: 'CONSUMPTION_CONFIRMED',
          subjectType: 'CUMULATIVE_SPEND',
          direction: 'CREDIT',
          amount: 100,
          balanceAfter: 100,
          cumulativeSpendAfter: 100,
          idempotencyKey: 'ledger-spend-1',
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
        },
        {
          id: 'ledger-credit-1',
          accountId: 'account-1',
          userId: 'normal-user',
          type: 'HISTORICAL_CONSUMPTION_GRANT',
          subjectType: 'CREDIT_ASSET',
          direction: 'CREDIT',
          amount: 300,
          assetAmount: 300,
          balanceAfter: 300,
          creditAssetBalanceAfter: 300,
          idempotencyKey: 'ledger-credit-1',
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
        },
      ],
    });

    const result = await service.listBuyerLedgers('normal-user', {
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'ledger-spend-1',
        subjectType: 'CUMULATIVE_SPEND',
        title: '消费累计',
      }),
    ]);
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
      title: '消费资产入账',
      subjectType: 'CREDIT_ASSET',
      sourceType: 'CONSUMPTION_CONFIRMED',
      amount: 300,
    });
  });

  it('listLedgers excludes zero historical consumption transfer rows for VIP and admin views', async () => {
    const zeroHistoricalLedger = {
      id: 'ledger-zero-history',
      accountId: 'account-1',
      userId: 'vip-user',
      type: 'HISTORICAL_CONSUMPTION_GRANT',
      subjectType: 'CREDIT_ASSET',
      direction: 'CREDIT',
      amount: 0,
      assetAmount: 0,
      balanceAfter: 0,
      creditAssetBalanceAfter: 0,
      idempotencyKey: 'user:vip-user:historical-consumption-credit-grant',
      createdAt: new Date('2026-06-21T00:00:00.000Z'),
    };
    const { service } = makeHarness({
      memberProfiles: [{ userId: 'vip-user', tier: 'VIP' }],
      ledgers: [
        zeroHistoricalLedger,
        {
          id: 'ledger-self-seed',
          accountId: 'account-1',
          userId: 'vip-user',
          type: 'SELF_VIP_PURCHASE',
          subjectType: 'SEED_ASSET',
          direction: 'CREDIT',
          amount: 1000,
          assetAmount: 1000,
          balanceAfter: 1000,
          seedAssetBalanceAfter: 1000,
          idempotencyKey: 'vip-purchase:vp-1:self-seed',
          createdAt: new Date('2026-06-20T00:00:00.000Z'),
        },
        {
          id: 'ledger-positive-history',
          accountId: 'account-1',
          userId: 'vip-user',
          type: 'HISTORICAL_CONSUMPTION_GRANT',
          subjectType: 'CREDIT_ASSET',
          direction: 'CREDIT',
          amount: 300,
          assetAmount: 300,
          balanceAfter: 300,
          creditAssetBalanceAfter: 300,
          idempotencyKey: 'user:vip-user:historical-consumption-credit-grant-positive',
          createdAt: new Date('2026-06-19T00:00:00.000Z'),
        },
      ],
    });

    const buyerResult = await service.listBuyerLedgers('vip-user', { page: 1, pageSize: 20 });
    const adminResult = await service.listLedgers('vip-user', { page: 1, pageSize: 20 });

    for (const result of [buyerResult, adminResult]) {
      expect(result.total).toBe(2);
      expect(result.items.map((item: any) => item.id)).toEqual([
        'ledger-self-seed',
        'ledger-positive-history',
      ]);
      expect(result.items.some((item: any) => item.id === zeroHistoricalLedger.id)).toBe(false);
    }
  });

  it('marks historical consumption asset processed without creating a zero-amount ledger', async () => {
    const { data, service } = makeHarness({
      users: [{ id: 'buyer-1', status: 'ACTIVE', deletionExecutedAt: null }],
    });

    await service.grantVipActivationAssets((service as any).prisma, {
      userId: 'buyer-1',
      vipPurchaseId: 'vp-1',
      packageId: 'pkg-399',
      vipAmount: 399,
      inviterUserId: null,
    });

    expect(data.accounts[0]).toMatchObject({
      userId: 'buyer-1',
      cumulativeSpendAmount: 0,
      seedAssetBalance: 1000,
      creditAssetBalance: 0,
      historicalCreditGrantedAt: expect.any(Date),
      historicalCreditGrantLedgerId: null,
    });
    expect(data.ledgers).toHaveLength(1);
    expect(data.ledgers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'SELF_VIP_PURCHASE',
        subjectType: 'SEED_ASSET',
        amount: 1000,
        assetAmount: 1000,
        idempotencyKey: 'vip-purchase:vp-1:self-seed',
      }),
    ]));
    expect(data.ledgers.some((ledger) => ledger.type === 'HISTORICAL_CONSUMPTION_GRANT')).toBe(false);
  });

  it('does not grant referral seed assets to banned inviters', async () => {
    const { data, service } = makeHarness({
      users: [
        { id: 'buyer-1', status: 'ACTIVE', deletionExecutedAt: null },
        { id: 'inviter-1', status: 'BANNED', deletionExecutedAt: null },
      ],
      memberProfiles: [{ userId: 'inviter-1', tier: 'VIP' }],
    });

    await service.grantVipActivationAssets((service as any).prisma, {
      userId: 'buyer-1',
      vipPurchaseId: 'vp-1',
      packageId: 'pkg-399',
      vipAmount: 399,
      inviterUserId: 'inviter-1',
    });

    expect(data.accounts.some((account) => account.userId === 'inviter-1')).toBe(false);
    expect(data.ledgers.some((ledger) => ledger.type === 'REFERRAL_VIP_PURCHASE')).toBe(false);
  });

  it('backfills missing referral seed assets for historical VIP purchases', async () => {
    const { data, service } = makeHarness({
      users: [
        { id: 'buyer-1', status: 'ACTIVE', deletionExecutedAt: null },
        { id: 'inviter-1', status: 'ACTIVE', deletionExecutedAt: null },
      ],
      memberProfiles: [
        { userId: 'buyer-1', tier: 'VIP' },
        { userId: 'inviter-1', tier: 'VIP' },
      ],
      accounts: [{
        id: 'account-buyer',
        userId: 'buyer-1',
        cumulativeSpendAmount: 0,
        seedAssetBalance: 1000,
        creditAssetBalance: 0,
        historicalCreditGrantedAt: new Date('2026-06-17T00:00:00.000Z'),
        historicalCreditGrantLedgerId: 'ledger-historical',
      }],
      ledgers: [
        {
          id: 'ledger-self',
          accountId: 'account-buyer',
          userId: 'buyer-1',
          type: 'SELF_VIP_PURCHASE',
          subjectType: 'SEED_ASSET',
          direction: 'CREDIT',
          amount: 1000,
          assetAmount: 1000,
          balanceAfter: 1000,
          seedAssetBalanceAfter: 1000,
          creditAssetBalanceAfter: 0,
          vipPurchaseId: 'vp-1',
          idempotencyKey: 'vip-purchase:vp-1:self-seed',
          createdAt: new Date('2026-06-17T00:00:00.000Z'),
        },
        {
          id: 'ledger-historical',
          accountId: 'account-buyer',
          userId: 'buyer-1',
          type: 'HISTORICAL_CONSUMPTION_GRANT',
          subjectType: 'CREDIT_ASSET',
          direction: 'CREDIT',
          amount: 0,
          assetAmount: 0,
          balanceAfter: 0,
          creditAssetBalanceAfter: 0,
          vipPurchaseId: 'vp-1',
          idempotencyKey: 'user:buyer-1:historical-consumption-credit-grant',
          createdAt: new Date('2026-06-17T00:00:00.000Z'),
        },
      ],
    });

    const result = await service.backfillExistingVipAssets({
      userId: 'buyer-1',
      vipPurchaseId: 'vp-1',
      packageId: 'pkg-399',
      vipAmount: 399,
      inviterUserId: 'inviter-1',
    });

    expect(result).toMatchObject({
      status: 'credited',
      grantedSelfSeed: false,
      grantedHistoricalCredit: false,
      grantedReferralSeed: true,
    });
    expect(data.accounts.find((account) => account.userId === 'inviter-1')).toMatchObject({
      seedAssetBalance: 2000,
    });
    expect(data.ledgers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        userId: 'inviter-1',
        type: 'REFERRAL_VIP_PURCHASE',
        subjectType: 'SEED_ASSET',
        amount: 2000,
        assetAmount: 2000,
        vipPurchaseId: 'vp-1',
        idempotencyKey: 'vip-purchase:vp-1:referral-seed',
      }),
    ]));
  });

  it('does not grant referral seed assets to deleted inviters', async () => {
    const { data, service } = makeHarness({
      users: [
        { id: 'buyer-1', status: 'ACTIVE', deletionExecutedAt: null },
        { id: 'inviter-1', status: 'ACTIVE', deletionExecutedAt: new Date('2026-06-17T00:00:00.000Z') },
      ],
      memberProfiles: [{ userId: 'inviter-1', tier: 'VIP' }],
    });

    await service.grantVipActivationAssets((service as any).prisma, {
      userId: 'buyer-1',
      vipPurchaseId: 'vp-1',
      packageId: 'pkg-399',
      vipAmount: 399,
      inviterUserId: 'inviter-1',
    });

    expect(data.accounts.some((account) => account.userId === 'inviter-1')).toBe(false);
    expect(data.ledgers.some((ledger) => ledger.type === 'REFERRAL_VIP_PURCHASE')).toBe(false);
  });

  it('clears seed and credit assets while retaining cumulative spend and audit ledger rows', async () => {
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

    await service.clearAccountAssets((service as any).prisma, {
      userId: 'vip-user',
      reason: 'ACCOUNT_DELETION',
      idempotencyKey: 'digital-asset-clear:vip-user:account-deletion',
    });

    expect(data.accounts[0]).toMatchObject({
      cumulativeSpendAmount: 580,
      seedAssetBalance: 0,
      creditAssetBalance: 0,
    });
    expect(data.ledgers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'ADMIN_ADJUSTMENT',
        subjectType: 'SEED_ASSET',
        direction: 'DEBIT',
        amount: 1000,
        assetAmount: 1000,
        seedAssetBalanceAfter: 0,
        creditAssetBalanceAfter: 460,
      }),
      expect.objectContaining({
        type: 'ADMIN_ADJUSTMENT',
        subjectType: 'CREDIT_ASSET',
        direction: 'DEBIT',
        amount: 460,
        assetAmount: 460,
        seedAssetBalanceAfter: 0,
        creditAssetBalanceAfter: 0,
      }),
    ]));
  });
});
