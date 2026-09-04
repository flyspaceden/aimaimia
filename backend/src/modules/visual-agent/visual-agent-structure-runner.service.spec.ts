import { VisualAgentStructureRunnerService, VerifyStructureInput } from './visual-agent-structure-runner.service';
import { VisualAgentInvocationService } from './visual-agent-invocation.service';
import { PrismaClient, VisualAgentBudgetScope } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BAILIAN_STRUCTURE_MODEL, BAILIAN_STRUCTURE_PROVIDER, STRUCTURE_VERIFICATION_MODE,
  STRUCTURE_VERIFICATION_VERSION, StructureObservations, structureVerificationPairHash, structureVerificationPlanHash } from './providers/bailian-structure-verification.provider';
const sharp = require('sharp') as typeof import('sharp').default;

function matchingObservations(): StructureObservations {
  return { identity: 'MATCH', intrinsicColor: 'MATCH', intrinsicMaterial: 'MATCH', labels: 'NOT_APPLICABLE',
    count: { source: 1, candidate: 1, verdict: 'MATCH' },
    components: { parts: 'MATCH', relativePositions: 'MATCH', crownToDial: 'MATCH', strapToDial: 'MATCH' },
    changeAllowances: { backgroundChanged: false, layoutChanged: false, countChanged: false } };
}

async function input(): Promise<VerifyStructureInput> {
  const source = { buffer: await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#aa7744' } }).jpeg().toBuffer(),
    mimeType: 'image/jpeg' as const, normalizedVersion: 'normalized-rgba-srgb-v1' as const, opaque: true as const };
  return { tenantId: 'tenant-a', ownerClientId: 'client-a', adapterNamespace: 'product', externalObjectId: 'product-a',
    actorId: 'actor-a', idempotencyKey: 'candidate-a-structure-v1', expiresAt: new Date(Date.now() + 60000), source, candidate: source,
    plan: { version: STRUCTURE_VERIFICATION_VERSION, candidateRole: 'FACT_MAIN_IMAGE', focus: 'WATCH_STRUCTURE',
      changeAllowances: { background: true, layout: false, count: false } } };
}

