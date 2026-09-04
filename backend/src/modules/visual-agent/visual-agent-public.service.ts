import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, VisualAgentAssetStatus, VisualAgentCandidateStatus, VisualCreditQuoteStatus } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
const sharp = require('sharp') as typeof import('sharp').default;
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { VisualAgentClientPrincipal } from './visual-agent-client-key.service';
import { visualPlanSha256 } from './visual-agent-integrity';
import { VisualAgentInvocationService } from './visual-agent-invocation.service';
import { VisualCreditService } from './visual-credit.service';
import { VisualPaidExecutionService } from './visual-paid-execution.service';
import { VisualAgentCandidateVerificationService, VisualAgentCandidateVerificationReport } from './visual-agent-candidate-verification.service';
import { VisualProviderAllowedOperation, VisualProviderDirection, VisualProviderRiskProfile, VisualProviderServerPlan, VisualProviderSource } from './providers/visual-image-edit.provider';
import { VisualAgentManagedOutput, VisualAgentManagedOutputService } from './visual-agent-managed-output.service';

const EVIDENCE_MAX_AGE_MS = 15 * 60_000;
const PLAN_TTL_MS = 15 * 60_000;
const SAFE_ID = /^[A-Za-z0-9._:/-]{1,200}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DIRECTIONS = new Set<VisualProviderDirection>(['PRESERVE_REAL_SCENE', 'CATALOG_STUDIO', 'PRODUCT_RETOUCH', 'MARKETING_SCENE']);
const RISKS = new Set<VisualProviderRiskProfile>(['STRICT_FACTS', 'CONSERVATIVE_FACTS', 'STANDARD_FACTS', 'ORGANIC_FACTS', 'MARKETING_ONLY']);
const OPERATIONS = new Set<VisualProviderAllowedOperation>(['LIGHTING', 'WHITE_BALANCE', 'DENOISE', 'DEGLARE', 'COMPOSITION', 'BACKGROUND_SIMPLIFY', 'BACKGROUND_REPLACE', 'SCENE_RESTAGE']);

export type AdapterEvidenceEnvelope = {
  version: 'adapter-evidence-v1';
  keyId: string;
  nonce: string;
  externalObjectId: string;
  externalObjectVersion: string;
  actorId: string;
  billingOwnerType: string;
  billingOwnerId: string;
  sourceSha256: string;
  riskProfile: VisualProviderRiskProfile;
  allowedDirections: VisualProviderDirection[];
  allowedOperations: VisualProviderAllowedOperation[];
  protectedRegionVersion: string;
  factPolicy: Record<string, unknown>;
  issuedAt: string;
  expiresAt: string;
};

/**
 * Generic, Key-scoped Core API for systems that do not use an in-process
 * Adapter. The evidence HMAC is deliberately independent from the API key:
 * possessing a client key alone cannot manufacture an external object's
 * version, source digest, billing owner or fact policy.
 */
