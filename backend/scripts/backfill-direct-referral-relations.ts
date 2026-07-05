import { Prisma, PrismaClient } from '@prisma/client';

let prisma: PrismaClient | null = null;

function getPrismaClient(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

type DirectReferralBindingCandidate = {
  id: string;
  inviterUserId: string;
  inviteeUserId: string;
  relationStatus: string;
  effectiveInviterUserId: string | null;
};

type DirectReferralBackfillResult = {
  scanned: number;
  memberProfilesCreated: number;
  memberInvitersBackfilled: number;
  memberInviterConflicts: number;
  effectiveInvitersBackfilled: number;
  skipped: number;
  conflicts: Array<{
    bindingId: string;
    inviteeUserId: string;
    bindingInviterUserId: string;
    memberInviterUserId: string;
  }>;
};

type DirectReferralBackfillDeps = {
  getCandidates(): Promise<DirectReferralBindingCandidate[]>;
  backfillCandidates(
    candidates: DirectReferralBindingCandidate[],
    options: { execute: boolean; now: Date },
  ): Promise<DirectReferralBackfillResult>;
};

type DirectReferralBackfillDb = {
  memberProfile: {
    findUnique(args: { where: { userId: string }; select?: Record<string, boolean> }): Promise<{
      userId: string;
      inviterUserId: string | null;
    } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { userId: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  normalShareBinding: {
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

async function getCandidates(db: any = getPrismaClient()): Promise<DirectReferralBindingCandidate[]> {
  return db.normalShareBinding.findMany({
    select: {
      id: true,
      inviterUserId: true,
      inviteeUserId: true,
      relationStatus: true,
      effectiveInviterUserId: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

export async function backfillDirectReferralRelationCandidates(
  db: DirectReferralBackfillDb,
  candidates: DirectReferralBindingCandidate[],
  {
    execute,
    now = new Date(),
  }: {
    execute: boolean;
    now?: Date;
  },
): Promise<DirectReferralBackfillResult> {
  const result: DirectReferralBackfillResult = {
    scanned: 0,
    memberProfilesCreated: 0,
    memberInvitersBackfilled: 0,
    memberInviterConflicts: 0,
    effectiveInvitersBackfilled: 0,
    skipped: 0,
    conflicts: [],
  };

  for (const binding of candidates) {
    result.scanned += 1;
    try {
      const member = await db.memberProfile.findUnique({
        where: { userId: binding.inviteeUserId },
        select: { userId: true, inviterUserId: true },
      });

      if (!member) {
        if (execute) {
          await db.memberProfile.create({
            data: {
              userId: binding.inviteeUserId,
              inviterUserId: binding.inviterUserId,
              createdAt: now,
              updatedAt: now,
            },
          });
        }
        result.memberProfilesCreated += 1;
      } else if (!member.inviterUserId) {
        if (execute) {
          await db.memberProfile.update({
            where: { userId: binding.inviteeUserId },
            data: { inviterUserId: binding.inviterUserId },
          });
        }
        result.memberInvitersBackfilled += 1;
      } else if (member.inviterUserId !== binding.inviterUserId) {
        result.memberInviterConflicts += 1;
        result.conflicts.push({
          bindingId: binding.id,
          inviteeUserId: binding.inviteeUserId,
          bindingInviterUserId: binding.inviterUserId,
          memberInviterUserId: member.inviterUserId,
        });
      }

      if (binding.relationStatus === 'ACTIVE' && !binding.effectiveInviterUserId) {
        if (execute) {
          await db.normalShareBinding.update({
            where: { id: binding.id },
            data: { effectiveInviterUserId: binding.inviterUserId },
          });
        }
        result.effectiveInvitersBackfilled += 1;
      }
    } catch (err) {
      result.skipped += 1;
      console.warn(
        `[direct-referral] skipped bindingId=${binding.id} invitee=${binding.inviteeUserId} error=${(err as Error)?.message}`,
      );
    }
  }

  return result;
}

async function backfillCandidates(
  candidates: DirectReferralBindingCandidate[],
  options: { execute: boolean; now: Date },
  db = getPrismaClient(),
): Promise<DirectReferralBackfillResult> {
  if (!options.execute) {
    return backfillDirectReferralRelationCandidates(db as unknown as DirectReferralBackfillDb, candidates, options);
  }

  return db.$transaction(
    (tx) => backfillDirectReferralRelationCandidates(
      tx as unknown as DirectReferralBackfillDb,
      candidates,
      options,
    ),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 120_000,
    },
  );
}

const defaultDeps: DirectReferralBackfillDeps = {
  getCandidates: () => getCandidates(),
  backfillCandidates,
};

export async function runBackfillDirectReferralRelations({
  execute = process.argv.includes('--execute'),
  deps = defaultDeps,
  now = new Date(),
}: {
  execute?: boolean;
  deps?: DirectReferralBackfillDeps;
  now?: Date;
} = {}) {
  const candidates = await deps.getCandidates();
  console.log(`[direct-referral] execute=${execute} bindings=${candidates.length}`);
  if (!execute) {
    console.log('[direct-referral] dry-run only; pass --execute to write MemberProfile inviter and effective inviter fields');
  }

  const result = await deps.backfillCandidates(candidates, { execute, now });
  console.log(
    `[direct-referral] ${execute ? 'complete' : 'preview'} scanned=${result.scanned} memberCreated=${result.memberProfilesCreated} memberInviterBackfilled=${result.memberInvitersBackfilled} effectiveInviterBackfilled=${result.effectiveInvitersBackfilled} conflicts=${result.memberInviterConflicts} skipped=${result.skipped}`,
  );
  if (result.conflicts.length > 0) {
    console.warn('[direct-referral] conflicts were not overwritten:', result.conflicts.slice(0, 20));
  }
  return { execute, candidateCount: candidates.length, backfill: result };
}

if (require.main === module) {
  runBackfillDirectReferralRelations()
    .catch((err) => {
      console.error('[direct-referral] backfill failed', err);
      process.exitCode = 1;
    })
    .finally(() => prisma?.$disconnect());
}
