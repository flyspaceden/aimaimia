import {
  classifyVipBackfillCandidate,
  parseVipBackfillOptions,
  resolveVipBackfillPackage,
  runVipBackfillJob,
} from '../../../scripts/backfill-digital-asset-v2';

describe('digital asset v2 vip backfill script helpers', () => {
  const vipPackages = [
    { id: 'pkg-399', price: 399, selfSeedAssetAmount: 1000, referralSeedAssetAmount: 2000, status: 'ACTIVE' },
    { id: 'pkg-699', price: 699, selfSeedAssetAmount: 2000, referralSeedAssetAmount: 4000, status: 'ACTIVE' },
    { id: 'pkg-999', price: 999, selfSeedAssetAmount: 3000, referralSeedAssetAmount: 8000, status: 'ACTIVE' },
  ];

  it('defaults to dry-run mode', () => {
    expect(parseVipBackfillOptions([])).toEqual({ dryRun: true });
  });

  it('dry run reports existing VIP with package match as wouldCredit', () => {
    expect(classifyVipBackfillCandidate({
      vipPurchaseId: 'vp-1',
      packageId: 'pkg-399',
      vipAmount: 399,
      userId: 'user-1',
      existingLedgerKeys: new Set(),
      vipPackages,
    })).toEqual({
      status: 'wouldCredit',
      matchedPackageId: 'pkg-399',
    });
  });

  it('missing packageId falls back to VipPurchase.amount', () => {
    expect(classifyVipBackfillCandidate({
      vipPurchaseId: 'vp-2',
      packageId: null,
      vipAmount: 699,
      userId: 'user-2',
      existingLedgerKeys: new Set(),
      vipPackages,
    })).toEqual({
      status: 'wouldCredit',
      matchedPackageId: 'pkg-699',
    });
  });

  it('missing package and amount match enters invalidPackage', () => {
    expect(classifyVipBackfillCandidate({
      vipPurchaseId: 'vp-3',
      packageId: null,
      vipAmount: 888,
      userId: 'user-3',
      existingLedgerKeys: new Set(),
      vipPackages,
    })).toEqual({
      status: 'invalidPackage',
      matchedPackageId: null,
    });
  });

  it('re-running after ledgers exist reports alreadyCredited', () => {
    expect(classifyVipBackfillCandidate({
      vipPurchaseId: 'vp-4',
      packageId: 'pkg-999',
      vipAmount: 999,
      userId: 'user-4',
      existingLedgerKeys: new Set([
        'vip-purchase:vp-4:self-seed',
        'user:user-4:historical-consumption-credit-grant',
      ]),
      vipPackages,
    })).toEqual({
      status: 'alreadyCredited',
      matchedPackageId: 'pkg-999',
    });
  });

  it('re-running after zero historical grant marker exists reports alreadyCredited without a historical ledger key', () => {
    expect(classifyVipBackfillCandidate({
      vipPurchaseId: 'vp-zero',
      packageId: 'pkg-399',
      vipAmount: 399,
      userId: 'user-zero',
      historicalCreditGrantedAt: new Date('2026-06-17T00:00:00.000Z'),
      existingLedgerKeys: new Set([
        'vip-purchase:vp-zero:self-seed',
      ]),
      vipPackages,
    })).toEqual({
      status: 'alreadyCredited',
      matchedPackageId: 'pkg-399',
    });
  });

  it('dry-run and execute package resolution use the same package set, including inactive packageId matches', () => {
    const packages = [
      { id: 'pkg-legacy', price: 399, selfSeedAssetAmount: 800, referralSeedAssetAmount: 1600, status: 'INACTIVE' },
      ...vipPackages,
    ];

    expect(resolveVipBackfillPackage({
      packageId: 'pkg-legacy',
      vipAmount: 399,
      vipPackages: packages,
    })).toMatchObject({ id: 'pkg-legacy', status: 'INACTIVE' });

    expect(classifyVipBackfillCandidate({
      vipPurchaseId: 'vp-legacy',
      packageId: 'pkg-legacy',
      vipAmount: 399,
      userId: 'vip-user',
      existingLedgerKeys: new Set(),
      vipPackages: packages,
    })).toEqual({
      status: 'wouldCredit',
      matchedPackageId: 'pkg-legacy',
    });
  });

  it('skips PAID VipPurchase rows where activation never produced an actual VIP member', async () => {
    const prisma = {
      vipPurchase: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'vp-1', userId: 'normal-user', packageId: 'pkg-399', amount: 399, activationStatus: 'FAILED' },
          { id: 'vp-2', userId: 'vip-user', packageId: 'pkg-699', amount: 699, activationStatus: 'SUCCESS' },
        ]),
      },
      memberProfile: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 'vip-user', tier: 'VIP' },
        ]),
      },
      vipPackage: {
        findMany: jest.fn().mockResolvedValue(vipPackages),
      },
      digitalAssetAccount: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      digitalAssetLedger: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const digitalAssetService = {
      backfillExistingVipAssets: jest.fn().mockResolvedValue({
        status: 'credited',
        grantedSelfSeed: true,
        grantedHistoricalCredit: true,
      }),
    };

    const result = await runVipBackfillJob({
      prisma: prisma as any,
      digitalAssetService: digitalAssetService as any,
      options: { dryRun: false },
    });

    expect(digitalAssetService.backfillExistingVipAssets).toHaveBeenCalledTimes(1);
    expect(digitalAssetService.backfillExistingVipAssets).toHaveBeenCalledWith({
      userId: 'vip-user',
      vipPurchaseId: 'vp-2',
      packageId: 'pkg-699',
      vipAmount: 699,
    });
    expect(result).toMatchObject({
      wouldCredit: 1,
      alreadyCredited: 0,
      invalidPackage: 0,
      errors: 0,
    });
  });
});
