import { QueueRewardService } from './queue-reward.service';

const queueRuleSnapshot = {
  queueReward: {
    enabled: true,
    queueSize: 3,
    rewardPercent: 0.05,
    splitUnitAmount: 200,
    maxPositionsPerOrder: 100,
    distributionMode: 'AVERAGE',
    randomStddev: 0.25,
    randomMinFactor: 0.5,
    randomMaxFactor: 1.5,
    activationAt: '2026-07-01T00:00:00.000Z',
  },
};

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'source-order',
    userId: 'source-user',
    paidAt: new Date('2026-07-10T00:00:00.000Z'),
    returnWindowExpiresAt: new Date('2026-07-20T00:00:00.000Z'),
    eligiblePaidCents: 10_000,
    profitCents: 1_000,
    platformProfitCents: 500,
    hasSuccessfulAfterSale: false,
    ruleVersion: 'rules-v1',
    ruleSnapshot: queueRuleSnapshot,
    ...overrides,
  };
}

function makeTx(options: {
  existing?: boolean;
  prior?: Array<{
    id: string;
    orderStateId: string;
    orderId: string;
    userId: string;
    sharedCapAmount: number;
    frozenReceivedAmount?: number;
    availableReceivedAmount?: number;
    observedUnitCount?: number;
    targetObservedUnitCount?: number;
    returnWindowExpiresAt?: Date | null;
    userStatus?: 'ACTIVE' | 'BANNED' | 'DELETED';
    deletionExecutedAt?: Date | null;
  }>;
  successfulAfterSale?: boolean;
} = {}) {
  let sequence = 0n;
  const states = new Map<string, any>();
  const positions: any[] = [];
  const allocations: any[] = [];
  const ledgers: any[] = [];
  const distributions: any[] = [];
  const outboxes: any[] = [];
  const accounts = new Map<string, any>();

  for (const prior of options.prior ?? []) {
    const state = {
      id: prior.orderStateId,
      orderId: prior.orderId,
      userId: prior.userId,
      eligiblePaidAmount: prior.sharedCapAmount,
      sharedCapAmount: prior.sharedCapAmount,
      frozenReceivedAmount: prior.frozenReceivedAmount ?? 0,
      availableReceivedAmount: prior.availableReceivedAmount ?? 0,
      voidedReceivedAmount: 0,
      status: 'ACTIVE',
      order: {
        status: 'RECEIVED',
        returnWindowExpiresAt:
          prior.returnWindowExpiresAt === undefined
            ? new Date('2026-07-18T00:00:00.000Z')
            : prior.returnWindowExpiresAt,
        user: {
          status: prior.userStatus ?? 'ACTIVE',
          deletionExecutedAt:
            prior.deletionExecutedAt ?? null,
        },
      },
    };
    states.set(state.id, state);
    sequence += 1n;
    positions.push({
      id: prior.id,
      sequence,
      orderStateId: prior.orderStateId,
      orderId: prior.orderId,
      userId: prior.userId,
      unitIndex: 0,
      observedUnitCount: prior.observedUnitCount ?? 0,
      targetObservedUnitCount:
        prior.targetObservedUnitCount ?? 2,
      status: 'ACTIVE',
    });
  }
  if (options.existing) {
    states.set('existing-state', {
      id: 'existing-state',
      orderId: 'source-order',
      userId: 'source-user',
      sharedCapAmount: 100,
      frozenReceivedAmount: 0,
      availableReceivedAmount: 0,
      status: 'ACTIVE',
    });
    positions.push({
      id: 'existing-position',
      orderStateId: 'existing-state',
      orderId: 'source-order',
      userId: 'source-user',
      status: 'ACTIVE',
    });
    allocations.push({
      sourceOrderId: 'source-order',
      distributedAmount: 1.23,
    });
  }

  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    afterSaleRequest: {
      findFirst: jest.fn().mockResolvedValue(
        options.successfulAfterSale ? { id: 'after-sale-1' } : null,
      ),
    },
    queueRewardOrderState: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.orderId) {
          const state = [...states.values()].find(
            (item) => item.orderId === where.orderId,
          );
          return state
            ? {
                ...state,
                positions: positions.filter(
                  (position) => position.orderStateId === state.id,
                ),
              }
            : null;
        }
        return states.get(where.id) ?? null;
      }),
      findUniqueOrThrow: jest.fn(
        async ({ where }: any) => states.get(where.id),
      ),
      create: jest.fn(async ({ data }: any) => {
        const state = {
          id: `state-${states.size + 1}`,
          frozenReceivedAmount: 0,
          availableReceivedAmount: 0,
          voidedReceivedAmount: 0,
          ...data,
        };
        states.set(state.id, state);
        return state;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const state = states.get(where.id);
        if (data.frozenReceivedAmount?.increment) {
          state.frozenReceivedAmount +=
            data.frozenReceivedAmount.increment;
        }
        Object.assign(
          state,
          Object.fromEntries(
            Object.entries(data).filter(
              ([key]) => key !== 'frozenReceivedAmount',
            ),
          ),
        );
        return state;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const state = states.get(where.id);
        if (!state) return { count: 0 };
        if (
          where.status &&
          typeof where.status === 'string' &&
          state.status !== where.status
        ) {
          return { count: 0 };
        }
        if (
          where.status?.not &&
          state.status === where.status.not
        ) {
          return { count: 0 };
        }
        Object.assign(state, data);
        return { count: 1 };
      }),
    },
    queueRewardPosition: {
      findMany: jest.fn(async ({ where, take }: any) =>
        positions
          .filter((position) =>
            ['ACTIVE', 'CAPPED'].includes(position.status) &&
            (!where?.orderId?.not ||
              position.orderId !== where.orderId.not),
          )
          .slice(0, take)
          .map((position) => ({
            ...position,
            orderState: states.get(position.orderStateId),
          }))),
      create: jest.fn(async ({ data }: any) => {
        sequence += 1n;
        const position = {
          id: `position-${positions.length + 1}`,
          sequence,
          observedUnitCount: 0,
          ...data,
        };
        positions.push(position);
        return position;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const position = positions.find((item) => item.id === where.id);
        Object.assign(position, data);
        return position;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = positions.filter(
          (position) =>
            position.orderStateId === where.orderStateId &&
            (!where.status || position.status === where.status),
        );
        rows.forEach((position) => Object.assign(position, data));
        return { count: rows.length };
      }),
      count: jest.fn(async ({ where }: any) =>
        positions.filter(
          (position) =>
            position.orderStateId === where.orderStateId &&
            where.status.in.includes(position.status),
        ).length),
    },
    queueRewardAllocation: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `queue-allocation-${allocations.length + 1}`,
          ...data,
        };
        allocations.push(row);
        return row;
      }),
      aggregate: jest.fn(async ({ where }: any) => ({
        _sum: {
          distributedAmount: allocations
            .filter(
              (allocation) =>
                allocation.sourceOrderId === where.sourceOrderId,
            )
            .reduce(
              (sum, allocation) =>
                sum + Number(allocation.distributedAmount ?? 0),
              0,
            ),
        },
      })),
    },
    rewardAllocation: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'reward-allocation-1',
        ...data,
      })),
    },
    rewardAccount: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const key =
          `${where.userId_type.userId}:${where.userId_type.type}`;
        if (!accounts.has(key)) {
          accounts.set(key, {
            id: `account-${accounts.size + 1}`,
            balance: 0,
            frozen: 0,
            ...create,
          });
        }
        return accounts.get(key);
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const account = [...accounts.values()].find(
          (item) => item.id === where.id,
        );
        account.frozen += data.frozen?.increment ?? 0;
        return account;
      }),
    },
    rewardLedger: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `ledger-${ledgers.length + 1}`, ...data };
        ledgers.push(row);
        return row;
      }),
    },
    queueRewardDistribution: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `distribution-${distributions.length + 1}`,
          ...data,
        };
        distributions.push(row);
        return row;
      }),
    },
  };
  return {
    tx,
    states,
    positions,
    allocations,
    ledgers,
    distributions,
    outboxes,
    accounts,
  };
}

