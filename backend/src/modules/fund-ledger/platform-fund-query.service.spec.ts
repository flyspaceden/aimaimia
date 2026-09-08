import { BadRequestException } from '@nestjs/common';
import { PlatformFundQueryService } from './platform-fund-query.service';

const date = new Date('2026-09-08T00:00:00.000Z');

describe('PlatformFundQueryService', () => {
  it('reconstructs from the immutable opening plus all-time account movement while keeping period flows separate', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        {
          fundType: 'PLATFORM_PROFIT',
          initialBalance: 10,
          initialFrozen: 2,
          cutoverBalance: 10,
          cutoverFrozen: 2,
          periodIncome: 3,
          periodExpense: 1,
          netMovement: 2,
          allTimeNetMovement: 999,
          currentBalance: 12,
          currentFrozen: 2,
          reconstructedTotal: 14,
          currentTotal: 14,
          lastEntryAt: date,
        },
      ])
      .mockResolvedValueOnce([{ fundType: 'PLATFORM_PROFIT', allTimeNetMovement: 4 }]);
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: { $queryRaw: typeof queryRaw }) => unknown) => callback({ $queryRaw: queryRaw })),
    } as any;
    const service = new PlatformFundQueryService(prisma);

    const result = await service.summary({ from: '2026-09-07T00:00:00.000Z', to: '2026-09-08T23:59:59.000Z' });
    const row = result.funds.find((fund) => fund.fundType === 'PLATFORM_PROFIT');

    expect(row).toEqual(expect.objectContaining({
      initialBalance: 10,
      periodIncome: 3,
      periodExpense: 1,
      reconstructedTotal: 16,
      currentTotal: 14,
    }));
  });

  it('returns a folded ledger source with its paired account balance and redacts sensitive metadata', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        id: 'pfe-source',
        fundType: 'PLATFORM_PROFIT',
        auditEventType: 'LEDGER_CREATED',
        logicalEventType: 'RELEASE',
        changeKind: 'MONEY',
        eventSequence: BigInt(8),
        transactionId: BigInt(100),
        occurredAt: date,
        recordedAt: date,
        sourceTable: 'RewardLedger',
        sourceOperation: 'INSERT',
        rewardLedgerId: 'ledger-source',
        allocationId: 'allocation-source',
        sourceLedgerId: null,
        orderId: 'order-source',
        companyId: 'company-source',
        sourceType: 'VIP',
        statusBefore: null,
        statusAfter: 'AVAILABLE',
        ledgerEntryTypeBefore: null,
        ledgerEntryTypeAfter: 'RELEASE',
        ledgerAmountBefore: null,
        ledgerAmountAfter: 5,
        ledgerAmountDelta: 5,
        amount: 5,
        sourceAmount: 5,
        direction: 'CREDIT',
        balanceAfter: 19,
        frozenAfter: 2,
        pairedAccountEventId: 'pfe-account',
        metaSnapshot: {
          scheme: 'VIP_PLATFORM_SPLIT',
          phone: '13800000000',
          configSnapshot: { ratio: 0.1, bankAccount: '6222000000000000' },
        },
        total: BigInt(1),
      },
    ]);
    const prisma = { $queryRaw: queryRaw } as any;
    const service = new PlatformFundQueryService(prisma);

    const result = await service.entries('PLATFORM_PROFIT', { page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      amount: 5,
      sourceAmount: 5,
      balanceAfter: 19,
      sourceType: 'VIP',
      orderId: 'order-source',
    }));
    expect(result.items[0].snapshot).toEqual({
      scheme: 'VIP_PLATFORM_SPLIT',
      configSnapshot: { ratio: 0.1 },
    });
    expect(JSON.stringify(result.items[0])).not.toContain('13800000000');
    expect(JSON.stringify(result.items[0])).not.toContain('6222000000000000');
  });

  it('keeps an un-audited historical RewardLedger row read-only and maps debit entries by their legacy semantics', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        id: 'legacy:legacy-withdraw',
        fundType: 'FUND_POOL',
        auditEventType: 'HISTORICAL_REWARD_LEDGER',
        logicalEventType: 'PAYMENT',
        changeKind: 'STATE',
        eventSequence: null,
        transactionId: null,
        occurredAt: date,
        recordedAt: date,
        sourceTable: 'RewardLedger',
        sourceOperation: 'HISTORICAL',
        rewardLedgerId: 'legacy-withdraw',
        allocationId: null,
        sourceLedgerId: null,
        orderId: 'legacy-order',
        companyId: null,
        sourceType: 'LEGACY',
        statusBefore: null,
        statusAfter: 'WITHDRAWN',
        ledgerEntryTypeBefore: null,
        ledgerEntryTypeAfter: 'WITHDRAW',
        ledgerAmountBefore: null,
        ledgerAmountAfter: 2,
        ledgerAmountDelta: 2,
        amount: -2,
        sourceAmount: 2,
        direction: 'DEBIT',
        balanceAfter: null,
        frozenAfter: null,
        pairedAccountEventId: null,
        metaSnapshot: { scheme: 'PLATFORM_SPLIT', phone: 'hidden' },
        total: 1,
      },
    ]);
    const service = new PlatformFundQueryService({ $queryRaw: queryRaw } as any);

    const result = await service.entries('FUND_POOL', { page: 1, pageSize: 20, sourceType: 'LEGACY' });
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: 'legacy:legacy-withdraw',
      amount: -2,
      direction: 'DEBIT',
      sourceAmount: 2,
    }));
    expect(result.items[0].metadata).toEqual(expect.objectContaining({ historical: true, audited: false }));
  });

  it('rejects unsupported fund types and reversed date ranges before querying', async () => {
    const service = new PlatformFundQueryService({ $queryRaw: jest.fn() } as any);
    await expect(service.entries('NORMAL_BROADCAST', { page: 1, pageSize: 20 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.entries('POINTS', {
      page: 1,
      pageSize: 20,
      from: '2026-09-09T00:00:00.000Z',
      to: '2026-09-08T00:00:00.000Z',
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