function harness() {
  let row: any = null;
  const updateMany = jest.fn(async ({ where, data }) => {
    if (!row || Object.entries(where).some(([key, value]) => key === 'leaseExpiresAt'
      ? !(row.leaseExpiresAt > (value as any).gt) : row[key] !== value)) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
  const prisma = {
    visualAgentInvocation: { findUnique: jest.fn(async () => row ? { ...row } : null) },
    $transaction: jest.fn(async (fn) => fn({ visualAgentInvocation: { updateMany } })),
  };
  const invocations = {
    reserve: jest.fn(async (value) => {
      row ??= { ...value, id: 'invocation-a', status: 'RESERVED', leaseGeneration: 0,
        verificationReport: null, providerUsage: null, providerRequestId: null, actualCostCents: null, providerOutputUrl: null };
      return { invocationId: row.id, status: row.status };
    }),
    acquireForSubmit: jest.fn(async () => {
      if (row.status !== 'RESERVED') throw new Error('Already submitted');
      Object.assign(row, { status: 'SUBMITTING', leaseToken: 'lease-a', leaseGeneration: 1, leaseExpiresAt: new Date(Date.now() + 60000) });
      return { invocationId: row.id, provider: BAILIAN_STRUCTURE_PROVIDER, policySnapshotVersion: 'v1', reservedCostCents: 1,
        adapterExecutionApproved: true, leaseToken: row.leaseToken, leaseGeneration: 1, expiresAt: row.leaseExpiresAt };
    }),
    recordSynchronousProviderOutcome: jest.fn(async (auth, outcome) => {
      if (row.status !== 'SUBMITTING' || row.leaseToken !== auth.leaseToken || row.leaseGeneration !== auth.leaseGeneration) throw new Error('Lease changed');
      Object.assign(row, { status: outcome.kind === 'DECLINED' ? 'RELEASED' : 'RECONCILING',
        leaseToken: null, leaseExpiresAt: null, reconciliationReason: outcome.code, providerRequestId: outcome.providerRequestId });
    }),
  };
  const provider = { isAvailable: jest.fn(() => true), preflight: jest.fn(async () => {}), verify: jest.fn(async (normalized: any, _authorization?: any) => ({
    kind: 'KNOWN', providerRequestId: 'request-1', usage: { inputTokens: 88, outputTokens: 22, totalTokens: 110 },
    report: { version: STRUCTURE_VERIFICATION_VERSION, scope: 'VISUAL_STRUCTURE', verdict: 'UNCERTAIN',
      reasons: ['INCOMPLETE_EVIDENCE'], observations: null as StructureObservations | null,
      sourcePairHash: structureVerificationPairHash(normalized), planHash: structureVerificationPlanHash(normalized.plan) },
  })) };
  return { prisma, invocations, provider, updateMany, get row() { return row; },
    service: new VisualAgentStructureRunnerService(prisma as any, invocations as any, provider as any) };
}

describe('VisualAgentStructureRunnerService', () => {
  it('reserves the fixed route before submit and atomically persists report, usage and success under an unexpired CAS lease', async () => {
    const h = harness(); const result = await h.service.verifyStructure(await input());
    expect(result.kind).toBe('KNOWN');
    expect(h.invocations.reserve).toHaveBeenCalledWith(expect.objectContaining({ provider: BAILIAN_STRUCTURE_PROVIDER,
      model: BAILIAN_STRUCTURE_MODEL, visualMode: STRUCTURE_VERIFICATION_MODE }));
    const normalized = h.provider.verify.mock.calls[0][0];
    for (const image of [normalized.source, normalized.candidate]) {
      expect(await sharp(image.buffer).metadata()).toMatchObject({ width: 1024, height: 768, format: 'png', hasAlpha: false });
    }
    expect(h.invocations.acquireForSubmit).toHaveBeenCalledWith('invocation-a', BAILIAN_STRUCTURE_MODEL,
      BAILIAN_STRUCTURE_PROVIDER, structureVerificationPairHash(normalized), structureVerificationPlanHash(normalized.plan), STRUCTURE_VERIFICATION_MODE);
    expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(h.updateMany.mock.calls[0][0].where).toMatchObject({ status: 'SUBMITTING', leaseToken: 'lease-a', leaseGeneration: 1,
      tenantId: 'tenant-a', ownerClientId: 'client-a', externalObjectId: 'product-a', actorId: 'actor-a', leaseExpiresAt: { gt: expect.any(Date) } });
    expect(h.row).toMatchObject({ status: 'SUCCEEDED', providerRequestId: 'request-1', providerUsage: { totalTokens: 110 },
      actualCostCents: null, providerOutputUrl: null });
  });

  it('does not enlarge small input and rejects falsely labelled transparent PNG before reservation', async () => {
    const h = harness(); const i = await input();
    i.source = { ...i.source, mimeType: 'image/png', buffer: await sharp({ create: { width: 128, height: 96, channels: 3, background: '#fff' } }).png().toBuffer() };
    await h.service.verifyStructure(i);
    expect(await sharp(h.provider.verify.mock.calls[0][0].source.buffer).metadata()).toMatchObject({ width: 128, height: 96 });
    const reject = harness();
    i.source.buffer = await sharp({ create: { width: 128, height: 96, channels: 4, background: '#ffffff80' } }).png().toBuffer();
    await expect(reject.service.verifyStructure(i)).rejects.toThrow('透明度');
    expect(reject.invocations.reserve).not.toHaveBeenCalled();
  });

  it('replays a persisted result after expiry and route pause without preflight, reservation or provider charge', async () => {
    const h = harness(); const i = await input(); const first = await h.service.verifyStructure(i);
    h.provider.preflight.mockRejectedValue(new Error('disabled'));
    i.expiresAt = new Date(0);
    expect(await h.service.verifyStructure(i)).toEqual(first);
    expect(h.provider.verify).toHaveBeenCalledTimes(1);
    expect(h.invocations.reserve).toHaveBeenCalledTimes(1);
    expect(h.provider.preflight).toHaveBeenCalledTimes(1);
  });

  it('allows only one provider call under simultaneous execution', async () => {
    const h = harness(); const i = await input();
    const results = await Promise.all([h.service.verifyStructure(i), h.service.verifyStructure(i)]);
    expect(results.some((r) => r.kind === 'KNOWN')).toBe(true);
    expect(h.provider.verify).toHaveBeenCalledTimes(1);
  });

  it('retains a completed FAIL report when later supplier billing moves the invocation to BILLING_EXCEPTION', async () => {
    const h = harness(); const i = await input(); await h.service.verifyStructure(i);
    const observation = { identity: 'MISMATCH', intrinsicColor: 'MATCH', intrinsicMaterial: 'MATCH', labels: 'NOT_APPLICABLE',
      count: { source: 1, candidate: 1, verdict: 'MATCH' }, components: { parts: 'MATCH', relativePositions: 'MATCH', crownToDial: 'MATCH', strapToDial: 'MATCH' },
      changeAllowances: { backgroundChanged: false, layoutChanged: false, countChanged: false } };
    Object.assign(h.row, { status: 'BILLING_EXCEPTION', verificationReport: { ...h.row.verificationReport,
      verdict: 'FAIL', reasons: ['IDENTITY_CHANGED'], observations: observation } });
    expect(await h.service.verifyStructure(i)).toMatchObject({ kind: 'KNOWN', billingStatus: 'BILLING_EXCEPTION',
      report: { verdict: 'FAIL', reasons: ['IDENTITY_CHANGED'] } });
    expect(h.provider.verify).toHaveBeenCalledTimes(1);
  });

  it('rejudges a stored PASS with a mismatched crown as FAIL using the bound plan', async () => {
    const h = harness(); const i = await input(); await h.service.verifyStructure(i);
    const observations = matchingObservations(); observations.components.crownToDial = 'MISMATCH';
    h.row.verificationReport = { ...h.row.verificationReport, verdict: 'PASS', reasons: ['NO_MATERIAL_CONFLICT'], observations };
    expect(await h.service.verifyStructure(i)).toMatchObject({ kind: 'KNOWN', report: { verdict: 'FAIL',
      reasons: expect.arrayContaining(['WATCH_CROWN_POSITION_CHANGED']) } });
    expect(h.provider.verify).toHaveBeenCalledTimes(1);
  });

  it.each(['UNCERTAIN', 'FAIL'])('never upgrades a stored %s despite currently matching observations', async (verdict) => {
    const h = harness(); const i = await input(); await h.service.verifyStructure(i);
    h.row.verificationReport = { ...h.row.verificationReport, verdict, reasons: ['INCOMPLETE_EVIDENCE'], observations: matchingObservations() };
    expect(await h.service.verifyStructure(i)).toMatchObject({ kind: 'KNOWN', report: { verdict } });
    expect(h.provider.verify).toHaveBeenCalledTimes(1);
  });

  it('does not replay PASS when observed change evidence is null', async () => {
    const h = harness(); const i = await input(); await h.service.verifyStructure(i);
    const observations = matchingObservations(); observations.changeAllowances.layoutChanged = null;
    h.row.verificationReport = { ...h.row.verificationReport, verdict: 'PASS', reasons: ['NO_MATERIAL_CONFLICT'], observations };
    expect(await h.service.verifyStructure(i)).toMatchObject({ kind: 'KNOWN', report: { verdict: 'UNCERTAIN',
      reasons: expect.arrayContaining(['INCOMPLETE_EVIDENCE']) } });
    expect(h.provider.verify).toHaveBeenCalledTimes(1);
  });

  it('rejudges contradictory provider reports before they are persisted', async () => {
    const h = harness(); const original = h.provider.verify.getMockImplementation()!;
    h.provider.verify.mockImplementation(async (normalized) => {
      const result = await original(normalized); const observations = matchingObservations();
      observations.intrinsicMaterial = 'MISMATCH';
      return { ...result, report: { ...result.report, verdict: 'PASS', reasons: ['NO_MATERIAL_CONFLICT'], observations } };
    });
    expect(await h.service.verifyStructure(await input())).toMatchObject({ kind: 'KNOWN', report: { verdict: 'FAIL' } });
    expect(h.row.verificationReport).toMatchObject({ verdict: 'FAIL', reasons: expect.arrayContaining(['INTRINSIC_MATERIAL_CHANGED']) });
  });

  it.each(['tenantId', 'ownerClientId', 'adapterNamespace', 'externalObjectId', 'actorId', 'idempotencyKey'])('rejects replay across %s boundaries', async (key) => {
    const h = harness(); const i = await input(); await h.service.verifyStructure(i);
    await expect(h.service.verifyStructure({ ...i, [key]: 'other-scope' })).rejects.toThrow('业务范围');
    expect(h.provider.verify).toHaveBeenCalledTimes(1);
  });

  it('rejects changed image order and plan on an existing idempotency key', async () => {
    const h = harness(); const i = await input();
    i.candidate = { ...i.source, buffer: await sharp(i.source.buffer).negate().jpeg().toBuffer() };
    await h.service.verifyStructure(i);
    await expect(h.service.verifyStructure({ ...i, source: i.candidate, candidate: i.source })).rejects.toThrow('其他图片');
    await expect(h.service.verifyStructure({ ...i, plan: { ...i.plan, focus: 'GENERAL_PRODUCT' } })).rejects.toThrow('其他图片');
    expect(h.provider.verify).toHaveBeenCalledTimes(1);
  });

  it.each(['SUBMITTING', 'RECONCILING', 'VERIFYING', 'SUCCEEDED'])('never resubmits %s when a report cannot be recovered', async (status) => {
    const h = harness(); const i = await input(); await h.service.verifyStructure(i);
    Object.assign(h.row, { status, verificationReport: null });
    expect(await h.service.verifyStructure(i)).toMatchObject({ kind: 'UNKNOWN', requiresReconciliation: true });
    expect(h.provider.verify).toHaveBeenCalledTimes(1);
  });

  it.each(['token', 'generation', 'expiry', 'status'])('rejects a known result when lease %s changes during provider I/O', async (change) => {
    const h = harness(); const original = h.provider.verify.getMockImplementation()!;
    h.provider.verify.mockImplementation(async (normalized) => {
      if (change === 'token') h.row.leaseToken = 'new-owner';
      if (change === 'generation') h.row.leaseGeneration = 2;
      if (change === 'expiry') h.row.leaseExpiresAt = new Date(0);
      if (change === 'status') h.row.status = 'RECONCILING';
      return original(normalized);
    });
    expect(await h.service.verifyStructure(await input())).toMatchObject({ kind: 'UNKNOWN', requiresReconciliation: true });
    expect(h.row.verificationReport).toBeNull();
    expect(h.row.status).not.toBe('SUCCEEDED');
  });

  it('retains the submit fence when report and reconciliation persistence both fail and never bills again', async () => {
    const h = harness(); const i = await input();
    h.prisma.$transaction.mockRejectedValue(new Error('database lost'));
    h.invocations.recordSynchronousProviderOutcome.mockRejectedValue(new Error('database still lost'));
    expect(await h.service.verifyStructure(i)).toMatchObject({ kind: 'UNKNOWN', requiresReconciliation: true });
    expect(h.row.status).toBe('SUBMITTING');
    expect(await h.service.verifyStructure(i)).toMatchObject({ kind: 'UNKNOWN' });
    expect(h.provider.verify).toHaveBeenCalledTimes(1);
  });

  it('replays an actually committed result after its acknowledgement is lost', async () => {
    const h = harness(); const i = await input();
    h.prisma.$transaction.mockImplementationOnce(async (fn) => { await fn({ visualAgentInvocation: { updateMany: h.updateMany } }); throw new Error('lost acknowledgement'); });
    expect(await h.service.verifyStructure(i)).toMatchObject({ kind: 'UNKNOWN' });
    expect(await h.service.verifyStructure(i)).toMatchObject({ kind: 'KNOWN' });
    expect(h.provider.verify).toHaveBeenCalledTimes(1);
  });

  it('whitelists usage/report fields without inventing zero actual cost when usage is absent', async () => {
    const h = harness(); const original = h.provider.verify.getMockImplementation()!;
    h.provider.verify.mockImplementation(async (normalized) => ({ ...await original(normalized),
      usage: { inputTokens: -1, outputTokens: 1.5, totalTokens: Number.MAX_SAFE_INTEGER + 1, freeText: 'secret' } as any }));
    await h.service.verifyStructure(await input());
    expect(h.row.providerUsage).toEqual({});
    expect(h.row.actualCostCents).toBeNull();
  });

  it('records unknown and declined outcomes without writing a successful report', async () => {
    for (const outcome of [{ kind: 'UNKNOWN', code: 'TRANSPORT_FAILURE', requiresReconciliation: true }, { kind: 'DECLINED', code: 'RATE_LIMITED' }]) {
      const h = harness(); h.provider.verify.mockResolvedValue(outcome as any); const i = await input();
      expect(await h.service.verifyStructure(i)).toMatchObject(outcome);
      expect(h.invocations.recordSynchronousProviderOutcome).toHaveBeenCalledTimes(1);
      expect(h.row.verificationReport).toBeNull();
      await h.service.verifyStructure(i);
      expect(h.provider.verify).toHaveBeenCalledTimes(1);
    }
  });

  it('does not call the provider when budget reservation is denied', async () => {
    const h = harness(); h.invocations.reserve.mockRejectedValue(new Error('missing budget scope'));
    await expect(h.service.verifyStructure(await input())).rejects.toThrow('budget');
    expect(h.invocations.acquireForSubmit).not.toHaveBeenCalled(); expect(h.provider.verify).not.toHaveBeenCalled();
  });
});

// Only a new, task-owned localhost database is permitted. These three Core tables are
// deliberately isolated: this test does not claim full-schema migration acceptance.
const integrationUrl = process.env.VISUAL_STRUCTURE_RUNNER_TEST_DATABASE_URL;
if (integrationUrl && (!['localhost', '127.0.0.1'].includes(new URL(integrationUrl).hostname)
  || new URL(integrationUrl).pathname !== '/visual_structure_runner_test')) throw new Error('Structure tests require isolated localhost/visual_structure_runner_test');

(integrationUrl ? describe : describe.skip)('Structure runner on isolated PostgreSQL Core tables', () => {
  let prisma: PrismaClient;
  let invocations: VisualAgentInvocationService;
  let service: VisualAgentStructureRunnerService;
  let i: VerifyStructureInput;
  let provider: ReturnType<typeof harness>['provider'];
  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: integrationUrl });
    await prisma.$connect();
    const tables = await prisma.$queryRawUnsafe<any[]>('SELECT tablename FROM pg_tables WHERE schemaname=\'public\'');
    if (tables.length) throw new Error('Refusing to use a nonempty database');
    for (const migration of ['20260822050000_add_visual_agent_core_invocations', '20260823010000_add_visual_agent_provider_usage', '20260904000200_visual_structure_report']) {
      const sql = readFileSync(resolve(__dirname, '../../..', 'prisma/migrations', migration, 'migration.sql'), 'utf8');
      for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
    }
    invocations = new VisualAgentInvocationService(prisma as any);
  });
  beforeEach(async () => {
    await prisma.visualAgentBudgetReservation.deleteMany();
    await prisma.visualAgentInvocation.deleteMany();
    await prisma.visualAgentBudgetPolicy.deleteMany();
    i = await input(); provider = harness().provider;
    const original = provider.verify.getMockImplementation()!;
    provider.verify.mockImplementation(async (normalized: any, authorization?: any) => {
      await invocations.assertProviderAuthorization(authorization, BAILIAN_STRUCTURE_PROVIDER, BAILIAN_STRUCTURE_MODEL,
        { sourceHash: structureVerificationPairHash(normalized), visualPlanHash: structureVerificationPlanHash(normalized.plan), visualMode: STRUCTURE_VERIFICATION_MODE });
      return original(normalized);
    });
    service = new VisualAgentStructureRunnerService(prisma as any, invocations, provider as any);
    const part = (s: string) => `${s.length}:${s}`;
    const tenant = `tenant:${part(i.tenantId)}`;
    const client = `${tenant}:client:${part(i.ownerClientId)}`;
    const adapter = `${client}:adapter:${part(i.adapterNamespace)}`;
    const scopes: Record<VisualAgentBudgetScope, string> = {
      PLATFORM: 'GLOBAL', PROVIDER: `provider:${part(BAILIAN_STRUCTURE_PROVIDER)}`, TENANT: tenant, CLIENT: client,
      EXTERNAL_OBJECT: `${adapter}:object:${part(i.externalObjectId)}`, ACTOR: `${adapter}:actor:${part(i.actorId)}`,
    };
    await prisma.visualAgentBudgetPolicy.createMany({ data: Object.entries(scopes).map(([scope, scopeKey]) => ({
      scope: scope as VisualAgentBudgetScope, scopeKey, provider: BAILIAN_STRUCTURE_PROVIDER, model: BAILIAN_STRUCTURE_MODEL,
      visualMode: STRUCTURE_VERIFICATION_MODE, reserveCents: 1, perTaskCapCents: 1, dailyCapCents: 100,
      weeklyCapCents: 100, policyVersion: 'structure-test-v1', enabled: true, effectiveFrom: new Date(0),
    })) });
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  it('concurrent real reserves leave one invocation, exactly six cost reservations and a durable replayable report', async () => {
    const runs = await Promise.allSettled(Array.from({ length: 4 }, () => service.verifyStructure(i)));
    expect(runs.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(await service.verifyStructure(i)).toMatchObject({ kind: 'KNOWN' });
    expect(await prisma.visualAgentInvocation.count()).toBe(1);
    expect(await prisma.visualAgentBudgetReservation.count()).toBe(6);
    expect(provider.verify).toHaveBeenCalledTimes(1);
    expect(await prisma.visualAgentInvocation.findFirst()).toMatchObject({ status: 'SUCCEEDED', actualCostCents: null,
      providerOutputUrl: null, providerUsage: { inputTokens: 88, outputTokens: 22, totalTokens: 110 },
      verificationReport: { verdict: 'UNCERTAIN' } });
  });

  it.each(Object.values(VisualAgentBudgetScope))('requires the real %s scope reservation before provider execution', async (scope) => {
    await prisma.visualAgentBudgetPolicy.deleteMany({ where: { scope } });
    await expect(service.verifyStructure(i)).rejects.toThrow('预算策略');
    expect(provider.verify).not.toHaveBeenCalled();
    expect(await prisma.visualAgentInvocation.count()).toBe(0);
    expect(await prisma.visualAgentBudgetReservation.count()).toBe(0);
  });

  it('rolls back a failed report write, retains six reservations, and never submits again', async () => {
    await prisma.$executeRawUnsafe(`CREATE FUNCTION structure_test_reject_report() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."verificationReport" IS NOT NULL THEN RAISE EXCEPTION 'isolated report write failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER structure_test_reject_report BEFORE UPDATE ON "VisualAgentInvocation" FOR EACH ROW EXECUTE FUNCTION structure_test_reject_report()');
    try {
      expect(await service.verifyStructure(i)).toMatchObject({ kind: 'UNKNOWN', requiresReconciliation: true });
      expect(await prisma.visualAgentInvocation.findFirst()).toMatchObject({ status: 'RECONCILING', verificationReport: null, actualCostCents: null });
      expect(await prisma.visualAgentBudgetReservation.count()).toBe(6);
      expect(await service.verifyStructure(i)).toMatchObject({ kind: 'UNKNOWN' });
      expect(provider.verify).toHaveBeenCalledTimes(1);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER structure_test_reject_report ON "VisualAgentInvocation"');
      await prisma.$executeRawUnsafe('DROP FUNCTION structure_test_reject_report()');
    }
  });

  it('fences a stale worker when the persisted generation changes while its model is running', async () => {
    const original = provider.verify.getMockImplementation()!;
    provider.verify.mockImplementation(async (normalized: any, authorization?: any) => {
      const result = await original(normalized, authorization);
      await prisma.visualAgentInvocation.update({ where: { id: authorization.invocationId },
        data: { leaseGeneration: { increment: 1 }, leaseToken: 'new-worker', status: 'RECONCILING' } });
      return result;
    });
    expect(await service.verifyStructure(i)).toMatchObject({ kind: 'UNKNOWN' });
    expect(await prisma.visualAgentInvocation.findFirst()).toMatchObject({ status: 'RECONCILING', verificationReport: null,
      leaseToken: 'new-worker', leaseGeneration: 2 });
    expect(await service.verifyStructure(i)).toMatchObject({ kind: 'UNKNOWN' });
    expect(provider.verify).toHaveBeenCalledTimes(1);
  });
});
