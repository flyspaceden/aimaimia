import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductImageArtifactKind, ProductImageAssetLineageRole, ProductImageOptimizationKind, ProductImageOptimizationStatus, SellerMediaAssetStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SellerMediaAssetsService } from './seller-media-assets.service';
import { UploadService } from '../upload/upload.service';
import { LocalCandidateVerificationReport } from './product-image-candidate-local-verification.service';

type PersistPaidCandidateInput = {
  companyId: string;
  staffId: string;
  productId: string;
  sourceAssetId: string;
  sourceCanonicalHash: string;
  provider: 'BAILIAN_WAN' | 'BAILIAN_QWEN_IMAGE';
  quote: {
    id: string;
    quoteHash: string;
    sourceAssetRef: string;
    sourceHash: string;
    visualPlanSnapshot: unknown;
    rateCardSnapshot: unknown;
    visualAgentInvocationId: string | null;
  };
  output: { buffer: Buffer; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' };
};

/**
 * Adapter-side candidate persistence for a paid Core quote. A candidate starts
 * in RECONCILING and can never be adopted until invocation completion and
 * merchant-credit settlement both succeed.
 */
@Injectable()
export class ProductPaidVisualCandidateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: SellerMediaAssetsService,
    private readonly uploadService: UploadService,
  ) {}

  async persistPendingVerification(input: PersistPaidCandidateInput) {
    if (input.quote.sourceAssetRef !== input.sourceAssetId || input.quote.sourceHash !== input.sourceCanonicalHash) {
      throw new ConflictException('付费图片候选的原图证据不匹配');
    }
    const source = await this.prisma.sellerMediaAsset.findFirst({
      where: {
        id: input.sourceAssetId,
        companyId: input.companyId,
        purpose: 'PRODUCT_IMAGE',
        status: SellerMediaAssetStatus.AVAILABLE,
        canonicalSha256: input.sourceCanonicalHash,
        deletedAt: null,
      },
      select: { id: true, objectKey: true, canonicalSha256: true, mimeType: true, byteSize: true, width: true, height: true },
    });
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, companyId: input.companyId, media: { some: { assetId: input.sourceAssetId } } },
      select: { id: true },
    });
    if (!source || !product) throw new NotFoundException('商品原图已变化，不能保存付费图片候选');
    const idempotencyKey = `paid-quote:${input.quote.id}`;
    const existing = await this.prisma.productImageOptimization.findUnique({
      where: { companyId_idempotencyKey: { companyId: input.companyId, idempotencyKey } },
      include: { artifacts: { where: { kind: ProductImageArtifactKind.CANDIDATE }, include: { asset: true } } },
    });
    if (existing) return this.toResult(existing);

    const candidate = await this.assets.createDerivedProductImageAsset(input.companyId, input.staffId, {
      buffer: input.output.buffer,
      size: input.output.buffer.length,
      mimetype: input.output.mimeType,
      originalname: 'paid-visual-candidate.png',
    } as Express.Multer.File);
    try {
      const contract = {
        version: 'paid-visual-candidate-v2',
        quoteId: input.quote.id,
        quoteHash: input.quote.quoteHash,
        invocationId: input.quote.visualAgentInvocationId,
        source: { assetId: source.id, canonicalSha256: source.canonicalSha256 },
        visualPlan: input.quote.visualPlanSnapshot,
        rateCard: input.quote.rateCardSnapshot,
        verification: {
          state: 'PENDING_CORE_COMPLETION_AND_HUMAN_FACT_REVIEW',
          outputMimeType: input.output.mimeType,
          outputByteSize: input.output.buffer.length,
        },
      };
      const task = await this.prisma.$transaction(async (tx) => {
        const created = await tx.productImageOptimization.create({
          data: {
            companyId: input.companyId,
            productId: product.id,
            kind: ProductImageOptimizationKind.BACKGROUND_GENERATION,
            status: ProductImageOptimizationStatus.RECONCILING,
            processingContract: contract as Prisma.InputJsonValue,
            contractHash: this.sha256(JSON.stringify(contract)),
            inputFingerprint: this.sha256(`${input.quote.id}:${source.id}:${source.canonicalSha256}`),
            templateVersion: 'paid-visual-candidate-v2',
            provider: input.provider,
            modelVersion: this.modelProfile(input.quote.rateCardSnapshot),
            costTier: 'PAID',
            reservedCostCents: 0,
            requestedByStaffId: input.staffId,
            idempotencyKey,
            dedupeKey: this.sha256(`paid-quote:${input.quote.id}`),
          },
        });
        const sourceArtifact = await tx.productImageArtifact.create({
          data: {
            optimizationId: created.id,
            kind: ProductImageArtifactKind.FOREGROUND_REFERENCE,
            assetId: source.id,
            objectKey: source.objectKey,
            sha256: source.canonicalSha256,
            mimeType: source.mimeType,
            byteSize: source.byteSize,
            width: source.width,
            height: source.height,
            isAigc: false,
          },
        });
        const candidateArtifact = await tx.productImageArtifact.create({
          data: {
            optimizationId: created.id,
            kind: ProductImageArtifactKind.CANDIDATE,
            assetId: candidate.asset.id,
            objectKey: candidate.asset.objectKey,
            sha256: candidate.asset.canonicalSha256,
            mimeType: candidate.asset.mimeType,
            byteSize: candidate.asset.byteSize,
            width: candidate.asset.width,
            height: candidate.asset.height,
            isAigc: true,
            metadata: {
              quoteId: input.quote.id,
              quoteHash: input.quote.quoteHash,
              invocationId: input.quote.visualAgentInvocationId,
              verification: 'PENDING_CORE_COMPLETION_AND_HUMAN_FACT_REVIEW',
            } as Prisma.InputJsonValue,
          },
        });
        await tx.productImageAssetLineage.create({
          data: {
            optimizationId: created.id,
            sourceAssetId: source.id,
            artifactId: sourceArtifact.id,
            role: ProductImageAssetLineageRole.PRIMARY_SOURCE,
          },
        });
        await tx.productImageAssetLineage.create({
          data: {
            optimizationId: created.id,
            sourceAssetId: source.id,
            artifactId: candidateArtifact.id,
            role: ProductImageAssetLineageRole.FOREGROUND_REFERENCE,
          },
        });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return this.toResult({ ...task, artifacts: [{ kind: ProductImageArtifactKind.CANDIDATE, asset: candidate.asset }] });
    } catch (error) {
      await this.prisma.sellerMediaAsset.updateMany({
        where: { id: candidate.asset.id, companyId: input.companyId, status: SellerMediaAssetStatus.CANDIDATE },
        data: { status: SellerMediaAssetStatus.RETIRED },
      });
      throw error;
    }
  }

  async finalizeLocalVerification(companyId: string, quoteId: string, local: LocalCandidateVerificationReport) {
    const task = await this.prisma.productImageOptimization.findFirst({
      where: { companyId, idempotencyKey: `paid-quote:${quoteId}`, status: ProductImageOptimizationStatus.RECONCILING },
      select: {
        id: true,
        processingContract: true,
        artifacts: { where: { kind: ProductImageArtifactKind.CANDIDATE }, select: { assetId: true } },
      },
    });
    if (!task) throw new ConflictException('付费图片候选当前不能完成验证');
    const status = local.disposition === 'REJECT'
      ? ProductImageOptimizationStatus.REJECTED
      : ProductImageOptimizationStatus.PENDING_REVIEW;
    const processingContract = {
      ...((task.processingContract as Record<string, unknown> | null) ?? {}),
      verification: {
        local,
        state: status === ProductImageOptimizationStatus.REJECTED ? 'LOCAL_FACT_MISMATCH_REJECTED' : 'LOCAL_CHECKS_COMPLETE_AWAITING_OCR_OR_HUMAN_REVIEW',
      },
    };
    const updated = await this.prisma.productImageOptimization.updateMany({
      where: { id: task.id, status: ProductImageOptimizationStatus.RECONCILING },
      data: {
        status,
        completedAt: new Date(),
        processingContract: processingContract as Prisma.InputJsonValue,
        contractHash: this.sha256(JSON.stringify(processingContract)),
        ...(status === ProductImageOptimizationStatus.REJECTED ? {
          failureCode: 'LOCAL_FACT_VERIFICATION_REJECTED',
          failureDetail: '候选图的二维码、条码格式或构图与原图存在明确不一致',
        } : {}),
      },
    });
    if (updated.count !== 1) throw new ConflictException('付费图片候选状态已变化');
    if (status === ProductImageOptimizationStatus.REJECTED) {
      const candidateAssetIds = task.artifacts.map((artifact) => artifact.assetId).filter((id): id is string => !!id);
      if (candidateAssetIds.length) {
        await this.prisma.sellerMediaAsset.updateMany({
          where: { id: { in: candidateAssetIds }, companyId, status: SellerMediaAssetStatus.CANDIDATE },
          data: { status: SellerMediaAssetStatus.RETIRED },
        });
      }
    }
    return { id: task.id, status };
  }

  async getForAdmin(optimizationId: string) {
    const task = await this.prisma.productImageOptimization.findFirst({
      where: { id: optimizationId, kind: ProductImageOptimizationKind.BACKGROUND_GENERATION },
      include: {
        product: { select: { id: true, title: true } },
        company: { select: { id: true, name: true } },
        artifacts: {
          where: { kind: { in: [ProductImageArtifactKind.FOREGROUND_REFERENCE, ProductImageArtifactKind.CANDIDATE] } },
          include: { asset: true },
        },
      },
    });
    if (!task) throw new NotFoundException('付费图片候选不存在');
    const source = task.artifacts.find((artifact) => artifact.kind === ProductImageArtifactKind.FOREGROUND_REFERENCE)?.asset;
    const candidate = task.artifacts.find((artifact) => artifact.kind === ProductImageArtifactKind.CANDIDATE)?.asset;
    if (!source || !candidate) throw new ConflictException('付费图片候选证据不完整');
    const [sourceAccess, candidateAccess] = await Promise.all([
      this.uploadService.createPrivateAccessUrl(source.objectKey, 300),
      this.uploadService.createPrivateAccessUrl(candidate.objectKey, 300),
    ]);
    return {
      task: { id: task.id, status: task.status, productId: task.productId, createdAt: task.createdAt },
      product: task.product,
      company: task.company,
      source: { assetId: source.id, displayUrl: sourceAccess.url, expiresAt: sourceAccess.expiresAt },
      candidate: { assetId: candidate.id, displayUrl: candidateAccess.url, expiresAt: candidateAccess.expiresAt, isAigc: true },
    };
  }

  async listPendingForAdmin() {
    return this.prisma.productImageOptimization.findMany({
      where: {
        kind: ProductImageOptimizationKind.BACKGROUND_GENERATION,
        status: ProductImageOptimizationStatus.PENDING_REVIEW,
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        status: true,
        createdAt: true,
        provider: true,
        modelVersion: true,
        costTier: true,
        product: { select: { id: true, title: true } },
        company: { select: { id: true, name: true } },
      },
    });
  }

  async approveHumanFactReview(optimizationId: string) {
    const updated = await this.prisma.productImageOptimization.updateMany({
      where: {
        id: optimizationId,
        kind: ProductImageOptimizationKind.BACKGROUND_GENERATION,
        status: ProductImageOptimizationStatus.PENDING_REVIEW,
      },
      data: { status: ProductImageOptimizationStatus.SUCCEEDED },
    });
    if (updated.count !== 1) throw new ConflictException('付费图片候选当前不能通过事实复核');
  }

  async rejectHumanFactReview(optimizationId: string, reason: string) {
    if (!reason.trim()) throw new ConflictException('请填写付费图片候选的驳回原因');
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.productImageOptimization.findFirst({
        where: { id: optimizationId, kind: ProductImageOptimizationKind.BACKGROUND_GENERATION, status: ProductImageOptimizationStatus.PENDING_REVIEW },
        include: { artifacts: { where: { kind: ProductImageArtifactKind.CANDIDATE }, select: { assetId: true } } },
      });
      if (!task) throw new ConflictException('付费图片候选当前不能驳回');
      const rejected = await tx.productImageOptimization.updateMany({
        where: { id: task.id, status: ProductImageOptimizationStatus.PENDING_REVIEW },
        data: { status: ProductImageOptimizationStatus.REJECTED, failureCode: 'HUMAN_FACT_REVIEW_REJECTED', failureDetail: reason.trim().slice(0, 400) },
      });
      if (rejected.count !== 1) throw new ConflictException('付费图片候选状态已变化');
      const candidateAssetId = task.artifacts[0]?.assetId;
      if (candidateAssetId) {
        await tx.sellerMediaAsset.updateMany({
          where: { id: candidateAssetId, status: SellerMediaAssetStatus.CANDIDATE },
          data: { status: SellerMediaAssetStatus.RETIRED },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private modelProfile(snapshot: unknown) {
    const modelProfile = (snapshot as { modelProfile?: unknown } | null)?.modelProfile;
    return typeof modelProfile === 'string' ? modelProfile : null;
  }

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private toResult(task: any) {
    const candidate = task.artifacts?.find((artifact: any) => artifact.kind === ProductImageArtifactKind.CANDIDATE)?.asset;
    return { id: task.id, status: task.status, candidateAssetId: candidate?.id ?? null, candidateObjectKey: candidate?.objectKey ?? null };
  }
}
