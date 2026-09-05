import { PrismaClient, Prisma } from '@prisma/client';
import { VisualTaskExecutionService } from './visual-task-execution.service';

/**
 * Scope: real PostgreSQL task-table migration and task lease SQL ONLY.
 * VisualCreditQuote is a minimal parent-table stub containing just its PK.
 * This is NOT full Prisma migration-history, quote/credit transaction, or
 * application integration validation. Those require a separately migrated DB.
 *
 * Reproduce from backend/ using a NEW disposable container (never existing DB):
 * 1. docker run -d --name aimai-visual-task-lease-repro \
 *      -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=visual_task_test \
 *      -p 127.0.0.1::5432 postgres:16.15-bookworm
 * 2. docker exec aimai-visual-task-lease-repro pg_isready -U postgres
 *    Wait until ready; docker port aimai-visual-task-lease-repro 5432
 *    displays the localhost PORT to use below.
 * 3. docker exec aimai-visual-task-lease-repro psql -U postgres \
 *      -d visual_task_test -c 'CREATE TABLE "VisualCreditQuote" ("id" TEXT PRIMARY KEY)'
 * 4. docker exec -i aimai-visual-task-lease-repro psql -U postgres \
 *      -d visual_task_test -v ON_ERROR_STOP=1 \
 *      < prisma/migrations/20260904000100_visual_task_execution/migration.sql
 * 5. VISUAL_TASK_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:PORT/visual_task_test \
 *      npx jest --runInBand src/modules/visual-agent/visual-task-execution.postgres.spec.ts
 * 6. docker rm --force --volumes aimai-visual-task-lease-repro
 *
 * Container trust auth is restricted to a randomly mapped localhost port.
 * Cleanup deletes only this test-owned disposable container/data.
 */

const url = process.env.VISUAL_TASK_TEST_DATABASE_URL;
const enabled = Boolean(url);
// Deliberately restricted to the isolated test database; never infer DATABASE_URL.
if (url && (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || new URL(url).pathname !== '/visual_task_test')) {
  throw new Error('Visual task lease tests require isolated localhost/visual_task_test');
}

(enabled ? describe : describe.skip)('Visual task leases on PostgreSQL', () => {
  let prisma: PrismaClient;
  let first: VisualTaskExecutionService;
  let second: VisualTaskExecutionService;
  let quoteId: string;
  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    first = new VisualTaskExecutionService(prisma as any);
    second = new VisualTaskExecutionService(prisma as any);
    await prisma.$connect();
  });
  beforeEach(async () => {
    quoteId = `lease-test-${Date.now()}-${Math.random()}`;
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "VisualCreditQuote" ("id") VALUES (${quoteId})`);
    await prisma.visualTaskExecution.create({ data: { quoteId } });
  });
  afterEach(async () => {
    await prisma.visualTaskExecution.deleteMany({ where: { quoteId } });
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "VisualCreditQuote" WHERE "id" = ${quoteId}`);
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  it('grants one of two concurrent workers ownership of a due task', async () => {
    const claims = await Promise.all([first.claim(), second.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const owner = claims.find(Boolean)!;
    expect(await first.heartbeat(owner)).toBe(true);
    expect(await second.claim()).toBeNull();
    expect((await first.finish(owner, { done: true })).count).toBe(1);
  });

  it('recovers an expired lease and fences writes by its old worker', async () => {
    const oldOwner = (await first.claim())!;
    await prisma.visualTaskExecution.update({ where: { quoteId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    const newOwner = (await second.claim())!;
    expect(newOwner.leaseGeneration).toBe(oldOwner.leaseGeneration + 1);
    expect(newOwner.leaseToken).not.toBe(oldOwner.leaseToken);
    expect(await first.heartbeat(oldOwner)).toBe(false);
    expect((await first.finish(oldOwner, { done: true })).count).toBe(0);
    expect((await second.finish(newOwner, { done: true })).count).toBe(1);
  });

  it('keeps a deferred task durable without making it immediately claimable', async () => {
    const owner = (await first.claim())!;
    await first.finish(owner, { done: false, retryAfterMs: 60_000 }, 'PROVIDER_RUNNING');
    expect(await second.claim()).toBeNull();
    const task = await prisma.visualTaskExecution.findUniqueOrThrow({ where: { quoteId } });
    expect(task.state).toBe('PENDING');
    expect(task.leaseToken).toBeNull();
    expect(task.lastErrorCode).toBe('PROVIDER_RUNNING');
  });
});
