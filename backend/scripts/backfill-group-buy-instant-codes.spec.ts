import {
  backfillActiveCodesInTransaction,
  runBackfillGroupBuyInstantCodes,
} from './backfill-group-buy-instant-codes';

describe('backfill-group-buy-instant-codes script', () => {
  it('dry-runs by default and does not write changes', async () => {
    const deps = {
      getCodeCandidates: jest.fn().mockResolvedValue([{ id: 'instance-1', initiatorOrderId: 'order-1' }]),
      getPendingRebateCandidates: jest.fn().mockResolvedValue([{ id: 'referral-1', referredOrderId: 'order-2' }]),
      getReleasableReferralCandidates: jest.fn().mockResolvedValue([{ id: 'referral-2', referredOrderId: 'order-3' }]),
      countSkippedInvalidInstances: jest.fn().mockResolvedValue(2),
      backfillActiveCodes: jest.fn(),
      backfillPendingRebates: jest.fn(),
      releaseReceivedReferrals: jest.fn(),
    };
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(runBackfillGroupBuyInstantCodes({ execute: false, deps }))
        .resolves.toEqual(expect.objectContaining({
          execute: false,
          codeCandidates: 1,
          pendingRebateCandidates: 1,
          releasableReferrals: 1,
          skippedInvalidInstances: 2,
        }));
    } finally {
      logSpy.mockRestore();
    }

    expect(deps.backfillActiveCodes).not.toHaveBeenCalled();
    expect(deps.backfillPendingRebates).not.toHaveBeenCalled();
    expect(deps.releaseReceivedReferrals).not.toHaveBeenCalled();
  });

  it('executes active code, pending rebate, and release backfills when requested', async () => {
    const now = new Date('2026-06-29T12:00:00.000Z');
    const codeCandidates = [{ id: 'instance-1', initiatorOrderId: 'order-1' }];
    const pendingCandidates = [{ id: 'referral-1', referredOrderId: 'order-2' }];
    const releasableCandidates = [{ id: 'referral-2', referredOrderId: 'order-3' }];
    const deps = {
      getCodeCandidates: jest.fn().mockResolvedValue(codeCandidates),
      getPendingRebateCandidates: jest.fn().mockResolvedValue(pendingCandidates),
      getReleasableReferralCandidates: jest.fn().mockResolvedValue(releasableCandidates),
      countSkippedInvalidInstances: jest.fn().mockResolvedValue(0),
      backfillActiveCodes: jest.fn().mockResolvedValue({ activated: 1, skipped: 0 }),
      backfillPendingRebates: jest.fn().mockResolvedValue({ created: 1, existing: 0, skipped: 0 }),
      releaseReceivedReferrals: jest.fn().mockResolvedValue({
        released: 1,
        alreadyReleased: 0,
        waiting: 0,
        skipped: 0,
      }),
    };
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(runBackfillGroupBuyInstantCodes({ execute: true, deps, now }))
        .resolves.toEqual(expect.objectContaining({
          execute: true,
          activeCodes: { activated: 1, skipped: 0 },
          pendingRebates: { created: 1, existing: 0, skipped: 0 },
          releasedReferrals: { released: 1, alreadyReleased: 0, waiting: 0, skipped: 0 },
        }));
    } finally {
      logSpy.mockRestore();
    }

    expect(deps.backfillActiveCodes).toHaveBeenCalledWith(codeCandidates, now);
    expect(deps.backfillPendingRebates).toHaveBeenCalledWith(pendingCandidates, now);
    expect(deps.releaseReceivedReferrals).toHaveBeenCalledWith(releasableCandidates, now);
  });

  it('activates paid pending instances and creates active codes transactionally', async () => {
    const now = new Date('2026-06-29T12:00:00.000Z');
    const tx = {
      groupBuyInstance: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'instance-1',
          status: 'QUALIFICATION_PENDING',
          code: null,
          initiatorOrder: {
            status: 'PAID',
            refunds: [],
            afterSaleRequests: [],
          },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      groupBuyCode: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'code-1' }),
      },
    };

    await expect(backfillActiveCodesInTransaction(tx as any, [
      { id: 'instance-1', initiatorOrderId: 'order-1' },
    ], now)).resolves.toEqual({ activated: 1, skipped: 0 });

    expect(tx.groupBuyInstance.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'instance-1',
        status: 'QUALIFICATION_PENDING',
        code: null,
      },
      data: {
        status: 'SHARING',
        activatedAt: now,
      },
    });
    expect(tx.groupBuyCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        instanceId: 'instance-1',
        status: 'ACTIVE',
        activatedAt: now,
      }),
    });
  });

  it('skips instances that already have a code or are no longer eligible', async () => {
    const tx = {
      groupBuyInstance: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'instance-coded',
            status: 'QUALIFICATION_PENDING',
            code: { id: 'code-existing' },
            initiatorOrder: {
              status: 'PAID',
              refunds: [],
              afterSaleRequests: [],
            },
          })
          .mockResolvedValueOnce({
            id: 'instance-refunded',
            status: 'QUALIFICATION_PENDING',
            code: null,
            initiatorOrder: {
              status: 'PAID',
              refunds: [{ id: 'refund-1' }],
              afterSaleRequests: [],
            },
          }),
        updateMany: jest.fn(),
      },
      groupBuyCode: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    await expect(backfillActiveCodesInTransaction(tx as any, [
      { id: 'instance-coded', initiatorOrderId: 'order-1' },
      { id: 'instance-refunded', initiatorOrderId: 'order-2' },
    ])).resolves.toEqual({ activated: 0, skipped: 2 });

    expect(tx.groupBuyInstance.updateMany).not.toHaveBeenCalled();
    expect(tx.groupBuyCode.create).not.toHaveBeenCalled();
  });
});
