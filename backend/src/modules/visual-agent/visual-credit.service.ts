import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Prisma,
  VisualCreditLedgerType,
  VisualCreditQuoteStatus,
  VisualRateCardStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { VisualAgentClientPrincipal } from './visual-agent-client-key.service';

const SAFE_ID = /^[A-Za-z0-9._:/-]{1,200}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_QUOTE_TTL_MS = 60 * 60_000;

export type VisualBillingOwner = {
  billingOwnerType: string;
  billingOwnerId: string;
};

export type VisualCreditScope = VisualBillingOwner & {
  principal: VisualAgentClientPrincipal;
  externalObjectId: string;
  actorId: string;
};

export type VerifiedVisualPlanForQuote = {
  direction: string;
  riskProfile: string;
  protectedRegionVersion: string;
  allowedOperations: string[];
};

/**
 * Domain-neutral merchant image-credit ledger. It deliberately has no
 * dependency on buyer Rewards, Coupons, wallet withdrawals, or an individual
 * product table; a trusted Adapter supplies the billable owner and scope.
 */
@Injectable()
export class VisualCreditService {
  constructor(private readonly prisma: PrismaService) {}

  async configureWelcomePolicy(input: {
    tenantId: string;
    enabled: boolean;
    grantCredits: number;
    creditValueCents: number;
    policyVersion: string;
    effectiveFrom: Date;
    effectiveUntil?: Date | null;
  }) {
    this.assertId(input.tenantId, 'Tenant');
    this.assertId(input.policyVersion, '欢迎额度策略版本');
    if (!Number.isInteger(input.grantCredits) || input.grantCredits <= 0
      || !Number.isInteger(input.creditValueCents) || input.creditValueCents < 0) {
      throw new ConflictException('欢迎图片额度策略不合法');
    }
    return this.prisma.visualCreditWelcomePolicy.upsert({
      where: { tenantId: input.tenantId },
      create: {
        tenantId: input.tenantId,
        enabled: input.enabled,
        grantCredits: input.grantCredits,
        creditValueCents: input.creditValueCents,
        policyVersion: input.policyVersion,
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil ?? null,
      },
      update: {
        enabled: input.enabled,
        grantCredits: input.grantCredits,
        creditValueCents: input.creditValueCents,
        policyVersion: input.policyVersion,
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil ?? null,
      },
    });
  }

  async getWelcomePolicy(tenantId: string) {
    this.assertId(tenantId, 'Tenant');
    return this.prisma.visualCreditWelcomePolicy.findUnique({ where: { tenantId } });
  }