@Injectable()
export class VisualAgentPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly upload: UploadService,
    private readonly credits: VisualCreditService,
    private readonly execution: VisualPaidExecutionService,
    private readonly invocations: VisualAgentInvocationService,
    private readonly config: ConfigService,
    private readonly verification: VisualAgentCandidateVerificationService,
    private readonly managedOutputs: VisualAgentManagedOutputService,
  ) {}

  async createAsset(input: { principal: VisualAgentClientPrincipal; evidenceJson: string; signature: string; file: Express.Multer.File }) {
    if (!input.file) throw new BadRequestException('请选择视觉源图片');
    const evidence = this.parseAndVerifyEvidence(input.principal, input.evidenceJson, input.signature, input.file.buffer);
    const existing = await this.prisma.visualAgentAsset.findUnique({
      where: { tenantId_clientId_adapterNamespace_evidenceNonce: this.scopeNonce(input.principal, evidence.nonce) },
    });
    if (existing) {
      if (existing.originalSha256 !== evidence.sourceSha256 || existing.externalObjectId !== evidence.externalObjectId
        || existing.externalObjectVersion !== evidence.externalObjectVersion || existing.billingOwnerType !== evidence.billingOwnerType
        || existing.billingOwnerId !== evidence.billingOwnerId) {
        throw new ConflictException('Adapter Evidence nonce 已被另一份视觉源证据使用');
      }
      return this.assetResponse(existing, true);
    }
    const uploaded = await this.upload.uploadFile(input.file, 'visual-agent-assets', { preserveQrCodes: true, preserveEvidencePixels: true });
    if (!uploaded.canonicalSha256 || !uploaded.width || !uploaded.height || !uploaded.mimeType.startsWith('image/')) {
      await this.upload.deleteFile(uploaded.key);
      throw new BadRequestException('视觉源图片无法规范化为受管图像');
    }
    if (uploaded.needsReview || uploaded.contactInfoDetected) {
      await this.upload.deleteFile(uploaded.key);
      throw new ConflictException('视觉源图片仍需安全复核，不能进入通用 AI Visual Agent');
    }
    try {
      const asset = await this.prisma.visualAgentAsset.create({
        data: {
          tenantId: input.principal.tenantId,
          clientId: input.principal.clientId,
          adapterNamespace: input.principal.adapterNamespace,
          externalObjectId: evidence.externalObjectId,
          externalObjectVersion: evidence.externalObjectVersion,
          actorId: evidence.actorId,
          billingOwnerType: evidence.billingOwnerType,
          billingOwnerId: evidence.billingOwnerId,
          objectKey: uploaded.key,
          canonicalSha256: uploaded.canonicalSha256,
          originalSha256: evidence.sourceSha256,
          mimeType: uploaded.mimeType,
          byteSize: uploaded.size,
          width: uploaded.width,
          height: uploaded.height,
          factPolicy: evidence.factPolicy as Prisma.InputJsonValue,
          evidenceNonce: evidence.nonce,
          evidenceIssuedAt: new Date(evidence.issuedAt),
          evidenceExpiresAt: new Date(evidence.expiresAt),
          evidenceKeyId: evidence.keyId,
        },
      });
      return this.assetResponse(asset, true);
    } catch (error) {
      await this.upload.deleteFile(uploaded.key);
      throw error;
    }
  }

  async getAsset(principal: VisualAgentClientPrincipal, assetId: string) {
    const asset = await this.findAsset(principal, assetId);
    return this.assetResponse(asset, true);
  }

  async createPlan(input: { principal: VisualAgentClientPrincipal; assetId: string; requestedDirection?: string }) {
    const asset = await this.findAsset(input.principal, input.assetId);
    if (asset.evidenceExpiresAt <= new Date()) throw new ConflictException('Adapter Evidence 已过期，不能创建新图片计划');
    const evidence = this.evidenceFromAsset(asset);
    const direction = input.requestedDirection
      ? this.assertDirection(input.requestedDirection)
      : this.recommendedDirection(evidence.allowedDirections);
    if (!evidence.allowedDirections.includes(direction)) throw new ConflictException('该视觉源证据不允许所选图片美化方向');
    const marketing = direction === 'MARKETING_SCENE';
    const providerPlan: VisualProviderServerPlan = {
      templateVersion: marketing ? 'marketing-restage-v1' : 'truth-preserving-v1',
      direction,
      riskProfile: evidence.riskProfile,
      allowedOperations: evidence.allowedOperations,
      protectedRegionVersion: marketing ? 'MARKETING_SCENE_NO_FACT_MAIN_IMAGE' : evidence.protectedRegionVersion,
      ...(marketing ? { presentationPreset: evidence.riskProfile === 'ORGANIC_FACTS' ? 'HARVEST_PLATE' : 'LIFESTYLE_TABLETOP' } : {}),
    };
    const planHash = visualPlanSha256(providerPlan);
    const now = new Date();
    const existing = await this.prisma.visualAgentPlan.findFirst({
      where: {
        tenantId: input.principal.tenantId,
        clientId: input.principal.clientId,
        adapterNamespace: input.principal.adapterNamespace,
        assetId: asset.id,
        planHash,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return this.planResponse(existing);
    const plan = await this.prisma.visualAgentPlan.create({
      data: {
        tenantId: input.principal.tenantId,
        clientId: input.principal.clientId,
        adapterNamespace: input.principal.adapterNamespace,
        assetId: asset.id,
        externalObjectId: asset.externalObjectId,
        externalObjectVersion: asset.externalObjectVersion,
        actorId: asset.actorId,
        billingOwnerType: asset.billingOwnerType,
        billingOwnerId: asset.billingOwnerId,
        riskProfile: evidence.riskProfile,
        recommendedDirection: direction,
        allowedDirections: evidence.allowedDirections,
        allowedOperations: evidence.allowedOperations,
        protectedRegionVersion: evidence.protectedRegionVersion,
        factPolicy: asset.factPolicy as Prisma.InputJsonValue,
        planHash,
        expiresAt: new Date(Math.min(asset.evidenceExpiresAt.getTime(), now.getTime() + PLAN_TTL_MS)),
      },
    });
    return this.planResponse(plan);
  }

  async issueQuote(input: { principal: VisualAgentClientPrincipal; planId: string; rateCode: string; idempotencyKey: string }) {
    const plan = await this.findPlan(input.principal, input.planId);
    if (!plan.recommendedDirection) throw new ConflictException('图片计划没有可执行的美化方向');
    const asset = await this.findAsset(input.principal, plan.assetId);
    const visualPlan = this.providerPlanFromPlan(plan);
    const quote = await this.credits.issueQuote({
      principal: input.principal,
      billingOwnerType: plan.billingOwnerType,
      billingOwnerId: plan.billingOwnerId,
      externalObjectId: plan.externalObjectId,
      actorId: plan.actorId,
      rateCode: input.rateCode,
      sourceAssetRef: asset.id,
      sourceHash: asset.canonicalSha256,
      visualPlanHash: plan.planHash,
      visualPlan: { ...visualPlan, allowedOperations: [...visualPlan.allowedOperations] },
      idempotencyKey: input.idempotencyKey,
      expiresAt: new Date(Math.min(plan.expiresAt.getTime(), Date.now() + PLAN_TTL_MS)),
    });
    const account = await this.credits.getAccount({
      tenantId: input.principal.tenantId,
      billingOwnerType: plan.billingOwnerType,
      billingOwnerId: plan.billingOwnerId,
    });
    return { quote: this.publicQuote(quote), account };
  }

  async confirmTask(input: { principal: VisualAgentClientPrincipal; quoteId: string; quoteHash: string }) {
    const quoteInfo = await this.credits.getQuoteForClient({ principal: input.principal, quoteId: input.quoteId });
    const plan = await this.findPlanForQuote(input.principal, quoteInfo.quote.sourceAssetRef, this.planHashFromQuoteSnapshot(quoteInfo.quote.visualPlanSnapshot));
    const confirmed = await this.credits.confirmAndReserve({
      principal: input.principal,
      billingOwnerType: plan.billingOwnerType,
      billingOwnerId: plan.billingOwnerId,
      externalObjectId: plan.externalObjectId,
      actorId: plan.actorId,
      quoteId: input.quoteId,
      quoteHash: input.quoteHash,
    });
    const reservedQuote = await this.credits.getReservedQuoteForExecution({ principal: input.principal, quoteId: input.quoteId });
    if (reservedQuote.status === VisualCreditQuoteStatus.RECONCILING) {
      return {
        confirmed: {
          quote: this.publicQuote('quote' in confirmed ? confirmed.quote : confirmed),
          account: 'account' in confirmed ? confirmed.account : null,
          ledger: 'ledger' in confirmed ? confirmed.ledger : null,
        },
        execution: this.publicExecution({ quoteId: reservedQuote.id, status: 'RECONCILING' as const }),
      };
    }
    if (reservedQuote.visualAgentInvocationId) {
      return {
        confirmed: {
          quote: this.publicQuote('quote' in confirmed ? confirmed.quote : confirmed),
          account: 'account' in confirmed ? confirmed.account : null,
          ledger: 'ledger' in confirmed ? confirmed.ledger : null,
        },
        execution: this.publicExecution({ quoteId: reservedQuote.id, status: 'ALREADY_BOUND' as const }),
      };
    }
    const asset = await this.findAsset(input.principal, plan.assetId);
    let source: VisualProviderSource;
    try {
      source = await this.toOpaqueProviderSource(await this.upload.getBuffer(asset.objectKey));
    } catch (error) {
      await this.credits.releaseReservedQuote(input.quoteId, 'SOURCE_PREPARATION_FAILED_BEFORE_PROVIDER_SUBMIT');
      throw error;
    }
    const execution = await this.execution.executeReservedQuote({
      principal: input.principal,
      quoteId: input.quoteId,
      sourceAssetRef: asset.id,
      sourceCanonicalHash: asset.canonicalSha256,
      source,
      visualPlan: this.providerPlanFromPlan(plan),
    });
    return {
      confirmed: {
        quote: this.publicQuote('quote' in confirmed ? confirmed.quote : confirmed),
        account: 'account' in confirmed ? confirmed.account : null,
        ledger: 'ledger' in confirmed ? confirmed.ledger : null,
      },
      execution: this.publicExecution(execution),
    };
  }

  async pollTask(input: { principal: VisualAgentClientPrincipal; quoteId: string }) {
    const quoteInfo = await this.credits.getQuoteForClient({ principal: input.principal, quoteId: input.quoteId });
    const existing = await this.prisma.visualAgentCandidate.findFirst({
      where: { quoteId: quoteInfo.quote.id, tenantId: input.principal.tenantId, clientId: input.principal.clientId, adapterNamespace: input.principal.adapterNamespace },
    });
    if (existing) {
      if (quoteInfo.quote.status === VisualCreditQuoteStatus.SETTLED) {
        return { quoteId: quoteInfo.quote.id, status: existing.status, candidate: await this.candidateResponse(existing) };
      }
      if ([VisualCreditQuoteStatus.RESERVED, VisualCreditQuoteStatus.RECONCILING].includes(quoteInfo.quote.status)) {
        try {
          await this.invocations.completeSynchronousVerification(existing.invocationId, existing.provider);
          await this.credits.settleReservedQuote(quoteInfo.quote.id, '已存储的模型候选恢复结算，等待外部 Adapter 显式采用');
          return { quoteId: quoteInfo.quote.id, invocationId: existing.invocationId, status: existing.status, candidate: await this.candidateResponse(existing) };
        } catch (error) {
          await this.movePollingFailureToReconciliation(existing.invocationId, existing.provider, quoteInfo.quote.id, 'PUBLIC_CANDIDATE_FINALIZATION_RECOVERY_FAILED');
          throw error;
        }
      }
      return { quoteId: quoteInfo.quote.id, status: quoteInfo.quote.status, candidate: null };
    }
    const polled = await this.execution.pollForOutput({ principal: input.principal, quoteId: input.quoteId });
    if (polled.status !== 'VERIFYING') return this.publicExecution(polled);
    const plan = await this.findPlanForQuote(input.principal, quoteInfo.quote.sourceAssetRef, this.planHashFromQuoteSnapshot(quoteInfo.quote.visualPlanSnapshot));
    const asset = await this.findAsset(input.principal, plan.assetId);
    try {
      const sourceBuffer = await this.upload.getBuffer(asset.objectKey);
      const managedOutput = await this.managedOutputs.normalize(polled.output);
      const requiresHumanReview = (quoteInfo.quote.rateCardSnapshot as { requiresHumanReview?: unknown } | null)?.requiresHumanReview !== false;
      const verification = await this.verification.verify({
        principal: input.principal,
        externalObjectId: plan.externalObjectId,
        actorId: plan.actorId,
        verificationId: quoteInfo.quote.id,
        sourceBuffer,
        candidateBuffer: managedOutput.buffer,
        allowAutoPass: !requiresHumanReview,
      });
      const candidate = await this.persistCandidate({ principal: input.principal, quoteId: quoteInfo.quote.id, plan, asset, invocationId: polled.invocationId, provider: polled.provider, output: managedOutput, verification });
      await this.invocations.completeSynchronousVerification(polled.invocationId, polled.provider);
      await this.credits.settleReservedQuote(quoteInfo.quote.id, '模型结果已受管存储，等待外部 Adapter 显式采用');
      return { quoteId: quoteInfo.quote.id, invocationId: polled.invocationId, status: candidate.status, candidate: await this.candidateResponse(candidate) };
    } catch (error) {
      await this.movePollingFailureToReconciliation(polled.invocationId, polled.provider, quoteInfo.quote.id, 'PUBLIC_CANDIDATE_PERSISTENCE_OR_SETTLEMENT_FAILED');
      throw error;
    }
  }

  async getTask(principal: VisualAgentClientPrincipal, quoteId: string) {
    const quoteInfo = await this.credits.getQuoteForClient({ principal, quoteId });
    const candidate = await this.prisma.visualAgentCandidate.findFirst({
      where: { quoteId: quoteInfo.quote.id, tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace },
    });
    return {
      quote: this.publicQuote(quoteInfo.quote),
      billingAccount: quoteInfo.billingAccount,
      candidate: candidate && quoteInfo.quote.status === VisualCreditQuoteStatus.SETTLED
        ? await this.candidateResponse(candidate)
        : null,
    };
  }

  async recordAdoptIntent(input: { principal: VisualAgentClientPrincipal; quoteId: string; externalObjectVersion: string; quantityConfirmed: boolean; labelsConfirmed: boolean; factsConfirmed: boolean }) {
    if (!SAFE_ID.test(input.externalObjectVersion) || !input.quantityConfirmed || !input.labelsConfirmed || !input.factsConfirmed) {
      throw new ConflictException('采用意图必须确认对象版本、数量、标签和商品事实');
    }
    const candidate = await this.prisma.visualAgentCandidate.findFirst({
      where: { quoteId: input.quoteId, tenantId: input.principal.tenantId, clientId: input.principal.clientId, adapterNamespace: input.principal.adapterNamespace },
      include: { plan: { select: { externalObjectVersion: true } }, quote: { select: { status: true } } },
    });
    if (!candidate || candidate.quote.status !== VisualCreditQuoteStatus.SETTLED
      || candidate.status !== VisualAgentCandidateStatus.PENDING_REVIEW || candidate.plan.externalObjectVersion !== input.externalObjectVersion) {
      throw new ConflictException('候选当前不能记录采用意图，或外部对象版本已变化');
    }
    const updated = await this.prisma.visualAgentCandidate.updateMany({
      where: { id: candidate.id, status: VisualAgentCandidateStatus.PENDING_REVIEW },
      data: {
        status: VisualAgentCandidateStatus.ADOPT_INTENT,
        adoptionAttestation: { externalObjectVersion: input.externalObjectVersion, quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true } as Prisma.InputJsonValue,
      },
    });
    if (updated.count !== 1) throw new ConflictException('候选采用意图已被其他操作处理');
    return { candidateId: candidate.id, status: VisualAgentCandidateStatus.ADOPT_INTENT, publication: 'EXTERNAL_ADAPTER_MUST_APPLY_EXPLICITLY' };
  }

  async getCredits(principal: VisualAgentClientPrincipal, billingOwnerType: string, billingOwnerId: string) {
    // VisualCreditAccount is intentionally tenant-level for in-process
    // adapters, so a public Client must first prove this billing owner appears
    // in one of its own signed assets. It cannot enumerate another Client's
    // account merely by guessing an owner ID.
    const bound = await this.prisma.visualAgentAsset.findFirst({
      where: {
        tenantId: principal.tenantId,
        clientId: principal.clientId,
        adapterNamespace: principal.adapterNamespace,
        billingOwnerType,
        billingOwnerId,
        status: VisualAgentAssetStatus.AVAILABLE,
      },
      select: { id: true },
    });
    if (!bound) throw new NotFoundException('图片积分账户不存在');
    return this.credits.getAccount({ tenantId: principal.tenantId, billingOwnerType, billingOwnerId });
  }

  private async persistCandidate(input: {
    principal: VisualAgentClientPrincipal;
    quoteId: string;
    plan: any;
    asset: any;
    invocationId: string;
    provider: 'BAILIAN_WAN' | 'BAILIAN_QWEN_IMAGE';
    output: VisualAgentManagedOutput;
    verification: VisualAgentCandidateVerificationReport;
  }) {
    const existing = await this.prisma.visualAgentCandidate.findUnique({ where: { quoteId: input.quoteId } });
    if (existing) return existing;
    const file = { buffer: input.output.buffer, size: input.output.buffer.length, mimetype: input.output.mimeType, originalname: input.output.mimeType === 'image/png' ? 'visual-agent-candidate.png' : 'visual-agent-candidate.webp' } as Express.Multer.File;
    const uploaded = await this.upload.uploadFile(file, 'visual-agent-assets', { preserveQrCodes: true, preserveProviderOutput: true });
    if (!uploaded.canonicalSha256 || !uploaded.width || !uploaded.height || !uploaded.mimeType.startsWith('image/')) {
      await this.upload.deleteFile(uploaded.key);
      throw new ConflictException('模型输出无法规范化为受管候选图片');
    }
    try {
      return await this.prisma.visualAgentCandidate.create({
        data: {
          tenantId: input.principal.tenantId,
          clientId: input.principal.clientId,
          adapterNamespace: input.principal.adapterNamespace,
          quoteId: input.quoteId,
          invocationId: input.invocationId,
          planId: input.plan.id,
          sourceAssetId: input.asset.id,
          objectKey: uploaded.key,
          canonicalSha256: uploaded.canonicalSha256,
          mimeType: uploaded.mimeType,
          byteSize: uploaded.size,
          width: uploaded.width,
          height: uploaded.height,
          provider: input.provider,
          status: input.verification.disposition === 'REJECT' ? VisualAgentCandidateStatus.REJECTED : VisualAgentCandidateStatus.PENDING_REVIEW,
          verificationSummary: { ...input.verification, managedOutput: input.output.audit } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      await this.upload.deleteFile(uploaded.key);
      throw error;
    }
  }

  private async movePollingFailureToReconciliation(invocationId: string, provider: string, quoteId: string, reason: string) {
    await Promise.allSettled([
      this.invocations.moveVerificationToReconciliation(invocationId, provider, reason),
      this.credits.markReconciliation(quoteId, reason),
    ]);
  }

  private async findAsset(principal: VisualAgentClientPrincipal, assetId: string) {
    if (!SAFE_ID.test(assetId)) throw new NotFoundException('视觉源资产不存在');
    const asset = await this.prisma.visualAgentAsset.findFirst({
      where: { id: assetId, tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace, status: VisualAgentAssetStatus.AVAILABLE },
    });
    if (!asset) throw new NotFoundException('视觉源资产不存在');
    return asset;
  }

  private async findPlan(principal: VisualAgentClientPrincipal, planId: string) {
    if (!SAFE_ID.test(planId)) throw new NotFoundException('图片美化计划不存在');
    const plan = await this.prisma.visualAgentPlan.findFirst({
      where: { id: planId, tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace, expiresAt: { gt: new Date() } },
    });
    if (!plan) throw new NotFoundException('图片美化计划不存在或已过期');
    return plan;
  }

  private async findPlanForQuote(principal: VisualAgentClientPrincipal, sourceAssetRef: string, planHash: string) {
    const plan = await this.prisma.visualAgentPlan.findFirst({
      where: {
        tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace,
        assetId: sourceAssetRef, planHash, expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!plan) throw new ConflictException('报价关联的通用图片计划已过期或不属于当前 Client');
    return plan;
  }

  private async assetResponse(asset: any, includePreview: boolean) {
    const preview = includePreview ? await this.upload.createPrivateAccessUrl(asset.objectKey, 300) : null;
    return {
      id: asset.id, externalObjectId: asset.externalObjectId, externalObjectVersion: asset.externalObjectVersion,
      canonicalSha256: asset.canonicalSha256, mimeType: asset.mimeType, byteSize: asset.byteSize, width: asset.width, height: asset.height,
      status: asset.status, preview: preview ? { displayUrl: preview.url, expiresAt: preview.expiresAt } : null,
    };
  }

  private planResponse(plan: any) {
    return {
      id: plan.id, assetId: plan.assetId, riskProfile: plan.riskProfile, recommendedDirection: plan.recommendedDirection,
      allowedDirections: plan.allowedDirections, allowedOperations: plan.allowedOperations, expiresAt: plan.expiresAt,
    };
  }

  private async candidateResponse(candidate: any) {
    const preview = await this.upload.createPrivateAccessUrl(candidate.objectKey, 300);
    return {
      id: candidate.id, status: candidate.status, mimeType: candidate.mimeType,
      width: candidate.width, height: candidate.height, displayUrl: preview.url, expiresAt: preview.expiresAt,
      verification: candidate.verificationSummary ?? null,
    };
  }

  private providerPlanFromPlan(plan: { recommendedDirection: string | null; riskProfile: string; allowedOperations: string[]; protectedRegionVersion: string }): VisualProviderServerPlan {
    if (!plan.recommendedDirection) throw new ConflictException('图片计划没有可执行方向');
    const direction = this.assertDirection(plan.recommendedDirection);
    const riskProfile = this.assertRisk(plan.riskProfile);
    const marketing = direction === 'MARKETING_SCENE';
    return {
      templateVersion: marketing ? 'marketing-restage-v1' : 'truth-preserving-v1',
      direction,
      riskProfile,
      allowedOperations: plan.allowedOperations.map((value) => this.assertOperation(value)),
      protectedRegionVersion: marketing ? 'MARKETING_SCENE_NO_FACT_MAIN_IMAGE' : this.assertId(plan.protectedRegionVersion, '保护区域版本'),
      ...(marketing ? { presentationPreset: riskProfile === 'ORGANIC_FACTS' ? 'HARVEST_PLATE' : 'LIFESTYLE_TABLETOP' } : {}),
    };
  }

  private planHashFromQuoteSnapshot(snapshot: unknown) {
    const value = snapshot as { direction?: unknown; riskProfile?: unknown; allowedOperations?: unknown; protectedRegionVersion?: unknown; presentationPreset?: unknown } | null;
    if (!value || !Array.isArray(value.allowedOperations)) throw new ConflictException('报价缺少可验证的视觉计划快照');
    const direction = this.assertDirection(value.direction);
    const riskProfile = this.assertRisk(value.riskProfile);
    const marketing = direction === 'MARKETING_SCENE';
    return visualPlanSha256({
      templateVersion: marketing ? 'marketing-restage-v1' : 'truth-preserving-v1',
      direction,
      riskProfile,
      allowedOperations: this.assertOperations(value.allowedOperations),
      protectedRegionVersion: this.assertId(value.protectedRegionVersion, '保护区域版本'),
      ...(marketing ? { presentationPreset: riskProfile === 'ORGANIC_FACTS' ? 'HARVEST_PLATE' : 'LIFESTYLE_TABLETOP' } : {}),
    });
  }

  private evidenceFromAsset(asset: { riskProfile?: never; factPolicy: unknown; evidenceKeyId: string; externalObjectId: string; externalObjectVersion: string; actorId: string; billingOwnerType: string; billingOwnerId: string }) {
    const factPolicy = asset.factPolicy as { riskProfile?: unknown; allowedDirections?: unknown; allowedOperations?: unknown; protectedRegionVersion?: unknown } | null;
    if (!factPolicy) throw new ConflictException('视觉源资产缺少受信事实策略');
    return {
      riskProfile: this.assertRisk(factPolicy.riskProfile),
      allowedDirections: this.assertDirections(factPolicy.allowedDirections),
      allowedOperations: this.assertOperations(factPolicy.allowedOperations),
      protectedRegionVersion: this.assertId(factPolicy.protectedRegionVersion, '保护区域版本'),
    };
  }

  private parseAndVerifyEvidence(principal: VisualAgentClientPrincipal, evidenceJson: string, signature: string, sourceBuffer: Buffer): AdapterEvidenceEnvelope {
    let evidence: AdapterEvidenceEnvelope;
    try { evidence = JSON.parse(evidenceJson) as AdapterEvidenceEnvelope; } catch { throw new BadRequestException('Adapter Evidence 必须是合法 JSON'); }
    if (!evidence || evidence.version !== 'adapter-evidence-v1' || !SAFE_ID.test(evidence.keyId) || !SAFE_ID.test(evidence.nonce)
      || !SAFE_ID.test(evidence.externalObjectId) || !SAFE_ID.test(evidence.externalObjectVersion) || !SAFE_ID.test(evidence.actorId)
      || !SAFE_ID.test(evidence.billingOwnerType) || !SAFE_ID.test(evidence.billingOwnerId) || !SHA256.test(evidence.sourceSha256)
      || !evidence.factPolicy || typeof evidence.factPolicy !== 'object') {
      throw new BadRequestException('Adapter Evidence 字段不合法');
    }
    evidence.riskProfile = this.assertRisk(evidence.riskProfile);
    evidence.allowedDirections = this.assertDirections(evidence.allowedDirections);
    evidence.allowedOperations = this.assertOperations(evidence.allowedOperations);
    evidence.protectedRegionVersion = this.assertId(evidence.protectedRegionVersion, '保护区域版本');
    const issuedAt = new Date(evidence.issuedAt);
    const expiresAt = new Date(evidence.expiresAt);
    const now = Date.now();
    if (!Number.isFinite(issuedAt.getTime()) || !Number.isFinite(expiresAt.getTime()) || issuedAt.getTime() > now + 30_000
      || expiresAt.getTime() <= now || expiresAt.getTime() - issuedAt.getTime() > EVIDENCE_MAX_AGE_MS) {
      throw new BadRequestException('Adapter Evidence 时间窗口无效');
    }
    const sourceSha256 = createHash('sha256').update(sourceBuffer).digest('hex');
    if (!timingSafeEqual(Buffer.from(sourceSha256, 'hex'), Buffer.from(evidence.sourceSha256, 'hex'))) {
      throw new ConflictException('Adapter Evidence 与上传源图片摘要不匹配');
    }
    if (!/^[a-f0-9]{64}$/.test(signature)) throw new BadRequestException('缺少有效的 Adapter Evidence 签名');
    const secret = this.evidenceSecret(principal, evidence.keyId);
    const expected = createHmac('sha256', secret).update(this.stableJson(evidence)).digest('hex');
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) {
      throw new ConflictException('Adapter Evidence 签名无效');
    }
    // Persist only Core-relevant, verified facts. Neither the raw HMAC nor an
    // external callback URL is retained in the asset record.
    evidence.factPolicy = {
      ...evidence.factPolicy,
      riskProfile: evidence.riskProfile,
      allowedDirections: evidence.allowedDirections,
      allowedOperations: evidence.allowedOperations,
      protectedRegionVersion: evidence.protectedRegionVersion,
    };
    return evidence;
  }

  private evidenceSecret(principal: VisualAgentClientPrincipal, keyId: string) {
    const clean = (value: string) => value.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
    const name = `AI_VISUAL_AGENT_ADAPTER_EVIDENCE_SECRET_${clean(principal.clientId)}_${clean(keyId)}`;
    const value = this.config.get<string>(name)?.trim();
    if (!value || value.length < 32) throw new ServiceUnavailableException('当前 Client 尚未配置可验证的 Adapter Evidence 签名密钥');
    return value;
  }

  private scopeNonce(principal: VisualAgentClientPrincipal, nonce: string) {
    return { tenantId: principal.tenantId, clientId: principal.clientId, adapterNamespace: principal.adapterNamespace, evidenceNonce: nonce };
  }

  private recommendedDirection(directions: VisualProviderDirection[]) {
    return directions.includes('PRESERVE_REAL_SCENE') ? 'PRESERVE_REAL_SCENE' as const : directions[0];
  }

  private assertDirections(value: unknown): VisualProviderDirection[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 4) throw new BadRequestException('Adapter Evidence 图片方向不合法');
    const directions = value.map((item) => this.assertDirection(item));
    if (new Set(directions).size !== directions.length) throw new BadRequestException('Adapter Evidence 图片方向不能重复');
    return directions;
  }

  private assertOperations(value: unknown): VisualProviderAllowedOperation[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 7) throw new BadRequestException('Adapter Evidence 图片操作不合法');
    const operations = value.map((item) => this.assertOperation(item));
    if (new Set(operations).size !== operations.length) throw new BadRequestException('Adapter Evidence 图片操作不能重复');
    return operations;
  }

  private assertDirection(value: unknown): VisualProviderDirection {
    if (typeof value !== 'string' || !DIRECTIONS.has(value as VisualProviderDirection)) throw new BadRequestException('图片美化方向不合法');
    return value as VisualProviderDirection;
  }

  private assertRisk(value: unknown): VisualProviderRiskProfile {
    if (typeof value !== 'string' || !RISKS.has(value as VisualProviderRiskProfile)) throw new BadRequestException('图片事实风险档不合法');
    return value as VisualProviderRiskProfile;
  }

  private assertOperation(value: unknown): VisualProviderAllowedOperation {
    if (typeof value !== 'string' || !OPERATIONS.has(value as VisualProviderAllowedOperation)) throw new BadRequestException('图片美化操作不合法');
    return value as VisualProviderAllowedOperation;
  }

  private assertId(value: unknown, label: string) {
    if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new BadRequestException(`${label}不合法`);
    return value;
  }

  private async toOpaqueProviderSource(buffer: Buffer): Promise<VisualProviderSource> {
    try {
      const flattened = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
        .rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
      return { buffer: flattened, mimeType: 'image/jpeg', normalizedVersion: 'normalized-rgba-srgb-v1', opaque: true };
    } catch {
      throw new ConflictException('视觉源图片无法安全转换为模型输入');
    }
  }

  private publicQuote(quote: any) {
    const rate = quote.rateCardSnapshot as { displayName?: unknown; description?: unknown; candidateCount?: unknown; creditCost?: unknown; requiresHumanReview?: unknown } | null;
    return {
      id: quote.id,
      status: quote.status,
      externalObjectId: quote.externalObjectId,
      creditCost: quote.creditCost,
      candidateCount: quote.candidateCount,
      offer: {
        displayName: typeof rate?.displayName === 'string' ? rate.displayName : 'AI 图片美化',
        description: typeof rate?.description === 'string' ? rate.description : '',
        requiresHumanReview: rate?.requiresHumanReview !== false,
      },
      quoteHash: quote.quoteHash,
      expiresAt: quote.expiresAt,
      confirmedAt: quote.confirmedAt,
      settledAt: quote.settledAt,
      releasedAt: quote.releasedAt,
      failureReason: quote.failureReason,
    };
  }

  private publicExecution(execution: { quoteId: string; status: string }) {
    return { quoteId: execution.quoteId, status: execution.status };
  }

  private stableJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => this.stableJson(item)).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${this.stableJson(object[key])}`).join(',')}}`;
  }
}
