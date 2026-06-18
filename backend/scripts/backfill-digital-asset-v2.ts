import { PrismaClient } from '@prisma/client';
import { DigitalAssetService } from '../src/modules/digital-asset/digital-asset.service';
import { resolveVipBackfillPackage as resolveVipBackfillPackageFromList } from '../src/modules/digital-asset/digital-asset-vip-package.utils';

export type VipBackfillOptions = {
  dryRun: boolean;
};

export type VipBackfillCandidate = {
  vipPurchaseId: string;
  packageId: string | null;
  vipAmount: number;
  userId: string;
  inviterUserId?: string | null;
  historicalCreditGrantedAt?: Date | string | null;
  existingLedgerKeys: Set<string>;
  eligibleInviterUserIds?: Set<string>;
  vipPackages: Array<{
    id: string;
    price: number;
    status?: string | null;
    selfSeedAssetAmount?: number;
    referralSeedAssetAmount?: number;
  }>;
};

export type VipBackfillResult = {
  wouldCredit: number;
  alreadyCredited: number;
  invalidPackage: number;
  errors: number;
  referralWouldCredit: number;
  referralCredited: number;
};

export function parseVipBackfillOptions(argv = process.argv.slice(2)): VipBackfillOptions {
  return {
    dryRun: !argv.includes('--execute'),
  };
}

export function resolveVipBackfillPackage(params: {
  packageId: string | null;
  vipAmount: number;
  vipPackages: Array<{
    id: string;
    price: number;
    status?: string | null;
    selfSeedAssetAmount?: number;
    referralSeedAssetAmount?: number;
  }>;
}) {
  return resolveVipBackfillPackageFromList(params);
}

export function classifyVipBackfillCandidate(candidate: VipBackfillCandidate): {
  status: 'wouldCredit' | 'alreadyCredited' | 'invalidPackage';
  matchedPackageId: string | null;
  needsReferralCredit: boolean;
} {
  const matchedPackage = resolveVipBackfillPackage({
    packageId: candidate.packageId,
    vipAmount: candidate.vipAmount,
    vipPackages: candidate.vipPackages,
  });

  if (!matchedPackage) {
    return { status: 'invalidPackage', matchedPackageId: null, needsReferralCredit: false };
  }

  const selfSeedKey = `vip-purchase:${candidate.vipPurchaseId}:self-seed`;
  const historicalCreditKey = `user:${candidate.userId}:historical-consumption-credit-grant`;
  const referralSeedKey = `vip-purchase:${candidate.vipPurchaseId}:referral-seed`;
  const inviterEligible = Boolean(
    candidate.inviterUserId &&
    (!candidate.eligibleInviterUserIds || candidate.eligibleInviterUserIds.has(candidate.inviterUserId)),
  );
  const needsReferralCredit = Boolean(
    inviterEligible &&
    (matchedPackage.referralSeedAssetAmount ?? 0) > 0 &&
    !candidate.existingLedgerKeys.has(referralSeedKey),
  );
  if (
    candidate.existingLedgerKeys.has(selfSeedKey)
    && (candidate.historicalCreditGrantedAt || candidate.existingLedgerKeys.has(historicalCreditKey))
    && !needsReferralCredit
  ) {
    return { status: 'alreadyCredited', matchedPackageId: matchedPackage.id, needsReferralCredit: false };
  }

  return { status: 'wouldCredit', matchedPackageId: matchedPackage.id, needsReferralCredit };
}