describe('QueueRewardService.allocateForReceivedOrder', () => {
  const service = new QueueRewardService(
    {} as any,
    {} as any,
  );

  it('creates the first warm-up position without inventing a recipient', async () => {
    const harness = makeTx();

    await expect(
      service.allocateForReceivedOrder(
        harness.tx,
        makeInput(),
      ),
    ).resolves.toMatchObject({
      participated: true,
      fundedCents: 0,
      positionCount: 1,
    });

    expect(harness.positions).toHaveLength(1);
    expect(harness.allocations).toEqual([
      expect.objectContaining({
        rewardPoolAmount: 0.5,
        distributedAmount: 0,
        platformRetainedAmount: 0.5,
      }),
    ]);
    expect(harness.ledgers).toHaveLength(0);
    expect(harness.tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('records an internal pending reward without touching the wallet and advances the prior position', async () => {
    const beneficiaryReleaseAt =
      new Date('2026-07-25T00:00:00.000Z');
    const harness = makeTx({
      prior: [
        {
          id: 'prior-position',
          orderStateId: 'prior-state',
          orderId: 'prior-order',
          userId: 'prior-user',
          sharedCapAmount: 100,
          observedUnitCount: 1,
          targetObservedUnitCount: 2,
          returnWindowExpiresAt: beneficiaryReleaseAt,
        },
      ],
    });

    const result = await service.allocateForReceivedOrder(
      harness.tx,
      makeInput(),
    );

    expect(result.fundedCents).toBe(50);
    expect(harness.ledgers).toHaveLength(0);
    expect(harness.accounts.size).toBe(0);
    expect(harness.distributions).toEqual([
      expect.objectContaining({
        sourceOrderId: 'source-order',
        beneficiaryPositionOrderId: 'prior-order',
        amount: 0.5,
        releaseAt: beneficiaryReleaseAt,
        weightSnapshot: expect.objectContaining({
          preClampWeight: 1,
          clampedWeight: 1,
          normalizedWeight: 1,
        }),
      }),
    ]);
    expect(harness.outboxes).toHaveLength(0);
    expect(
      harness.positions.find(
        (position) => position.id === 'prior-position',
      ),
    ).toMatchObject({
      observedUnitCount: 2,
      status: 'COMPLETED',
    });
    expect(
      harness.states.get('prior-state').frozenReceivedAmount,
    ).toBe(0.5);
  });

  it('records a successful pre-entry after-sale as VOIDED without joining the queue', async () => {
    const harness = makeTx();

    const result = await service.allocateForReceivedOrder(
      harness.tx,
      makeInput({ hasSuccessfulAfterSale: true }),
    );

    expect(result).toMatchObject({
      participated: true,
      fundedCents: 0,
      positionCount: 0,
      reason: 'SUCCESSFUL_AFTER_SALE_BEFORE_QUEUE_ENTRY',
    });
    expect(harness.positions).toHaveLength(0);
    expect([...harness.states.values()][0].status).toBe('VOIDED');
    expect(harness.allocations).toHaveLength(0);
  });

  it('rechecks a completed exchange under the queue lock and refuses late entry', async () => {
    const harness = makeTx({ successfulAfterSale: true });

    const result = await service.allocateForReceivedOrder(
      harness.tx,
      makeInput({ hasSuccessfulAfterSale: false }),
    );

    expect(result).toMatchObject({
      participated: true,
      fundedCents: 0,
      positionCount: 0,
      reason: 'SUCCESSFUL_AFTER_SALE_BEFORE_QUEUE_ENTRY',
    });
    expect(harness.positions).toHaveLength(0);
    expect([...harness.states.values()][0].status).toBe('VOIDED');
  });

  it.each([
    [45_000, 2],
    [60_000, 3],
  ])(
    'keeps all units of one physical order from rewarding or advancing one another (%i cents)',
    async (eligiblePaidCents, expectedUnits) => {
      const harness = makeTx();

      await service.allocateForReceivedOrder(
        harness.tx,
        makeInput({ eligiblePaidCents }),
      );

      const ownPositions = harness.positions.filter(
        (position) => position.orderId === 'source-order',
      );
      expect(ownPositions).toHaveLength(expectedUnits);
      expect(ownPositions).toEqual(
        expect.arrayContaining(
          ownPositions.map((position) =>
            expect.objectContaining({
              id: position.id,
              observedUnitCount: 0,
            }),
          ),
        ),
      );
      expect(harness.distributions).toHaveLength(0);
      expect(harness.ledgers).toHaveLength(0);
    },
  );

  it('does not create a queue state for a zero-paid prize-only order', async () => {
    const harness = makeTx();

    const result = await service.allocateForReceivedOrder(
      harness.tx,
      makeInput({ eligiblePaidCents: 0 }),
    );

    expect(result).toMatchObject({
      participated: false,
      fundedCents: 0,
      positionCount: 0,
      reason: 'NO_ELIGIBLE_NON_PRIZE_PAYMENT',
    });
    expect(harness.tx.$executeRaw).not.toHaveBeenCalled();
    expect(harness.states.size).toBe(0);
    expect(harness.positions).toHaveLength(0);
  });

  it('redistributes around an inactive beneficiary while still advancing its window', async () => {
    const harness = makeTx({
      prior: [
        {
          id: 'banned-position',
          orderStateId: 'banned-state',
          orderId: 'banned-order',
          userId: 'banned-user',
          sharedCapAmount: 100,
          userStatus: 'BANNED',
        },
        {
          id: 'active-position',
          orderStateId: 'active-state',
          orderId: 'active-order',
          userId: 'active-user',
          sharedCapAmount: 100,
        },
      ],
    });

    await service.allocateForReceivedOrder(
      harness.tx,
      makeInput(),
    );

    expect(harness.ledgers).toHaveLength(0);
    expect(harness.distributions).toEqual([
      expect.objectContaining({
        recipientUserId: 'active-user',
        amount: 0.5,
      }),
    ]);
    expect(
      harness.positions.find(
        (position) => position.id === 'banned-position',
      ),
    ).toMatchObject({ observedUnitCount: 1 });
  });

  it('only rewards and advances the first queueSize minus one positions when a large order leaves a backlog', async () => {
    const harness = makeTx({
      prior: Array.from({ length: 5 }, (_, index) => ({
        id: `prior-position-${index + 1}`,
        orderStateId: `prior-state-${index + 1}`,
        orderId: `prior-order-${index + 1}`,
        userId: `prior-user-${index + 1}`,
        sharedCapAmount: 100,
      })),
    });

    await service.allocateForReceivedOrder(
      harness.tx,
      makeInput(),
    );

    expect(
      harness.tx.queueRewardPosition.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 }),
    );
    expect(
      harness.distributions.map(
        (distribution) => distribution.recipientUserId,
      ),
    ).toEqual(['prior-user-1', 'prior-user-2']);
    expect(
      harness.positions
        .filter((position) =>
          position.id.startsWith('prior-position-'),
        )
        .map((position) => position.observedUnitCount),
    ).toEqual([1, 1, 0, 0, 0]);
  });

  it('does not retroactively enroll an order paid before activation', async () => {
    const harness = makeTx();

    const result = await service.allocateForReceivedOrder(
      harness.tx,
      makeInput({
        paidAt: new Date('2026-06-30T23:59:59.000Z'),
      }),
    );

    expect(result.participated).toBe(false);
    expect(result.reason).toBe(
      'ORDER_PAID_BEFORE_QUEUE_ACTIVATION',
    );
    expect(harness.tx.$executeRaw).not.toHaveBeenCalled();
    expect(harness.states.size).toBe(0);
  });

  it('returns the committed funding amount on an idempotent replay', async () => {
    const harness = makeTx({ existing: true });

    const result = await service.allocateForReceivedOrder(
      harness.tx,
      makeInput(),
    );

    expect(result).toMatchObject({
      participated: true,
      alreadyProcessed: true,
      fundedCents: 123,
      positionCount: 1,
    });
    expect(
      harness.tx.queueRewardOrderState.create,
    ).not.toHaveBeenCalled();
  });

  it('keeps the reward fail-closed when either after-sale window is missing', async () => {
    const harness = makeTx({
      prior: [
        {
          id: 'prior-position',
          orderStateId: 'prior-state',
          orderId: 'prior-order',
          userId: 'prior-user',
          sharedCapAmount: 100,
          returnWindowExpiresAt: null,
        },
      ],
    });

    await service.allocateForReceivedOrder(
      harness.tx,
      makeInput(),
    );

    expect(harness.distributions).toHaveLength(1);
    expect(harness.distributions[0].releaseAt).toBeNull();
  });

  it('creates a zero-funded position when profit cannot be reconciled', async () => {
    const harness = makeTx({
      prior: [
        {
          id: 'prior-position',
          orderStateId: 'prior-state',
          orderId: 'prior-order',
          userId: 'prior-user',
          sharedCapAmount: 100,
        },
      ],
    });

    const result = await service.allocateForReceivedOrder(
      harness.tx,
      makeInput({
        profitCents: 0,
        platformProfitCents: 0,
      }),
    );

    expect(result).toMatchObject({
      participated: true,
      fundedCents: 0,
      positionCount: 1,
    });
    expect(harness.positions).toHaveLength(2);
    expect(harness.distributions).toHaveLength(0);
    expect(harness.outboxes).toHaveLength(0);
  });
});

function makeLifecycleHarness(options: {
  afterSales?: Array<{ orderId: string; status: string }>;
  recipient?: {
    status: 'ACTIVE' | 'BANNED' | 'DELETED';
    deletionExecutedAt: Date | null;
  } | null;
  orders?: Array<{
    id: string;
    status: string;
    returnWindowExpiresAt: Date | null;
  }>;
} = {}) {
  const past = new Date('2026-07-01T00:00:00.000Z');
  const distribution = {
    id: 'distribution-1',
    allocationId: 'allocation-1',
    sourceOrderId: 'source-order',
    sourcePositionId: 'source-position',
    beneficiaryPositionOrderId: 'beneficiary-order',
    beneficiaryPositionId: 'beneficiary-position',
    recipientUserId: 'beneficiary-user',
    amount: 1.25,
    rewardLedgerId: null,
    allocation: {
      rewardAllocationId: 'reward-allocation-1',
    },
    status: 'FROZEN',
    releaseAt: past,
    beneficiaryPosition: { orderStateId: 'beneficiary-state' },
  };
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    queueRewardDistribution: {
      findUnique: jest.fn().mockResolvedValue(distribution),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    order: {
      findMany: jest.fn().mockResolvedValue(
        options.orders ?? [
          {
            id: 'source-order',
            status: 'RECEIVED',
            returnWindowExpiresAt: past,
          },
          {
            id: 'beneficiary-order',
            status: 'RECEIVED',
            returnWindowExpiresAt: past,
          },
        ],
      ),
    },
    afterSaleRequest: {
      findMany: jest
        .fn()
        .mockResolvedValue(options.afterSales ?? []),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(
        options.recipient === undefined
          ? { status: 'ACTIVE', deletionExecutedAt: null }
          : options.recipient,
      ),
    },
    rewardLedger: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
    },
    rewardAccount: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({ id: 'account-1' }),
      update: jest.fn().mockResolvedValue({ id: 'account-1' }),
    },
    queueRewardOrderState: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma: any = {
    queueRewardDistribution: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: distribution.id }])
        .mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  };
  const notificationService = {
    emit: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new QueueRewardService(
      prisma,
      notificationService as any,
    ),
    prisma,
    tx,
    notificationService,
  };
}

