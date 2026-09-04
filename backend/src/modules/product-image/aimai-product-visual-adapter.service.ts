import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ProductImageOptimizationStatus, ProductVisualMode, ProductVisualRiskProfile, SellerMediaAssetStatus, VisualCreditQuoteStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { VisualAgentClientKeyService } from '../visual-agent/visual-agent-client-key.service';
import { VisualAgentTrustedAdapterService } from '../visual-agent/visual-agent-trusted-adapter.service';
import { VisualCreditService } from '../visual-agent/visual-credit.service';
import { VisualPaidExecutionService } from '../visual-agent/visual-paid-execution.service';
import { VisualAgentInvocationService } from '../visual-agent/visual-agent-invocation.service';
import { visualPlanSha256 } from '../visual-agent/visual-agent-integrity';
import { VisualProviderAllowedOperation, VisualProviderDirection, VisualProviderRiskProfile, VisualProviderServerPlan, VisualProviderSource } from '../visual-agent/providers/visual-image-edit.provider';
import { UploadService } from '../upload/upload.service';
import { ProductPaidVisualCandidateService } from './product-paid-visual-candidate.service';
import { ProductImageCandidateLocalVerificationService } from './product-image-candidate-local-verification.service';
import { ProductImageCandidateOcrVerificationService } from './product-image-candidate-ocr-verification.service';
import { productVisualFactHash } from './product-visual-fact-hash';
import { ProductVisualTestAccessService } from './product-visual-test-access.service';
import { AIMAI_VISUAL_ADAPTER_TYPE, AIMAI_VISUAL_CLIENT_ID, AIMAI_VISUAL_TENANT_ID } from './aimai-product-visual.constants';
const sharp = require('sharp') as typeof import('sharp').default;

export { AIMAI_VISUAL_ADAPTER_TYPE, AIMAI_VISUAL_CLIENT_ID, AIMAI_VISUAL_TENANT_ID } from './aimai-product-visual.constants';
const QUOTE_TTL_MS = 15 * 60_000;
const EXECUTABLE_RATE_MODELS = new Set(['BAILIAN_WAN_STANDARD', 'BAILIAN_WAN_PRO', 'BAILIAN_QWEN_IMAGE', 'BAILIAN_QWEN_IMAGE_PRO']);

type IssueQuoteInput = {
  companyId: string;
  staffId: string;
  productId: string;
  sourceAssetId: string;
  planId: string;
  direction: ProductVisualMode;
  rateCode: string;
  idempotencyKey: string;
};

/**
 * 爱买买 is an in-process domain Adapter. It translates product/media facts to
 * Core scope and fixed Provider operations; neither seller browser nor a
 * Client Key can choose arbitrary prompt text, Provider fields or billing IDs.
 */
