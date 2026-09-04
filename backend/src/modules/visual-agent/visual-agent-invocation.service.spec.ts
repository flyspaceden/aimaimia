import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { VisualAgentBudgetScope, VisualAgentInvocationStatus, VisualCreditQuoteStatus } from '@prisma/client';
import { VisualAgentInvocationService } from './visual-agent-invocation.service';

const scopes = [
  VisualAgentBudgetScope.PLATFORM,
  VisualAgentBudgetScope.PROVIDER,
  VisualAgentBudgetScope.TENANT,
  VisualAgentBudgetScope.CLIENT,
  VisualAgentBudgetScope.EXTERNAL_OBJECT,
  VisualAgentBudgetScope.ACTOR,
];

const sourceHash = 'a'.repeat(64);
const planHash = 'b'.repeat(64);

function reserveInput() {
  return {
    tenantId: 'tenant-1', ownerClientId: 'client-1', adapterNamespace: 'aimai-product',
    externalObjectId: 'product-1', actorId: 'staff-1', provider: 'BAILIAN_WAN', model: 'wan2.7-image' as const,
    visualMode: 'PRESERVE_REAL_SCENE', sourceHash, visualPlanHash: planHash,
    idempotencyKey: 'create-1', expiresAt: new Date(Date.now() + 5 * 60_000),
  };
}

function policy(scope: VisualAgentBudgetScope, scopeKey: string) {
  return {
    id: `policy-${scope}`, scope, scopeKey, provider: 'BAILIAN_WAN', model: 'wan2.7-image', visualMode: 'PRESERVE_REAL_SCENE',
    reserveCents: 20, perTaskCapCents: 50, dailyCapCents: 500, weeklyCapCents: 2000, timezone: 'Asia/Shanghai',
    policyVersion: 'v1', enabled: true, effectiveFrom: new Date(0), effectiveUntil: null,
  };
}

function prismaMock(overrides: Record<string, any> = {}) {
  const tx = {
    $executeRaw: jest.fn(),
    visualAgentInvocation: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'invocation-1', status: VisualAgentInvocationStatus.RESERVED, reservations: scopes.map((scope) => ({ scope })) }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    visualAgentBudgetPolicy: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), upsert: jest.fn() },
    visualAgentBudgetReservation: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 0 } }) },
    visualCreditAccount: { update: jest.fn() },
    visualCreditQuote: { update: jest.fn() },
    visualCreditLedger: { create: jest.fn() },
    ...overrides.tx,
  };
  return {
    $transaction: jest.fn(async (callback: any) => callback(tx)),
    visualAgentInvocation: { ...tx.visualAgentInvocation, findMany: jest.fn(), ...(overrides.root?.visualAgentInvocation ?? {}) },
    visualAgentBudgetPolicy: { findMany: jest.fn(), ...(overrides.root?.visualAgentBudgetPolicy ?? {}) },
    visualAgentBudgetReservation: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 0 } }), ...(overrides.root?.visualAgentBudgetReservation ?? {}) },
    ...Object.fromEntries(Object.entries(overrides.root ?? {}).filter(([key]) => !['visualAgentInvocation', 'visualAgentBudgetPolicy'].includes(key))),
    tx,
  };
}

