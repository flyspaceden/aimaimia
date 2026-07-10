import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from './captain.constants';
import { CaptainAttributionService } from './captain-attribution.service';

const captainConfig = {
  ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
  enabled: true,
  effectiveFrom: '2026-07-01T00:00:00.000Z',
  perOrderCommission: { directProfitRate: 0.11 },
  monthlyRewards: {
    ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.monthlyRewards,
    baseManagementProfitRate: 0.02,
    growthBonusProfitRate: 0.01,
    cultivationBonusProfitRate: 0.005,
    performanceBonusProfitRate: 0.01,
  },
};

function makeSnapshot(overrides: any = {}) {
  const base = {
    id: 'profit-snapshot-1',
    orderId: 'order-1',
    revision: 1,
    isCurrent: true,
    status: 'READY',
    distributableProfitAmount: 50,
    captainEligibleProfitAmount: 35,
    itemBreakdown: [
      {
        orderItemId: 'item-1',
        captainEligible: true,
        netGoodsRevenueCents: 11_325,
        distributableProfitShareCents: 3_500,
      },
    ],
    couponDiscountAmount: 4,
    rewardDeductionAmount: 3,
    ruleSnapshot: {
      buyerPath: 'VIP',
      vipNormalConfigVersion: 'member-rules-v3',
      directInviter: {
        eligibleUserId: 'inviter-1',
        effectiveDirectRate: 0.04,
      },
      captain: {
        relationId: 'captain-relation-1',
        directCaptainUserId: 'captain-1',
        relationStatus: 'ACTIVE',
        profileStatus: 'ACTIVE',
        exclusionReason: null,
        configVersion: 'captain-rules-v3',
        config: captainConfig,
      },
      rates: {
        vip: {
          platform: 0.45,
          reward: 0.2,
          directReferral: 0.04,
          industryFund: 0.1,
          charity: 0.08,
          tech: 0.07,
          reserve: 0.06,
        },
        normal: {
          platform: 0.49,
          reward: 0.16,
          directReferral: 0.01,
          industryFund: 0.16,
          charity: 0.08,
          tech: 0.08,
          reserve: 0.02,
        },
      },
    },
    order: {
      id: 'order-1',
      userId: 'buyer-1',
      bizType: 'NORMAL_GOODS',
      paidAt: new Date('2026-07-10T00:00:00.000Z'),
    },
  };
  return {
    ...base,
    ...overrides,
    ruleSnapshot: {
      ...base.ruleSnapshot,
      ...(overrides.ruleSnapshot ?? {}),
    },
    order: {
      ...base.order,
      ...(overrides.order ?? {}),
    },
  };
}