describe('QueueRewardService release lifecycle', () => {
  it('keeps a reward frozen while either order has an active after-sale', async () => {
    const harness = makeLifecycleHarness({
      afterSales: [
        { orderId: 'beneficiary-order', status: 'REQUESTED' },
      ],
    });

    await harness.service.releaseEligibleRewards();

    expect(
      harness.tx.queueRewardDistribution.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        id: 'distribution-1',
        status: 'FROZEN',
      },
      data: { updatedAt: expect.any(Date) },
    });
    expect(harness.notificationService.emit).not.toHaveBeenCalled();
  });

  it('releases only after both orders are received and both windows are closed', async () => {
    const harness = makeLifecycleHarness();

    await harness.service.releaseEligibleRewards();

    expect(
      harness.tx.queueRewardDistribution.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        id: 'distribution-1',
        status: 'FROZEN',
        rewardLedgerId: null,
      },
      data: {
        status: 'AVAILABLE',
        rewardLedgerId: 'ledger-1',
        releasedAt: expect.any(Date),
      },
    });
    expect(harness.tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'account-1',
        userId: 'beneficiary-user',
        amount: 1.25,
        status: 'AVAILABLE',
        entryType: 'RELEASE',
      }),
    });
    expect(harness.tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: {
        balance: { increment: 1.25 },
      },
    });
    expect(harness.notificationService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'queueReward.available',
        aggregateId: 'distribution-1',
      }),
      harness.tx,
    );
  });

  it('voids rather than releases when either side completed an after-sale', async () => {
    const harness = makeLifecycleHarness({
      afterSales: [
        { orderId: 'beneficiary-order', status: 'COMPLETED' },
      ],
    });
    const voidSpy = jest
      .spyOn(
        harness.service,
        'voidRewardsForOrderInTransaction',
      )
      .mockResolvedValue(1);

    await harness.service.releaseEligibleRewards();

    expect(voidSpy).toHaveBeenCalledWith(
      harness.tx,
      'beneficiary-order',
      'AFTER_SALE_SUCCESS_DURING_RELEASE',
    );
    expect(
      harness.tx.queueRewardDistribution.updateMany,
    ).not.toHaveBeenCalled();
    expect(harness.notificationService.emit).not.toHaveBeenCalled();
  });

  it('returns a pending reward to platform instead of reviving an inactive recipient wallet', async () => {
    const harness = makeLifecycleHarness({
      recipient: {
        status: 'DELETED',
        deletionExecutedAt: new Date(
          '2026-07-02T00:00:00.000Z',
        ),
      },
    });

    await harness.service.releaseEligibleRewards();

    expect(
      harness.tx.queueRewardDistribution.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        id: 'distribution-1',
        status: 'FROZEN',
        rewardLedgerId: null,
      },
      data: {
        status: 'VOIDED',
        voidedAt: expect.any(Date),
        voidReason: 'RECIPIENT_INACTIVE_BEFORE_RELEASE',
        recoveredAmount: 1.25,
        platformReturnedAmount: 1.25,
        platformReturnRatio: {
          numerator: 1,
          denominator: 1,
        },
      },
    });
    expect(harness.tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: { balance: { increment: 1.25 } },
    });
    expect(harness.notificationService.emit).not.toHaveBeenCalled();
  });
});

