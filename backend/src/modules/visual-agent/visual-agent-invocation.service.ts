import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, VisualAgentBudgetScope, VisualAgentInvocationStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  VisualProviderAuthorization,
  VisualProviderQueryResult,
  VisualProviderSubmitResult,
} from './providers/visual-image-edit.provider';

const REQUIRED_SCOPES = [
  VisualAgentBudgetScope.PLATFORM,
  VisualAgentBudgetScope.PROVIDER,
  VisualAgentBudgetScope.TENANT,
  VisualAgentBudgetScope.CLIENT,
  VisualAgentBudgetScope.EXTERNAL_OBJECT,
  VisualAgentBudgetScope.ACTOR,
] as const;

const COMMITTED_STATUSES: VisualAgentInvocationStatus[] = [
  VisualAgentInvocationStatus.RESERVED,
  VisualAgentInvocationStatus.SUBMITTING,
  VisualAgentInvocationStatus.QUEUED,
  VisualAgentInvocationStatus.RUNNING,
  VisualAgentInvocationStatus.RECONCILING,
  VisualAgentInvocationStatus.VERIFYING,
  VisualAgentInvocationStatus.SUCCEEDED,
  VisualAgentInvocationStatus.FAILED,
  VisualAgentInvocationStatus.REJECTED,
  VisualAgentInvocationStatus.BILLING_EXCEPTION,
  VisualAgentInvocationStatus.CANCELLED,
];

const QUERYABLE_STATUSES: VisualAgentInvocationStatus[] = [
  VisualAgentInvocationStatus.QUEUED,
  VisualAgentInvocationStatus.RUNNING,
  VisualAgentInvocationStatus.RECONCILING,
];

const COST_SETTLEABLE_STATUSES: VisualAgentInvocationStatus[] = [
  VisualAgentInvocationStatus.VERIFYING,
  VisualAgentInvocationStatus.SUCCEEDED,
  VisualAgentInvocationStatus.RECONCILING,
];

export type ReserveVisualAgentInvocationInput = {
  tenantId: string;
  ownerClientId: string;
  adapterNamespace: string;
  externalObjectId: string;
  actorId: string;
  provider: string;
  model: string;
  visualMode: string;
  sourceHash: string;
  visualPlanHash: string;
  idempotencyKey: string;
  expiresAt: Date;
};

type InvocationForAuthorization = {
  id: string;
  provider: string;
  policySnapshotVersion: string;
  reservedCostCents: number;
  leaseToken: string | null;
  leaseGeneration: number;
  leaseExpiresAt: Date | null;
  status: VisualAgentInvocationStatus;
  model: string;
  reservations: Array<{ scope: VisualAgentBudgetScope }>;
};

export type VisualAgentReservedInvocation = {
  invocationId: string;
  status: VisualAgentInvocationStatus;
};

export type VisualSynchronousProviderOutcome =
  | { kind: 'KNOWN'; providerRequestId?: string; usage?: Record<string, number | undefined> }
  | { kind: 'DECLINED'; code: string; providerRequestId?: string }
  | { kind: 'UNKNOWN'; code: string; providerRequestId?: string; requiresReconciliation: true };

/**
 * Durable billing and reconciliation fence for the domain-neutral Core.
 * There is no direct provider-execution controller: only a trusted
 * Adapter/Core orchestrator can create an invocation, and a missing policy
 * rejects before Provider I/O.
 */
