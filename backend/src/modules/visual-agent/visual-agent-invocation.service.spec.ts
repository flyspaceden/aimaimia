import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { VisualAgentBudgetScope, VisualAgentInvocationStatus } from '@prisma/client';
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
      create: jest.fn().mockResolvedValue({ id: 'invocation-1', status: VisualAgentInvocationStatus.RESERVED, reservations: scopes.map((scope) => ({ scope })) }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    visualAgentBudgetPolicy: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    visualAgentBudgetReservation: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 0 } }) },
    ...overrides.tx,
  };
  return {
    $transaction: jest.fn(async (callback: any) => callback(tx)),
    visualAgentInvocation: { ...tx.visualAgentInvocation, ...(overrides.root?.visualAgentInvocation ?? {}) },
    ...Object.fromEntries(Object.entries(overrides.root ?? {}).filter(([key]) => key !== 'visualAgentInvocation')),
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
      provider: 'BAILIAN_WAN', status: VisualAgentInvocationStatus.SUBMITTING, model: 'wan2.7-image', policySnapshotVersion: 'snapshot-1',
      reservedCostCents: 20, leaseToken: 'lease-1', leaseGeneration: 1, leaseExpiresAt: new Date(Date.now() + 60_000),
      reservations: scopes.map((scope) => ({ scope, policy: { enabled: true, effectiveFrom: new Date(0), effectiveUntil: null } })),
    };
    const prisma = prismaMock({ tx: { visualAgentInvocation: {
      findUnique: jest.fn().mockResolvedValue(goodInvocation), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    } } });
    const service = new VisualAgentInvocationService(prisma as any);

    await expect(service.assertProviderAuthorization(authorization, 'BAILIAN_WAN', 'wan2.7-image')).resolves.toBeUndefined();
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
      data: expect.objectContaining({ status: VisualAgentInvocationStatus.VERIFYING }),
    }));
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
});
