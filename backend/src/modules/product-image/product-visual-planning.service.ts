import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductVisualMode, ProductVisualRiskProfile, SellerMediaAssetStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductVisualPlanDto } from './product-visual-planning.dto';
import { productVisualFactHash } from './product-visual-fact-hash';

const POLICY_VERSION = 'product-visual-plan-v1';
const MODEL_POLICY_VERSION = 'model-policy-disabled-v1';
const PLAN_TTL_MS = 30 * 60_000;

const ORGANIC_KEYWORDS = ['虾', '鱼', '蟹', '贝', '肉', '蔬菜', '水果', '农产品', '海鲜', '禽'];
const ELECTRONICS_KEYWORDS = ['手环', '手表', '耳机', '手机', '电脑', '家电', '充电', '数码', '电子'];
const STRICT_KEYWORDS = ['包装', '条码', '二维码', '型号', '序列号', '成分', '保质', '规格', '容量', '屏幕'];

type QualityDiagnosis = {
  width?: number;
  height?: number;
  tooSmall?: boolean;
  brightness?: { advisory?: string | null };
  contrast?: { advisory?: string | null };
  advisories?: Array<{ code?: string; severity?: string }>;
};

@Injectable()
export class ProductVisualPlanningService {
  constructor(private readonly prisma: PrismaService) {}

  async createPlan(
    companyId: string,
    staffId: string,
    productId: string,
    dto: CreateProductVisualPlanDto,
  ) {
    const source = await this.prisma.sellerMediaAsset.findFirst({
      where: {
        id: dto.sourceAssetId,
        companyId,
        purpose: 'PRODUCT_IMAGE',
        status: SellerMediaAssetStatus.AVAILABLE,
        deletedAt: null,
      },
      select: {
        id: true,
        canonicalSha256: true,
        width: true,
        height: true,
        diagnosis: true,
        scanSummary: true,
      },
    });
    if (!source) throw new NotFoundException('商品图片资产不存在');
    if ((source.scanSummary as { needsReview?: boolean } | null)?.needsReview) {
      throw new ConflictException('图片仍需人工安全复核，不能生成美化计划');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: {
        id: true,
        title: true,
        subtitle: true,
        description: true,
        categoryId: true,
        updatedAt: true,
        mediaVersion: true,
        category: { select: { name: true } },
      },
    });
    if (!product) throw new NotFoundException('关联商品不存在');