  async upsertRateCard(input: {
    tenantId: string;
    clientId: string;
    adapterNamespace: string;
    code: string;
    displayName: string;
    description: string;
    modelProfile: string;
    outputSpec: Prisma.InputJsonValue;
    allowedDirections: string[];
    allowedRiskProfiles: string[];
    candidateRole: string;
    requiresHumanReview: boolean;
    candidateCount: number;
    creditCost: number;
    status: VisualRateCardStatus;
    version: string;
    effectiveFrom: Date;
    effectiveUntil?: Date | null;
  }) {
    [input.tenantId, input.clientId, input.adapterNamespace, input.code, input.modelProfile, input.version, input.candidateRole]
      .forEach((value) => this.assertId(value, 'Rate Card 字段'));
    if (!input.displayName.trim() || !input.description.trim()
      || !Number.isInteger(input.candidateCount) || input.candidateCount <= 0
      || !Number.isInteger(input.creditCost) || input.creditCost < 0
      || input.allowedDirections.length === 0 || input.allowedRiskProfiles.length === 0
      || input.allowedDirections.some((value) => !SAFE_ID.test(value))
      || input.allowedRiskProfiles.some((value) => !SAFE_ID.test(value))) {
      throw new ConflictException('图片额度价目不合法');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `VISUAL_RATE_CARD:${input.tenantId}:${input.clientId}:${input.adapterNamespace}:${input.code}`);
      if (input.status === VisualRateCardStatus.ACTIVE) {
        await tx.visualRateCard.updateMany({
          where: {
            tenantId: input.tenantId,
            clientId: input.clientId,
            adapterNamespace: input.adapterNamespace,
            code: input.code,
            status: VisualRateCardStatus.ACTIVE,
            version: { not: input.version },
          },
          data: { status: VisualRateCardStatus.PAUSED },
        });
      }
      return tx.visualRateCard.upsert({
        where: {
          tenantId_clientId_adapterNamespace_code_version: {
            tenantId: input.tenantId,
            clientId: input.clientId,
            adapterNamespace: input.adapterNamespace,
            code: input.code,
            version: input.version,
          },
        },
        create: {
          ...input,
          effectiveUntil: input.effectiveUntil ?? null,
        },
        update: {
          displayName: input.displayName,
          description: input.description,
          modelProfile: input.modelProfile,
          outputSpec: input.outputSpec,
          allowedDirections: input.allowedDirections,
          allowedRiskProfiles: input.allowedRiskProfiles,
          candidateRole: input.candidateRole,
          requiresHumanReview: input.requiresHumanReview,
          candidateCount: input.candidateCount,
          creditCost: input.creditCost,
          status: input.status,
          effectiveFrom: input.effectiveFrom,
          effectiveUntil: input.effectiveUntil ?? null,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listRateCards(input: { tenantId: string; clientId: string; adapterNamespace: string }) {
    [input.tenantId, input.clientId, input.adapterNamespace].forEach((value) => this.assertId(value, 'Rate Card scope'));
    return this.prisma.visualRateCard.findMany({
      where: input,
      orderBy: [{ code: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  async grantWelcomeCredits(input: VisualBillingOwner & {
    tenantId: string;
    idempotencyKey?: string;
    now?: Date;
  }) {
    this.assertTenantOwner(input.tenantId, input);
    const now = input.now ?? new Date();
    const grantKey = input.idempotencyKey ?? `WELCOME_200_V1:${input.tenantId}:${input.billingOwnerType}:${input.billingOwnerId}`;
    this.assertId(grantKey, '欢迎额度幂等键');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `VISUAL_CREDIT_ACCOUNT:${input.tenantId}:${input.billingOwnerType}:${input.billingOwnerId}`);
      const policy = await tx.visualCreditWelcomePolicy.findUnique({ where: { tenantId: input.tenantId } });
      if (!policy || !policy.enabled || policy.effectiveFrom > now
        || (policy.effectiveUntil && policy.effectiveUntil <= now)) {
        throw new ServiceUnavailableException('当前没有可用的新商家图片额度赠送策略');
      }
      const account = await this.ensureAccountTx(tx, input.tenantId, input);
      const existing = await tx.visualCreditLedger.findUnique({ where: { idempotencyKey: grantKey } });
      if (existing) {
        if (existing.accountId !== account.id) {
          throw new ConflictException('欢迎额度幂等键已被另一个图片额度账户使用');
        }
        return this.toAccountResult(account, existing);
      }

      const availableAfter = account.availableCredits + policy.grantCredits;
      const updated = await tx.visualCreditAccount.update({
        where: { id: account.id },
        data: { availableCredits: availableAfter, version: { increment: 1 } },
      });
      const ledger = await tx.visualCreditLedger.create({
        data: {
          accountId: account.id,
          type: VisualCreditLedgerType.WELCOME_GRANT,
          availableDelta: policy.grantCredits,
          reservedDelta: 0,
          availableBalanceAfter: availableAfter,
          reservedBalanceAfter: account.reservedCredits,
          idempotencyKey: grantKey,
          reason: '新商家图片额度赠送',
          metadata: {
            policyVersion: policy.policyVersion,
            grantCredits: policy.grantCredits,
            creditValueCents: policy.creditValueCents,
          } as Prisma.InputJsonValue,
        },
      });
      return this.toAccountResult(updated, ledger);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async issueQuote(input: VisualCreditScope & {
    rateCode: string;
    sourceAssetRef: string;
    sourceHash: string;
    visualPlanHash: string;
    visualPlan: VerifiedVisualPlanForQuote;
    idempotencyKey: string;
    expiresAt: Date;
  }) {
    this.assertScope(input);
    this.assertId(input.rateCode, 'Rate Card code');
    this.assertId(input.sourceAssetRef, '视觉源资产标识');
    this.assertId(input.idempotencyKey, '报价幂等键');
    this.assertHashes(input.sourceHash, input.visualPlanHash);
    this.assertVisualPlan(input.visualPlan);
    const now = new Date();
    if (input.expiresAt <= now || input.expiresAt.getTime() - now.getTime() > MAX_QUOTE_TTL_MS) {
      throw new ConflictException('图片美化报价有效期必须在未来 60 分钟内');
    }
    const { principal } = input;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `VISUAL_CREDIT_QUOTE:${principal.tenantId}:${principal.clientId}:${principal.adapterNamespace}:${input.idempotencyKey}`);
      const account = await this.ensureAccountTx(tx, principal.tenantId, input);
      const existing = await tx.visualCreditQuote.findUnique({
        where: {
          tenantId_clientId_adapterNamespace_idempotencyKey: {
            tenantId: principal.tenantId,
            clientId: principal.clientId,
            adapterNamespace: principal.adapterNamespace,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) {
        this.assertQuoteInputMatches(existing, input, account.id);
        return this.toQuoteResponse(existing);
      }
      const rateCard = await tx.visualRateCard.findFirst({
        where: {
          tenantId: principal.tenantId,
          clientId: principal.clientId,
          adapterNamespace: principal.adapterNamespace,
          code: input.rateCode,
          status: VisualRateCardStatus.ACTIVE,
          effectiveFrom: { lte: now },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!rateCard) throw new ServiceUnavailableException('当前没有可用的图片美化报价档位');
      if (!rateCard.allowedDirections.includes(input.visualPlan.direction)
        || !rateCard.allowedRiskProfiles.includes(input.visualPlan.riskProfile)) {
        throw new ConflictException('该图片风险档不允许使用所选美化报价');
      }
      const snapshot = {
        code: rateCard.code,
        displayName: rateCard.displayName,
        description: rateCard.description,
        modelProfile: rateCard.modelProfile,
        outputSpec: rateCard.outputSpec,
        allowedDirections: rateCard.allowedDirections,
        allowedRiskProfiles: rateCard.allowedRiskProfiles,
        candidateRole: rateCard.candidateRole,
        requiresHumanReview: rateCard.requiresHumanReview,
        candidateCount: rateCard.candidateCount,
        creditCost: rateCard.creditCost,
        version: rateCard.version,
      };
      const quoteHash = this.sha256(JSON.stringify({
        tenantId: principal.tenantId,
        clientId: principal.clientId,
        adapterNamespace: principal.adapterNamespace,
        billingAccountId: account.id,
        externalObjectId: input.externalObjectId,
        actorId: input.actorId,
        sourceAssetRef: input.sourceAssetRef,
        sourceHash: input.sourceHash,
        visualPlanHash: input.visualPlanHash,
        visualPlan: input.visualPlan,
        snapshot,
      }));
      const quote = await tx.visualCreditQuote.create({
        data: {
          tenantId: principal.tenantId,
          clientId: principal.clientId,
          adapterNamespace: principal.adapterNamespace,
          billingAccountId: account.id,
          rateCardId: rateCard.id,
          externalObjectId: input.externalObjectId,
          actorId: input.actorId,
          sourceAssetRef: input.sourceAssetRef,
          sourceHash: input.sourceHash,
          visualPlanHash: input.visualPlanHash,
          visualPlanSnapshot: input.visualPlan as Prisma.InputJsonValue,
          rateCardSnapshot: snapshot as Prisma.InputJsonValue,
          creditCost: rateCard.creditCost,
          candidateCount: rateCard.candidateCount,
          idempotencyKey: input.idempotencyKey,
          quoteHash,
          expiresAt: input.expiresAt,
        },
      });
      return this.toQuoteResponse(quote);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async confirmAndReserve(input: VisualCreditScope & { quoteId: string; quoteHash: string }) {
    this.assertScope(input);
    this.assertId(input.quoteId, '报价 ID');
    if (!SHA256.test(input.quoteHash)) throw new ConflictException('报价确认凭证无效');
    const now = new Date();
    const { principal } = input;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `VISUAL_CREDIT_QUOTE_ID:${input.quoteId}`);
      const quote = await tx.visualCreditQuote.findFirst({
        where: {
          id: input.quoteId,
          tenantId: principal.tenantId,
          clientId: principal.clientId,
          adapterNamespace: principal.adapterNamespace,
        },
        include: { billingAccount: true },
      });
      if (!quote || quote.billingAccount.billingOwnerType !== input.billingOwnerType
        || quote.billingAccount.billingOwnerId !== input.billingOwnerId
        || quote.externalObjectId !== input.externalObjectId
        || quote.actorId !== input.actorId) {
        throw new NotFoundException('图片美化报价不存在');
      }
      if (quote.quoteHash !== input.quoteHash) {
        throw new ConflictException('图片美化报价已变化，请重新查看费用后确认');
      }
      await this.lock(tx, `VISUAL_CREDIT_ACCOUNT:${principal.tenantId}:${input.billingOwnerType}:${input.billingOwnerId}`);
      if (quote.status === VisualCreditQuoteStatus.RESERVED || quote.status === VisualCreditQuoteStatus.RECONCILING) {
        return this.toQuoteResponse(quote);
      }
      if (quote.status !== VisualCreditQuoteStatus.ISSUED) {
        throw new ConflictException('该图片美化报价不能再确认');
      }
      if (quote.expiresAt <= now) {
        await tx.visualCreditQuote.update({
          where: { id: quote.id },
          data: { status: VisualCreditQuoteStatus.EXPIRED, failureReason: 'QUOTE_EXPIRED' },
        });
        throw new ConflictException('图片美化报价已过期，请重新获取报价');
      }
      if (quote.billingAccount.availableCredits < quote.creditCost) {
        throw new ConflictException('图片额度不足，请先充值或使用免费分析');
      }
      const availableAfter = quote.billingAccount.availableCredits - quote.creditCost;
      const reservedAfter = quote.billingAccount.reservedCredits + quote.creditCost;
      const account = await tx.visualCreditAccount.update({
        where: { id: quote.billingAccount.id },
        data: { availableCredits: availableAfter, reservedCredits: reservedAfter, version: { increment: 1 } },
      });
      const reserved = await tx.visualCreditQuote.update({
        where: { id: quote.id },
        data: { status: VisualCreditQuoteStatus.RESERVED, confirmedAt: now },
      });
      const ledger = await tx.visualCreditLedger.create({
        data: {
          accountId: account.id,
          quoteId: quote.id,
          type: VisualCreditLedgerType.RESERVE,
          availableDelta: -quote.creditCost,
          reservedDelta: quote.creditCost,
          availableBalanceAfter: availableAfter,
          reservedBalanceAfter: reservedAfter,
          idempotencyKey: `quote:${quote.id}:reserve`,
          reason: '商家确认图片美化报价，冻结额度',
          metadata: { quoteHash: quote.quoteHash, rateCardSnapshot: quote.rateCardSnapshot } as Prisma.InputJsonValue,
        },
      });
      return { quote: this.toQuoteResponse(reserved), account: this.toAccountResponse(account), ledger: this.toLedgerResponse(ledger) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async markReconciliation(quoteId: string, reason: string) {
    this.assertId(quoteId, '报价 ID');
    const updated = await this.prisma.visualCreditQuote.updateMany({
      where: { id: quoteId, status: VisualCreditQuoteStatus.RESERVED },
      data: { status: VisualCreditQuoteStatus.RECONCILING, failureReason: reason.slice(0, 160) },
    });
    if (updated.count !== 1) throw new ConflictException('图片美化报价当前不能进入对账');
  }

  async settleReservedQuote(quoteId: string, reason = '模型任务已完成并通过验真') {
    return this.closeReservedQuote(quoteId, 'SETTLE', reason);
  }

  async releaseReservedQuote(quoteId: string, reason = '模型任务未被 Provider 接受或明确未计费') {
    return this.closeReservedQuote(quoteId, 'RELEASE', reason);
  }

  async getAccount(input: { tenantId: string } & VisualBillingOwner) {
    this.assertTenantOwner(input.tenantId, input);
    const account = await this.prisma.visualCreditAccount.findUnique({
      where: {
        tenantId_billingOwnerType_billingOwnerId: {
          tenantId: input.tenantId,
          billingOwnerType: input.billingOwnerType,
          billingOwnerId: input.billingOwnerId,
        },
      },
    });
    if (!account) return { availableCredits: 0, reservedCredits: 0, exists: false };
    return { ...this.toAccountResponse(account), exists: true };
  }

  async listLedger(input: { tenantId: string } & VisualBillingOwner & { take?: number }) {
    const account = await this.prisma.visualCreditAccount.findUnique({
      where: {
        tenantId_billingOwnerType_billingOwnerId: {
          tenantId: input.tenantId,
          billingOwnerType: input.billingOwnerType,
          billingOwnerId: input.billingOwnerId,
        },
      },
      select: { id: true },
    });
    if (!account) return [];
    const rows = await this.prisma.visualCreditLedger.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(input.take ?? 50, 1), 200),
    });
    return rows.map((row) => this.toLedgerResponse(row));
  }

  async adminAdjust(input: { tenantId: string } & VisualBillingOwner & {
    availableDelta: number;
    reason: string;
    idempotencyKey: string;
    operatorId: string;
  }) {
    this.assertTenantOwner(input.tenantId, input);
    this.assertId(input.idempotencyKey, '额度调整幂等键');
    this.assertId(input.operatorId, '额度调整操作人');
    if (!Number.isInteger(input.availableDelta) || input.availableDelta === 0 || !input.reason.trim()) {
      throw new ConflictException('图片额度调整必须给出非零整数额度和原因');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `VISUAL_CREDIT_ACCOUNT:${input.tenantId}:${input.billingOwnerType}:${input.billingOwnerId}`);
      const account = await this.ensureAccountTx(tx, input.tenantId, input);
      const existing = await tx.visualCreditLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        if (existing.accountId !== account.id) throw new ConflictException('额度调整幂等键已被另一个账户使用');
        return this.toAccountResult(account, existing);
      }
      const availableAfter = account.availableCredits + input.availableDelta;
      if (availableAfter < 0) throw new ConflictException('图片额度不足，不能执行本次人工扣减');
      const updated = await tx.visualCreditAccount.update({
        where: { id: account.id },
        data: { availableCredits: availableAfter, version: { increment: 1 } },
      });
      const ledger = await tx.visualCreditLedger.create({
        data: {
          accountId: account.id,
          type: VisualCreditLedgerType.ADMIN_ADJUST,
          availableDelta: input.availableDelta,
          reservedDelta: 0,
          availableBalanceAfter: availableAfter,
          reservedBalanceAfter: account.reservedCredits,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason.trim().slice(0, 400),
          metadata: { operatorId: input.operatorId } as Prisma.InputJsonValue,
        },
      });
      return this.toAccountResult(updated, ledger);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireIssuedQuotes() {
    return this.prisma.visualCreditQuote.updateMany({
      where: { status: VisualCreditQuoteStatus.ISSUED, expiresAt: { lte: new Date() } },
      data: { status: VisualCreditQuoteStatus.EXPIRED, failureReason: 'QUOTE_EXPIRED' },
    });
  }

  private async closeReservedQuote(quoteId: string, action: 'SETTLE' | 'RELEASE', reason: string) {
    this.assertId(quoteId, '报价 ID');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `VISUAL_CREDIT_QUOTE_ID:${quoteId}`);
      const quote = await tx.visualCreditQuote.findUnique({
        where: { id: quoteId },
        include: { billingAccount: true },
      });
      if (!quote) throw new NotFoundException('图片美化报价不存在');
      if (quote.status === VisualCreditQuoteStatus.SETTLED || quote.status === VisualCreditQuoteStatus.RELEASED) {
        return this.toQuoteResponse(quote);
      }
      if (quote.status !== VisualCreditQuoteStatus.RESERVED && quote.status !== VisualCreditQuoteStatus.RECONCILING) {
        throw new ConflictException('图片美化报价当前不能结算或释放');
      }
      await this.lock(tx, `VISUAL_CREDIT_ACCOUNT:${quote.tenantId}:${quote.billingAccount.billingOwnerType}:${quote.billingAccount.billingOwnerId}`);
      if (quote.billingAccount.reservedCredits < quote.creditCost) {
        throw new ConflictException('图片额度冻结余额异常，不能自动结算');
      }
      const availableAfter = action === 'RELEASE'
        ? quote.billingAccount.availableCredits + quote.creditCost
        : quote.billingAccount.availableCredits;
      const reservedAfter = quote.billingAccount.reservedCredits - quote.creditCost;
      const account = await tx.visualCreditAccount.update({
        where: { id: quote.billingAccount.id },
        data: { availableCredits: availableAfter, reservedCredits: reservedAfter, version: { increment: 1 } },
      });
      const status = action === 'SETTLE' ? VisualCreditQuoteStatus.SETTLED : VisualCreditQuoteStatus.RELEASED;
      const closed = await tx.visualCreditQuote.update({
        where: { id: quote.id },
        data: {
          status,
          settledAt: action === 'SETTLE' ? new Date() : null,
          releasedAt: action === 'RELEASE' ? new Date() : null,
          failureReason: action === 'RELEASE' ? reason.slice(0, 160) : null,
        },
      });
      const ledger = await tx.visualCreditLedger.create({
        data: {
          accountId: account.id,
          quoteId: quote.id,
          type: action === 'SETTLE' ? VisualCreditLedgerType.SETTLE : VisualCreditLedgerType.RELEASE,
          availableDelta: action === 'RELEASE' ? quote.creditCost : 0,
          reservedDelta: -quote.creditCost,
          availableBalanceAfter: availableAfter,
          reservedBalanceAfter: reservedAfter,
          idempotencyKey: `quote:${quote.id}:${action.toLowerCase()}`,
          reason,
          metadata: { quoteHash: quote.quoteHash } as Prisma.InputJsonValue,
        },
      });
      return { quote: this.toQuoteResponse(closed), account: this.toAccountResponse(account), ledger: this.toLedgerResponse(ledger) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async ensureAccountTx(tx: any, tenantId: string, owner: VisualBillingOwner) {
    return tx.visualCreditAccount.upsert({
      where: { tenantId_billingOwnerType_billingOwnerId: { tenantId, ...owner } },
      create: { tenantId, ...owner },
      update: {},
    });
  }

  private async lock(tx: any, key: string) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
  }

  private assertScope(input: VisualCreditScope) {
    this.assertTenantOwner(input.principal.tenantId, input);
    [input.principal.clientId, input.principal.adapterNamespace, input.externalObjectId, input.actorId]
      .forEach((value) => this.assertId(value, '图片额度 scope'));
  }

  private assertTenantOwner(tenantId: string, owner: VisualBillingOwner) {
    [tenantId, owner.billingOwnerType, owner.billingOwnerId].forEach((value) => this.assertId(value, '图片额度账户标识'));
  }

  private assertId(value: string, label: string) {
    if (!SAFE_ID.test(value)) throw new ConflictException(`${label} 格式无效`);
  }

  private assertHashes(sourceHash: string, visualPlanHash: string) {
    if (!SHA256.test(sourceHash) || !SHA256.test(visualPlanHash)) {
      throw new ConflictException('图片源或视觉计划哈希无效');
    }
  }

  private assertVisualPlan(plan: VerifiedVisualPlanForQuote) {
    if (!SAFE_ID.test(plan.direction) || !SAFE_ID.test(plan.riskProfile)
      || !SAFE_ID.test(plan.protectedRegionVersion)
      || plan.allowedOperations.length === 0
      || plan.allowedOperations.some((operation) => !SAFE_ID.test(operation))) {
      throw new ConflictException('视觉计划报价快照无效');
    }
  }

  private assertQuoteInputMatches(existing: {
    externalObjectId: string; actorId: string; sourceAssetRef: string; sourceHash: string; visualPlanHash: string; billingAccountId: string;
  }, input: VisualCreditScope & { sourceAssetRef: string; sourceHash: string; visualPlanHash: string }, billingAccountId: string) {
    if (existing.externalObjectId !== input.externalObjectId || existing.actorId !== input.actorId
      || existing.sourceAssetRef !== input.sourceAssetRef || existing.sourceHash !== input.sourceHash || existing.visualPlanHash !== input.visualPlanHash
      || existing.billingAccountId !== billingAccountId) {
      throw new ConflictException('图片美化报价幂等键已用于另一张图片或业务对象');
    }
  }

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private toQuoteResponse(quote: any) {
    return {
      id: quote.id,
      status: quote.status,
      sourceAssetRef: quote.sourceAssetRef,
      creditCost: quote.creditCost,
      candidateCount: quote.candidateCount,
      rateCardSnapshot: quote.rateCardSnapshot,
      visualPlanSnapshot: quote.visualPlanSnapshot,
      quoteHash: quote.quoteHash,
      expiresAt: quote.expiresAt,
      confirmedAt: quote.confirmedAt,
      settledAt: quote.settledAt,
      releasedAt: quote.releasedAt,
      failureReason: quote.failureReason,
    };
  }

  private toAccountResponse(account: any) {
    return {
      id: account.id,
      tenantId: account.tenantId,
      billingOwnerType: account.billingOwnerType,
      billingOwnerId: account.billingOwnerId,
      availableCredits: account.availableCredits,
      reservedCredits: account.reservedCredits,
      version: account.version,
    };
  }

  private toLedgerResponse(ledger: any) {
    return {
      id: ledger.id,
      type: ledger.type,
      availableDelta: ledger.availableDelta,
      reservedDelta: ledger.reservedDelta,
      availableBalanceAfter: ledger.availableBalanceAfter,
      reservedBalanceAfter: ledger.reservedBalanceAfter,
      createdAt: ledger.createdAt,
    };
  }

  private toAccountResult(account: any, ledger: any) {
    return { account: this.toAccountResponse(account), ledger: this.toLedgerResponse(ledger) };
  }
}