describe('VisualAgentInvocationService', () => {
  it('uses one canonical Provider scope key for reservations and every circuit-breaker lock', () => {
    const service = new VisualAgentInvocationService(prismaMock() as any);
    const input = reserveInput();
    const scopeKeys = (service as any).scopeKeys(input);

    expect(scopeKeys[VisualAgentBudgetScope.PROVIDER]).toBe('provider:11:BAILIAN_WAN');
    expect((service as any).providerBudgetLockKey(input.provider)).toBe(
      `VISUAL_AGENT_BUDGET:PROVIDER:${scopeKeys[VisualAgentBudgetScope.PROVIDER]}`,
    );
  });

  it('reports rate-card readiness only when all six exact active budget scopes exist', async () => {
    const input = reserveInput();
    const prisma = prismaMock();
    prisma.visualAgentBudgetPolicy.findMany.mockResolvedValue([
      policy(VisualAgentBudgetScope.PLATFORM, 'GLOBAL'),
      policy(VisualAgentBudgetScope.PROVIDER, 'provider:11:BAILIAN_WAN'),
      policy(VisualAgentBudgetScope.TENANT, 'tenant:8:tenant-1'),
      policy(VisualAgentBudgetScope.CLIENT, 'tenant:8:tenant-1:client:8:client-1'),
      policy(VisualAgentBudgetScope.EXTERNAL_OBJECT, 'tenant:8:tenant-1:client:8:client-1:adapter:13:aimai-product:object:9:product-1'),
      policy(VisualAgentBudgetScope.ACTOR, 'tenant:8:tenant-1:client:8:client-1:adapter:13:aimai-product:actor:7:staff-1'),
    ]);
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.hasActiveBudgetCoverage(input)).resolves.toBe(true);
    await expect(service.hasActiveBudgetCoverage({
      ...input,
      expectedPolicyVersions: { [VisualAgentBudgetScope.ACTOR]: 'different-rate' },
    })).resolves.toBe(false);
    prisma.visualAgentBudgetPolicy.findMany.mockResolvedValueOnce([]);
    await expect(service.hasActiveBudgetCoverage(input)).resolves.toBe(false);
  });

  it('does not advertise a rate card when exact budgets disagree or are exhausted', async () => {
    const input = reserveInput();
    const prisma = prismaMock();
    const exact = [
      policy(VisualAgentBudgetScope.PLATFORM, 'GLOBAL'),
      policy(VisualAgentBudgetScope.PROVIDER, 'provider:11:BAILIAN_WAN'),
      policy(VisualAgentBudgetScope.TENANT, 'tenant:8:tenant-1'),
      policy(VisualAgentBudgetScope.CLIENT, 'tenant:8:tenant-1:client:8:client-1'),
      policy(VisualAgentBudgetScope.EXTERNAL_OBJECT, 'tenant:8:tenant-1:client:8:client-1:adapter:13:aimai-product:object:9:product-1'),
      policy(VisualAgentBudgetScope.ACTOR, 'tenant:8:tenant-1:client:8:client-1:adapter:13:aimai-product:actor:7:staff-1'),
    ];
    prisma.visualAgentBudgetPolicy.findMany.mockResolvedValue([{ ...exact[0], reserveCents: 10 }, ...exact.slice(1)]);
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.hasActiveBudgetCoverage(input)).resolves.toBe(false);
    prisma.visualAgentBudgetPolicy.findMany.mockResolvedValue(exact);
    prisma.visualAgentBudgetReservation.aggregate.mockResolvedValue({ _sum: { amountCents: 500 } });
    await expect(service.hasActiveBudgetCoverage(input)).resolves.toBe(false);
  });

  it('requires one positive, current policy at every budget scope before creating a durable reservation', async () => {
    const input = reserveInput();
    const prisma = prismaMock();
    prisma.tx.visualAgentBudgetPolicy.findMany.mockResolvedValue([
      policy(VisualAgentBudgetScope.PLATFORM, 'GLOBAL'),
      policy(VisualAgentBudgetScope.PROVIDER, 'provider:11:BAILIAN_WAN'),
      policy(VisualAgentBudgetScope.TENANT, 'tenant:8:tenant-1'),
      policy(VisualAgentBudgetScope.CLIENT, 'tenant:8:tenant-1:client:8:client-1'),
      policy(VisualAgentBudgetScope.EXTERNAL_OBJECT, 'tenant:8:tenant-1:client:8:client-1:adapter:13:aimai-product:object:9:product-1'),
      policy(VisualAgentBudgetScope.ACTOR, 'tenant:8:tenant-1:client:8:client-1:adapter:13:aimai-product:actor:7:staff-1'),
    ]);
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.reserve(input)).resolves.toEqual({ invocationId: 'invocation-1', status: 'RESERVED' });
    expect(prisma.tx.$executeRaw).toHaveBeenCalledTimes(6);
    expect(prisma.tx.visualAgentInvocation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reservedCostCents: 20, providerIdempotencyKey: expect.stringMatching(/^vai_/) }),
    }));
  });

  it('fails closed when any scope policy is missing rather than interpreting it as unlimited', async () => {
    const prisma = prismaMock();
    prisma.tx.visualAgentBudgetPolicy.findMany.mockResolvedValue([]);
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.reserve(reserveInput())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.tx.visualAgentInvocation.create).not.toHaveBeenCalled();
  });

  it('returns a Provider output reference only from a persisted VERIFYING invocation', async () => {
    const prisma = prismaMock({ root: { visualAgentInvocation: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'invocation-1', providerOutputUrl: 'https://wanx-v1.oss-cn-beijing.aliyuncs.com/result.jpg',
        providerTaskId: 'wan-task-1', sourceHash, visualPlanHash: planHash,
      }),
    } } });
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.getOutputForVerification('invocation-1')).resolves.toMatchObject({ id: 'invocation-1', providerTaskId: 'wan-task-1' });
    expect(prisma.visualAgentInvocation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: VisualAgentInvocationStatus.VERIFYING }),
      select: expect.objectContaining({ provider: true }),
    }));
  });

  it('derives the reserve from policy rather than a caller-supplied low amount, and rejects disagreeing scopes', async () => {
    const prisma = prismaMock();
    const policies = [
      policy(VisualAgentBudgetScope.PLATFORM, 'GLOBAL'),
      policy(VisualAgentBudgetScope.PROVIDER, 'provider:11:BAILIAN_WAN'),
      policy(VisualAgentBudgetScope.TENANT, 'tenant:8:tenant-1'),
      policy(VisualAgentBudgetScope.CLIENT, 'tenant:8:tenant-1:client:8:client-1'),
      policy(VisualAgentBudgetScope.EXTERNAL_OBJECT, 'tenant:8:tenant-1:client:8:client-1:adapter:13:aimai-product:object:9:product-1'),
      { ...policy(VisualAgentBudgetScope.ACTOR, 'tenant:8:tenant-1:client:8:client-1:adapter:13:aimai-product:actor:7:staff-1'), reserveCents: 1 },
    ];
    prisma.tx.visualAgentBudgetPolicy.findMany.mockResolvedValue(policies);
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.reserve(reserveInput())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.tx.visualAgentInvocation.create).not.toHaveBeenCalled();
  });

  it('returns the original reconciliation record for a repeated idempotency key and never creates a fresh call', async () => {
    const prisma = prismaMock({ tx: {
      visualAgentInvocation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invocation-1', status: VisualAgentInvocationStatus.RECONCILING, reservations: scopes.map((scope) => ({ scope })),
          tenantId: 'tenant-1', ownerClientId: 'client-1', adapterNamespace: 'aimai-product', externalObjectId: 'product-1', actorId: 'staff-1',
          provider: 'BAILIAN_WAN', model: 'wan2.7-image', visualMode: 'PRESERVE_REAL_SCENE', sourceHash, visualPlanHash: planHash,
        }),
        create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
      },
    } });
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.reserve(reserveInput())).resolves.toEqual({ invocationId: 'invocation-1', status: 'RECONCILING' });
    expect(prisma.tx.visualAgentInvocation.create).not.toHaveBeenCalled();
  });

  it('verifies that an authorization is bound to one persisted SUBMITTING lease and all six reservations', async () => {
    const authorization = {
      invocationId: 'invocation-1', provider: 'BAILIAN_WAN', policySnapshotVersion: 'snapshot-1', reservedCostCents: 20,
      adapterExecutionApproved: true as const, leaseToken: 'lease-1', leaseGeneration: 1, expiresAt: new Date(Date.now() + 60_000),
    };
    const goodInvocation = {
      sourceHash, visualPlanHash: planHash, visualMode: 'PRESERVE_REAL_SCENE',
      provider: 'BAILIAN_WAN', status: VisualAgentInvocationStatus.SUBMITTING, model: 'wan2.7-image', policySnapshotVersion: 'snapshot-1',
      reservedCostCents: 20, leaseToken: 'lease-1', leaseGeneration: 1, leaseExpiresAt: new Date(Date.now() + 60_000),
      reservations: scopes.map((scope) => ({ scope, policy: { enabled: true, effectiveFrom: new Date(0), effectiveUntil: null } })),
    };
    const prisma = prismaMock({ tx: { visualAgentInvocation: {
      findUnique: jest.fn().mockResolvedValue(goodInvocation), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    } } });
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.assertProviderAuthorization(authorization, 'BAILIAN_WAN', 'wan2.7-image')).resolves.toBeUndefined();
    await expect(service.assertProviderAuthorization(authorization, 'BAILIAN_WAN', 'wan2.7-image', {
      sourceHash, visualPlanHash: planHash, visualMode: 'PRESERVE_REAL_SCENE',
    })).resolves.toBeUndefined();
    for (const mismatch of [{ sourceHash: 'c'.repeat(64) }, { visualPlanHash: 'c'.repeat(64) }, { visualMode: 'STRUCTURE_VERIFY' }]) {
      await expect(service.assertProviderAuthorization(authorization, 'BAILIAN_WAN', 'wan2.7-image', {
        sourceHash, visualPlanHash: planHash, visualMode: 'PRESERVE_REAL_SCENE', ...mismatch,
      })).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
    await expect(service.assertProviderAuthorization(authorization, 'BAILIAN_QWEN_OCR', 'wan2.7-image')).rejects.toBeInstanceOf(ServiceUnavailableException);
    prisma.tx.visualAgentInvocation.findUnique.mockResolvedValue({ ...goodInvocation, reservations: goodInvocation.reservations.slice(1) });
    await expect(service.assertProviderAuthorization(authorization, 'BAILIAN_WAN', 'wan2.7-image')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('moves a transport-unknown submission to durable reconciliation and blocks a second acquire', async () => {
    const prisma = prismaMock({ root: { visualAgentInvocation: { findUnique: jest.fn().mockResolvedValue({
      id: 'invocation-1', providerTaskId: null, status: VisualAgentInvocationStatus.RECONCILING,
    }) } } });
    const service = new VisualAgentInvocationService(prisma as any);
    const authorization = {
      invocationId: 'invocation-1', provider: 'BAILIAN_WAN', policySnapshotVersion: 'snapshot-1', reservedCostCents: 20,
      adapterExecutionApproved: true as const, leaseToken: 'lease-1', leaseGeneration: 1, expiresAt: new Date(Date.now() + 60_000),
    };

    await service.recordSubmitOutcome(authorization, { kind: 'UNKNOWN', code: 'TRANSPORT_TIMEOUT', requiresReconciliation: true });
    expect(prisma.visualAgentInvocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: VisualAgentInvocationStatus.RECONCILING }),
    }));
    await expect(service.acquireForSubmit('invocation-1', 'wan2.7-image', 'BAILIAN_WAN', sourceHash, planHash, 'PRESERVE_REAL_SCENE')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a submit whose recomputed source or plan hash differs from the reserved invocation', async () => {
    const invocation = {
      id: 'invocation-1', provider: 'BAILIAN_WAN', model: 'wan2.7-image', sourceHash, visualPlanHash: planHash,
      visualMode: 'PRESERVE_REAL_SCENE', status: VisualAgentInvocationStatus.RESERVED, expiresAt: new Date(Date.now() + 60_000),
      reservations: scopes.map((scope) => ({ scope })),
    };
    const prisma = prismaMock({ tx: { visualAgentInvocation: {
      findUnique: jest.fn().mockResolvedValue(invocation), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    } } });
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.acquireForSubmit('invocation-1', 'wan2.7-image', 'BAILIAN_WAN', 'c'.repeat(64), planHash, 'PRESERVE_REAL_SCENE')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.acquireForSubmit('invocation-1', 'wan2.7-image', 'BAILIAN_QWEN_OCR', sourceHash, planHash, 'PRESERVE_REAL_SCENE')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.acquireForSubmit('invocation-1', 'wan2.7-image', 'BAILIAN_WAN', sourceHash, planHash, 'MARKETING_SCENE')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.tx.visualAgentInvocation.update).not.toHaveBeenCalled();
  });

  it('releases an old RESERVED invocation when its policy was circuit-disabled before any provider I/O', async () => {
    const invocation = {
      id: 'invocation-1', provider: 'BAILIAN_WAN', model: 'wan2.7-image', sourceHash, visualPlanHash: planHash,
      visualMode: 'PRESERVE_REAL_SCENE', status: VisualAgentInvocationStatus.RESERVED, expiresAt: new Date(Date.now() + 60_000),
      reservations: scopes.map((scope) => ({
        scope,
        policy: { enabled: scope !== VisualAgentBudgetScope.PROVIDER, effectiveFrom: new Date(0), effectiveUntil: null },
      })),
    };
    const prisma = prismaMock({ tx: { visualAgentInvocation: {
      findUnique: jest.fn().mockResolvedValue(invocation), create: jest.fn(), update: jest.fn().mockResolvedValue(invocation), updateMany: jest.fn(),
    } } });
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.acquireForSubmit('invocation-1', 'wan2.7-image', 'BAILIAN_WAN', sourceHash, planHash, 'PRESERVE_REAL_SCENE')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.tx.visualAgentInvocation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: VisualAgentInvocationStatus.RELEASED }),
    }));
  });

  it('uses a query generation lease so an older poll cannot overwrite a later result', async () => {
    const invocation = {
      id: 'invocation-1', providerTaskId: 'provider-task-1', status: VisualAgentInvocationStatus.QUEUED,
      policySnapshotVersion: 'snapshot-1', reservedCostCents: 20, leaseGeneration: 1,
      reservations: scopes.map((scope) => ({ scope })),
    };
    const claimed = { ...invocation, leaseToken: 'query-lease-2', leaseGeneration: 2, leaseExpiresAt: new Date(Date.now() + 60_000) };
    const prisma = prismaMock({ tx: { visualAgentInvocation: {
      findUnique: jest.fn().mockResolvedValue(invocation), create: jest.fn(),
      update: jest.fn().mockResolvedValue(claimed), updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    } } });
    const service = new VisualAgentInvocationService(prisma as any);

    const authorization = await service.acquireForQuery('invocation-1');
    await service.recordQueryOutcome(authorization, { kind: 'KNOWN', providerTaskId: 'provider-task-1', state: 'SUCCEEDED' });
    expect(prisma.visualAgentInvocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ leaseToken: 'query-lease-2', leaseGeneration: 2 }),
      data: expect.objectContaining({ status: VisualAgentInvocationStatus.VERIFYING, expiresAt: expect.any(Date) }),
    }));
    const verificationExpiry = prisma.visualAgentInvocation.updateMany.mock.calls[0][0].data.expiresAt as Date;
    expect(verificationExpiry.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });

  it('idempotently completes verification from a recoverable invocation without another Provider submission', async () => {
    const prisma = prismaMock({ root: { visualAgentInvocation: {
      updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({ provider: 'BAILIAN_WAN', status: VisualAgentInvocationStatus.SUCCEEDED, providerOutputUrl: 'https://example.com/output.png' }),
    } } });
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.completeSynchronousVerification('invocation-1', 'BAILIAN_WAN')).resolves.toBeUndefined();
    expect(prisma.visualAgentInvocation.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        status: { in: [VisualAgentInvocationStatus.VERIFYING, VisualAgentInvocationStatus.RECONCILING] },
        providerOutputUrl: { not: null },
      }),
      data: { status: VisualAgentInvocationStatus.SUCCEEDED },
    }));
    await expect(service.completeSynchronousVerification('invocation-1', 'BAILIAN_WAN')).resolves.toBeUndefined();
  });

  it('reaps only unsubmitted expiry; expired submit and query leases remain reconcilable', async () => {
    const prisma = prismaMock({ root: { visualAgentInvocation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } } });
    const service = new VisualAgentInvocationService(prisma as any);

    await service.reapExpiredLeases();
    const calls = prisma.visualAgentInvocation.updateMany.mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls[0][0].data.status).toBe(VisualAgentInvocationStatus.RELEASED);
    expect(calls[1][0].data.status).toBe(VisualAgentInvocationStatus.RECONCILING);
    expect(calls[2][0].data.status).toBe(VisualAgentInvocationStatus.RECONCILING);
    expect(calls[3][0].data.status).toBe(VisualAgentInvocationStatus.RECONCILING);
  });

  it('keeps an acknowledged Provider FAILED state in reconciliation until billing evidence is available', async () => {
    const prisma = prismaMock({ root: { visualAgentInvocation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } } });
    const service = new VisualAgentInvocationService(prisma as any);
    const authorization = {
      invocationId: 'invocation-1', provider: 'BAILIAN_WAN', policySnapshotVersion: 'snapshot-1', reservedCostCents: 20,
      adapterExecutionApproved: true as const, leaseToken: 'query-lease-1', leaseGeneration: 3,
      providerTaskId: 'provider-task-1', expiresAt: new Date(Date.now() + 60_000),
    };

    await service.recordQueryOutcome(authorization, { kind: 'KNOWN', providerTaskId: 'provider-task-1', state: 'FAILED' });
    expect(prisma.visualAgentInvocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: VisualAgentInvocationStatus.RECONCILING }),
    }));
  });

  it('opens the provider circuit when the billed amount exceeds the six-scope reservation', async () => {
    const prisma = prismaMock({ tx: { visualAgentInvocation: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'invocation-1', provider: 'BAILIAN_WAN', model: 'wan2.7-image', reservedCostCents: 20,
        status: VisualAgentInvocationStatus.VERIFYING,
      }),
      create: jest.fn(), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn(),
    } } });
    const service = new VisualAgentInvocationService(prisma as any);

    await service.recordActualCost('invocation-1', 21);
    expect(prisma.tx.visualAgentInvocation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: VisualAgentInvocationStatus.BILLING_EXCEPTION, actualCostCents: 21 }),
    }));
    expect(prisma.tx.visualAgentBudgetPolicy.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ provider: 'BAILIAN_WAN', model: 'wan2.7-image', enabled: true }),
      data: { enabled: false },
    }));
  });

  it('activates only one budget-policy version for an exact scope and model route', async () => {
    const prisma = prismaMock();
    prisma.tx.visualAgentBudgetPolicy.upsert.mockResolvedValue({ id: 'policy-v2' });
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.upsertBudgetPolicy({
      scope: VisualAgentBudgetScope.PLATFORM,
      scopeKey: 'GLOBAL',
      provider: 'BAILIAN_WAN',
      model: 'wan2.7-image',
      visualMode: 'PRESERVE_REAL_SCENE',
      reserveCents: 20,
      perTaskCapCents: 50,
      dailyCapCents: 500,
      weeklyCapCents: 2000,
      policyVersion: 'v2',
      enabled: true,
      effectiveFrom: new Date(0),
    })).resolves.toEqual({ id: 'policy-v2' });

    expect(prisma.tx.visualAgentBudgetPolicy.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ scope: VisualAgentBudgetScope.PLATFORM, scopeKey: 'GLOBAL', policyVersion: { not: 'v2' } }),
      data: { enabled: false },
    }));
    expect(prisma.tx.visualAgentBudgetPolicy.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ timezone: 'Asia/Shanghai', reserveCents: 20 }),
    }));
  });

  it('rejects a budget policy whose route or caps cannot authorize a real task', async () => {
    const prisma = prismaMock();
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.upsertBudgetPolicy({
      scope: VisualAgentBudgetScope.PLATFORM,
      scopeKey: 'GLOBAL',
      provider: 'BAILIAN_WAN',
      model: 'unsupported-model',
      visualMode: 'PRESERVE_REAL_SCENE',
      reserveCents: 20,
      perTaskCapCents: 10,
      dailyCapCents: 100,
      weeklyCapCents: 50,
      policyVersion: 'v1',
      enabled: true,
      effectiveFrom: new Date(0),
    })).rejects.toThrow('预算策略不合法');
    expect(prisma.tx.visualAgentBudgetPolicy.upsert).not.toHaveBeenCalled();
  });

  it('releases a linked merchant quote and frozen credits in the same manual reconciliation transaction', async () => {
    const prisma = prismaMock();
    prisma.tx.visualAgentInvocation.findFirst
      .mockResolvedValueOnce({ provider: 'BAILIAN_WAN' })
      .mockResolvedValueOnce({
        id: 'invocation-1', provider: 'BAILIAN_WAN', model: 'wan2.7-image',
        creditQuote: {
          id: 'quote-1', tenantId: 'tenant-1', status: VisualCreditQuoteStatus.RECONCILING, creditCost: 15, quoteHash: 'c'.repeat(64),
          billingAccount: { id: 'account-1', billingOwnerType: 'COMPANY', billingOwnerId: 'company-1', availableCredits: 185, reservedCredits: 15 },
        },
      });
    const service = new VisualAgentInvocationService(prisma as any);

    await service.resolveReconciliation({
      invocationId: 'invocation-1', decision: 'RELEASED', creditDecision: 'RELEASE', operatorId: 'admin-1', evidenceRef: 'provider:no-charge-1',
    });

    expect(prisma.tx.visualCreditAccount.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ availableCredits: 200, reservedCredits: 0 }) }));
    expect(prisma.tx.visualCreditQuote.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: VisualCreditQuoteStatus.RELEASED }) }));
    expect(prisma.tx.visualCreditLedger.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'RELEASE', availableDelta: 15, reservedDelta: -15 }) }));
  });

  it('requires an explicit merchant-credit decision and opens the provider circuit for billing exceptions', async () => {
    const prisma = prismaMock();
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.resolveReconciliation({
      invocationId: 'invocation-1', decision: 'RELEASED', creditDecision: 'SETTLE', operatorId: 'admin-1', evidenceRef: 'provider:no-charge-1',
    })).rejects.toThrow('必须释放商家冻结图片积分');

    prisma.tx.visualAgentInvocation.findFirst
      .mockResolvedValueOnce({ provider: 'BAILIAN_WAN' })
      .mockResolvedValueOnce({ id: 'invocation-1', provider: 'BAILIAN_WAN', model: 'wan2.7-image', creditQuote: null });
    await service.resolveReconciliation({
      invocationId: 'invocation-1', decision: 'BILLING_EXCEPTION', creditDecision: 'SETTLE', operatorId: 'admin-1', evidenceRef: 'provider:bill-1',
    });
    expect(prisma.tx.visualAgentBudgetPolicy.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { enabled: false } }));
  });
});