    const diagnosis = (source.diagnosis ?? {}) as QualityDiagnosis;
    const riskProfile = this.deriveRiskProfile(product, source, diagnosis);
    const allowedModes = this.allowedModes(riskProfile);
    const recommendedMode = this.recommendMode(riskProfile, diagnosis, dto.requestedMode, allowedModes);
    const sceneAnalysis = {
      ...this.buildSceneAnalysis(product, source, diagnosis, riskProfile),
      productFactHash: productVisualFactHash(product),
    };
    const processingPlan = this.buildProcessingPlan(riskProfile, recommendedMode, allowedModes, sceneAnalysis);
    const allowedOperations = processingPlan.freeTunePolicy.allowed;
    const planHash = this.sha256(JSON.stringify({
      sourceAssetId: source.id,
      sourceHash: source.canonicalSha256,
      productId: product.id,
      riskProfile,
      recommendedMode,
      allowedModes,
      sceneAnalysis,
      processingPlan,
      allowedOperations,
      policyVersion: POLICY_VERSION,
      modelPolicyVersion: MODEL_POLICY_VERSION,
      protectedRegionVersion: 'NOT_CREATED',
    }));
    const planLockKey = `product-visual-plan:${companyId}:${product.id}:${source.id}:${planHash}`;
    const plan = await this.prisma.$transaction(async (tx) => {
      // PostgreSQL advisory locks serialize plan reuse without a time-based
      // unique index (PostgreSQL rejects volatile now() in index predicates).
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${planLockKey}))`);
      const now = new Date();
      const existing = await tx.productVisualPlan.findFirst({
        where: { companyId, productId: product.id, sourceAssetId: source.id, planHash, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return existing;
      return tx.productVisualPlan.create({
        data: {
          companyId,
          productId: product.id,
          sourceAssetId: source.id,
          sourceHash: source.canonicalSha256,
          requestedByStaffId: staffId,
          riskProfile,
          recommendedMode,
          allowedModes,
          allowedOperations,
          sceneAnalysis: sceneAnalysis as Prisma.InputJsonValue,
          processingPlan: processingPlan as Prisma.InputJsonValue,
          planHash,
          policyVersion: POLICY_VERSION,
          modelPolicyVersion: MODEL_POLICY_VERSION,
          protectedRegionVersion: 'NOT_CREATED',
          expiresAt: new Date(now.getTime() + PLAN_TTL_MS),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.toResponse(plan);
  }

  private deriveRiskProfile(
    product: { title: string; subtitle: string | null; description: string | null; category: { name: string } | null },
    source: { width: number; height: number; scanSummary: unknown },
    diagnosis: QualityDiagnosis,
  ): ProductVisualRiskProfile {
    const text = [product.title, product.subtitle, product.description, product.category?.name]
      .filter((value): value is string => !!value)
      .join(' ')
      .toLowerCase();
    const qrCodes = Number((source.scanSummary as { qrCodesDetected?: number } | null)?.qrCodesDetected ?? 0);
    const criticallySmall = diagnosis.tooSmall === true && (source.width < 384 || source.height < 384);
    if (criticallySmall) return ProductVisualRiskProfile.RETAKE_REQUIRED;
    if (qrCodes > 0 || STRICT_KEYWORDS.some((keyword) => text.includes(keyword))) {
      return ProductVisualRiskProfile.STRICT_FACTS;
    }
    if (ORGANIC_KEYWORDS.some((keyword) => text.includes(keyword))) {
      return ProductVisualRiskProfile.ORGANIC_FACTS;
    }
    if (ELECTRONICS_KEYWORDS.some((keyword) => text.includes(keyword))) {
      return ProductVisualRiskProfile.CONSERVATIVE_FACTS;
    }
    return ProductVisualRiskProfile.STANDARD_FACTS;
  }

  private allowedModes(riskProfile: ProductVisualRiskProfile): ProductVisualMode[] {
    switch (riskProfile) {
      case ProductVisualRiskProfile.RETAKE_REQUIRED:
        return [];
      case ProductVisualRiskProfile.STRICT_FACTS:
        return [ProductVisualMode.PRESERVE_REAL_SCENE, ProductVisualMode.CATALOG_STUDIO];
      case ProductVisualRiskProfile.ORGANIC_FACTS:
        return [ProductVisualMode.PRESERVE_REAL_SCENE, ProductVisualMode.CATALOG_STUDIO, ProductVisualMode.MARKETING_SCENE];
      case ProductVisualRiskProfile.CONSERVATIVE_FACTS:
        return [ProductVisualMode.PRESERVE_REAL_SCENE, ProductVisualMode.CATALOG_STUDIO, ProductVisualMode.PRODUCT_RETOUCH];
      case ProductVisualRiskProfile.MARKETING_ONLY:
        return [ProductVisualMode.MARKETING_SCENE];
      default:
        return [
          ProductVisualMode.PRESERVE_REAL_SCENE,
          ProductVisualMode.CATALOG_STUDIO,
          ProductVisualMode.PRODUCT_RETOUCH,
          ProductVisualMode.MARKETING_SCENE,
        ];
    }
  }

  private recommendMode(
    riskProfile: ProductVisualRiskProfile,
    diagnosis: QualityDiagnosis,
    requestedMode: ProductVisualMode | undefined,
    allowedModes: ProductVisualMode[],
  ): ProductVisualMode | null {
    if (requestedMode && allowedModes.includes(requestedMode)) return requestedMode;
    if (riskProfile === ProductVisualRiskProfile.RETAKE_REQUIRED) return null;
    const codes = new Set((diagnosis.advisories ?? []).map((advisory) => advisory.code));
    if (codes.has('PORTRAIT_CROP_RISK') || codes.has('IMAGE_TOO_SMALL')) {
      return allowedModes.includes(ProductVisualMode.CATALOG_STUDIO)
        ? ProductVisualMode.CATALOG_STUDIO
        : allowedModes[0] ?? null;
    }
    return allowedModes.includes(ProductVisualMode.PRESERVE_REAL_SCENE)
      ? ProductVisualMode.PRESERVE_REAL_SCENE
      : allowedModes[0] ?? null;
  }

  private buildSceneAnalysis(
    product: { title: string; category: { name: string } | null },
    source: { width: number; height: number },
    diagnosis: QualityDiagnosis,
    riskProfile: ProductVisualRiskProfile,
  ) {
    const advisoryCodes = (diagnosis.advisories ?? []).map((advisory) => advisory.code).filter((code): code is string => !!code);
    const retakeRequired = riskProfile === ProductVisualRiskProfile.RETAKE_REQUIRED;
    return {
      version: POLICY_VERSION,
      productTitle: product.title,
      categoryName: product.category?.name ?? null,
      source: { width: source.width, height: source.height, aspectRatio: source.height === 0 ? null : source.width / source.height },
      quality: diagnosis,
      advisoryCodes,
      sceneAssessment: retakeRequired ? 'RETAKE_REQUIRED' : 'PRESERVE_REAL_SCENE_FIRST',
      reasons: retakeRequired
        ? ['图片分辨率过低，无法可信地恢复商品细节，建议重拍']
        : ['当前免费分析无法可靠证明实景不适合保留，默认优先保留真实场景'],
    };
  }

  private buildProcessingPlan(
    riskProfile: ProductVisualRiskProfile,
    recommendedMode: ProductVisualMode | null,
    allowedModes: ProductVisualMode[],
    sceneAnalysis: Record<string, unknown>,
  ) {
    const freeTunePolicy = this.freeTunePolicy(riskProfile);
    return {
      version: POLICY_VERSION,
      riskProfile,
      recommendedMode,
      allowedModes,
      freeTunePolicy,
      requiresModel: false,
      executionAvailability: 'PLAN_ONLY_NO_MODEL_CALL',
      requiresMerchantGenerationClick: true,
      requiresFactConfirmation: true,
      requiresHumanReview: riskProfile === ProductVisualRiskProfile.STRICT_FACTS
        || riskProfile === ProductVisualRiskProfile.CONSERVATIVE_FACTS,
      protectedRegionRequired: riskProfile !== ProductVisualRiskProfile.STANDARD_FACTS,
      sceneAssessment: sceneAnalysis.sceneAssessment,
    };
  }

  private freeTunePolicy(riskProfile: ProductVisualRiskProfile) {
    switch (riskProfile) {
      case ProductVisualRiskProfile.STRICT_FACTS:
        return { allowed: ['ORIENTATION', 'CROP_PREVIEW', 'BACKGROUND_LUMINANCE'], protectedRegionPixelChanges: 0 };
      case ProductVisualRiskProfile.ORGANIC_FACTS:
        return { allowed: ['ORIENTATION', 'CROP_PREVIEW', 'LIMITED_LUMINANCE', 'BACKGROUND_DENOISE'], exposureEvLimit: 0.15, contrastPercentLimit: 5, hueDelta: 0, saturationDelta: 0 };
      case ProductVisualRiskProfile.CONSERVATIVE_FACTS:
        return { allowed: ['ORIENTATION', 'CROP_PREVIEW', 'LIMITED_LUMINANCE', 'BACKGROUND_DENOISE'], exposureEvLimit: 0.2, hueDelta: 0, saturationDelta: 0, localProductRetouch: false };
      case ProductVisualRiskProfile.STANDARD_FACTS:
        return { allowed: ['ORIENTATION', 'CROP_PREVIEW', 'LIMITED_LUMINANCE', 'WHITE_BALANCE', 'DENOISE', 'LIGHT_SHARPEN'], requiresRecordedParameters: true };
      default:
        return { allowed: [] };
    }
  }

  private toResponse(plan: {
    id: string;
    productId: string | null;
    sourceAssetId: string;
    sourceHash: string;
    riskProfile: ProductVisualRiskProfile;
    recommendedMode: ProductVisualMode | null;
    allowedModes: ProductVisualMode[];
    allowedOperations: string[];
    sceneAnalysis: unknown;
    processingPlan: unknown;
    planHash: string;
    policyVersion: string;
    modelPolicyVersion: string;
    protectedRegionVersion: string;
    expiresAt: Date;
    createdAt: Date;
  }) {
    return {
      id: plan.id,
      productId: plan.productId,
      sourceAssetId: plan.sourceAssetId,
      sourceHash: plan.sourceHash,
      riskProfile: plan.riskProfile,
      recommendedMode: plan.recommendedMode,
      allowedModes: plan.allowedModes,
      allowedOperations: plan.allowedOperations,
      sceneAnalysis: plan.sceneAnalysis,
      processingPlan: plan.processingPlan,
      planHash: plan.planHash,
      policyVersion: plan.policyVersion,
      modelPolicyVersion: plan.modelPolicyVersion,
      protectedRegionVersion: plan.protectedRegionVersion,
      expiresAt: plan.expiresAt,
      createdAt: plan.createdAt,
    };
  }

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