@Injectable()
export class AimaiProductVisualAdapterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: VisualAgentClientKeyService,
    private readonly trusted: VisualAgentTrustedAdapterService,
    private readonly credits: VisualCreditService,
    private readonly execution: VisualPaidExecutionService,
    private readonly uploadService: UploadService,
    private readonly invocations: VisualAgentInvocationService,
    private readonly candidates: ProductPaidVisualCandidateService,
    private readonly localVerification: ProductImageCandidateLocalVerificationService,
    private readonly ocrVerification: ProductImageCandidateOcrVerificationService,
    private readonly testAccess: ProductVisualTestAccessService,
  ) {}

  async issueQuote(input: IssueQuoteInput) {
    const [principal, plan] = await Promise.all([
      this.resolveAimaiPrincipal(),
      this.prisma.productVisualPlan.findFirst({
        where: {
          id: input.planId,
          companyId: input.companyId,
          productId: input.productId,
          sourceAssetId: input.sourceAssetId,
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          sourceHash: true,
          riskProfile: true,
          allowedModes: true,
          protectedRegionVersion: true,
          sceneAnalysis: true,
        },
      }),
    ]);
    if (!plan) throw new ConflictException('图片美化计划已过期、已变更或不属于当前商品图片');
    if (!plan.allowedModes.includes(input.direction)) {
      throw new ConflictException('当前商品风险档不允许使用所选图片美化方向');
    }
    const [source, product] = await Promise.all([
      this.prisma.sellerMediaAsset.findFirst({
        where: {
          id: input.sourceAssetId,
          companyId: input.companyId,
          purpose: 'PRODUCT_IMAGE',
          status: SellerMediaAssetStatus.AVAILABLE,
          canonicalSha256: plan.sourceHash,
          deletedAt: null,
        },
        select: { id: true, canonicalSha256: true },
      }),
      this.prisma.product.findFirst({
        where: { id: input.productId, companyId: input.companyId },
        select: { id: true, title: true, subtitle: true, description: true, categoryId: true, updatedAt: true, mediaVersion: true },
      }),
    ]);
    if (!source || !product) throw new NotFoundException('商品或原图已变化，不能创建图片美化报价');
    const factVersion = this.planFactVersion(plan.sceneAnalysis);
    if (!factVersion || productVisualFactHash(product) !== factVersion) {
      throw new ConflictException('商品标题、分类或图片版本已变化，请重新查看美化建议');
    }

    const eligibleCards = await this.listEligibleRateCards({
      companyId: input.companyId,
      staffId: input.staffId,
      productId: input.productId,
      sourceAssetId: input.sourceAssetId,
      planId: input.planId,
      direction: input.direction,
    });
    if (!eligibleCards.some((card) => card.code === input.rateCode)) {
      throw new ServiceUnavailableException('当前测试授权未包含所选图片美化报价');
    }

    const providerPlan = this.toProviderPlan(plan.riskProfile, input.direction, plan.protectedRegionVersion, factVersion);
    const visualPlanHash = visualPlanSha256(providerPlan);
    const quote = await this.trusted.issueQuoteFromTrustedAdapter({
      principal,
      adapterType: AIMAI_VISUAL_ADAPTER_TYPE,
      billingOwner: { billingOwnerType: 'COMPANY', billingOwnerId: input.companyId },
      externalObjectId: product.id,
      actorId: input.staffId,
      rateCode: input.rateCode,
      sourceAssetRef: source.id,
      sourceHash: source.canonicalSha256,
      visualPlanHash,
      visualPlan: {
        direction: providerPlan.direction,
        riskProfile: providerPlan.riskProfile,
        protectedRegionVersion: providerPlan.protectedRegionVersion,
        adapterFactVersion: providerPlan.adapterFactVersion,
        allowedOperations: [...providerPlan.allowedOperations],
        presentationPreset: providerPlan.presentationPreset,
      },
      idempotencyKey: input.idempotencyKey,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    });
    const account = await this.credits.getAccount({
      tenantId: principal.tenantId,
      billingOwnerType: 'COMPANY',
      billingOwnerId: input.companyId,
    });
    return { quote, account, providerPlan: this.toSellerPlan(providerPlan) };
  }

  async confirmQuote(input: {
    companyId: string;
    staffId: string;
    productId: string;
    quoteId: string;
    quoteHash: string;
  }) {
    const principal = await this.resolveAimaiPrincipal();
    const access = await this.credits.getQuoteForClient({ principal, quoteId: input.quoteId });
    this.assertMerchantQuoteAccess(access, input.companyId, input.productId);
    const rateCode = (access.quote.rateCardSnapshot as { code?: unknown } | null)?.code;
    if (typeof rateCode === 'string' && rateCode.startsWith('STAGING_AUTO_') && !this.testAccess.isAllMerchantMode()) {
      if (access.quote.status === VisualCreditQuoteStatus.RESERVED && !access.quote.providerSubmissionStarted) {
        const released = await this.credits.releaseUnboundReservedQuote(input.quoteId, 'ALL_TEST_MERCHANT_ACCESS_DISABLED');
        if ((released as { releaseSkipped?: boolean }).releaseSkipped) {
          return this.trusted.confirmQuoteFromTrustedAdapter({
            principal,
            adapterType: AIMAI_VISUAL_ADAPTER_TYPE,
            billingOwner: { billingOwnerType: 'COMPANY', billingOwnerId: input.companyId },
            externalObjectId: input.productId,
            actorId: input.staffId,
            quoteId: input.quoteId,
            quoteHash: input.quoteHash,
          });
        }
      }
      if (!access.quote.providerSubmissionStarted) {
        throw new ServiceUnavailableException('全部测试商家图片美化已暂停，本次不会调用模型');
      }
    }
    return this.trusted.confirmQuoteFromTrustedAdapter({
      principal,
      adapterType: AIMAI_VISUAL_ADAPTER_TYPE,
      billingOwner: { billingOwnerType: 'COMPANY', billingOwnerId: input.companyId },
      externalObjectId: input.productId,
      actorId: input.staffId,
      quoteId: input.quoteId,
      quoteHash: input.quoteHash,
    });
  }

  async confirmAndExecute(input: {
    companyId: string;
    staffId: string;
    productId: string;
    quoteId: string;
    quoteHash: string;
  }) {
    const confirmed = await this.confirmQuote(input);
    const principal = await this.resolveAimaiPrincipal();
    const quote = await this.credits.getReservedQuoteForExecution({ principal, quoteId: input.quoteId });
    if (quote.status === VisualCreditQuoteStatus.RECONCILING) {
      return { confirmed, execution: { quoteId: quote.id, invocationId: quote.visualAgentInvocationId, status: 'RECONCILING' as const } };
    }
    if (quote.visualAgentInvocationId) {
      return { confirmed, execution: { quoteId: quote.id, invocationId: quote.visualAgentInvocationId, status: 'ALREADY_BOUND' as const } };
    }
    const source = await this.prisma.sellerMediaAsset.findFirst({
      where: {
        id: quote.sourceAssetRef,
        companyId: input.companyId,
        purpose: 'PRODUCT_IMAGE',
        status: SellerMediaAssetStatus.AVAILABLE,
        canonicalSha256: quote.sourceHash,
        deletedAt: null,
      },
      select: { id: true, objectKey: true, canonicalSha256: true },
    });
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, companyId: input.companyId },
      select: { id: true, title: true, subtitle: true, description: true, categoryId: true, updatedAt: true, mediaVersion: true },
    });
    if (!source || !product) {
      await this.credits.releaseReservedQuote(quote.id, 'SOURCE_OR_PRODUCT_CHANGED_BEFORE_EXECUTION');
      throw new NotFoundException('商品原图已变化，已释放本次图片美化额度');
    }
    const providerPlan = this.providerPlanFromQuoteSnapshot(quote.visualPlanSnapshot);
    if (!providerPlan.adapterFactVersion || productVisualFactHash(product) !== providerPlan.adapterFactVersion) {
      await this.credits.releaseReservedQuote(quote.id, 'PRODUCT_FACTS_CHANGED_BEFORE_PROVIDER_SUBMIT');
      throw new ConflictException('商品资料已变化，已释放本次图片积分；请重新查看美化建议');
    }
    let providerSource: VisualProviderSource;
    try {
      const sourceBuffer = await this.uploadService.getBuffer(source.objectKey);
      providerSource = await this.toOpaqueProviderSource(sourceBuffer);
    } catch (error) {
      await this.credits.releaseReservedQuote(quote.id, 'SOURCE_PREPARATION_FAILED_BEFORE_PROVIDER_SUBMIT');
      throw error;
    }
    const execution = await this.execution.executeReservedQuote({
      principal,
      quoteId: quote.id,
      sourceAssetRef: source.id,
      sourceCanonicalHash: source.canonicalSha256,
      source: providerSource,
      visualPlan: providerPlan,
    });
    return { confirmed, execution };
  }

  async getAccount(companyId: string) {
    const principal = await this.resolveAimaiPrincipal();
    return this.credits.getAccount({
      tenantId: principal.tenantId,
      billingOwnerType: 'COMPANY',
      billingOwnerId: companyId,
    });
  }

  async listEligibleRateCards(input: {
    companyId: string;
    staffId: string;
    productId: string;
    sourceAssetId: string;
    planId: string;
    direction: ProductVisualMode;
  }) {
    const [principal, plan] = await Promise.all([
      this.resolveAimaiPrincipal(),
      this.prisma.productVisualPlan.findFirst({
        where: {
          id: input.planId,
          companyId: input.companyId,
          productId: input.productId,
          sourceAssetId: input.sourceAssetId,
          expiresAt: { gt: new Date() },
        },
        select: { riskProfile: true, allowedModes: true },
      }),
    ]);
    if (!plan || !plan.allowedModes.includes(input.direction)) {
      throw new ConflictException('当前图片计划不允许查看该美化方向的报价');
    }
    const attached = await this.prisma.product.findFirst({
      where: { id: input.productId, companyId: input.companyId },
      select: { id: true },
    });
    if (!attached) throw new NotFoundException('商品原图已变化，不能查看图片美化报价');
    const cards = await this.credits.listRateCards({
      tenantId: principal.tenantId,
      clientId: principal.clientId,
      adapterNamespace: principal.adapterNamespace,
    });
    const compatible = cards
      .filter((card) => card.status === 'ACTIVE'
        && (!card.code.startsWith('STAGING_AUTO_') || this.testAccess.isAllMerchantMode())
        && card.candidateCount === 1
        && EXECUTABLE_RATE_MODELS.has(card.modelProfile)
        && card.allowedDirections.includes(input.direction)
        && card.allowedRiskProfiles.includes(plan.riskProfile)
        && (input.direction === ProductVisualMode.MARKETING_SCENE
          ? card.candidateRole === 'MARKETING_IMAGE'
          : card.candidateRole !== 'MARKETING_IMAGE'));
    const ready = await Promise.all(compatible.map(async (card) => {
      const route = this.routeForModelProfile(card.modelProfile);
      if (!route || !this.execution.isModelProfileAvailable(card.modelProfile)) return null;
      const hasBudget = await this.invocations.hasActiveBudgetCoverage({
        tenantId: principal.tenantId,
        ownerClientId: principal.clientId,
        adapterNamespace: principal.adapterNamespace,
        externalObjectId: input.productId,
        actorId: input.staffId,
        provider: route.provider,
        model: route.model,
        visualMode: input.direction,
        expectedPolicyVersions: {
          EXTERNAL_OBJECT: this.ratePolicyVersion(card.code),
          ACTOR: this.ratePolicyVersion(card.code),
        },
      });
      return hasBudget ? card : null;
    }));
    return ready.filter((card): card is NonNullable<typeof card> => !!card).map((card) => ({
      code: card.code,
      displayName: card.displayName,
      description: card.description,
      outputSpec: card.outputSpec,
      candidateCount: card.candidateCount,
      creditCost: card.creditCost,
      requiresHumanReview: card.requiresHumanReview,
      candidateRole: card.candidateRole,
    }));
  }

  async ensureDefaultTestAccess(input: {
    companyId: string;
    staffId: string;
    productId: string;
    sourceAssetId: string;
    planId: string;
    direction: ProductVisualMode;
  }) {
    if (!this.testAccess.isAllMerchantMode()) return { enabled: false, created: false };
    const plan = await this.prisma.productVisualPlan.findFirst({
      where: {
        id: input.planId,
        companyId: input.companyId,
        productId: input.productId,
        sourceAssetId: input.sourceAssetId,
        expiresAt: { gt: new Date() },
      },
      select: { allowedModes: true },
    });
    if (!plan || !plan.allowedModes.includes(input.direction)) {
      throw new ConflictException('当前图片计划不允许开通该美化方向');
    }
    const access = await this.testAccess.ensureDefaultAccess({
      companyId: input.companyId,
      staffId: input.staffId,
      productId: input.productId,
      visualMode: input.direction,
    });
    return { enabled: true, created: true, access };
  }

  async getQuote(companyId: string, productId: string, quoteId: string) {
    const principal = await this.resolveAimaiPrincipal();
    const result = await this.credits.getQuoteForClient({ principal, quoteId });
    this.assertMerchantQuoteAccess(result, companyId, productId);
    const optimization = await this.prisma.productImageOptimization.findFirst({
      where: { companyId, productId, idempotencyKey: `paid-quote:${quoteId}` },
      select: { id: true, status: true },
    });
    return { ...result, optimization };
  }

  async pollAndPersistCandidate(input: {
    companyId: string;
    staffId: string;
    productId: string;
    quoteId: string;
  }) {
    const completed = await this.findTerminalPaidOptimization(input.companyId, input.productId, input.quoteId);
    if (completed) return this.toTerminalPollResult(input.quoteId, completed);
    const principal = await this.resolveAimaiPrincipal();
    const access = await this.credits.getQuoteForClient({ principal, quoteId: input.quoteId });
    this.assertMerchantQuoteAccess(access, input.companyId, input.productId);
    const pending = await this.candidates.getPendingVerification(input.companyId, input.quoteId);
    if (pending) {
      if (pending.provider !== 'BAILIAN_WAN' && pending.provider !== 'BAILIAN_QWEN_IMAGE') {
        throw new ConflictException('付费图片候选缺少可恢复的模型服务标识');
      }
      const recoveryQuote = await this.credits.getQuoteForCandidateFinalization({ principal, quoteId: input.quoteId });
      if (!recoveryQuote.visualAgentInvocationId) throw new ConflictException('付费图片候选缺少可恢复的模型调用');
      return this.finalizePersistedCandidate(input, recoveryQuote, pending, recoveryQuote.visualAgentInvocationId, pending.provider);
    }
    const polled = await this.execution.pollForOutput({ principal, quoteId: input.quoteId });
    if (polled.status !== 'VERIFYING') return polled;
    let quote;
    try {
      quote = await this.credits.getReservedQuoteForExecution({ principal, quoteId: input.quoteId });
    } catch (error) {
      // A second browser poll can arrive after the first poll has persisted the
      // candidate and settled the quote. Return the terminal optimization
      // instead of misreporting the now-settled quote as invalid.
      const settled = await this.findTerminalPaidOptimization(input.companyId, input.productId, input.quoteId);
      if (settled) return this.toTerminalPollResult(input.quoteId, settled);
      throw error;
    }
    let candidate;
    try {
      candidate = await this.candidates.persistPendingVerification({
        companyId: input.companyId,
        staffId: input.staffId,
        productId: input.productId,
        sourceAssetId: quote.sourceAssetRef,
        sourceCanonicalHash: quote.sourceHash,
        provider: polled.provider,
        quote,
        output: polled.output,
      });
    } catch (error) {
      await Promise.allSettled([
        this.invocations.moveVerificationToReconciliation(polled.invocationId, polled.provider, 'CANDIDATE_PERSISTENCE_OR_SETTLEMENT_FAILED'),
        this.credits.markReconciliation(quote.id, 'CANDIDATE_PERSISTENCE_OR_SETTLEMENT_FAILED'),
      ]);
      throw error;
    }
    return this.finalizePersistedCandidate(input, quote, candidate, polled.invocationId, polled.provider);
  }

  private async finalizePersistedCandidate(
    input: { companyId: string; staffId: string; productId: string; quoteId: string },
    quote: any,
    candidate: { id: string; candidateAssetId?: string | null; candidateObjectKey?: string | null },
    invocationId: string,
    provider: 'BAILIAN_WAN' | 'BAILIAN_QWEN_IMAGE',
  ) {
    try {
      if (!candidate.candidateObjectKey) throw new ConflictException('付费图片候选缺少受管存储证据');
      const source = await this.prisma.sellerMediaAsset.findFirst({
        where: {
          id: quote.sourceAssetRef,
          companyId: input.companyId,
          purpose: 'PRODUCT_IMAGE',
          status: SellerMediaAssetStatus.AVAILABLE,
          canonicalSha256: quote.sourceHash,
          deletedAt: null,
        },
        select: { objectKey: true },
      });
      if (!source) throw new NotFoundException('商品原图已变化，不能完成候选事实验证');
      const [sourceBuffer, candidateBuffer] = await Promise.all([
        this.uploadService.getBuffer(source.objectKey),
        this.uploadService.getBuffer(candidate.candidateObjectKey),
      ]);
      const local = await this.localVerification.verify(sourceBuffer, candidateBuffer);
      const requiresHumanReview = (quote.rateCardSnapshot as { requiresHumanReview?: unknown } | null)?.requiresHumanReview !== false;
      const ocr = await this.ocrVerification.verify({
        companyId: input.companyId,
        staffId: input.staffId,
        productId: input.productId,
        quoteId: quote.id,
        sourceBuffer,
        candidateBuffer,
        allowAutoPass: !requiresHumanReview && local.disposition !== 'REJECT',
      });
      await this.invocations.completeSynchronousVerification(invocationId, provider);
      await this.credits.settleReservedQuote(quote.id, '模型结果已受管存储，等待商家确认采用');
      const optimization = await this.candidates.finalizeVerification(input.companyId, quote.id, { local, ocr }, requiresHumanReview);
      return {
        quoteId: quote.id,
        invocationId,
        candidate,
        optimizationId: optimization.id,
        verification: optimization.verification,
        status: optimization.status === ProductImageOptimizationStatus.REJECTED
          ? 'REJECTED' as const
          : 'SUCCEEDED' as const,
      };
    } catch (error) {
      await Promise.allSettled([
        this.invocations.moveVerificationToReconciliation(invocationId, provider, 'CANDIDATE_PERSISTENCE_OR_SETTLEMENT_FAILED'),
        this.credits.markReconciliation(quote.id, 'CANDIDATE_PERSISTENCE_OR_SETTLEMENT_FAILED'),
      ]);
      throw error;
    }
  }

  private async findTerminalPaidOptimization(companyId: string, productId: string, quoteId: string) {
    return this.prisma.productImageOptimization.findFirst({
      where: {
        companyId,
        productId,
        idempotencyKey: `paid-quote:${quoteId}`,
        status: { in: [
          ProductImageOptimizationStatus.SUCCEEDED,
          ProductImageOptimizationStatus.REJECTED,
          ProductImageOptimizationStatus.ADOPTED,
        ] },
      },
      select: { id: true, status: true },
    });
  }

  private assertMerchantQuoteAccess(
    result: {
      billingAccount: { billingOwnerType: string; billingOwnerId: string };
      quote: { externalObjectId: string };
    },
    companyId: string,
    productId: string,
  ) {
    if (result.billingAccount.billingOwnerType !== 'COMPANY'
      || result.billingAccount.billingOwnerId !== companyId
      || result.quote.externalObjectId !== productId) {
      throw new NotFoundException('图片美化报价不存在');
    }
  }

  private toTerminalPollResult(
    quoteId: string,
    optimization: { id: string; status: ProductImageOptimizationStatus },
  ) {
    return {
      quoteId,
      optimizationId: optimization.id,
      status: optimization.status === ProductImageOptimizationStatus.REJECTED
        ? 'REJECTED' as const
        : 'SUCCEEDED' as const,
    };
  }

  private toProviderPlan(
    riskProfile: ProductVisualRiskProfile,
    direction: ProductVisualMode,
    protectedRegionVersion: string,
    adapterFactVersion: string,
  ): VisualProviderServerPlan {
    if (riskProfile === ProductVisualRiskProfile.RETAKE_REQUIRED
      || (riskProfile === ProductVisualRiskProfile.MARKETING_ONLY && direction !== ProductVisualMode.MARKETING_SCENE)) {
      throw new ConflictException('当前图片风险档不能生成可付费的商品主图候选');
    }
    const operations = this.allowedOperations(riskProfile, direction);
    if (operations.length === 0) throw new ConflictException('当前风险档没有可安全执行的图片美化操作');
    return {
      templateVersion: direction === ProductVisualMode.MARKETING_SCENE ? 'marketing-restage-v1' : 'truth-preserving-v1',
      direction,
      riskProfile,
      allowedOperations: operations,
      protectedRegionVersion: direction === ProductVisualMode.MARKETING_SCENE ? 'MARKETING_SCENE_NO_FACT_MAIN_IMAGE' : protectedRegionVersion,
      adapterFactVersion,
      ...(direction === ProductVisualMode.MARKETING_SCENE ? {
        presentationPreset: riskProfile === ProductVisualRiskProfile.ORGANIC_FACTS ? 'HARVEST_PLATE' as const : 'LIFESTYLE_TABLETOP' as const,
      } : {}),
    };
  }

  private allowedOperations(
    riskProfile: ProductVisualRiskProfile,
    direction: ProductVisualMode,
  ): VisualProviderAllowedOperation[] {
    if (riskProfile === ProductVisualRiskProfile.STRICT_FACTS) {
      return direction === ProductVisualMode.PRESERVE_REAL_SCENE
        ? ['LIGHTING']
        : direction === ProductVisualMode.CATALOG_STUDIO
          ? ['LIGHTING', 'COMPOSITION', 'BACKGROUND_SIMPLIFY']
          : [];
    }
    if (riskProfile === ProductVisualRiskProfile.CONSERVATIVE_FACTS) {
      return direction === ProductVisualMode.PRESERVE_REAL_SCENE
        ? ['LIGHTING', 'DEGLARE', 'COMPOSITION', 'BACKGROUND_SIMPLIFY']
        : direction === ProductVisualMode.CATALOG_STUDIO
          ? ['LIGHTING', 'DEGLARE', 'COMPOSITION', 'BACKGROUND_SIMPLIFY', 'BACKGROUND_REPLACE']
          : direction === ProductVisualMode.PRODUCT_RETOUCH
            ? ['LIGHTING', 'DEGLARE', 'COMPOSITION']
            : [];
    }
    if (riskProfile === ProductVisualRiskProfile.ORGANIC_FACTS) {
      return direction === ProductVisualMode.PRESERVE_REAL_SCENE
        ? ['LIGHTING', 'WHITE_BALANCE', 'DENOISE', 'COMPOSITION', 'BACKGROUND_SIMPLIFY']
        : direction === ProductVisualMode.CATALOG_STUDIO
          ? ['LIGHTING', 'WHITE_BALANCE', 'COMPOSITION', 'BACKGROUND_SIMPLIFY']
          : direction === ProductVisualMode.MARKETING_SCENE
            ? ['LIGHTING', 'WHITE_BALANCE', 'COMPOSITION', 'BACKGROUND_REPLACE', 'SCENE_RESTAGE']
          : [];
    }
    return direction === ProductVisualMode.PRESERVE_REAL_SCENE
      ? ['LIGHTING', 'WHITE_BALANCE', 'DENOISE', 'DEGLARE', 'COMPOSITION', 'BACKGROUND_SIMPLIFY']
      : direction === ProductVisualMode.CATALOG_STUDIO
        ? ['LIGHTING', 'WHITE_BALANCE', 'COMPOSITION', 'BACKGROUND_SIMPLIFY', 'BACKGROUND_REPLACE']
        : direction === ProductVisualMode.PRODUCT_RETOUCH
          ? ['LIGHTING', 'WHITE_BALANCE', 'DENOISE', 'DEGLARE', 'COMPOSITION']
          : direction === ProductVisualMode.MARKETING_SCENE
            ? ['LIGHTING', 'WHITE_BALANCE', 'COMPOSITION', 'BACKGROUND_REPLACE', 'SCENE_RESTAGE']
          : [];
  }

  private toSellerPlan(plan: VisualProviderServerPlan) {
    return {
      direction: plan.direction,
      riskProfile: plan.riskProfile,
      allowedOperations: plan.allowedOperations,
      protectedRegionVersion: plan.protectedRegionVersion,
      presentationPreset: plan.presentationPreset,
    };
  }

  private planFactVersion(sceneAnalysis: unknown) {
    const value = (sceneAnalysis as { productFactHash?: unknown } | null)?.productFactHash;
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
  }

  private routeForModelProfile(modelProfile: string) {
    if (modelProfile === 'BAILIAN_WAN_STANDARD') return { provider: 'BAILIAN_WAN', model: 'wan2.7-image' };
    if (modelProfile === 'BAILIAN_WAN_PRO') return { provider: 'BAILIAN_WAN', model: 'wan2.7-image-pro' };
    if (modelProfile === 'BAILIAN_QWEN_IMAGE') return { provider: 'BAILIAN_QWEN_IMAGE', model: 'qwen-image-3.0' };
    if (modelProfile === 'BAILIAN_QWEN_IMAGE_PRO') return { provider: 'BAILIAN_QWEN_IMAGE', model: 'qwen-image-3.0-pro' };
    return null;
  }

  private ratePolicyVersion(rateCode: string) {
    return `rate-${rateCode}`;
  }

  private async toOpaqueProviderSource(buffer: Buffer) {
    try {
      const flattened = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
        .rotate()
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
        .toBuffer();
      return {
        buffer: flattened,
        mimeType: 'image/jpeg' as const,
        normalizedVersion: 'normalized-rgba-srgb-v1' as const,
        opaque: true as const,
      };
    } catch {
      throw new ConflictException('商品原图无法安全转换为模型输入');
    }
  }

  private providerPlanFromQuoteSnapshot(snapshot: unknown): VisualProviderServerPlan {
    const value = snapshot as {
      direction?: unknown;
      riskProfile?: unknown;
      protectedRegionVersion?: string;
      allowedOperations?: unknown;
      presentationPreset?: unknown;
      adapterFactVersion?: unknown;
    };
    const presentationPreset = value?.presentationPreset === 'HARVEST_PLATE'
      || value?.presentationPreset === 'HANDHELD_HARVEST'
      || value?.presentationPreset === 'LIFESTYLE_TABLETOP'
      ? value.presentationPreset
      : null;
    const adapterFactVersion = typeof value?.adapterFactVersion === 'string' && /^[a-f0-9]{64}$/.test(value.adapterFactVersion)
      ? value.adapterFactVersion
      : null;
    if (!value || typeof value !== 'object' || !value.direction || !value.riskProfile
      || !value.protectedRegionVersion || !Array.isArray(value.allowedOperations)
      || !this.isProviderDirection(value.direction) || !this.isProviderRiskProfile(value.riskProfile)
      || value.allowedOperations.some((operation) => !this.isProviderOperation(operation))
      || !adapterFactVersion
      || (value.direction === ProductVisualMode.MARKETING_SCENE && !presentationPreset)) {
      throw new ConflictException('图片美化报价的视觉计划快照无效');
    }
    return {
      templateVersion: value.direction === ProductVisualMode.MARKETING_SCENE ? 'marketing-restage-v1' : 'truth-preserving-v1',
      direction: value.direction,
      riskProfile: value.riskProfile,
      allowedOperations: value.allowedOperations,
      protectedRegionVersion: value.protectedRegionVersion,
      adapterFactVersion,
      ...(value.direction === ProductVisualMode.MARKETING_SCENE ? { presentationPreset: presentationPreset! } : {}),
    };
  }

  private isProviderDirection(value: unknown): value is VisualProviderDirection {
    return value === ProductVisualMode.PRESERVE_REAL_SCENE
      || value === ProductVisualMode.CATALOG_STUDIO
      || value === ProductVisualMode.PRODUCT_RETOUCH
      || value === ProductVisualMode.MARKETING_SCENE;
  }

  private isProviderRiskProfile(value: unknown): value is VisualProviderRiskProfile {
    return value === ProductVisualRiskProfile.STRICT_FACTS
      || value === ProductVisualRiskProfile.CONSERVATIVE_FACTS
      || value === ProductVisualRiskProfile.STANDARD_FACTS
      || value === ProductVisualRiskProfile.ORGANIC_FACTS
      || value === ProductVisualRiskProfile.MARKETING_ONLY;
  }

  private isProviderOperation(value: unknown): value is VisualProviderAllowedOperation {
    return value === 'LIGHTING' || value === 'WHITE_BALANCE' || value === 'DENOISE'
      || value === 'DEGLARE' || value === 'COMPOSITION' || value === 'BACKGROUND_SIMPLIFY'
      || value === 'BACKGROUND_REPLACE' || value === 'SCENE_RESTAGE';
  }

  private async resolveAimaiPrincipal() {
    const principal = await this.clients.resolveInternalClientPrincipal(AIMAI_VISUAL_CLIENT_ID);
    if (principal.tenantId !== AIMAI_VISUAL_TENANT_ID || principal.adapterNamespace !== 'aimai-product') {
      throw new ServiceUnavailableException('爱买买 AI Visual Agent Client 配置与受信 Adapter 不匹配');
    }
    return principal;
  }
}