@Injectable()
export class VisualAgentInvocationService {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(input: ReserveVisualAgentInvocationInput): Promise<VisualAgentReservedInvocation> {
    this.assertReserveInput(input);
    const now = new Date();
    const scopeKeys = this.scopeKeys(input);
    try {
      return await this.prisma.$transaction(async (tx) => {
        for (const scope of REQUIRED_SCOPES) {
          await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`VISUAL_AGENT_BUDGET:${scope}:${scopeKeys[scope]}`}))`);
        }
        const existing = await tx.visualAgentInvocation.findUnique({
          where: {
            tenantId_ownerClientId_adapterNamespace_idempotencyKey: {
              tenantId: input.tenantId,
              ownerClientId: input.ownerClientId,
              adapterNamespace: input.adapterNamespace,
              idempotencyKey: input.idempotencyKey,
            },
          },
          include: { reservations: { select: { scope: true } } },
        });
        if (existing) {
          this.assertIdempotentInputMatches(existing, input);
          return { invocationId: existing.id, status: existing.status };
        }

        const policies = await tx.visualAgentBudgetPolicy.findMany({
          where: {
            enabled: true,
            provider: input.provider,
            model: input.model,
            visualMode: input.visualMode,
            effectiveFrom: { lte: now },
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
            scope: { in: [...REQUIRED_SCOPES] },
          },
        });
        const selected = REQUIRED_SCOPES.map((scope) => {
          const matches = policies.filter((policy) => policy.scope === scope && policy.scopeKey === scopeKeys[scope]);
          if (matches.length !== 1) {
            throw new ServiceUnavailableException(`AI Visual Agent 缺少或存在冲突的 ${scope} 预算策略`);
          }
          const policy = matches[0];
          if (policy.timezone !== 'Asia/Shanghai' || !this.hasPositiveCaps(policy)) {
            throw new ServiceUnavailableException(`AI Visual Agent ${scope} 预算策略未授权本次调用`);
          }
          return policy;
        });

        const reserveCents = this.requiredConsistentReserveCents(selected);
        const { dayStart, weekStart } = this.shanghaiBudgetWindow(now);
        for (const policy of selected) {
          const [daily, weekly] = await Promise.all([
            tx.visualAgentBudgetReservation.aggregate({
              where: { policyId: policy.id, createdAt: { gte: dayStart }, invocation: { status: { in: COMMITTED_STATUSES } } },
              _sum: { amountCents: true },
            }),
            tx.visualAgentBudgetReservation.aggregate({
              where: { policyId: policy.id, createdAt: { gte: weekStart }, invocation: { status: { in: COMMITTED_STATUSES } } },
              _sum: { amountCents: true },
            }),
          ]);
          if ((daily._sum.amountCents ?? 0) + reserveCents > policy.dailyCapCents
            || (weekly._sum.amountCents ?? 0) + reserveCents > policy.weeklyCapCents) {
            throw new ConflictException('AI Visual Agent 预算额度已用尽');
          }
        }

        const policySnapshotVersion = createHash('sha256').update(selected
          .map((policy) => `${policy.scope}:${policy.scopeKey}:${policy.policyVersion}:${policy.id}`)
          .sort().join('|')).digest('hex');
        const created = await tx.visualAgentInvocation.create({
          data: {
            tenantId: input.tenantId,
            ownerClientId: input.ownerClientId,
            adapterNamespace: input.adapterNamespace,
            externalObjectId: input.externalObjectId,
            actorId: input.actorId,
            provider: input.provider,
            model: input.model,
            visualMode: input.visualMode,
            sourceHash: input.sourceHash,
            visualPlanHash: input.visualPlanHash,
            idempotencyKey: input.idempotencyKey,
            providerIdempotencyKey: `vai_${randomUUID()}`,
            reservedCostCents: reserveCents,
            policySnapshotVersion,
            expiresAt: input.expiresAt,
            reservations: {
              create: selected.map((policy) => ({
                policyId: policy.id,
                scope: policy.scope,
                scopeKey: policy.scopeKey,
                amountCents: reserveCents,
              })),
            },
          },
          include: { reservations: { select: { scope: true } } },
        });
        return { invocationId: created.id, status: created.status };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.visualAgentInvocation.findUnique({
          where: {
            tenantId_ownerClientId_adapterNamespace_idempotencyKey: {
              tenantId: input.tenantId, ownerClientId: input.ownerClientId,
              adapterNamespace: input.adapterNamespace, idempotencyKey: input.idempotencyKey,
            },
          },
          include: { reservations: { select: { scope: true } } },
        });
        if (existing) {
          this.assertIdempotentInputMatches(existing, input);
          return { invocationId: existing.id, status: existing.status };
        }
      }
      throw error;
    }
  }

  async acquireForSubmit(
    invocationId: string,
    model: string,
    provider: string,
    sourceHash: string,
    visualPlanHash: string,
    visualMode: string,
  ): Promise<VisualProviderAuthorization> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`VISUAL_AGENT_INVOCATION:${invocationId}`}))`);
      const providerRef = await tx.visualAgentInvocation.findUnique({
        where: { id: invocationId },
        select: { provider: true },
      });
      if (!providerRef) throw new ConflictException('AI Visual Agent 调用不能重新提交或不存在');
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${this.providerBudgetLockKey(providerRef.provider)}))`);
      // Read policy state only after the provider circuit lock is held.
      const invocation = await tx.visualAgentInvocation.findUnique({
        where: { id: invocationId },
        include: { reservations: { include: { policy: { select: { enabled: true, effectiveFrom: true, effectiveUntil: true } } } } },
      });
      if (!invocation || invocation.provider !== provider || invocation.model !== model || invocation.sourceHash !== sourceHash
        || invocation.visualPlanHash !== visualPlanHash || invocation.visualMode !== visualMode
        || invocation.status !== VisualAgentInvocationStatus.RESERVED) {
        throw new ConflictException('AI Visual Agent 调用不能重新提交或不存在');
      }
      if (invocation.expiresAt.getTime() <= Date.now()) {
        await tx.visualAgentInvocation.update({ where: { id: invocation.id }, data: { status: VisualAgentInvocationStatus.RELEASED, reconciliationReason: 'EXPIRED_BEFORE_SUBMIT' } });
        throw new ConflictException('AI Visual Agent 调用授权已过期');
      }
      const now = new Date();
      if (invocation.reservations.length !== REQUIRED_SCOPES.length || invocation.reservations.some(({ policy }) => {
        const policyExpired = policy.effectiveUntil ? policy.effectiveUntil.getTime() <= now.getTime() : false;
        return !policy.enabled || policy.effectiveFrom.getTime() > now.getTime() || policyExpired;
      })) {
        await tx.visualAgentInvocation.update({
          where: { id: invocation.id },
          data: { status: VisualAgentInvocationStatus.RELEASED, reconciliationReason: 'POLICY_DISABLED_BEFORE_SUBMIT' },
        });
        throw new ServiceUnavailableException('AI Visual Agent 预算策略已禁用或失效');
      }
      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(Date.now() + 2 * 60_000);
      const claimed = await tx.visualAgentInvocation.update({
        where: { id: invocation.id },
        data: {
          status: VisualAgentInvocationStatus.SUBMITTING,
          leaseToken,
          leaseExpiresAt,
          leaseGeneration: { increment: 1 },
          attemptCount: { increment: 1 },
        },
        include: { reservations: { select: { scope: true } } },
      });
      return this.toAuthorization(claimed);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** Safe only before Provider submission; used to unwind a failed Quote bind. */
  async releaseBeforeSubmit(invocationId: string, reason: string) {
    const released = await this.prisma.visualAgentInvocation.updateMany({
      where: { id: invocationId, status: VisualAgentInvocationStatus.RESERVED },
      data: { status: VisualAgentInvocationStatus.RELEASED, reconciliationReason: reason.slice(0, 160) },
    });
    if (released.count !== 1) {
      throw new ConflictException('AI Visual Agent 调用已不能安全释放');
    }
  }

  async getOutputForVerification(invocationId: string) {
    const invocation = await this.prisma.visualAgentInvocation.findFirst({
      where: {
        id: invocationId,
        status: VisualAgentInvocationStatus.VERIFYING,
        providerOutputUrl: { not: null },
      },
      select: { id: true, provider: true, providerOutputUrl: true, providerTaskId: true, sourceHash: true, visualPlanHash: true },
    });
    if (!invocation?.providerOutputUrl || !invocation.providerTaskId) {
      throw new ConflictException('AI Visual Agent 调用当前没有可验证的 Provider 输出');
    }
    return invocation;
  }

  async assertProviderAuthorization(authorization: VisualProviderAuthorization, provider: string, model: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const providerRef = await tx.visualAgentInvocation.findUnique({
        where: { id: authorization.invocationId },
        select: { provider: true },
      });
      if (!providerRef) throw new ServiceUnavailableException('AI Visual Agent Core 授权不存在、已失效或预算不完整');
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${this.providerBudgetLockKey(providerRef.provider)}))`);
      const invocation = await tx.visualAgentInvocation.findUnique({
        where: { id: authorization.invocationId },
        include: { reservations: { include: { policy: { select: { enabled: true, effectiveFrom: true, effectiveUntil: true } } } } },
      });
      if (!invocation || invocation.status !== VisualAgentInvocationStatus.SUBMITTING || invocation.provider !== provider || invocation.model !== model
        || invocation.policySnapshotVersion !== authorization.policySnapshotVersion
        || invocation.reservedCostCents !== authorization.reservedCostCents
        || invocation.leaseToken !== authorization.leaseToken
        || invocation.leaseGeneration !== authorization.leaseGeneration
        || !invocation.leaseExpiresAt || invocation.leaseExpiresAt.getTime() <= Date.now()
        || invocation.reservations.length !== REQUIRED_SCOPES.length
        || REQUIRED_SCOPES.some((scope) => !invocation.reservations.some((entry) => entry.scope === scope))) {
        throw new ServiceUnavailableException('AI Visual Agent Core 授权不存在、已失效或预算不完整');
      }
      const now = new Date();
      if (invocation.reservations.some(({ policy }) => !policy.enabled
        || policy.effectiveFrom.getTime() > now.getTime()
        || (policy.effectiveUntil ? policy.effectiveUntil.getTime() <= now.getTime() : false))) {
        await tx.visualAgentInvocation.updateMany({
          where: {
            id: invocation.id,
            status: VisualAgentInvocationStatus.SUBMITTING,
            leaseToken: authorization.leaseToken,
            leaseGeneration: authorization.leaseGeneration,
          },
          data: { status: VisualAgentInvocationStatus.RELEASED, reconciliationReason: 'POLICY_DISABLED_BEFORE_PROVIDER_IO', leaseToken: null, leaseExpiresAt: null },
        });
        throw new ServiceUnavailableException('AI Visual Agent Provider 策略已熔断');
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async recordSubmitOutcome(authorization: VisualProviderAuthorization, outcome: VisualProviderSubmitResult) {
    const where = {
      id: authorization.invocationId,
      provider: authorization.provider,
      status: VisualAgentInvocationStatus.SUBMITTING,
      leaseToken: authorization.leaseToken,
      leaseGeneration: authorization.leaseGeneration,
    };
    if (outcome.kind === 'ACCEPTED') {
      const updated = await this.prisma.visualAgentInvocation.updateMany({
        where,
        data: {
          status: outcome.state === 'RUNNING' ? VisualAgentInvocationStatus.RUNNING : VisualAgentInvocationStatus.QUEUED,
          providerTaskId: outcome.providerTaskId,
          providerRequestId: outcome.providerRequestId,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (updated.count !== 1) throw new ConflictException('AI Visual Agent Provider 提交租约已失效');
      return;
    }
    const updated = await this.prisma.visualAgentInvocation.updateMany({
      where,
      data: outcome.kind === 'DECLINED'
        ? { status: VisualAgentInvocationStatus.RELEASED, reconciliationReason: outcome.code, leaseToken: null, leaseExpiresAt: null }
        : { status: VisualAgentInvocationStatus.RECONCILING, reconciliationReason: outcome.code, providerRequestId: outcome.providerRequestId, leaseToken: null, leaseExpiresAt: null },
    });
    if (updated.count !== 1) throw new ConflictException('AI Visual Agent Provider 提交租约已失效');
  }

  /** Closes a synchronous (for example OCR) Provider request under its lease. */
  async recordSynchronousProviderOutcome(authorization: VisualProviderAuthorization, outcome: VisualSynchronousProviderOutcome) {
    const where = {
      id: authorization.invocationId,
      provider: authorization.provider,
      status: VisualAgentInvocationStatus.SUBMITTING,
      leaseToken: authorization.leaseToken,
      leaseGeneration: authorization.leaseGeneration,
    };
    if (outcome.kind === 'KNOWN') {
      const providerUsage = Object.fromEntries(Object.entries(outcome.usage ?? {})
        .filter(([, value]) => Number.isInteger(value) && (value as number) >= 0));
      const updated = await this.prisma.visualAgentInvocation.updateMany({
        where,
        data: {
          status: VisualAgentInvocationStatus.VERIFYING,
          providerRequestId: outcome.providerRequestId,
          providerUsage: providerUsage as Prisma.InputJsonValue,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (updated.count !== 1) throw new ConflictException('AI Visual Agent 同步 Provider 提交租约已失效');
      return;
    }
    const updated = await this.prisma.visualAgentInvocation.updateMany({
      where,
      data: outcome.kind === 'DECLINED'
        ? { status: VisualAgentInvocationStatus.RELEASED, reconciliationReason: outcome.code, leaseToken: null, leaseExpiresAt: null }
        : { status: VisualAgentInvocationStatus.RECONCILING, reconciliationReason: outcome.code, providerRequestId: outcome.providerRequestId, leaseToken: null, leaseExpiresAt: null },
    });
    if (updated.count !== 1) throw new ConflictException('AI Visual Agent 同步 Provider 提交租约已失效');
  }

  async completeSynchronousVerification(invocationId: string, provider: string) {
    const completed = await this.prisma.visualAgentInvocation.updateMany({
      where: { id: invocationId, provider, status: VisualAgentInvocationStatus.VERIFYING },
      data: { status: VisualAgentInvocationStatus.SUCCEEDED },
    });
    if (completed.count !== 1) throw new ConflictException('AI Visual Agent 同步调用当前不能完成验真');
  }

  async moveVerificationToReconciliation(invocationId: string, provider: string, reason: string) {
    const updated = await this.prisma.visualAgentInvocation.updateMany({
      where: { id: invocationId, provider, status: VisualAgentInvocationStatus.VERIFYING },
      data: { status: VisualAgentInvocationStatus.RECONCILING, reconciliationReason: reason.slice(0, 120) },
    });
    if (updated.count !== 1) throw new ConflictException('AI Visual Agent 调用当前不能进入对账');
  }

  async acquireForQuery(invocationId: string): Promise<VisualProviderAuthorization & { providerTaskId: string }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`VISUAL_AGENT_QUERY:${invocationId}`}))`);
      const invocation = await tx.visualAgentInvocation.findUnique({
        where: { id: invocationId }, include: { reservations: { select: { scope: true } } },
      });
      if (!invocation?.providerTaskId || !QUERYABLE_STATUSES.includes(invocation.status)) {
        throw new ConflictException('AI Visual Agent 没有可查询的 Provider 任务');
      }
      if (invocation.leaseToken && invocation.leaseExpiresAt && invocation.leaseExpiresAt.getTime() > Date.now()) {
        throw new ConflictException('AI Visual Agent 已有进行中的 Provider 查询');
      }
      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(Date.now() + 2 * 60_000);
      const claimed = await tx.visualAgentInvocation.update({
        where: { id: invocation.id },
        data: { leaseToken, leaseExpiresAt, leaseGeneration: { increment: 1 } },
        include: { reservations: { select: { scope: true } } },
      });
      return { ...this.toAuthorization(claimed), providerTaskId: invocation.providerTaskId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async recordQueryOutcome(authorization: VisualProviderAuthorization & { providerTaskId: string }, outcome: VisualProviderQueryResult) {
    if (outcome.kind === 'KNOWN' && outcome.providerTaskId !== authorization.providerTaskId) {
      throw new ConflictException('AI Visual Agent Provider 查询任务不匹配');
    }
    if (outcome.kind !== 'KNOWN') {
      const updated = await this.prisma.visualAgentInvocation.updateMany({
        where: {
          id: authorization.invocationId,
          provider: authorization.provider,
          providerTaskId: authorization.providerTaskId,
          leaseToken: authorization.leaseToken,
          leaseGeneration: authorization.leaseGeneration,
        },
        data: { status: VisualAgentInvocationStatus.RECONCILING, reconciliationReason: outcome.code, providerRequestId: outcome.providerRequestId, leaseToken: null, leaseExpiresAt: null },
      });
      if (updated.count !== 1) throw new ConflictException('AI Visual Agent 查询租约已失效');
      return;
    }
    const status = {
      QUEUED: VisualAgentInvocationStatus.QUEUED,
      RUNNING: VisualAgentInvocationStatus.RUNNING,
      SUCCEEDED: VisualAgentInvocationStatus.VERIFYING,
      // Provider FAILED without an auditable cost receipt is not a free retry.
      FAILED: VisualAgentInvocationStatus.RECONCILING,
      CANCELED: VisualAgentInvocationStatus.RECONCILING,
      UNKNOWN: VisualAgentInvocationStatus.RECONCILING,
    }[outcome.state];
    const updated = await this.prisma.visualAgentInvocation.updateMany({
      where: {
        id: authorization.invocationId,
        provider: authorization.provider,
        providerTaskId: authorization.providerTaskId,
        leaseToken: authorization.leaseToken,
        leaseGeneration: authorization.leaseGeneration,
      },
      data: {
        status,
        providerRequestId: outcome.providerRequestId,
        providerOutputUrl: outcome.outputUrl,
        reconciliationReason: status === VisualAgentInvocationStatus.RECONCILING ? `QUERY_${outcome.state}` : null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count !== 1) throw new ConflictException('AI Visual Agent 查询租约已失效');
  }

  /** Explicit human-only closure after provider-console or bill evidence. */
  async resolveReconciliation(input: {
    invocationId: string;
    decision: 'RELEASED' | 'BILLING_EXCEPTION';
    operatorId: string;
    evidenceRef: string;
  }) {
    if (![input.invocationId, input.operatorId, input.evidenceRef].every((value) => /^[A-Za-z0-9._:/-]{1,200}$/.test(value))) {
      throw new ConflictException('AI Visual Agent 对账证据格式不合法');
    }
    await this.prisma.$transaction(async (tx) => {
      const providerRef = await tx.visualAgentInvocation.findFirst({
        where: { id: input.invocationId, status: VisualAgentInvocationStatus.RECONCILING },
        select: { provider: true },
      });
      if (!providerRef) throw new ConflictException('AI Visual Agent 不在可人工对账状态');
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${this.providerBudgetLockKey(providerRef.provider)}))`);
      const invocation = await tx.visualAgentInvocation.findFirst({
        where: { id: input.invocationId, status: VisualAgentInvocationStatus.RECONCILING },
        select: { id: true, provider: true, model: true },
      });
      if (!invocation) throw new ConflictException('AI Visual Agent 不在可人工对账状态');
      await tx.visualAgentInvocation.update({
        where: { id: invocation.id },
        data: {
          status: input.decision === 'RELEASED' ? VisualAgentInvocationStatus.RELEASED : VisualAgentInvocationStatus.BILLING_EXCEPTION,
          reconciliationReason: `MANUAL:${input.operatorId}:${input.evidenceRef}`,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (input.decision === 'BILLING_EXCEPTION') {
        await tx.visualAgentBudgetPolicy.updateMany({
          where: { provider: invocation.provider, model: invocation.model, enabled: true },
          data: { enabled: false },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async recordActualCost(invocationId: string, actualCostCents: number) {
    if (!Number.isInteger(actualCostCents) || actualCostCents < 0) {
      throw new ConflictException('AI Visual Agent 实际成本必须是非负整数分');
    }
    await this.prisma.$transaction(async (tx) => {
      const providerRef = await tx.visualAgentInvocation.findUnique({
        where: { id: invocationId },
        select: { provider: true },
      });
      if (!providerRef) throw new ConflictException('AI Visual Agent 调用当前不能结算成本');
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${this.providerBudgetLockKey(providerRef.provider)}))`);
      const invocation = await tx.visualAgentInvocation.findUnique({
        where: { id: invocationId },
        select: { id: true, provider: true, model: true, reservedCostCents: true, status: true },
      });
      if (!invocation || !COST_SETTLEABLE_STATUSES.includes(invocation.status)) {
        throw new ConflictException('AI Visual Agent 调用当前不能结算成本');
      }
      if (actualCostCents > invocation.reservedCostCents) {
        await tx.visualAgentInvocation.update({
          where: { id: invocation.id },
          data: { status: VisualAgentInvocationStatus.BILLING_EXCEPTION, actualCostCents, reconciliationReason: 'ACTUAL_COST_EXCEEDS_RESERVATION' },
        });
        await tx.visualAgentBudgetPolicy.updateMany({
          where: { provider: invocation.provider, model: invocation.model, enabled: true },
          data: { enabled: false },
        });
        return;
      }
      await tx.visualAgentInvocation.update({ where: { id: invocation.id }, data: { actualCostCents } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** No Provider task is retried by this reaper; uncertain work is reconciled. */
  @Cron(CronExpression.EVERY_MINUTE)
  async reapExpiredLeases() {
    const now = new Date();
    await this.prisma.visualAgentInvocation.updateMany({
      where: { status: VisualAgentInvocationStatus.RESERVED, expiresAt: { lte: now } },
      data: { status: VisualAgentInvocationStatus.RELEASED, reconciliationReason: 'EXPIRED_BEFORE_SUBMIT' },
    });
    await this.prisma.visualAgentInvocation.updateMany({
      where: { status: VisualAgentInvocationStatus.SUBMITTING, leaseExpiresAt: { lte: now } },
      data: { status: VisualAgentInvocationStatus.RECONCILING, reconciliationReason: 'SUBMIT_LEASE_EXPIRED', leaseToken: null, leaseExpiresAt: null },
    });
    await this.prisma.visualAgentInvocation.updateMany({
      where: { status: VisualAgentInvocationStatus.VERIFYING, expiresAt: { lte: now } },
      data: { status: VisualAgentInvocationStatus.RECONCILING, reconciliationReason: 'VERIFICATION_EXPIRED' },
    });
    await this.prisma.visualAgentInvocation.updateMany({
      where: {
        status: { in: QUERYABLE_STATUSES },
        leaseToken: { not: null },
        leaseExpiresAt: { lte: now },
      },
      data: { status: VisualAgentInvocationStatus.RECONCILING, reconciliationReason: 'QUERY_LEASE_EXPIRED', leaseToken: null, leaseExpiresAt: null },
    });
  }

  private scopeKeys(input: ReserveVisualAgentInvocationInput): Record<VisualAgentBudgetScope, string> {
    const part = (value: string) => `${value.length}:${value}`;
    return {
      [VisualAgentBudgetScope.PLATFORM]: 'GLOBAL',
      [VisualAgentBudgetScope.PROVIDER]: this.providerBudgetScopeKey(input.provider),
      [VisualAgentBudgetScope.TENANT]: `tenant:${part(input.tenantId)}`,
      [VisualAgentBudgetScope.CLIENT]: `tenant:${part(input.tenantId)}:client:${part(input.ownerClientId)}`,
      [VisualAgentBudgetScope.EXTERNAL_OBJECT]: `tenant:${part(input.tenantId)}:client:${part(input.ownerClientId)}:adapter:${part(input.adapterNamespace)}:object:${part(input.externalObjectId)}`,
      [VisualAgentBudgetScope.ACTOR]: `tenant:${part(input.tenantId)}:client:${part(input.ownerClientId)}:adapter:${part(input.adapterNamespace)}:actor:${part(input.actorId)}`,
    };
  }

  private toAuthorization(invocation: InvocationForAuthorization): VisualProviderAuthorization {
    if (!invocation.leaseToken || !invocation.leaseExpiresAt) {
      throw new ConflictException('AI Visual Agent 调用尚未取得有效租约');
    }
    if (invocation.reservations.length !== REQUIRED_SCOPES.length) {
      throw new ServiceUnavailableException('AI Visual Agent 调用缺少完整预算预占');
    }
    return {
      invocationId: invocation.id,
      provider: invocation.provider,
      policySnapshotVersion: invocation.policySnapshotVersion,
      reservedCostCents: invocation.reservedCostCents,
      adapterExecutionApproved: true,
      leaseToken: invocation.leaseToken,
      leaseGeneration: invocation.leaseGeneration,
      expiresAt: invocation.leaseExpiresAt,
    };
  }

  private providerBudgetScopeKey(provider: string) {
    return `provider:${provider.length}:${provider}`;
  }

  private providerBudgetLockKey(provider: string) {
    return `VISUAL_AGENT_BUDGET:PROVIDER:${this.providerBudgetScopeKey(provider)}`;
  }

  private hasPositiveCaps(policy: { perTaskCapCents: number; dailyCapCents: number; weeklyCapCents: number }) {
    return Number.isInteger(policy.perTaskCapCents) && policy.perTaskCapCents > 0
      && Number.isInteger(policy.dailyCapCents) && policy.dailyCapCents > 0
      && Number.isInteger(policy.weeklyCapCents) && policy.weeklyCapCents > 0;
  }

  private requiredConsistentReserveCents(policies: Array<{
    reserveCents: number; perTaskCapCents: number;
  }>) {
    const values = new Set(policies.map((policy) => policy.reserveCents));
    const reserveCents = policies[0]?.reserveCents;
    if (!Number.isInteger(reserveCents) || reserveCents <= 0 || values.size !== 1
      || policies.some((policy) => reserveCents > policy.perTaskCapCents)) {
      throw new ServiceUnavailableException('AI Visual Agent 模型预占价格未被六层策略一致授权');
    }
    return reserveCents;
  }

  private shanghaiBudgetWindow(now: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const dayStart = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) - 8 * 60 * 60 * 1000);
    const mondayOffset = (dayStart.getUTCDay() + 6) % 7;
    return { dayStart, weekStart: new Date(dayStart.getTime() - mondayOffset * 24 * 60 * 60 * 1000) };
  }

  private assertReserveInput(input: ReserveVisualAgentInvocationInput) {
    const scoped = [input.tenantId, input.ownerClientId, input.adapterNamespace, input.externalObjectId, input.actorId, input.provider, input.visualMode, input.idempotencyKey];
    if (scoped.some((value) => !/^[A-Za-z0-9._:/-]{1,200}$/.test(value))
      || !/^[a-f0-9]{64}$/.test(input.sourceHash)
      || !/^[a-f0-9]{64}$/.test(input.visualPlanHash)
      || input.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('AI Visual Agent 调用参数不合法');
    }
  }

  private assertIdempotentInputMatches(existing: {
    tenantId: string; ownerClientId: string; adapterNamespace: string; externalObjectId: string; actorId: string;
    provider: string; model: string; visualMode: string; sourceHash: string; visualPlanHash: string;
  }, input: ReserveVisualAgentInvocationInput) {
    if (existing.tenantId !== input.tenantId || existing.ownerClientId !== input.ownerClientId
      || existing.adapterNamespace !== input.adapterNamespace || existing.externalObjectId !== input.externalObjectId
      || existing.actorId !== input.actorId || existing.provider !== input.provider || existing.model !== input.model
      || existing.visualMode !== input.visualMode || existing.sourceHash !== input.sourceHash
      || existing.visualPlanHash !== input.visualPlanHash) {
      throw new ConflictException('AI Visual Agent 幂等键已绑定到不同的源图、计划或业务对象');
    }
  }
}
