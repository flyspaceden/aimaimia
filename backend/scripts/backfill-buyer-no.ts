import { Prisma, PrismaClient } from '@prisma/client';
import {
  acquireBuyerNoSequenceLock,
  formatBuyerNo,
  nextBuyerNo,
} from '../src/common/utils/buyer-no.util';

let prisma: PrismaClient | null = null;

function getPrismaClient(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

type BuyerCandidate = {
  id: string;
  createdAt: Date;
};

type BackfillResult = {
  updated: number;
  skipped: number;
  actualMax?: number;
};

type BuyerNoPreviewRange = {
  firstNo: string;
  lastNo: string;
};

type BuyerNoRawDb = {
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Promise<number>;
};

type BuyerNoBackfillTx = BuyerNoRawDb & {
  user: {
    updateMany(args: {
      where: { id: string; buyerNo: null };
      data: { buyerNo: string };
    }): Promise<{ count: number }>;
  };
};

type BuyerNoBackfillDeps = {
  getCandidates(): Promise<BuyerCandidate[]>;
  getCurrentMax(): Promise<number>;
  getBuyerNoPreviewRange(currentMax: number, candidateCount: number): Promise<BuyerNoPreviewRange>;
  syncSequenceToAtLeast(maxNo: number): Promise<void>;
  backfillCandidates(candidates: BuyerCandidate[]): Promise<BackfillResult>;
};

async function getCandidates(db: Pick<BuyerNoRawDb, '$queryRaw'> = getPrismaClient()): Promise<BuyerCandidate[]> {
  return db.$queryRaw<BuyerCandidate[]>`
    SELECT DISTINCT u.id, u."createdAt"
    FROM "User" u
    WHERE u."buyerNo" IS NULL
      AND (
        EXISTS (SELECT 1 FROM "Order" o WHERE o."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "Cart" c WHERE c."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "Address" a WHERE a."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "InvoiceProfile" ip WHERE ip."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "CouponInstance" ci WHERE ci."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "LotteryRecord" lr WHERE lr."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "CsSession" cs WHERE cs."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "DigitalAssetAccount" da WHERE da."userId" = u.id)
        OR (
          EXISTS (SELECT 1 FROM "AuthIdentity" ai WHERE ai."userId" = u.id)
          AND NOT EXISTS (SELECT 1 FROM "CompanyStaff" st WHERE st."userId" = u.id)
        )
      )
    ORDER BY u."createdAt" ASC, u.id ASC
  `;
}

async function getCurrentMax(db: Pick<BuyerNoRawDb, '$queryRaw'> = getPrismaClient()): Promise<number> {
  const rows = await db.$queryRaw<Array<{ max_no: bigint | number | null }>>`
    SELECT COALESCE(MAX(REPLACE("buyerNo", 'AIMM', '')::BIGINT), 0) AS max_no
    FROM "User"
    WHERE "buyerNo" ~ '^AIMM[0-9]{14}$'
  `;
  return Number(rows[0]?.max_no ?? 0);
}

export async function syncSequenceToAtLeast(
  db: Pick<BuyerNoRawDb, '$executeRaw'>,
  maxNo: number,
): Promise<void> {
  if (maxNo < 1) return;
  await acquireBuyerNoSequenceLock(db);
  await db.$executeRaw`
    SELECT setval(
      'buyer_no_seq',
      GREATEST((SELECT last_value FROM buyer_no_seq), ${maxNo}::BIGINT),
      true
    )
  `;
}

export async function getBuyerNoPreviewRange(
  db: Pick<BuyerNoRawDb, '$queryRaw'>,
  currentMax: number,
  candidateCount: number,
): Promise<BuyerNoPreviewRange> {
  const rows = await db.$queryRaw<Array<{ last_value: bigint | number | string; is_called: boolean }>>`
    SELECT last_value, is_called FROM buyer_no_seq
  `;
  const lastValue = Number(rows[0]?.last_value ?? 0);
  const isCalled = Boolean(rows[0]?.is_called);
  const firstValue = currentMax >= 1
    ? Math.max(lastValue, currentMax) + 1
    : isCalled
      ? lastValue + 1
      : lastValue;
  return {
    firstNo: formatBuyerNo(firstValue),
    lastNo: formatBuyerNo(firstValue + candidateCount - 1),
  };
}

export async function backfillCandidatesInTransaction(
  tx: BuyerNoBackfillTx,
  candidates: BuyerCandidate[],
): Promise<BackfillResult> {
  await acquireBuyerNoSequenceLock(tx);
  const currentMax = await getCurrentMax(tx);
  await syncSequenceToAtLeast(tx, currentMax);

  let updated = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const buyerNo = await nextBuyerNo(tx);
    const result = await tx.user.updateMany({
      where: { id: candidate.id, buyerNo: null },
      data: { buyerNo },
    });
    if (result.count === 1) {
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return { updated, skipped };
}

async function backfillCandidates(candidates: BuyerCandidate[]): Promise<BackfillResult> {
  const db = getPrismaClient();
  const result = await db.$transaction(
    async (tx) => backfillCandidatesInTransaction(tx as unknown as BuyerNoBackfillTx, candidates),
    { timeout: 120_000 },
  );
  const actualMax = await getCurrentMax(db);
  await syncSequenceToAtLeast(db, actualMax);
  return { ...result, actualMax };
}

const defaultDeps: BuyerNoBackfillDeps = {
  getCandidates: () => getCandidates(),
  getCurrentMax: () => getCurrentMax(),
  getBuyerNoPreviewRange: (currentMax, candidateCount) =>
    getBuyerNoPreviewRange(getPrismaClient(), currentMax, candidateCount),
  syncSequenceToAtLeast: (maxNo) => syncSequenceToAtLeast(getPrismaClient(), maxNo),
  backfillCandidates,
};

export async function runBackfillBuyerNo({
  dryRun = process.argv.includes('--dry-run'),
  deps = defaultDeps,
}: {
  dryRun?: boolean;
  deps?: BuyerNoBackfillDeps;
} = {}) {
  const candidates = await deps.getCandidates();
  const currentMax = await deps.getCurrentMax();
  console.log(`[buyer-no] dryRun=${dryRun} candidates=${candidates.length} currentMax=${currentMax}`);

  if (candidates.length === 0) {
    if (!dryRun) {
      await deps.syncSequenceToAtLeast(currentMax);
    }
    console.log(
      `[buyer-no] no candidates, ${
        dryRun ? 'sequence sync skipped' : `sequence synced to at least max=${currentMax}`
      }`,
    );
    return;
  }

  const { firstNo, lastNo } = await deps.getBuyerNoPreviewRange(currentMax, candidates.length);
  console.log(`[buyer-no] first=${firstNo} last=${lastNo}`);

  if (dryRun) return;

  const result = await deps.backfillCandidates(candidates);
  console.log(
    `[buyer-no] backfill complete updated=${result.updated} skipped=${result.skipped}${
      result.actualMax === undefined ? '' : ` actualMax=${result.actualMax}`
    }`,
  );
}

if (require.main === module) {
  runBackfillBuyerNo()
    .catch((err) => {
      console.error('[buyer-no] backfill failed', err);
      process.exitCode = 1;
    })
    .finally(() => prisma?.$disconnect());
}