describe('QueueRewardService dual-direction after-sale void', () => {
  it('account deletion voids only beneficiary dimensions for each user order state', async () => {
    const tx: any = {
      queueRewardOrderState: {
        findMany: jest.fn().mockResolvedValue([
          { orderId: 'order-a' },
          { orderId: 'order-b' },
        ]),
      },
    };
    const service = new QueueRewardService({} as any, {} as any);
    const voidSpy = jest
      .spyOn(service, 'voidRewardsForOrderInTransaction')
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    await expect(
      service.voidRecipientRewardsForUserDeletionInTransaction(
        tx,
        'user-1',
      ),
    ).resolves.toBe(3);

    expect(voidSpy).toHaveBeenNthCalledWith(
      1,
      tx,
      'order-a',
      'ACCOUNT_DELETION',
      { beneficiaryOnly: true },
    );
    expect(voidSpy).toHaveBeenNthCalledWith(
      2,
      tx,
      'order-b',
      'ACCOUNT_DELETION',
      { beneficiaryOnly: true },
    );
  });

  it('selects rewards where the refunded order is either source or beneficiary position', async () => {
    const distributions = [
      {
        id: 'source-side',
        sourceOrderId: 'refunded-order',
        beneficiaryPositionOrderId: 'other-order',
        recipientUserId: 'user-a',
        amount: 1,
        rewardLedgerId: 'ledger-a',
        status: 'FROZEN',
        beneficiaryPosition: { orderStateId: 'state-a' },
      },
      {
        id: 'beneficiary-side',
        sourceOrderId: 'other-source',
        beneficiaryPositionOrderId: 'refunded-order',
        recipientUserId: 'user-b',
        amount: 2,
        rewardLedgerId: 'ledger-b',
        status: 'FROZEN',
        beneficiaryPosition: { orderStateId: 'state-b' },
      },
    ];
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      queueRewardDistribution: {
        findMany: jest.fn().mockResolvedValue(distributions),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      rewardLedger: {
        findMany: jest.fn().mockResolvedValue([
          { refId: 'withdraw-processing-1' },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
      rewardAccount: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'account-1',
          balance: 100,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest
          .fn()
          .mockResolvedValue({ id: 'platform-account' }),
        update: jest.fn().mockResolvedValue({}),
      },
      queueRewardOrderState: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'refunded-state' }),
      },
      queueRewardPosition: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new QueueRewardService(
      {} as any,
      {} as any,
    );

    await expect(
      service.voidRewardsForOrderInTransaction(
        tx,
        'refunded-order',
        'AFTER_SALE_SUCCESS',
      ),
    ).resolves.toBe(2);

    expect(
      tx.queueRewardDistribution.findMany,
    ).toHaveBeenCalledWith({
      where: {
        status: { in: ['FROZEN', 'AVAILABLE'] },
        OR: [
          { sourceOrderId: 'refunded-order' },
          { beneficiaryPositionOrderId: 'refunded-order' },
        ],
      },
      include: {
        beneficiaryPosition: {
          select: { orderStateId: true },
        },
        rewardLedger: {
          select: {
            id: true,
            allocationId: true,
            accountId: true,
            amount: true,
            status: true,
            entryType: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledTimes(2);
    expect(tx.rewardAccount.update).toHaveBeenCalledTimes(2);
    expect(tx.queueRewardPosition.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderStateId: 'refunded-state',
          status: { not: 'VOIDED' },
        },
      }),
    );
  });

  it('records a pending clawback instead of blocking after-sale when an available reward was withdrawn', async () => {
    const distribution = {
      id: 'available-distribution',
      sourceOrderId: 'other-source',
      beneficiaryPositionOrderId: 'refunded-order',
      recipientUserId: 'user-a',
      amount: 5,
      rewardLedgerId: 'release-ledger',
      rewardLedger: {
        id: 'release-ledger',
        allocationId: 'reward-allocation',
        accountId: 'queue-account',
        amount: 5,
        status: 'AVAILABLE',
        entryType: 'RELEASE',
      },
      status: 'AVAILABLE',
      beneficiaryPosition: { orderStateId: 'state-a' },
    };
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      queueRewardDistribution: {
        findMany: jest.fn().mockResolvedValue([distribution]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      rewardLedger: {
        findMany: jest.fn().mockResolvedValue([
          { refId: 'withdraw-processing-1' },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
      rewardAccount: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'queue-account',
          balance: 2,
          frozen: 3,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue({ id: 'platform-account' }),
        update: jest.fn().mockResolvedValue({}),
      },
      queueRewardOrderState: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'refunded-state' }),
      },
      queueRewardPosition: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new QueueRewardService({} as any, {} as any);

    await expect(
      service.voidRewardsForOrderInTransaction(
        tx,
        'refunded-order',
      ),
    ).resolves.toBe(1);

    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'queue-account',
        balance: { gte: 2 },
      },
      data: { balance: { decrement: 2 } },
    });
    expect(tx.rewardLedger.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        accountId: 'queue-account',
        amount: -5,
        status: 'RETURN_FROZEN',
        sourceLedgerId: 'release-ledger',
        meta: expect.objectContaining({
          clawbackStatus: 'CLAWBACK_PENDING',
          recoveredAmount: 2,
          clawbackAmount: 3,
          pendingWithdrawalIds: ['withdraw-processing-1'],
        }),
      }),
    });
    expect(tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: 'platform-account' },
      data: { balance: { increment: 2 } },
    });
  });

  it('does not turn a fully refunded source order queue pool back into platform profit', async () => {
    const distribution = {
      id: 'source-frozen',
      sourceOrderId: 'refunded-order',
      beneficiaryPositionOrderId: 'beneficiary-order',
      recipientUserId: 'user-a',
      amount: 5,
      rewardLedgerId: null,
      rewardLedger: null,
      status: 'FROZEN',
      beneficiaryPosition: { orderStateId: 'state-a' },
    };
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      queueRewardDistribution: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([distribution])
          .mockResolvedValueOnce([
            {
              id: distribution.id,
              recoveredAmount: 5,
              platformReturnedAmount: 0,
            },
          ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      rewardLedger: {
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      rewardAccount: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      queueRewardOrderState: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'refunded-state' }),
      },
      queueRewardPosition: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new QueueRewardService({} as any, {} as any);

    await expect(
      service.voidRewardsForOrderInTransaction(
        tx,
        'refunded-order',
        'AFTER_SALE_SUCCESS',
        {
          sourcePlatformReturnRatio: {
            numerator: 0,
            denominator: 100,
          },
        },
      ),
    ).resolves.toBe(1);

    expect(tx.rewardAccount.upsert).not.toHaveBeenCalled();
    expect(tx.rewardLedger.create).not.toHaveBeenCalled();
  });

  it('reconciles the cumulative platform return on a second partial refund after distributions are already voided', async () => {
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      queueRewardDistribution: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: 'source-distribution',
              recoveredAmount: 10,
              platformReturnedAmount: 8,
            },
          ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rewardLedger: {
        create: jest.fn().mockResolvedValue({}),
      },
      rewardAccount: {
        upsert: jest
          .fn()
          .mockResolvedValue({ id: 'platform-account' }),
        update: jest.fn().mockResolvedValue({}),
      },
      queueRewardOrderState: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new QueueRewardService({} as any, {} as any);

    await expect(
      service.voidRewardsForOrderInTransaction(
        tx,
        'refunded-order',
        'AFTER_SALE_SUCCESS',
        {
          sourcePlatformReturnRatio: {
            numerator: 50,
            denominator: 100,
          },
          sourceAdjustmentId: 'refund-2',
        },
      ),
    ).resolves.toBe(0);

    expect(
      tx.queueRewardDistribution.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        id: 'source-distribution',
        platformReturnedAmount: 8,
      },
      data: {
        platformReturnedAmount: 5,
        platformReturnRatio: {
          numerator: 50,
          denominator: 100,
        },
      },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entryType: 'VOID',
        amount: -3,
        status: 'VOIDED',
        idempotencyKey:
          'QUEUE_REWARD_SOURCE_RECONCILE:refund-2:source-distribution',
      }),
    });
    expect(tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: 'platform-account' },
      data: { balance: { increment: -3 } },
    });
  });
});

