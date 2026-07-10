import { CaptainCommissionService } from './captain-commission.service';
import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from './captain.constants';

const oldReceivedAt = new Date('2026-06-20T00:00:00.000Z');

function makeAttribution(overrides: any = {}) {
  return {
    id: 'attr-1',
    orderId: 'order-1',
    programCode: DEFAULT_CAPTAIN_SEAFOOD_CONFIG.programCode,
    commissionBase: 100,
    refundAmount: 0,
    status: 'FROZEN',
    configSnapshot: {
      ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
      enabled: true,
      orderRules: {
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.orderRules,
        freezeDaysAfterReceived: 7,
      },
    },
    order: {
      id: 'order-1',
      status: 'RECEIVED',
      receivedAt: oldReceivedAt,
      returnWindowExpiresAt: oldReceivedAt,
      refunds: [],
      afterSaleRequests: [],
    },
    ledgers: [
      {
        id: 'ledger-direct',
        accountId: 'account-direct',
        userId: 'captain-1',
        orderId: 'order-1',
        orderAttributionId: 'attr-1',
        programCode: DEFAULT_CAPTAIN_SEAFOOD_CONFIG.programCode,
        type: 'DIRECT_ORDER',
        status: 'FROZEN',
        amount: 9,
        commissionBase: 100,
        rate: 0.09,
        configSnapshot: DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
        meta: {},
      },
      {
        id: 'ledger-indirect',
        accountId: 'account-indirect',
        userId: 'captain-0',
        orderId: 'order-1',
        orderAttributionId: 'attr-1',
        programCode: DEFAULT_CAPTAIN_SEAFOOD_CONFIG.programCode,
        type: 'LEGACY_INDIRECT_ORDER',
        status: 'FROZEN',
        amount: 2,
        commissionBase: 100,
        rate: 0.02,
        configSnapshot: DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
        meta: {},
      },
    ],
    ...overrides,
  };
}

