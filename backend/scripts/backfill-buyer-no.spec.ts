import {
  backfillCandidatesInTransaction,
  runBackfillBuyerNo,
  syncSequenceToAtLeast,
} from './backfill-buyer-no';

describe('backfill-buyer-no script', () => {
  it('does not sync the sequence on dry-run when no buyer candidates exist', async () => {
    const deps = {
      getCandidates: jest.fn().mockResolvedValue([]),
      getCurrentMax: jest.fn().mockResolvedValue(7),
      getBuyerNoPreviewRange: jest.fn(),
      syncSequenceToAtLeast: jest.fn(),
      backfillCandidates: jest.fn(),
    };
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await runBackfillBuyerNo({ dryRun: true, deps });
    } finally {
      logSpy.mockRestore();
    }

    expect(deps.syncSequenceToAtLeast).not.toHaveBeenCalled();
    expect(deps.backfillCandidates).not.toHaveBeenCalled();
    expect(deps.getBuyerNoPreviewRange).not.toHaveBeenCalled();
  });

  it('previews dry-run buyer numbers from the sequence state without mutating sequence state', async () => {
    const deps = {
      getCandidates: jest.fn().mockResolvedValue([
        { id: 'user-1', createdAt: new Date('2026-01-01T00:00:00.000Z') },
        { id: 'user-2', createdAt: new Date('2026-01-02T00:00:00.000Z') },
      ]),
      getCurrentMax: jest.fn().mockResolvedValue(7),
      getBuyerNoPreviewRange: jest.fn().mockResolvedValue({
        firstNo: 'AIMM00000000000042',
        lastNo: 'AIMM00000000000043',
      }),
      syncSequenceToAtLeast: jest.fn(),
      backfillCandidates: jest.fn(),
    };
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await runBackfillBuyerNo({ dryRun: true, deps });
      expect(logSpy).toHaveBeenCalledWith(
        '[buyer-no] first=AIMM00000000000042 last=AIMM00000000000043',
      );
    } finally {
      logSpy.mockRestore();
    }

    expect(deps.getBuyerNoPreviewRange).toHaveBeenCalledWith(7, 2);
    expect(deps.syncSequenceToAtLeast).not.toHaveBeenCalled();
    expect(deps.backfillCandidates).not.toHaveBeenCalled();
  });

  it('assigns buyer numbers from the PostgreSQL sequence under an advisory lock', async () => {
    const executeSql: string[] = [];
    const querySql: string[] = [];
    const tx = {
      $executeRaw: jest.fn((strings: TemplateStringsArray) => {
        executeSql.push(strings.join(' '));
        return Promise.resolve(1);
      }),
      $queryRaw: jest
        .fn()
        .mockImplementationOnce((strings: TemplateStringsArray) => {
          querySql.push(strings.join(' '));
          return Promise.resolve([{ max_no: BigInt(7) }]);
        })
        .mockImplementationOnce((strings: TemplateStringsArray) => {
          querySql.push(strings.join(' '));
          return Promise.resolve([{ nextval: BigInt(8) }]);
        })
        .mockImplementationOnce((strings: TemplateStringsArray) => {
          querySql.push(strings.join(' '));
          return Promise.resolve([{ nextval: BigInt(9) }]);
        }),
      user: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
    } as any;

    await expect(
      backfillCandidatesInTransaction(tx, [
        { id: 'user-1', createdAt: new Date('2026-01-01T00:00:00.000Z') },
        { id: 'user-2', createdAt: new Date('2026-01-02T00:00:00.000Z') },
      ]),
    ).resolves.toEqual({ updated: 1, skipped: 1 });

    expect(executeSql.some((sql) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(executeSql.some((sql) => sql.includes('setval'))).toBe(true);
    expect(querySql[0]).toContain('MAX(REPLACE("buyerNo"');
    expect(querySql[1]).toContain("nextval('buyer_no_seq')");
    expect(tx.user.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'user-1', buyerNo: null },
      data: { buyerNo: 'AIMM00000000000008' },
    });
    expect(tx.user.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'user-2', buyerNo: null },
      data: { buyerNo: 'AIMM00000000000009' },
    });
  });

  it('locks before syncing the buyer number sequence directly', async () => {
    const executeSql: string[] = [];
    const db = {
      $executeRaw: jest.fn((strings: TemplateStringsArray) => {
        executeSql.push(strings.join(' '));
        return Promise.resolve(1);
      }),
    } as any;

    await syncSequenceToAtLeast(db, 42);

    expect(executeSql).toHaveLength(2);
    expect(executeSql[0]).toContain('pg_advisory_xact_lock');
    expect(executeSql[1]).toContain('setval');
  });
});
