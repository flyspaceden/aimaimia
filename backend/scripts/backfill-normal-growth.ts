import { Prisma, PrismaClient } from '@prisma/client';
import { pickUniqueNormalShareCode } from '../src/modules/normal-share/normal-share-code.util';

let prisma: PrismaClient | null = null;

function getPrismaClient(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

type NormalGrowthCandidate = {
  id: string;
  buyerNo: string | null;
  createdAt: Date;
};

type BackfillResult = {
  growthAccountsCreated: number;
  growthAccountsExisting: number;
  shareProfilesCreated: number;
  shareProfilesExisting: number;
  skipped: number;
};

type RunResult = {
  execute: boolean;
  candidateCount: number;
  backfill?: BackfillResult;
};

type NormalGrowthBackfillDeps = {
  getCandidates(): Promise<NormalGrowthCandidate[]>;
  backfillCandidates(candidates: NormalGrowthCandidate[], now: Date): Promise<BackfillResult>;
};

type NormalGrowthBackfillTx = {
  growthAccount: {
    findUnique(args: { where: { userId: string } }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  normalShareProfile: {
    findUnique(args: { where: { userId: string } | { code: string } }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

async function getCandidates(db: any = getPrismaClient()): Promise<NormalGrowthCandidate[]> {
  return db.user.findMany({
    where: {
      buyerNo: { not: null },
      status: 'ACTIVE',
      deletionExecutedAt: null,
      OR: [
        { memberProfile: { is: null } },
        { memberProfile: { is: { tier: { not: 'VIP' } } } },
      ],
      AND: [
        {
          OR: [
            { growthAccount: { is: null } },
            { normalShareProfile: { is: null } },
          ],
        },
      ],
    },
    select: { id: true, buyerNo: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

export async function backfillNormalGrowthCandidatesInTransaction(
  tx: NormalGrowthBackfillTx,
  candidates: NormalGrowthCandidate[],
  now = new Date(),
): Promise<BackfillResult> {
  const result: BackfillResult = {
    growthAccountsCreated: 0,
    growthAccountsExisting: 0,
    shareProfilesCreated: 0,
    shareProfilesExisting: 0,
    skipped: 0,
  };

  for (const candidate of candidates) {
    try {
      const existingAccount = await tx.growthAccount.findUnique({
        where: { userId: candidate.id },
      });
      if (existingAccount) {
        result.growthAccountsExisting += 1;
      } else {
        await tx.growthAccount.create({
          data: {
            userId: candidate.id,
            pointsBalance: 0,
            pointsTotalEarned: 0,
            pointsTotalSpent: 0,
            growthValue: 0,
            createdAt: now,
            updatedAt: now,
          },
        });
        result.growthAccountsCreated += 1;
      }

      const existingProfile = await tx.normalShareProfile.findUnique({
        where: { userId: candidate.id },
      });
      if (existingProfile) {
        result.shareProfilesExisting += 1;
      } else {
        const code = await pickUniqueNormalShareCode(tx as unknown as Prisma.TransactionClient);
        await tx.normalShareProfile.create({
          data: {
            userId: candidate.id,
            code,
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
          },
        });
        result.shareProfilesCreated += 1;
      }
    } catch (err) {
      result.skipped += 1;
      console.warn(
        `[normal-growth] skipped userId=${candidate.id} buyerNo=${candidate.buyerNo ?? '-'} error=${(err as Error)?.message}`,
      );
    }
  }

  return result;
}

async function backfillCandidates(
  candidates: NormalGrowthCandidate[],
  now: Date,
  db = getPrismaClient(),
): Promise<BackfillResult> {
  return db.$transaction(
    (tx) => backfillNormalGrowthCandidatesInTransaction(tx as unknown as NormalGrowthBackfillTx, candidates, now),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 120_000,
    },
  );
}

const defaultDeps: NormalGrowthBackfillDeps = {
  getCandidates: () => getCandidates(),
  backfillCandidates,
};

export async function runBackfillNormalGrowth({
  execute = process.argv.includes('--execute'),
  deps = defaultDeps,
  now = new Date(),
}: {
  execute?: boolean;
  deps?: NormalGrowthBackfillDeps;
  now?: Date;
} = {}): Promise<RunResult> {
  const candidates = await deps.getCandidates();
  console.log(`[normal-growth] execute=${execute} candidates=${candidates.length}`);

  if (!execute) {
    console.log('[normal-growth] dry-run only; pass --execute to write missing accounts and share profiles');
    return { execute, candidateCount: candidates.length };
  }

  const backfill = await deps.backfillCandidates(candidates, now);
  console.log(
    `[normal-growth] complete growthCreated=${backfill.growthAccountsCreated} growthExisting=${backfill.growthAccountsExisting} shareCreated=${backfill.shareProfilesCreated} shareExisting=${backfill.shareProfilesExisting} skipped=${backfill.skipped}`,
  );
  return { execute, candidateCount: candidates.length, backfill };
}

if (require.main === module) {
  runBackfillNormalGrowth()
    .catch((err) => {
      console.error('[normal-growth] backfill failed', err);
      process.exitCode = 1;
    })
    .finally(() => prisma?.$disconnect());
}
