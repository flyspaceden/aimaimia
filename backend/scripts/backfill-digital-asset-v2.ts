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
  historicalCreditGrantedAt?: Date | string | null;
  existingLedgerKeys: Set<string>;
  vipPackages: Array<{ id: string; price: number; status?: string | null }>;
};

export type VipBackfillResult = {
  wouldCredit: number;
  alreadyCredited: number;
  invalidPackage: number;
  errors: number;
};

export function parseVipBackfillOptions(argv = process.argv.slice(2)): VipBackfillOptions {
  return {
    dryRun: !argv.includes('--execute'),
  };
}

export function resolveVipBackfillPackage(params: {
  packageId: string | null;
  vipAmount: number;
  vipPackages: Array<{ id: string; price: number; status?: string | null }>;
}) {
  return resolveVipBackfillPackageFromList(params);
}

export function classifyVipBackfillCandidate(candidate: VipBackfillCandidate): {
  status: 'wouldCredit' | 'alreadyCredited' | 'invalidPackage';
  matchedPackageId: string | null;
} {
  const matchedPackage = resolveVipBackfillPackage({
    packageId: candidate.packageId,
    vipAmount: candidate.vipAmount,
    vipPackages: candidate.vipPackages,
  });

  if (!matchedPackage) {
    return { status: 'invalidPackage', matchedPackageId: null };
  }

  const selfSeedKey = `vip-purchase:${candidate.vipPurchaseId}:self-seed`;
  const historicalCreditKey = `user:${candidate.userId}:historical-consumption-credit-grant`;
  if (
    candidate.existingLedgerKeys.has(selfSeedKey)
    && (candidate.historicalCreditGrantedAt || candidate.existingLedgerKeys.has(historicalCreditKey))
  ) {
    return { status: 'alreadyCredited', matchedPackageId: matchedPackage.id };
  }

  return { status: 'wouldCredit', matchedPackageId: matchedPackage.id };
}

export async function runVipBackfillJob(params: {
  prisma: Pick<PrismaClient, 'vipPurchase' | 'memberProfile' | 'vipPackage' | 'digitalAssetAccount' | 'digitalAssetLedger'>;
  digitalAssetService: Pick<DigitalAssetService, 'backfillExistingVipAssets'>;
  options: VipBackfillOptions;
  errorLog?: (...args: any[]) => void;
}): Promise<VipBackfillResult> {
  const { prisma, digitalAssetService, options, errorLog = console.error } = params;
  let wouldCredit = 0;
  let alreadyCredited = 0;
  let invalidPackage = 0;
  let errors = 0;

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
  const [memberProfiles, vipPackages, accounts, existingLedgers] = await Promise.all([
    vipUserIds.length === 0
      ? []
      : (prisma as any).memberProfile.findMany({
        where: {
          userId: { in: vipUserIds },
          tier: 'VIP',
        },
        select: {
          userId: true,
          tier: true,
        },
      }),
    (prisma as any).vipPackage.findMany({
      select: { id: true, price: true, status: true },
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
        ],
      },
      select: {
        userId: true,
        vipPurchaseId: true,
        idempotencyKey: true,
      },
    }),
  ]);

  const vipMemberUserIds = new Set(
    memberProfiles
      .filter((profile: any) => profile.tier === 'VIP')
      .map((profile: any) => profile.userId),
  );

  const existingLedgerKeysByUser = new Map<string, Set<string>>();
  for (const ledger of existingLedgers) {
    const existing = existingLedgerKeysByUser.get(ledger.userId) ?? new Set<string>();
    existing.add(ledger.idempotencyKey);
    existingLedgerKeysByUser.set(ledger.userId, existing);
  }
  const historicalCreditGrantedAtByUser = new Map<string, Date | string | null>(
    accounts.map((account: any) => [account.userId, account.historicalCreditGrantedAt ?? null]),
  );

  for (const vipPurchase of vipPurchases) {
    if (!vipMemberUserIds.has(vipPurchase.userId)) {
      continue;
    }

    try {
      const classification = classifyVipBackfillCandidate({
        vipPurchaseId: vipPurchase.id,
        packageId: vipPurchase.packageId ?? null,
        vipAmount: vipPurchase.amount,
        userId: vipPurchase.userId,
        historicalCreditGrantedAt: historicalCreditGrantedAtByUser.get(vipPurchase.userId) ?? null,
        existingLedgerKeys: existingLedgerKeysByUser.get(vipPurchase.userId) ?? new Set<string>(),
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
        continue;
      }

      const result = await digitalAssetService.backfillExistingVipAssets({
        userId: vipPurchase.userId,
        vipPurchaseId: vipPurchase.id,
        packageId: vipPurchase.packageId ?? null,
        vipAmount: vipPurchase.amount,
      });
      if (result.status === 'credited') wouldCredit += 1;
      if (result.status === 'alreadyCredited') alreadyCredited += 1;
      if (result.status === 'invalidPackage') invalidPackage += 1;
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