describe('QueueRewardService.getUserStatus', () => {
  it('returns only the current user queue wallet, positions and auditable reward states', async () => {
    const createdAt = new Date('2026-07-20T00:00:00.000Z');
    const releaseAt = new Date('2026-07-30T00:00:00.000Z');
    const prisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([
        { id: 'position-1', ahead: 7n },
      ]),
      ruleConfig: {
        findMany: jest.fn().mockResolvedValue([
          {
            key: 'QUEUE_REWARD_ENABLED',
            value: { value: true },
          },
          { key: 'QUEUE_SIZE', value: { value: 21 } },
          {
            key: 'QUEUE_SPLIT_UNIT_AMOUNT',
            value: { value: 200 },
          },
          {
            key: 'QUEUE_MAX_POSITIONS_PER_ORDER',
            value: { value: 100 },
          },
          {
            key: 'QUEUE_DISTRIBUTION_MODE',
            value: { value: 'AVERAGE' },
          },
        ]),
      },
      rewardAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ balance: 8, frozen: 3 }),
      },
      rewardLedger: {
        findMany: jest.fn().mockResolvedValue([
          {
            amount: -6,
            meta: {
              scheme: 'GLOBAL_QUEUE_VOID',
              clawbackAmount: 6,
            },
          },
        ]),
      },
      queueRewardOrderState: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'state-1',
            orderId: 'order-beneficiary-1234567890',
            eligiblePaidAmount: 450,
            sharedCapAmount: 450,
            availableReceivedAmount: 8,
            voidedReceivedAmount: 0,
            status: 'ACTIVE',
            createdAt,
            order: {
              id: 'order-beneficiary-1234567890',
              returnWindowExpiresAt: releaseAt,
            },
          },
        ]),
      },
      queueRewardPosition: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'position-1',
            sequence: 42n,
            orderId: 'order-beneficiary-1234567890',
            unitIndex: 1,
            observedUnitCount: 12,
            targetObservedUnitCount: 20,
            status: 'ACTIVE',
            joinedAt: createdAt,
            orderState: {
              sharedCapAmount: 450,
              availableReceivedAmount: 8,
              order: {
                id: 'order-beneficiary-1234567890',
              },
            },
          },
        ]),
        count: jest.fn().mockResolvedValue(7),
      },
      queueRewardDistribution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'distribution-1',
            amount: 0.42,
            status: 'AVAILABLE',
            releaseAt,
            releasedAt: null,
            voidedAt: null,
            createdAt,
            allocation: {
              sourceOrder: {
                id: 'source-order-1234567890',
              },
            },
          },
        ]),
      },
    };
    const service = new QueueRewardService(
      prisma,
      {} as any,
    );

    await expect(
      service.getUserStatus('user-1'),
    ).resolves.toMatchObject({
      enabled: true,
      queueSize: 21,
      splitUnitAmount: 200,
      maxPositionsPerOrder: 100,
      distributionMode: 'AVERAGE',
      totalActivePositions: 7,
      positionPage: {
        pageSize: 20,
        total: 7,
        hasMore: false,
        nextSequence: '42',
      },
      wallet: {
        available: 2,
        total: 2,
      },
      activePositions: [
        {
          id: 'position-1',
          sequence: '42',
          ahead: 7,
          remainingObservedUnitCount: 8,
          receivedAmount: 8,
        },
      ],
      recentOrders: [
        {
          orderId: 'order-beneficiary-1234567890',
          orderNo: 'Y-1234567890',
        },
      ],
      recentRewards: [
        {
          id: 'distribution-1',
          amount: 0.42,
          status: 'AVAILABLE',
          sourceOrderNo: 'R-1234567890',
        },
      ],
    });
    expect(prisma.rewardAccount.findUnique).toHaveBeenCalledWith({
      where: {
        userId_type: {
          userId: 'user-1',
          type: 'QUEUE_REWARD',
        },
      },
      select: { balance: true },
    });
    expect(
      prisma.queueRewardPosition.count,
    ).toHaveBeenCalledTimes(1);
    expect(prisma.rewardLedger.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        entryType: 'VOID',
        status: 'RETURN_FROZEN',
        account: { type: 'QUEUE_REWARD' },
      },
      select: { amount: true, meta: true },
    });
  });
});
