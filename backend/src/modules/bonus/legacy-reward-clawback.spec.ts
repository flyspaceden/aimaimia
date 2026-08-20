import {
  calculateUncoveredLegacyClawbackCents,
  settleLegacyRewardClawbacksInTransaction,
} from './legacy-reward-clawback';

describe('legacy reward clawback settlement', () => {
  function harness(balance = 0.5, amount = -1.5) {
    const pending = {
      id: 'clawback-1',
      userId: 'user-1',
      accountId: 'vip-account-1',
      amount,
      status: 'RETURN_FROZEN',
      entryType: 'VOID',
      refType: 'AFTER_SALE_CLAWBACK',
      refId: 'order-1',
      meta: { clawbackAmount: Math.abs(amount), recoveredAmount: 0 },
    };
    const tx: any = {
      rewardLedger: {
        findMany: jest.fn().mockResolvedValue([pending]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'platform-recovery-1' }),
      },
      rewardAccount: {
        findMany: jest.fn().mockResolvedValue([{ id: 'vip-account-1', balance }]),
        findUnique: jest.fn().mockResolvedValue({ id: 'vip-account-1', balance }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return { tx, pending };
  }

  it('recovers future balance in cents and leaves only the unresolved debt pending', async () => {
    const { tx } = harness(0.5, -1.5);

    await expect(settleLegacyRewardClawbacksInTransaction(tx, 'user-1')).resolves.toEqual({
      recoveredCents: 50,
      remainingCents: 100,
    });
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'vip-account-1', balance: { gte: 0.5 } },
      data: { balance: { decrement: 0.5 } },
    });
    expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'clawback-1',
        status: 'RETURN_FROZEN',
        entryType: 'VOID',
        amount: -1.5,
      },
      data: expect.objectContaining({ amount: -1, status: 'RETURN_FROZEN' }),
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'PLATFORM',
        amount: 0.5,
        idempotencyKey: 'legacy-clawback-recovery:clawback-1:150',
      }),
    });
  });

  it('reports only debt that current matching account balances cannot cover', async () => {
    const { tx } = harness(1, -1.5);

    await expect(calculateUncoveredLegacyClawbackCents(tx, 'user-1')).resolves.toBe(50);
  });

  it('recovers an industry-fund legacy debt from subsequent industry income', async () => {
    const { tx, pending } = harness(2, -1.5);
    pending.accountId = 'industry-account-1';
    tx.rewardAccount.findMany.mockResolvedValue([{
      id: 'industry-account-1',
      type: 'INDUSTRY_FUND',
      balance: 2,
    }]);

    await expect(settleLegacyRewardClawbacksInTransaction(tx, 'user-1')).resolves.toEqual({
      recoveredCents: 150,
      remainingCents: 0,
    });
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'industry-account-1', balance: { gte: 1.5 } },
      data: { balance: { decrement: 1.5 } },
    });
  });

  it('is idempotent when the settlement entrypoint is retried after a committed recovery', async () => {
    let pendingActive = true;
    let balance = 1.5;
    const pending = {
      id: 'clawback-repeat',
      userId: 'user-1',
      accountId: 'vip-account-1',
      amount: -1.5,
      status: 'RETURN_FROZEN',
      entryType: 'VOID',
      refType: 'AFTER_SALE_CLAWBACK',
      refId: 'order-1',
      meta: {},
    };
    const tx: any = {
      rewardLedger: {
        findMany: jest.fn(async () => (pendingActive ? [pending] : [])),
        updateMany: jest.fn(async () => {
          if (!pendingActive) return { count: 0 };
          pendingActive = false;
          return { count: 1 };
        }),
        create: jest.fn().mockResolvedValue({}),
      },
      rewardAccount: {
        findMany: jest.fn(async () => [{ id: 'vip-account-1', type: 'VIP_REWARD', balance }]),
        updateMany: jest.fn(async ({ data }: any) => {
          balance -= Number(data.balance.decrement);
          return { count: 1 };
        }),
        upsert: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    await expect(settleLegacyRewardClawbacksInTransaction(tx, 'user-1'))
      .resolves.toEqual({ recoveredCents: 150, remainingCents: 0 });
    await expect(settleLegacyRewardClawbacksInTransaction(tx, 'user-1'))
      .resolves.toEqual({ recoveredCents: 0, remainingCents: 0 });
    expect(tx.rewardLedger.create).toHaveBeenCalledTimes(1);
    expect(balance).toBe(0);
  });
});
