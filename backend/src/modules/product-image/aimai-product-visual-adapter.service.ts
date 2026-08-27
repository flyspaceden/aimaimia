import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ProductVisualMode, ProductVisualRiskProfile, SellerMediaAssetStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { VisualAgentClientKeyService } from '../visual-agent/visual-agent-client-key.service';
import { VisualAgentTrustedAdapterService } from '../visual-agent/visual-agent-trusted-adapter.service';
import { VisualCreditService } from '../visual-agent/visual-credit.service';
import { VisualPaidExecutionService } from '../visual-agent/visual-paid-execution.service';
import { visualPlanSha256 } from '../visual-agent/visual-agent-integrity';
import { VisualProviderAllowedOperation, VisualProviderDirection, VisualProviderRiskProfile, VisualProviderServerPlan } from '../visual-agent/providers/visual-image-edit.provider';
import { UploadService } from '../upload/upload.service';
const sharp = require('sharp') as typeof import('sharp').default;

export const AIMAI_VISUAL_TENANT_ID = 'aimai-product-agent';
export const AIMAI_VISUAL_CLIENT_ID = 'aimai-product-adapter-v1';
export const AIMAI_VISUAL_ADAPTER_TYPE = 'aimai-product-v1';
const QUOTE_TTL_MS = 15 * 60_000;

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
        },
      }),
    ]);
    if (!plan) throw new ConflictException('图片美化计划已过期、已变更或不属于当前商品图片');
    if (!plan.allowedModes.includes(input.direction) || input.direction === ProductVisualMode.MARKETING_SCENE) {
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
        where: { id: input.productId, companyId: input.companyId, media: { some: { assetId: input.sourceAssetId } } },
        select: { id: true },
      }),
    ]);
    if (!source || !product) throw new NotFoundException('商品原图已变化，不能创建图片美化报价');

    const providerPlan = this.toProviderPlan(plan.riskProfile, input.direction, plan.protectedRegionVersion);
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
        allowedOperations: [...providerPlan.allowedOperations],
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
      where: { id: input.productId, companyId: input.companyId, media: { some: { assetId: quote.sourceAssetRef } } },
      select: { id: true },
    });
    if (!source || !product) {
      await this.credits.releaseReservedQuote(quote.id, 'SOURCE_OR_PRODUCT_CHANGED_BEFORE_EXECUTION');
      throw new NotFoundException('商品原图已变化，已释放本次图片美化额度');
    }
    const sourceBuffer = await this.uploadService.getBuffer(source.objectKey);
    const providerSource = await this.toOpaqueProviderSource(sourceBuffer);
    const providerPlan = this.providerPlanFromQuoteSnapshot(quote.visualPlanSnapshot);
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

  private toProviderPlan(
    riskProfile: ProductVisualRiskProfile,
    direction: ProductVisualMode,
    protectedRegionVersion: string,
  ): VisualProviderServerPlan {
    if (riskProfile === ProductVisualRiskProfile.RETAKE_REQUIRED || riskProfile === ProductVisualRiskProfile.MARKETING_ONLY) {
      throw new ConflictException('当前图片风险档不能生成可付费的商品主图候选');
    }
    const operations = this.allowedOperations(riskProfile, direction);
    if (operations.length === 0) throw new ConflictException('当前风险档没有可安全执行的图片美化操作');
    return {
      templateVersion: 'truth-preserving-v1',
      direction,
      riskProfile,
      allowedOperations: operations,
      protectedRegionVersion,
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
          : [];
    }
    return direction === ProductVisualMode.PRESERVE_REAL_SCENE
      ? ['LIGHTING', 'WHITE_BALANCE', 'DENOISE', 'DEGLARE', 'COMPOSITION', 'BACKGROUND_SIMPLIFY']
      : direction === ProductVisualMode.CATALOG_STUDIO
        ? ['LIGHTING', 'WHITE_BALANCE', 'COMPOSITION', 'BACKGROUND_SIMPLIFY', 'BACKGROUND_REPLACE']
        : direction === ProductVisualMode.PRODUCT_RETOUCH
          ? ['LIGHTING', 'WHITE_BALANCE', 'DENOISE', 'DEGLARE', 'COMPOSITION']
          : [];
  }

  private toSellerPlan(plan: VisualProviderServerPlan) {
    return {
      direction: plan.direction,
      riskProfile: plan.riskProfile,
      allowedOperations: plan.allowedOperations,
      protectedRegionVersion: plan.protectedRegionVersion,
    };
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
    };
    if (!value || typeof value !== 'object' || !value.direction || !value.riskProfile
      || !value.protectedRegionVersion || !Array.isArray(value.allowedOperations)
      || !this.isProviderDirection(value.direction) || !this.isProviderRiskProfile(value.riskProfile)
      || value.allowedOperations.some((operation) => !this.isProviderOperation(operation))) {
      throw new ConflictException('图片美化报价的视觉计划快照无效');
    }
    return {
      templateVersion: 'truth-preserving-v1',
      direction: value.direction,
      riskProfile: value.riskProfile,
      allowedOperations: value.allowedOperations,
      protectedRegionVersion: value.protectedRegionVersion,
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
      || value === 'BACKGROUND_REPLACE';
  }

  private async resolveAimaiPrincipal() {
    const principal = await this.clients.resolveInternalClientPrincipal(AIMAI_VISUAL_CLIENT_ID);
    if (principal.tenantId !== AIMAI_VISUAL_TENANT_ID || principal.adapterNamespace !== 'aimai-product') {
      throw new ServiceUnavailableException('爱买买 AI Visual Agent Client 配置与受信 Adapter 不匹配');
    }
    return principal;
  }
}
