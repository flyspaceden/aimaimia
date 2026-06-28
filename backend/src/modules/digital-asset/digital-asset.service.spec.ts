import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DigitalAssetService } from './digital-asset.service';

type DataSet = {
  accounts: any[];
  ledgers: any[];
  orders: any[];
  refunds: any[];
  afterSales: any[];
  memberProfiles: any[];
};

const makeHarness = (initial?: Partial<DataSet>) => {
  const data: DataSet = {
    accounts: initial?.accounts ?? [],
    ledgers: initial?.ledgers ?? [],
    orders: initial?.orders ?? [],
    refunds: initial?.refunds ?? [],
    afterSales: initial?.afterSales ?? [],
    memberProfiles: initial?.memberProfiles ?? [],
  };

  const memberTierOf = (userId: string) =>
    data.memberProfiles.find((profile) => profile.userId === userId)?.tier ?? null;

  const filterAccounts = (where: any) => data.accounts.filter((account) => {
    if (where?.userId && account.userId !== where.userId) return false;
    if (where?.id && account.id !== where.id) return false;
    if (where?.cumulativeSpendAmount?.gt !== undefined && !(account.cumulativeSpendAmount > where.cumulativeSpendAmount.gt)) {
      return false;
    }
    const requiredTier = where?.user?.memberProfile?.is?.tier;
    if (requiredTier && memberTierOf(account.userId) !== requiredTier) return false;
    return true;
  });

  const matchesField = (actual: any, expected: any) => {
    if (expected === undefined) return true;
    if (expected && Array.isArray(expected.in)) return expected.in.includes(actual);
    return actual === expected;
  };

  const filterLedgers = (where: any) => data.ledgers.filter((ledger) => {
    if (where?.orderId && ledger.orderId !== where.orderId) return false;
    if (where?.userId && ledger.userId !== where.userId) return false;
    if (!matchesField(ledger.direction, where?.direction)) return false;
    if (!matchesField(ledger.type, where?.type)) return false;
    if (!matchesField(ledger.subjectType, where?.subjectType)) return false;
    if (where?.accountId && ledger.accountId !== where.accountId) return false;
    return true;
  });

  const tx: any = {
    order: {
      findUnique: jest.fn(({ where }: any) => data.orders.find((order) => order.id === where.id) ?? null),
    },
    digitalAssetAccount: {
      findUnique: jest.fn(({ where }: any) =>
        filterAccounts(where)[0] ?? null,
      ),
      count: jest.fn(({ where }: any) => filterAccounts(where).length),
      create: jest.fn(({ data: createData }: any) => {
        const account = {
          id: `account-${data.accounts.length + 1}`,
          cumulativeSpendAmount: 0,
          ...createData,
        };
        data.accounts.push(account);
        return account;
      }),
      update: jest.fn(({ where, data: updateData }: any) => {
        const account = data.accounts.find((item) => item.id === where.id);
        Object.assign(account, {
          cumulativeSpendAmount: updateData.cumulativeSpendAmount,
        });
        return account;
      }),
    },
    digitalAssetLedger: {
      findUnique: jest.fn(({ where }: any) =>
        data.ledgers.find((ledger) => ledger.idempotencyKey === where.idempotencyKey) ?? null,
      ),
      findMany: jest.fn(({ where }: any) => filterLedgers(where)),
      count: jest.fn(({ where }: any) => filterLedgers(where).length),
      create: jest.fn(({ data: createData }: any) => {
        const ledger = {
          id: `ledger-${data.ledgers.length + 1}`,
          createdAt: new Date(),
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
    refundItem: {
      findMany: jest.fn(({ where }: any) =>
        data.refunds.find((refund) => refund.id === where.refundId)?.items ?? [],
      ),
    },
    afterSaleRequest: {
      findFirst: jest.fn(({ where }: any) =>
        data.afterSales.find((request) => request.refundId === where.refundId) ?? null,
      ),
      findUnique: jest.fn(({ where }: any) =>
        data.afterSales.find((request) => request.id === where.id) ?? null,
      ),
    },
    memberProfile: {
      findUnique: jest.fn(({ where }: any) =>
        data.memberProfiles.find((profile) => profile.userId === where.userId) ?? null,
      ),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (callback: any, options: any) => callback(tx),),
    digitalAssetAccount: tx.digitalAssetAccount,
    digitalAssetLedger: tx.digitalAssetLedger,
    memberProfile: tx.memberProfile,
  };

  return { data, prisma, tx, service: new DigitalAssetService(prisma as any) };
};

const receivedOrder = {
  id: 'order-1',
  userId: 'user-1',
  status: 'RECEIVED',
  receivedAt: new Date(),
  goodsAmount: 120,
  shippingFee: 12,
  discountAmount: 10,
  vipDiscountAmount: 5,
  totalCouponDiscount: 5,
  items: [
    { id: 'item-1', skuId: 'sku-1', quantity: 1, unitPrice: 60, isPrize: false, createdAt: new Date('2026-01-01') },
    { id: 'item-2', skuId: 'sku-2', quantity: 1, unitPrice: 60, isPrize: false, createdAt: new Date('2026-01-02') },
  ],
};

describe('DigitalAssetService', () => {
  it('ranks a VIP digital asset account among VIP accounts by cumulative spend amount', async () => {
    const { service } = makeHarness({
      accounts: [
        { id: 'account-current', userId: 'user-current', cumulativeSpendAmount: 80 },
        { id: 'account-vip-higher', userId: 'user-vip-higher', cumulativeSpendAmount: 120 },
        { id: 'account-normal-higher', userId: 'user-normal-higher', cumulativeSpendAmount: 500 },
        { id: 'account-vip-lower', userId: 'user-vip-lower', cumulativeSpendAmount: 10 },
      ],
      memberProfiles: [
        { userId: 'user-current', tier: 'VIP' },
        { userId: 'user-vip-higher', tier: 'VIP' },
        { userId: 'user-normal-higher', tier: 'NORMAL' },
        { userId: 'user-vip-lower', tier: 'VIP' },
      ],
    });

    await expect(service.getSummary('user-current')).resolves.toMatchObject({
      cumulativeSpendAmount: 80,
      assetRank: 2,
    });
  });

  it('does not rank a user without a digital asset account', async () => {
    const { service } = makeHarness({
      accounts: [
        { id: 'account-vip-higher', userId: 'user-vip-higher', cumulativeSpendAmount: 120 },
      ],
      memberProfiles: [
        { userId: 'user-current', tier: 'VIP' },
        { userId: 'user-vip-higher', tier: 'VIP' },
      ],
    });

    await expect(service.getSummary('user-current')).resolves.toMatchObject({
      cumulativeSpendAmount: 0,
      assetRank: null,
    });
  });

  it('does not rank a non-VIP account in the VIP digital asset leaderboard', async () => {
    const { service } = makeHarness({
      accounts: [
        { id: 'account-current', userId: 'user-current', cumulativeSpendAmount: 500 },
        { id: 'account-vip-lower', userId: 'user-vip-lower', cumulativeSpendAmount: 10 },
      ],
      memberProfiles: [
        { userId: 'user-current', tier: 'NORMAL' },
        { userId: 'user-vip-lower', tier: 'VIP' },
      ],
    });

    await expect(service.getSummary('user-current')).resolves.toMatchObject({
      cumulativeSpendAmount: 500,
      assetRank: null,
    });
  });

  it('credits a received order once with item allocations and Serializable isolation', async () => {
    const { data, prisma, service } = makeHarness({ orders: [receivedOrder] });

    await service.creditOrderReceived('order-1', 'ORDER_RECEIVED');

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(data.accounts[0]).toMatchObject({
      userId: 'user-1',
      cumulativeSpendAmount: 100,
    });
    expect(data.ledgers[0]).toMatchObject({
      userId: 'user-1',
      type: 'CONSUMPTION_CONFIRMED',
      subjectType: 'CUMULATIVE_SPEND',
      direction: 'CREDIT',
      amount: 100,
      balanceAfter: 100,
      orderId: 'order-1',
      idempotencyKey: 'order:order-1:spend-credit',
    });
    expect(data.ledgers[0].meta).toMatchObject({
      itemAllocations: [
        { orderItemId: 'item-1', skuId: 'sku-1', quantity: 1, grossAmount: 60, assetAmount: 50 },
        { orderItemId: 'item-2', skuId: 'sku-2', quantity: 1, grossAmount: 60, assetAmount: 50 },
      ],
      residualOrderItemId: 'item-2',
      source: 'ORDER_RECEIVED',
    });
  });

  it('uses the same idempotency key for backfill and skips duplicate credit', async () => {
    const { data, service } = makeHarness({
      orders: [receivedOrder],
      accounts: [{ id: 'account-1', userId: 'user-1', cumulativeSpendAmount: 100 }],
      ledgers: [{
        id: 'ledger-existing',
        accountId: 'account-1',
        userId: 'user-1',
        direction: 'CREDIT',
        type: 'CONSUMPTION_CONFIRMED',
        subjectType: 'CUMULATIVE_SPEND',
        amount: 100,
        balanceAfter: 100,
        orderId: 'order-1',
        idempotencyKey: 'order:order-1:spend-credit',
        meta: {},
      }],
    });

    await service.creditOrderReceived('order-1', 'BACKFILL');

    expect(data.ledgers).toHaveLength(1);
    expect(data.accounts[0].cumulativeSpendAmount).toBe(100);
  });

  it('reverseRefund skips when an after-sale fallback ledger already exists', async () => {
    const { data, service } = makeHarness({
      refunds: [{ id: 'refund-1', orderId: 'order-1', afterSaleId: 'after-sale-1', amount: 80, items: [] }],
      ledgers: [{
        id: 'ledger-fallback',
        idempotencyKey: 'after-sale:after-sale-1:cumulative-spend-reversal',
        refundId: null,
        afterSaleId: 'after-sale-1',
      }],
    });

    await service.reverseRefund('refund-1');

    expect(data.ledgers).toHaveLength(1);
    expect(data.ledgers[0].refundId).toBe('refund-1');
  });

  it('reverseAfterSale without refundId writes fallback debit ledger with reversed item metadata', async () => {
    const { data, service } = makeHarness({
      accounts: [{ id: 'account-1', userId: 'user-1', cumulativeSpendAmount: 100 }],
      orders: [receivedOrder],
      afterSales: [{
        id: 'after-sale-1',
        orderId: 'order-1',
        userId: 'user-1',
        orderItemId: 'item-1',
        refundId: null,
        refundAmount: 88,
        returnShippingFee: 8,
        shippingPayment: { status: 'REFUNDED', amount: 10 },
      }],
      ledgers: [{
        id: 'ledger-credit',
        accountId: 'account-1',
        userId: 'user-1',
        direction: 'CREDIT',
        type: 'CONSUMPTION_CONFIRMED',
        subjectType: 'CUMULATIVE_SPEND',
        amount: 100,
        balanceAfter: 100,
        orderId: 'order-1',
        idempotencyKey: 'order:order-1:spend-credit',
        meta: {
          itemAllocations: [
            { orderItemId: 'item-1', skuId: 'sku-1', quantity: 1, grossAmount: 60, assetAmount: 50 },
            { orderItemId: 'item-2', skuId: 'sku-2', quantity: 1, grossAmount: 60, assetAmount: 50 },
          ],
        },
      }],
    });

    await service.reverseAfterSale('after-sale-1');

    expect(data.accounts[0].cumulativeSpendAmount).toBe(50);
    expect(data.ledgers).toHaveLength(2);
    expect(data.ledgers[1]).toMatchObject({
      accountId: 'account-1',
      userId: 'user-1',
      type: 'REFUND_REVERSAL',
      subjectType: 'CUMULATIVE_SPEND',
      direction: 'DEBIT',
      amount: 50,
      balanceAfter: 50,
      orderId: 'order-1',
      afterSaleId: 'after-sale-1',
      idempotencyKey: 'after-sale:after-sale-1:cumulative-spend-reversal',
    });
    expect(data.ledgers[1].meta.reversedItems).toEqual([
      {
        orderItemId: 'item-1',
        quantity: 1,
        originalAssetAmount: 50,
        alreadyReversedAmount: 0,
        reversedAmount: 50,
      },
    ]);
  });

  it('reverseRefund without item rows caps the whole refund amount once across allocations', async () => {
    const { data, service } = makeHarness({
      accounts: [{ id: 'account-1', userId: 'user-1', cumulativeSpendAmount: 100 }],
      orders: [receivedOrder],
      refunds: [{ id: 'refund-1', orderId: 'order-1', afterSaleId: null, amount: 30, items: [] }],
      ledgers: [{
        id: 'ledger-credit',
        accountId: 'account-1',
        userId: 'user-1',
        direction: 'CREDIT',
        type: 'CONSUMPTION_CONFIRMED',
        subjectType: 'CUMULATIVE_SPEND',
        amount: 100,
        balanceAfter: 100,
        orderId: 'order-1',
        idempotencyKey: 'order:order-1:spend-credit',
        meta: {
          itemAllocations: [
            { orderItemId: 'item-1', skuId: 'sku-1', quantity: 1, grossAmount: 60, assetAmount: 50 },
            { orderItemId: 'item-2', skuId: 'sku-2', quantity: 1, grossAmount: 60, assetAmount: 50 },
          ],
        },
      }],
    });

    await service.reverseRefund('refund-1');

    expect(data.accounts[0].cumulativeSpendAmount).toBe(70);
    expect(data.ledgers[1]).toMatchObject({
      type: 'REFUND_REVERSAL',
      subjectType: 'CUMULATIVE_SPEND',
      direction: 'DEBIT',
      amount: 30,
      balanceAfter: 70,
      refundId: 'refund-1',
    });
    expect(data.ledgers[1].meta.reversedItems).toEqual([
      {
        orderItemId: 'item-1',
        quantity: 1,
        originalAssetAmount: 50,
        alreadyReversedAmount: 0,
        reversedAmount: 30,
      },
    ]);
  });

  it('reverseRefund with explicit zero product amount does not debit the whole order', async () => {
    const { data, service } = makeHarness({
      accounts: [{ id: 'account-1', userId: 'user-1', cumulativeSpendAmount: 100 }],
      orders: [receivedOrder],
      refunds: [{ id: 'refund-1', orderId: 'order-1', afterSaleId: null, amount: 0, items: [] }],
      ledgers: [{
        id: 'ledger-credit',
        accountId: 'account-1',
        userId: 'user-1',
        direction: 'CREDIT',
        type: 'CONSUMPTION_CONFIRMED',
        subjectType: 'CUMULATIVE_SPEND',
        amount: 100,
        balanceAfter: 100,
        orderId: 'order-1',
        idempotencyKey: 'order:order-1:spend-credit',
        meta: {
          itemAllocations: [
            { orderItemId: 'item-1', skuId: 'sku-1', quantity: 1, grossAmount: 60, assetAmount: 50 },
            { orderItemId: 'item-2', skuId: 'sku-2', quantity: 1, grossAmount: 60, assetAmount: 50 },
          ],
        },
      }],
    });

    await service.reverseRefund('refund-1');

    expect(data.accounts[0].cumulativeSpendAmount).toBe(100);
    expect(data.ledgers).toHaveLength(1);
  });

  it('reverseAfterSale delegates to reverseRefund when refundId exists', async () => {
    const { service } = makeHarness({
      afterSales: [{ id: 'after-sale-1', refundId: 'refund-1' }],
      refunds: [{ id: 'refund-1', orderId: 'order-1', afterSaleId: 'after-sale-1', amount: 0, items: [] }],
    });
    const reverseRefund = jest.spyOn(service, 'reverseRefund').mockResolvedValue();

    await service.reverseAfterSale('after-sale-1');

    expect(reverseRefund).toHaveBeenCalledWith('refund-1');
  });

  it('rejects admin debit that would make the balance negative', async () => {
    const { service } = makeHarness({
      accounts: [{ id: 'account-1', userId: 'user-1', cumulativeSpendAmount: 10 }],
    });

    await expect(service.adjustByAdmin({
      targetUserId: 'user-1',
      adminUserId: 'admin-1',
      amount: 20,
      direction: 'DEBIT',
      reason: '测试扣减',
    })).rejects.toThrow(BadRequestException);
  });

  it('deduplicates admin adjustment by client idempotency key', async () => {
    const { data, service } = makeHarness({
      accounts: [{ id: 'account-1', userId: 'user-1', cumulativeSpendAmount: 10 }],
      ledgers: [{
        id: 'ledger-existing',
        idempotencyKey: 'admin-adjust-client:client-1',
        type: 'ADMIN_ADJUSTMENT',
      }],
    });

    await service.adjustByAdmin({
      targetUserId: 'user-1',
      adminUserId: 'admin-1',
      amount: 20,
      direction: 'CREDIT',
      reason: '测试增加',
      clientIdempotencyKey: 'client-1',
    });

    expect(data.ledgers).toHaveLength(1);
    expect(data.accounts[0].cumulativeSpendAmount).toBe(10);
  });
});