function createHarness(snapshot = makeSnapshot()) {
  const tx: any = {
    orderProfitSnapshot: {
      findFirst: jest.fn().mockResolvedValue(snapshot),
    },
    captainOrderAttribution: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'attribution-1' }),
    },
    captainAccount: {
      upsert: jest.fn().mockResolvedValue({
        id: 'account-1',
        userId: 'captain-1',
        balance: 7,
        frozen: 2,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    captainCommissionLedger: {
      create: jest.fn().mockResolvedValue({ id: 'direct-ledger-1' }),
    },
    orderProfitFundingLedger: {
      create: jest.fn().mockResolvedValue({}),
    },
    orderProfitReconciliationTask: {
      upsert: jest.fn().mockResolvedValue({ id: 'reconciliation-1' }),
    },
  };

  return {
    tx,
    service: new CaptainAttributionService(),
  };
}

function expectNoRewardWrites(tx: any) {
  expect(tx.captainOrderAttribution.create).not.toHaveBeenCalled();
  expect(tx.captainAccount.upsert).not.toHaveBeenCalled();
  expect(tx.captainAccount.update).not.toHaveBeenCalled();
  expect(tx.captainCommissionLedger.create).not.toHaveBeenCalled();
  expect(tx.orderProfitFundingLedger.create).not.toHaveBeenCalled();
}

describe('CaptainAttributionService V3 retained-profit funding', () => {
  it('funds the golden vector from the READY payment snapshot and freezes only direct commission', async () => {
    const { service, tx } = createHarness();

    await expect(service.createFrozenForPaidOrder(tx, 'order-1')).resolves.toBe('credited');

    expect(tx.orderProfitSnapshot.findFirst).toHaveBeenCalledWith({
      where: { orderId: 'order-1', isCurrent: true },
      include: { order: true },
      orderBy: { revision: 'desc' },
    });
    expect(tx.captainOrderAttribution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        buyerUserId: 'buyer-1',
        directCaptainUserId: 'captain-1',
        legacyIndirectCaptainUserId: null,
        commissionBase: 35,
        eligibleGoodsAmount: 113.25,
        directRate: 0.11,
        legacyIndirectRate: 0,
        calculationModel: 'PROFIT_V3',
        profitSnapshotId: 'profit-snapshot-1',
        profitConfigVersion: 'captain-rules-v3',
        profitBaseAmount: 35,
        status: 'FROZEN',
      }),
    });
    expect(tx.captainCommissionLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.captainCommissionLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'captain-1',
        orderAttributionId: 'attribution-1',
        type: 'DIRECT_ORDER',
        status: 'FROZEN',
        amount: 3.85,
        commissionBase: 35,
        rate: 0.11,
        frozenAfter: 5.85,
        idempotencyKey: 'captain:v3:order:order-1:direct',
      }),
    });
    expect(tx.captainAccount.update).toHaveBeenCalledTimes(1);
    expect(tx.captainAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: { frozen: { increment: 3.85 } },
    });

    const funding = tx.orderProfitFundingLedger.create.mock.calls.map(
      ([{ data }]: any[]) => data,
    );
    expect(funding).toEqual([
      expect.objectContaining({
        type: 'PLATFORM_RETAINED_CREDIT',
        amount: 33,
        idempotencyKey: 'captain:v3:funding:order-1:platform-retained',
      }),
      expect.objectContaining({
        type: 'CAPTAIN_DIRECT_HOLD',
        amount: -3.85,
        sourceLedgerId: 'direct-ledger-1',
        idempotencyKey: 'captain:v3:funding:order-1:direct-hold',
      }),
      expect.objectContaining({
        type: 'CAPTAIN_MONTHLY_HOLD',
        amount: -1.58,
        sourceLedgerId: null,
        idempotencyKey: 'captain:v3:funding:order-1:monthly-hold',
      }),
    ]);
    expect(Math.abs(funding[1].amount) + Math.abs(funding[2].amount))
      .toBeLessThanOrEqual(funding[0].amount);
  });

  it('keeps a missing direct inviter share in platform retained funding', async () => {
    const snapshot = makeSnapshot({
      ruleSnapshot: {
        directInviter: {
          eligibleUserId: null,
          effectiveDirectRate: 0.04,
        },
      },
    });
    const { service, tx } = createHarness(snapshot);

    await service.createFrozenForPaidOrder(tx, 'order-1');

    expect(tx.orderProfitFundingLedger.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        type: 'PLATFORM_RETAINED_CREDIT',
        amount: 35,
      }),
    });
  });

  it.each([
    ['reconciliation snapshot', makeSnapshot({ status: 'RECONCILIATION_REQUIRED' })],
    ['zero distributable profit', makeSnapshot({ distributableProfitAmount: 0 })],
    ['zero captain-eligible profit', makeSnapshot({ captainEligibleProfitAmount: 0 })],
    ['non-V3 captain snapshot', makeSnapshot({
      ruleSnapshot: {
        captain: {
          ...makeSnapshot().ruleSnapshot.captain,
          config: { schemaVersion: 2, enabled: true },
        },
      },
    })],
    ['disabled V3 captain snapshot', makeSnapshot({
      ruleSnapshot: {
        captain: {
          ...makeSnapshot().ruleSnapshot.captain,
          config: { ...captainConfig, enabled: false },
        },
      },
    })],
    ['no active direct relation', makeSnapshot({
      ruleSnapshot: {
        captain: {
          ...makeSnapshot().ruleSnapshot.captain,
          directCaptainUserId: null,
          exclusionReason: 'NO_CAPTAIN_RELATION',
        },
      },
    })],
    ['inactive direct relation', makeSnapshot({
      ruleSnapshot: {
        captain: {
          ...makeSnapshot().ruleSnapshot.captain,
          relationStatus: 'INACTIVE',
        },
      },
    })],
    ['inactive captain profile', makeSnapshot({
      ruleSnapshot: {
        captain: {
          ...makeSnapshot().ruleSnapshot.captain,
          profileStatus: 'SUSPENDED',
        },
      },
    })],
    ['self relation', makeSnapshot({
      ruleSnapshot: {
        captain: {
          ...makeSnapshot().ruleSnapshot.captain,
          directCaptainUserId: 'buyer-1',
          exclusionReason: null,
        },
      },
    })],
    ['pre-effective payment', makeSnapshot({
      order: { paidAt: new Date('2026-06-30T23:59:59.999Z') },
    })],
  ])('skips %s without creating funding or rewards', async (_label, snapshot) => {
    const { service, tx } = createHarness(snapshot);

    await expect(service.createFrozenForPaidOrder(tx, 'order-1')).resolves.toBe('skipped');

    expectNoRewardWrites(tx);
    expect(tx.orderProfitReconciliationTask.upsert).not.toHaveBeenCalled();
  });

  it('creates a reconciliation task and no reward when configured holds exceed R', async () => {
    const overfundedConfig = {
      ...captainConfig,
      perOrderCommission: { directProfitRate: 0.5 },
      monthlyRewards: {
        ...captainConfig.monthlyRewards,
        baseManagementProfitRate: 0.2,
        growthBonusProfitRate: 0,
        cultivationBonusProfitRate: 0,
        performanceBonusProfitRate: 0,
      },
    };
    const snapshot = makeSnapshot({
      distributableProfitAmount: 8,
      captainEligibleProfitAmount: 8,
      ruleSnapshot: {
        captain: {
          ...makeSnapshot().ruleSnapshot.captain,
          config: overfundedConfig,
        },
      },
    });
    const { service, tx } = createHarness(snapshot);

    await expect(service.createFrozenForPaidOrder(tx, 'order-1')).resolves.toBe('skipped');

    expect(tx.orderProfitReconciliationTask.upsert).toHaveBeenCalledWith({
      where: {
        sourceSnapshotId_orderId: {
          sourceSnapshotId: 'profit-snapshot-1',
          orderId: 'order-1',
        },
      },
      update: {
        status: 'PENDING',
        errorCode: 'CAPTAIN_FUNDING_EXCEEDS_PLATFORM_RETAINED',
      },
      create: {
        orderId: 'order-1',
        sourceSnapshotId: 'profit-snapshot-1',
        status: 'PENDING',
        errorCode: 'CAPTAIN_FUNDING_EXCEEDS_PLATFORM_RETAINED',
      },
    });
    expectNoRewardWrites(tx);
  });

  it('marks a snapshot with C greater than D as invalid and creates no reward', async () => {
    const snapshot = makeSnapshot({
      distributableProfitAmount: 8,
      captainEligibleProfitAmount: 8.01,
    });
    const { service, tx } = createHarness(snapshot);

    await expect(service.createFrozenForPaidOrder(tx, 'order-1')).resolves.toBe('skipped');
    expect(tx.orderProfitReconciliationTask.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          errorCode: 'CAPTAIN_FUNDING_INVALID_SNAPSHOT',
        }),
      }),
    );
    expectNoRewardWrites(tx);
  });

  it('requires item-level captain-eligible net GMV before creating attribution', async () => {
    const snapshot = makeSnapshot({ itemBreakdown: null });
    const { service, tx } = createHarness(snapshot);

    await expect(service.createFrozenForPaidOrder(tx, 'order-1')).resolves.toBe('skipped');
    expect(tx.orderProfitReconciliationTask.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          errorCode: 'CAPTAIN_FUNDING_INVALID_SNAPSHOT',
        }),
      }),
    );
    expectNoRewardWrites(tx);
  });

  it('is idempotent across attribution, account, captain ledger and funding ledgers', async () => {
    const { service, tx } = createHarness();
    tx.captainOrderAttribution.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'attribution-1' });

    await expect(service.createFrozenForPaidOrder(tx, 'order-1')).resolves.toBe('credited');
    await expect(service.createFrozenForPaidOrder(tx, 'order-1')).resolves.toBe('skipped');

    expect(tx.orderProfitSnapshot.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.captainOrderAttribution.create).toHaveBeenCalledTimes(1);
    expect(tx.captainAccount.upsert).toHaveBeenCalledTimes(1);
    expect(tx.captainAccount.update).toHaveBeenCalledTimes(1);
    expect(tx.captainCommissionLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.orderProfitFundingLedger.create).toHaveBeenCalledTimes(3);
    expect(tx.orderProfitReconciliationTask.upsert).not.toHaveBeenCalled();
  });
});
