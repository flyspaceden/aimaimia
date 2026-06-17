import { PrismaClient } from '@prisma/client';
import { DigitalAssetService } from '../src/modules/digital-asset/digital-asset.service';

export type VipBackfillOptions = {
  dryRun: boolean;
};

export type VipBackfillCandidate = {
  vipPurchaseId: string;
  packageId: string | null;
  vipAmount: number;
  userId: string;
  existingLedgerKeys: Set<string>;
  vipPackages: Array<{ id: string; price: number }>;
};

export function parseVipBackfillOptions(argv = process.argv.slice(2)): VipBackfillOptions {
  return {
    dryRun: !argv.includes('--execute'),
  };
}

export function classifyVipBackfillCandidate(candidate: VipBackfillCandidate): {
  status: 'wouldCredit' | 'alreadyCredited' | 'invalidPackage';
  matchedPackageId: string | null;
} {
  const matchedPackage = candidate.packageId
    ? candidate.vipPackages.find((pkg) => pkg.id === candidate.packageId)
    : candidate.vipPackages.find((pkg) => pkg.price === candidate.vipAmount);

  if (!matchedPackage) {
    return { status: 'invalidPackage', matchedPackageId: null };
  }

  const selfSeedKey = `vip-purchase:${candidate.vipPurchaseId}:self-seed`;
  const historicalCreditKey = `user:${candidate.userId}:historical-consumption-credit-grant`;
  if (
    candidate.existingLedgerKeys.has(selfSeedKey)
    && candidate.existingLedgerKeys.has(historicalCreditKey)
  ) {
    return { status: 'alreadyCredited', matchedPackageId: matchedPackage.id };
  }

  return { status: 'wouldCredit', matchedPackageId: matchedPackage.id };
}

async function run() {
  const options = parseVipBackfillOptions();
  const prisma = new PrismaClient();
  const digitalAssetService = new DigitalAssetService(prisma as any);
  let wouldCredit = 0;
  let alreadyCredited = 0;
  let invalidPackage = 0;
  let errors = 0;

  try {
    const [vipPurchases, vipPackages, existingLedgers] = await Promise.all([
      (prisma as any).vipPurchase.findMany({
        where: { status: 'PAID' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          userId: true,
          packageId: true,
          amount: true,
        },
      }),
      (prisma as any).vipPackage.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, price: true },
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

    const existingLedgerKeysByUser = new Map<string, Set<string>>();
    for (const ledger of existingLedgers) {
      const existing = existingLedgerKeysByUser.get(ledger.userId) ?? new Set<string>();
      existing.add(ledger.idempotencyKey);
      existingLedgerKeysByUser.set(ledger.userId, existing);
    }

    for (const vipPurchase of vipPurchases) {
      try {
        const classification = classifyVipBackfillCandidate({
          vipPurchaseId: vipPurchase.id,
          packageId: vipPurchase.packageId ?? null,
          vipAmount: vipPurchase.amount,
          userId: vipPurchase.userId,
          existingLedgerKeys: existingLedgerKeysByUser.get(vipPurchase.userId) ?? new Set<string>(),
          vipPackages,
        });

        if (options.dryRun) {
          if (classification.status === 'wouldCredit') wouldCredit += 1;
          if (classification.status === 'alreadyCredited') alreadyCredited += 1;
          if (classification.status === 'invalidPackage') invalidPackage += 1;
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
        console.error(`[digital-asset-v2-backfill] vipPurchase=${vipPurchase.id} failed`, error);
      }
    }

    console.log(`wouldCredit=${wouldCredit}`);
    console.log(`alreadyCredited=${alreadyCredited}`);
    console.log(`invalidPackage=${invalidPackage}`);
    console.log(`errors=${errors}`);
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
