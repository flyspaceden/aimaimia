import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { VisualCreditService } from './visual-credit.service';

/**
 * Full-schema integration (not the minimal lease-only fixture).
 * New task-owned local postgres container/database only:
 * docker run -d --name aimai-visual-full-repro -e POSTGRES_HOST_AUTH_METHOD=trust \
 *   -e POSTGRES_DB=visual_task_full_test -p 127.0.0.1::5432 postgres:16.15-bookworm
 * docker exec aimai-visual-full-repro pg_isready -U postgres
 * docker port aimai-visual-full-repro 5432
 * DATABASE_URL=postgresql://postgres@127.0.0.1:PORT/visual_task_full_test npx prisma migrate deploy
 * VISUAL_TASK_FULL_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:PORT/visual_task_full_test \
 *   npx jest --runInBand src/modules/visual-agent/visual-task-execution.integration.spec.ts
 * docker rm --force --volumes aimai-visual-full-repro
 * No provider calls, main app seed, or real user credentials are used.
 */
const url = process.env.VISUAL_TASK_FULL_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || new URL(url).pathname !== '/visual_task_full_test')) {
  throw new Error('Full visual task tests require isolated localhost/visual_task_full_test');
}

(url ? describe : describe.skip)('Confirmed visual tasks on fully migrated PostgreSQL', () => {
  let prisma: PrismaClient;
  let credits: VisualCreditService;
  let tenantId: string;
  let principal: { tenantId: string; clientId: string; adapterNamespace: string; allowedAdapterTypes: string[]; keyId: string };
  let quote: Awaited<ReturnType<VisualCreditService['issueQuote']>>;
  const owner = { billingOwnerType: 'COMPANY', billingOwnerId: 'integration-company' };
  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    await prisma.$connect();
    credits = new VisualCreditService(prisma as any);
    // Require migration history from migrate deploy, not db push/minimal tables.
    const migrations = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>('SELECT COUNT(*) AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    expect(Number(migrations[0].count)).toBeGreaterThan(100);
  });
  beforeEach(async () => {
    tenantId = `full-task-${randomUUID()}`;
    principal = { tenantId, clientId: `${tenantId}-client`, adapterNamespace: 'task-integration', allowedAdapterTypes: ['integration-v1'], keyId: 'test' };
    await prisma.visualAgentTenant.create({ data: { id: tenantId, name: 'Isolated task test' } });
    await prisma.visualAgentClient.create({ data: { id: principal.clientId, tenantId, name: 'test', adapterNamespace: principal.adapterNamespace, allowedAdapterTypes: principal.allowedAdapterTypes } });
    await prisma.visualCreditAccount.create({ data: { tenantId, ...owner, availableCredits: 200 } });
    await prisma.visualRateCard.create({ data: {
      tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace, code: 'TEST',
      displayName: '测试', description: 'isolated', modelProfile: 'BAILIAN_WAN_STANDARD', outputSpec: {},
      allowedDirections: ['PRESERVE_REAL_SCENE'], allowedRiskProfiles: ['STANDARD_FACTS'],
      candidateCount: 1, creditCost: 10, version: 'v1', effectiveFrom: new Date(0),
    } });
    quote = await credits.issueQuote({ principal, ...owner, externalObjectId: 'product', actorId: 'staff',
      rateCode: 'TEST', sourceAssetRef: 'source', sourceHash: 'a'.repeat(64), visualPlanHash: 'b'.repeat(64),
      visualPlan: { direction: 'PRESERVE_REAL_SCENE', riskProfile: 'STANDARD_FACTS', protectedRegionVersion: 'NOT_CREATED', allowedOperations: ['LIGHTING'] },
      idempotencyKey: 'issue', expiresAt: new Date(Date.now() + 60_000),
    });
  });
  afterEach(async () => {
    await prisma.visualTaskExecution.deleteMany({ where: { quote: { tenantId } } });
    await prisma.visualCreditLedger.deleteMany({ where: { account: { tenantId } } });
    await prisma.visualCreditQuote.deleteMany({ where: { tenantId } });
    await prisma.visualRateCard.deleteMany({ where: { tenantId } });
    await prisma.visualCreditAccount.deleteMany({ where: { tenantId } });
    await prisma.visualAgentClient.deleteMany({ where: { tenantId } });
    await prisma.visualAgentTenant.delete({ where: { id: tenantId } });
  });
  afterAll(async () => { await prisma?.$disconnect(); });
  const confirm = () => credits.confirmAndReserve({ principal, ...owner, externalObjectId: 'product', actorId: 'staff', quoteId: quote.id, quoteHash: quote.quoteHash });

  it('atomically freezes credits, writes one ledger and creates durable execution', async () => {
    await confirm();
    expect(await prisma.visualCreditAccount.findFirst({ where: { tenantId } })).toMatchObject({ availableCredits: 190, reservedCredits: 10 });
    expect(await prisma.visualCreditLedger.count({ where: { quoteId: quote.id, type: 'RESERVE' } })).toBe(1);
    expect(await prisma.visualTaskExecution.findUnique({ where: { quoteId: quote.id } })).toMatchObject({ state: 'PENDING' });
    expect(await prisma.visualCreditQuote.findUnique({ where: { id: quote.id } })).toMatchObject({ status: 'RESERVED' });
  });

  it('concurrent confirmations and response-loss replay freeze the same quote once', async () => {
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => confirm()));
    expect(results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => ({ code: result.reason?.code, message: result.reason?.message }))).toEqual([]);
    await confirm();
    expect(await prisma.visualCreditAccount.findFirst({ where: { tenantId } })).toMatchObject({ availableCredits: 190, reservedCredits: 10 });
    expect(await prisma.visualCreditLedger.count({ where: { quoteId: quote.id, type: 'RESERVE' } })).toBe(1);
    expect(await prisma.visualTaskExecution.count({ where: { quoteId: quote.id } })).toBe(1);
  });

  it('rolls back quote, credits and ledger when durable task insertion fails', async () => {
    await prisma.$executeRawUnsafe(`CREATE FUNCTION visual_task_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated task insertion failure'; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER visual_task_test_reject BEFORE INSERT ON "VisualTaskExecution" FOR EACH ROW EXECUTE FUNCTION visual_task_test_reject()');
    try {
      await expect(confirm()).rejects.toThrow();
      expect(await prisma.visualCreditAccount.findFirst({ where: { tenantId } })).toMatchObject({ availableCredits: 200, reservedCredits: 0 });
      expect(await prisma.visualCreditQuote.findUnique({ where: { id: quote.id } })).toMatchObject({ status: 'ISSUED' });
      expect(await prisma.visualCreditLedger.count({ where: { quoteId: quote.id } })).toBe(0);
      expect(await prisma.visualTaskExecution.count({ where: { quoteId: quote.id } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER visual_task_test_reject ON "VisualTaskExecution"');
      await prisma.$executeRawUnsafe('DROP FUNCTION visual_task_test_reject()');
    }
  });
});
