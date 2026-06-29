import { Prisma, PrismaClient } from '@prisma/client';

import { generateUniqueGroupBuyCode } from '../src/modules/group-buy/group-buy-code.util';
import { GroupBuyRebateService } from '../src/modules/group-buy/group-buy-rebate.service';

let prisma: PrismaClient | null = null;

function getPrismaClient(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

const PAID_GROUP_BUY_ORDER_STATUSES = ['PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'] as const;
const DEFAULT_BATCH_SIZE = 100;

type GroupBuyCodeCandidate = {
  id: string;
  initiatorOrderId: string;
};

type GroupBuyReferralCandidate = {
  id: string;
  referredOrderId: string;
};

type ActiveCodeBackfillResult = {
  activated: number;
  skipped: number;
};

type PendingRebateBackfillResult = {
  created: number;
  existing: number;
  skipped: number;
};

type ReleaseBackfillResult = {
  released: number;
  alreadyReleased: number;
  waiting: number;
  skipped: number;
};

type GroupBuyInstantBackfillDeps = {
  getCodeCandidates(): Promise<GroupBuyCodeCandidate[]>;
  getPendingRebateCandidates(): Promise<GroupBuyReferralCandidate[]>;
  getReleasableReferralCandidates(): Promise<GroupBuyReferralCandidate[]>;
  countSkippedInvalidInstances(): Promise<number>;
  backfillActiveCodes(candidates: GroupBuyCodeCandidate[], now: Date): Promise<ActiveCodeBackfillResult>;
  backfillPendingRebates(candidates: GroupBuyReferralCandidate[], now: Date): Promise<PendingRebateBackfillResult>;
  releaseReceivedReferrals(candidates: GroupBuyReferralCandidate[], now: Date): Promise<ReleaseBackfillResult>;
};

type RunOptions = {
  execute?: boolean;
  deps?: GroupBuyInstantBackfillDeps;
  now?: Date;
};

type GroupBuyInstantBackfillTx = {
  groupBuyInstance: {
    findUnique(args: any): Promise<any>;
    updateMany(args: any): Promise<{ count: number }>;
  };
  groupBuyCode: {
    findUnique(args: any): Promise<any>;
    create(args: any): Promise<any>;
  };
};

function chunk<T>(items: T[], size = DEFAULT_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function getCodeCandidates(db: any = getPrismaClient()): Promise<GroupBuyCodeCandidate[]> {
  return db.groupBuyInstance.findMany({
    where: {
      status: 'QUALIFICATION_PENDING',
      code: null,
      initiatorOrder: {
        status: { in: PAID_GROUP_BUY_ORDER_STATUSES },
        refunds: { none: {} },
        afterSaleRequests: { none: {} },
      },
    },
    select: {
      id: true,
      initiatorOrderId: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

async function getPendingRebateCandidates(db: any = getPrismaClient()): Promise<GroupBuyReferralCandidate[]> {
  return db.groupBuyReferral.findMany({
    where: {
      status: 'CANDIDATE',
      instance: { status: { in: ['SHARING', 'TERMINATED'] } },
      ledgers: { none: { type: 'PENDING_REBATE' } },
      referredOrder: {
        status: { in: PAID_GROUP_BUY_ORDER_STATUSES },
        refunds: { none: {} },
        afterSaleRequests: { none: {} },
      },
    },
    select: {
      id: true,
      referredOrderId: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

async function getReleasableReferralCandidates(db: any = getPrismaClient()): Promise<GroupBuyReferralCandidate[]> {
  return db.groupBuyReferral.findMany({
    where: {
      status: 'CANDIDATE',
      referredOrder: {
        status: 'RECEIVED',
        refunds: { none: {} },
        afterSaleRequests: { none: {} },
      },
    },
    select: {
      id: true,
      referredOrderId: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

async function countSkippedInvalidInstances(db: any = getPrismaClient()): Promise<number> {
  return db.groupBuyInstance.count({
    where: {
      status: 'QUALIFICATION_PENDING',
      code: null,
      OR: [
        { initiatorOrder: { status: { notIn: PAID_GROUP_BUY_ORDER_STATUSES } } },
        { initiatorOrder: { refunds: { some: {} } } },
        { initiatorOrder: { afterSaleRequests: { some: {} } } },
      ],
    },
  });
}

export async function backfillActiveCodesInTransaction(
  tx: GroupBuyInstantBackfillTx,
  candidates: GroupBuyCodeCandidate[],
  now = new Date(),
): Promise<ActiveCodeBackfillResult> {
  let activated = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const instance = await tx.groupBuyInstance.findUnique({
      where: { id: candidate.id },
      include: {
        code: true,
        initiatorOrder: {
          select: {
            status: true,
            refunds: { select: { id: true }, take: 1 },
            afterSaleRequests: { select: { id: true }, take: 1 },
          },
        },
      },
    });
    const order = instance?.initiatorOrder;
    if (
      !instance
      || instance.status !== 'QUALIFICATION_PENDING'
      || instance.code
      || !PAID_GROUP_BUY_ORDER_STATUSES.includes(order?.status)
      || order.refunds.length > 0
      || order.afterSaleRequests.length > 0
    ) {
      skipped += 1;
      continue;
    }

    const updated = await tx.groupBuyInstance.updateMany({
      where: {
        id: instance.id,
        status: 'QUALIFICATION_PENDING',
        code: null,
      },
      data: {
        status: 'SHARING',
        activatedAt: now,
      },
    });
    if (updated.count !== 1) {
      skipped += 1;
      continue;
    }

    const code = await generateUniqueGroupBuyCode(tx as unknown as Prisma.TransactionClient);
    await tx.groupBuyCode.create({
      data: {
        instanceId: instance.id,
        code,
        status: 'ACTIVE',
        activatedAt: now,
      },
    });
    activated += 1;
  }

  return { activated, skipped };
}

async function backfillActiveCodes(
  candidates: GroupBuyCodeCandidate[],
  now: Date,
  db = getPrismaClient(),
): Promise<ActiveCodeBackfillResult> {
  let activated = 0;
  let skipped = 0;

  for (const batch of chunk(candidates)) {
    const result = await db.$transaction(
      async (tx) => backfillActiveCodesInTransaction(tx as unknown as GroupBuyInstantBackfillTx, batch, now),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 },
    );
    activated += result.activated;
    skipped += result.skipped;
  }

  return { activated, skipped };
}

async function backfillPendingRebates(
  candidates: GroupBuyReferralCandidate[],
  now: Date,
  db = getPrismaClient(),
  rebateService = new GroupBuyRebateService(db as any),
): Promise<PendingRebateBackfillResult> {
  let created = 0;
  let existing = 0;
  let skipped = 0;

  for (const batch of chunk(candidates)) {
    const result = await db.$transaction(
      async (tx) => {
        let batchCreated = 0;
        let batchExisting = 0;
        let batchSkipped = 0;
        for (const candidate of batch) {
          const pending = await rebateService.createPendingReferralAfterPayment(
            tx as unknown as Prisma.TransactionClient,
            candidate.id,
            now,
          );
          if (pending.status === 'PENDING_CREATED') batchCreated += 1;
          else if (pending.status === 'PENDING_EXISTS') batchExisting += 1;
          else batchSkipped += 1;
        }
        return { created: batchCreated, existing: batchExisting, skipped: batchSkipped };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 },
    );
    created += result.created;
    existing += result.existing;
    skipped += result.skipped;
  }

  return { created, existing, skipped };
}

async function releaseReceivedReferrals(
  candidates: GroupBuyReferralCandidate[],
  now: Date,
  db = getPrismaClient(),
  rebateService = new GroupBuyRebateService(db as any),
): Promise<ReleaseBackfillResult> {
  let released = 0;
  let alreadyReleased = 0;
  let waiting = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const result = await rebateService.releaseReferralIfValid(candidate.id, now);
    if (result.status === 'RELEASED') released += 1;
    else if (result.status === 'ALREADY_VALID' || result.status === 'ALREADY_RELEASED') alreadyReleased += 1;
    else if (result.status === 'WAITING_RECEIVE') waiting += 1;
    else skipped += 1;
  }

  return { released, alreadyReleased, waiting, skipped };
}

const defaultDeps: GroupBuyInstantBackfillDeps = {
  getCodeCandidates: () => getCodeCandidates(),
  getPendingRebateCandidates: () => getPendingRebateCandidates(),
  getReleasableReferralCandidates: () => getReleasableReferralCandidates(),
  countSkippedInvalidInstances: () => countSkippedInvalidInstances(),
  backfillActiveCodes: (candidates, now) => backfillActiveCodes(candidates, now),
  backfillPendingRebates: (candidates, now) => backfillPendingRebates(candidates, now),
  releaseReceivedReferrals: (candidates, now) => releaseReceivedReferrals(candidates, now),
};

export async function runBackfillGroupBuyInstantCodes({
  execute = process.argv.includes('--execute'),
  deps = defaultDeps,
  now = new Date(),
}: RunOptions = {}) {
  const [codeCandidates, pendingRebateCandidates, releasableReferralCandidates, skippedInvalidInstances] =
    await Promise.all([
      deps.getCodeCandidates(),
      deps.getPendingRebateCandidates(),
      deps.getReleasableReferralCandidates(),
      deps.countSkippedInvalidInstances(),
    ]);

  console.log(
    `[group-buy-instant-code] execute=${execute} codeCandidates=${codeCandidates.length} ` +
    `pendingRebateCandidates=${pendingRebateCandidates.length} ` +
    `releasableReferrals=${releasableReferralCandidates.length} ` +
    `skippedInvalidInstances=${skippedInvalidInstances}`,
  );

  if (!execute) {
    console.log('[group-buy-instant-code] dry-run only; pass --execute to write changes');
    return {
      execute,
      codeCandidates: codeCandidates.length,
      pendingRebateCandidates: pendingRebateCandidates.length,
      releasableReferrals: releasableReferralCandidates.length,
      skippedInvalidInstances,
    };
  }

  const activeCodes = await deps.backfillActiveCodes(codeCandidates, now);
  const pendingRebates = await deps.backfillPendingRebates(pendingRebateCandidates, now);
  const releasedReferrals = await deps.releaseReceivedReferrals(releasableReferralCandidates, now);

  console.log(
    `[group-buy-instant-code] done activated=${activeCodes.activated} ` +
    `codeSkipped=${activeCodes.skipped} pendingCreated=${pendingRebates.created} ` +
    `pendingExisting=${pendingRebates.existing} pendingSkipped=${pendingRebates.skipped} ` +
    `released=${releasedReferrals.released} releaseAlready=${releasedReferrals.alreadyReleased} ` +
    `releaseWaiting=${releasedReferrals.waiting} releaseSkipped=${releasedReferrals.skipped}`,
  );

  return {
    execute,
    codeCandidates: codeCandidates.length,
    pendingRebateCandidates: pendingRebateCandidates.length,
    releasableReferrals: releasableReferralCandidates.length,
    skippedInvalidInstances,
    activeCodes,
    pendingRebates,
    releasedReferrals,
  };
}

if (require.main === module) {
  runBackfillGroupBuyInstantCodes()
    .catch((err) => {
      console.error('[group-buy-instant-code] backfill failed', err);
      process.exitCode = 1;
    })
    .finally(() => prisma?.$disconnect());
}
