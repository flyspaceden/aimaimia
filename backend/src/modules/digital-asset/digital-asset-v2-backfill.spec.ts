import {
  classifyVipBackfillCandidate,
  parseVipBackfillOptions,
} from '../../../scripts/backfill-digital-asset-v2';

describe('digital asset v2 vip backfill script helpers', () => {
  const vipPackages = [
    { id: 'pkg-399', price: 399, selfSeedAssetAmount: 1000, referralSeedAssetAmount: 2000 },
    { id: 'pkg-699', price: 699, selfSeedAssetAmount: 2000, referralSeedAssetAmount: 4000 },
    { id: 'pkg-999', price: 999, selfSeedAssetAmount: 3000, referralSeedAssetAmount: 8000 },
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
});