function createHarness(attribution: any = makeAttribution(), priorVoidLedgers: any[] = []) {
  const tx: any = {
    captainOrderAttribution: {
      findUnique: jest.fn().mockResolvedValue(attribution),
      update: jest.fn().mockResolvedValue({}),
    },
    captainCommissionLedger: {
      findMany: jest.fn().mockResolvedValue(priorVoidLedgers),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    captainAccount: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id === 'account-direct') {
          return { id: 'account-direct', frozen: 9, balance: 9, clawback: 0 };
        }
        return { id: 'account-indirect', frozen: 2, balance: 2, clawback: 0 };
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    orderStatusHistory: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma: any = {
    $transaction: jest.fn(async (callback: any) => callback(tx)),
    orderStatusHistory: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
  return {
    tx,
    prisma,
    service: new CaptainCommissionService(prisma),
  };
}

describe('CaptainCommissionService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-08T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('releases frozen order ledgers after receive freeze days have passed', async () => {
    const { service, tx } = createHarness();

    await expect(service.releaseForReceivedOrder('order-1', 'BUYER_RECEIVED')).resolves.toBe('released');

    expect(tx.captainOrderAttribution.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        ledgers: expect.objectContaining({
          where: expect.objectContaining({
            type: { in: ['DIRECT_ORDER', 'LEGACY_INDIRECT_ORDER'] },
          }),
        }),
      }),
    }));
    expect(tx.captainCommissionLedger.update).toHaveBeenCalledTimes(2);
    expect(tx.captainCommissionLedger.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'ledger-direct' },
      data: expect.objectContaining({
        status: 'AVAILABLE',
        balanceAfter: 18,
        frozenAfter: 0,
      }),
    });
    expect(tx.captainAccount.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'account-direct' },
      data: {
        frozen: { decrement: 9 },
        balance: { increment: 9 },
      },
    });
    expect(tx.captainOrderAttribution.update).toHaveBeenCalledWith({
      where: { id: 'attr-1' },
      data: expect.objectContaining({ status: 'AVAILABLE' }),
    });
  });

  it('skips release before the configured freeze days have passed', async () => {
    const attribution = makeAttribution({
      order: {
        ...makeAttribution().order,
        receivedAt: new Date('2026-07-07T00:00:00.000Z'),
        returnWindowExpiresAt: new Date('2026-07-07T00:00:00.000Z'),
      },
    });
    const { service, tx } = createHarness(attribution);

    await expect(service.releaseForReceivedOrder('order-1', 'BUYER_RECEIVED')).resolves.toBe('skipped');

    expect(tx.captainCommissionLedger.update).not.toHaveBeenCalled();
    expect(tx.captainAccount.update).not.toHaveBeenCalled();
  });

  it('voids frozen ledgers and decrements frozen account balance after refund', async () => {
    const { service, tx } = createHarness();

    await expect(service.voidForRefund('order-1', 'refund-1', 100)).resolves.toBe('voided');

    expect(tx.captainCommissionLedger.update).toHaveBeenCalledWith({
      where: { id: 'ledger-direct' },
      data: expect.objectContaining({
        status: 'VOIDED',
        frozenAfter: 0,
      }),
    });
    expect(tx.captainCommissionLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'captain-1',
        type: 'VOID',
        status: 'VOIDED',
        amount: -9,
        idempotencyKey: 'captain:void:order-1:refund-1:ledger-direct',
        refType: 'REFUND',
        refId: 'refund-1',
      }),
    });
    expect(tx.captainAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-direct' },
      data: { frozen: { decrement: 9 } },
    });
  });

  it('creates clawback pending void ledgers when available balance is insufficient after refund', async () => {
    const attribution = makeAttribution({
      status: 'AVAILABLE',
      ledgers: [
        {
          ...makeAttribution().ledgers[0],
          status: 'AVAILABLE',
          amount: 9,
        },
      ],
    });
    const { service, tx } = createHarness(attribution);
    tx.captainAccount.findUnique.mockResolvedValueOnce({
      id: 'account-direct',
      frozen: 0,
      balance: 3,
      clawback: 0,
    });

    await expect(service.voidForRefund('order-1', 'refund-2', 100)).resolves.toBe('voided');

    expect(tx.captainAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-direct' },
      data: {
        balance: { decrement: 3 },
        clawback: { increment: 6 },
      },
    });
    expect(tx.captainCommissionLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'VOID',
        status: 'CLAWBACK_PENDING',
        amount: -9,
        balanceAfter: 0,
        idempotencyKey: 'captain:void:order-1:refund-2:ledger-direct',
      }),
    });
  });

  it('does not void the same refund twice', async () => {
    const { service, tx } = createHarness();
    tx.captainCommissionLedger.findFirst.mockResolvedValueOnce({ id: 'void-existing' });

    await expect(service.voidForRefund('order-1', 'refund-1', 100)).resolves.toBe('skipped');

    expect(tx.captainCommissionLedger.create).not.toHaveBeenCalled();
    expect(tx.captainAccount.update).not.toHaveBeenCalled();
  });

  it('caps repeated refund voids at the original available ledger amount', async () => {
    const attribution = makeAttribution({
      status: 'AVAILABLE',
      ledgers: [
        {
          ...makeAttribution().ledgers[0],
          status: 'AVAILABLE',
          amount: 9,
        },
      ],
    });
    const { service, tx } = createHarness(attribution, [
      {
        amount: -6.3,
        meta: { originalLedgerId: 'ledger-direct' },
      },
    ]);
    tx.captainAccount.findUnique.mockResolvedValueOnce({
      id: 'account-direct',
      frozen: 0,
      balance: 20,
      clawback: 0,
    });

    await expect(service.voidForRefund('order-1', 'refund-3', 50)).resolves.toBe('voided');

    expect(tx.captainCommissionLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'VOID',
        amount: -2.7,
        idempotencyKey: 'captain:void:order-1:refund-3:ledger-direct',
      }),
    });
    expect(tx.captainAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-direct' },
      data: {
        balance: { decrement: 2.7 },
      },
    });
  });
});
