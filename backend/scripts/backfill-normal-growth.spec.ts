import {
  backfillNormalGrowthCandidatesInTransaction,
  runBackfillNormalGrowth,
} from './backfill-normal-growth';
import { readFileSync } from 'fs';

describe('backfill-normal-growth script', () => {
  it('dry-runs by default and does not write missing growth accounts or share profiles', async () => {
    const deps = {
      getCandidates: jest.fn().mockResolvedValue([
        { id: 'normal-1', buyerNo: 'AIMM00000000000001', createdAt: new Date('2026-07-01T00:00:00.000Z') },
      ]),
      backfillCandidates: jest.fn(),
    };
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(runBackfillNormalGrowth({ execute: false, deps })).resolves.toMatchObject({
        execute: false,
        candidateCount: 1,
      });
    } finally {
      logSpy.mockRestore();
    }

    expect(deps.backfillCandidates).not.toHaveBeenCalled();
  });

  it('creates zero-value GrowthAccount and active NormalShareProfile only for missing records', async () => {
    const now = new Date('2026-07-04T00:00:00.000Z');
    const tx = {
      growthAccount: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'existing-growth' }),
        create: jest.fn().mockResolvedValue({ id: 'growth-created' }),
      },
      normalShareProfile: {
        findUnique: jest.fn(({ where }: any) => {
          if (where.userId === 'normal-1') return Promise.resolve(null);
          if (where.userId === 'normal-2') return Promise.resolve({ id: 'existing-share' });
          return Promise.resolve(null);
        }),
        create: jest.fn().mockResolvedValue({ id: 'share-created' }),
      },
    };

    await expect(
      backfillNormalGrowthCandidatesInTransaction(tx as any, [
        { id: 'normal-1', buyerNo: 'AIMM00000000000001', createdAt: now },
        { id: 'normal-2', buyerNo: 'AIMM00000000000002', createdAt: now },
      ], now),
    ).resolves.toEqual({
      growthAccountsCreated: 1,
      growthAccountsExisting: 1,
      shareProfilesCreated: 1,
      shareProfilesExisting: 1,
      skipped: 0,
    });

    expect(tx.growthAccount.create).toHaveBeenCalledWith({
      data: {
        userId: 'normal-1',
        pointsBalance: 0,
        pointsTotalEarned: 0,
        pointsTotalSpent: 0,
        growthValue: 0,
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(tx.normalShareProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'normal-1',
        status: 'ACTIVE',
      }),
    });
  });

  it('ships a Prisma migration that backfills both growth accounts and normal share profiles', () => {
    const migrationSql = readFileSync(
      'prisma/migrations/20260704010000_backfill_normal_growth_accounts/migration.sql',
      'utf8',
    );

    expect(migrationSql).toContain('INSERT INTO "GrowthAccount"');
    expect(migrationSql).toContain('INSERT INTO "NormalShareProfile"');
    expect(migrationSql).toContain('Existing share profiles are never overwritten');
    expect(migrationSql).toContain('ON CONFLICT DO NOTHING');
  });
});