export async function runVipBackfillJob(params: {
  prisma: Pick<PrismaClient, 'vipPurchase' | 'memberProfile' | 'vipPackage' | 'digitalAssetAccount' | 'digitalAssetLedger' | 'user'>;
  digitalAssetService: Pick<DigitalAssetService, 'backfillExistingVipAssets'>;
  options: VipBackfillOptions;
  errorLog?: (...args: any[]) => void;
}): Promise<VipBackfillResult> {
  const { prisma, digitalAssetService, options, errorLog = console.error } = params;
  let wouldCredit = 0;
  let alreadyCredited = 0;
  let invalidPackage = 0;
  let errors = 0;
  let referralWouldCredit = 0;
  let referralCredited = 0;

  const vipPurchases = await (prisma as any).vipPurchase.findMany({
    where: {
      status: 'PAID',
      activationStatus: 'SUCCESS',
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      userId: true,
      packageId: true,
      amount: true,
      activationStatus: true,
    },
  });

  const vipUserIds = Array.from(new Set(vipPurchases.map((vipPurchase: any) => vipPurchase.userId)));
  const memberProfiles = vipUserIds.length === 0
    ? []
    : await (prisma as any).memberProfile.findMany({
      where: {
        userId: { in: vipUserIds },
      },
      select: {
        userId: true,
        tier: true,
        inviterUserId: true,
      },
    });
  const memberProfileByUserId = new Map(memberProfiles.map((profile: any) => [profile.userId, profile]));
  const inviterUserIds = Array.from(new Set(
    memberProfiles
      .map((profile: any) => profile.inviterUserId)
      .filter(Boolean),
  ));

  const [inviterProfiles, inviterUsers, vipPackages, accounts, existingLedgers] = await Promise.all([
    inviterUserIds.length === 0
      ? []
      : (prisma as any).memberProfile.findMany({
        where: {
          userId: { in: inviterUserIds },
        },
        select: {
          userId: true,
          tier: true,
        },
      }),
    inviterUserIds.length === 0 || !(prisma as any).user?.findMany
      ? []
      : (prisma as any).user.findMany({
        where: {
          id: { in: inviterUserIds },
        },
        select: {
          id: true,
          status: true,
          deletionExecutedAt: true,
        },
      }),
    (prisma as any).vipPackage.findMany({
      select: { id: true, price: true, status: true, selfSeedAssetAmount: true, referralSeedAssetAmount: true },
    }),
    vipUserIds.length === 0
      ? []
      : (prisma as any).digitalAssetAccount.findMany({
        where: { userId: { in: vipUserIds } },
        select: {
          userId: true,
          historicalCreditGrantedAt: true,
        },
      }),
    (prisma as any).digitalAssetLedger.findMany({
      where: {
        OR: [
          { type: 'SELF_VIP_PURCHASE' },
          { type: 'HISTORICAL_CONSUMPTION_GRANT' },
          { type: 'REFERRAL_VIP_PURCHASE' },
        ],
      },
      select: {
        userId: true,
        vipPurchaseId: true,
        idempotencyKey: true,
      },
    }),
  ]);

  const eligibleInviterUserIds = new Set<string>(
    inviterProfiles
      .filter((profile: any) => {
        if (profile.tier !== 'VIP') return false;
        const user = inviterUsers.find((item: any) => item.id === profile.userId);
        return !user || (user.status === 'ACTIVE' && !user.deletionExecutedAt);
      })
      .map((profile: any) => String(profile.userId)),
  );

  const existingLedgerKeys = new Set<string>(existingLedgers.map((ledger: any) => String(ledger.idempotencyKey)));
  const historicalCreditGrantedAtByUser = new Map<string, Date | string | null>(
    accounts.map((account: any) => [account.userId, account.historicalCreditGrantedAt ?? null]),
  );

  for (const vipPurchase of vipPurchases) {
    const memberProfile = memberProfileByUserId.get(vipPurchase.userId) as any;
    if (memberProfile?.tier !== 'VIP') {
      continue;
    }

    try {
      const classification = classifyVipBackfillCandidate({
        vipPurchaseId: vipPurchase.id,
        packageId: vipPurchase.packageId ?? null,
        vipAmount: vipPurchase.amount,
        userId: vipPurchase.userId,
        inviterUserId: memberProfile.inviterUserId ?? null,
        historicalCreditGrantedAt: historicalCreditGrantedAtByUser.get(vipPurchase.userId) ?? null,
        existingLedgerKeys,
        eligibleInviterUserIds,
        vipPackages,
      });

      if (classification.status === 'invalidPackage') {
        invalidPackage += 1;
        continue;
      }
      if (classification.status === 'alreadyCredited') {
        alreadyCredited += 1;
        continue;
      }
      if (options.dryRun) {
        wouldCredit += 1;
        if (classification.needsReferralCredit) referralWouldCredit += 1;
        continue;
      }

      const result = await digitalAssetService.backfillExistingVipAssets({
        userId: vipPurchase.userId,
        vipPurchaseId: vipPurchase.id,
        packageId: vipPurchase.packageId ?? null,
        vipAmount: vipPurchase.amount,
        inviterUserId: memberProfile.inviterUserId ?? null,
      });
      if (result.status === 'credited') wouldCredit += 1;
      if (result.status === 'alreadyCredited') alreadyCredited += 1;
      if (result.status === 'invalidPackage') invalidPackage += 1;
      if (result.grantedReferralSeed) referralCredited += 1;
    } catch (error) {
      errors += 1;
      errorLog(`[digital-asset-v2-backfill] vipPurchase=${vipPurchase.id} failed`, error);
    }
  }

  return {
    wouldCredit,
    alreadyCredited,
    invalidPackage,
    errors,
    referralWouldCredit,
    referralCredited,
  };
}

async function run() {
  const options = parseVipBackfillOptions();
  const prisma = new PrismaClient();
  const digitalAssetService = new DigitalAssetService(prisma as any);

  try {
    const result = await runVipBackfillJob({
      prisma,
      digitalAssetService,
      options,
    });

    console.log(`wouldCredit=${result.wouldCredit}`);
    console.log(`alreadyCredited=${result.alreadyCredited}`);
    console.log(`invalidPackage=${result.invalidPackage}`);
    console.log(`errors=${result.errors}`);
    console.log(`referralWouldCredit=${result.referralWouldCredit}`);
    console.log(`referralCredited=${result.referralCredited}`);

    if (!options.dryRun && result.errors > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
