import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ProductImageArtifactKind,
  ProductImageAssetLineageRole,
  ProductImageFactScanStatus,
  ProductImageOptimizationKind,
  ProductImageOptimizationStatus,
  ProductMediaRevisionStatus,
  ProductMediaVisualOrigin,
  SellerMediaAssetStatus,
  VisualAgentInvocationStatus,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { SellerMediaAssetsService } from './seller-media-assets.service';
import { ProductImageCompositionService } from './product-image-composition.service';
import { AdoptProductImageOptimizationDto, RequestProductImageOptimizationDto } from './product-image-optimization.dto';
import { assertProductImageOptimizationTransition } from './product-image-optimization-state';
import { ProductMediaRevisionsService } from './product-media-revisions.service';

const WHITE_BACKGROUND_CONTRACT = {
  version: 'phase-b-white-background-v1',
  intent: 'WHITE_BACKGROUND',
  provider: 'deterministic-sharp',
  canvas: { width: 800, height: 1000, background: '#ffffff' },
  requiresTransparentForeground: true,
  allowedOperations: ['NEAREST_NEIGHBOR_GEOMETRY', 'WHITE_BACKGROUND_COMPOSITE'],
  forbiddenOperations: ['PRODUCT_REGENERATION', 'TEXT_EDIT', 'COLOR_CHANGE', 'OBJECT_ADD_REMOVE'],
  costTier: 'FREE',
} as const;

const FREE_TUNE_CONTRACT = {
  version: 'phase-p1b-free-tune-v1',
  intent: 'FREE_TUNE',
  provider: 'deterministic-sharp',
  allowedRiskProfile: 'STANDARD_FACTS',
  requiredMode: 'PRESERVE_REAL_SCENE',
  allowedOperations: ['PIXEL_ALIGNED_BRIGHTNESS', 'PIXEL_ALIGNED_CONTRAST', 'NEUTRAL_SATURATION', 'LIGHT_SHARPEN'],
  forbiddenOperations: ['CROP', 'RESIZE', 'ROTATE', 'TEXT_EDIT', 'OBJECT_ADD_REMOVE', 'PRODUCT_REGENERATION', 'MODEL_CALL'],
  costTier: 'FREE',
} as const;

type DeterministicProductImageContract = {
  version: string;
  intent: string;
  provider: string;
  costTier: 'FREE';
  [key: string]: unknown;
};

@Injectable()
export class ProductImageOptimizationService {
  private readonly logger = new Logger(ProductImageOptimizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly mediaAssets: SellerMediaAssetsService,
    private readonly composition: ProductImageCompositionService,
    private readonly mediaRevisions: ProductMediaRevisionsService,
  ) {}

  async requestWhiteBackground(
    companyId: string,
    staffId: string,
    dto: RequestProductImageOptimizationDto,
  ) {
    const source = await this.prisma.sellerMediaAsset.findFirst({
      where: { id: dto.sourceAssetId, companyId, purpose: 'PRODUCT_IMAGE', status: SellerMediaAssetStatus.AVAILABLE, deletedAt: null },
    });
    if (!source) throw new NotFoundException('商品图片资产不存在');
    if ((source.scanSummary as { needsReview?: boolean } | null)?.needsReview) {
      throw new ConflictException('图片仍需人工安全复核，不能创建优化任务');
    }
    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,
        companyId,
        // An optimization is evidence for this exact product, not a reusable
        // generic asset. It must start from media already attached to it.
        media: { some: { assetId: source.id } },
      },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('关联商品不存在，或该原图尚未用于该商品');

    const contract = WHITE_BACKGROUND_CONTRACT;
    const contractHash = this.sha256(JSON.stringify(contract));
    const inputFingerprint = this.sha256(`${source.id}:${source.canonicalSha256}:${contractHash}:${product.id}`);
    const dedupeKey = this.sha256(`${inputFingerprint}:deterministic-sharp-v1`);
    await this.expireLeases({ companyId, dedupeKey });

    const { task } = await this.createOrReuseTask({
      companyId,
      staffId,
      source,
      productId: product.id,
      idempotencyKey: dto.idempotencyKey,
      kind: ProductImageOptimizationKind.WHITE_BACKGROUND,
      contract,
      contractHash,
      inputFingerprint,
      dedupeKey,
    });
    if (task.status !== ProductImageOptimizationStatus.REQUESTED) {
      return this.getForSeller(companyId, task.id);
    }
    const queuedByThisRequest = await this.queue(task.id);
    if (!queuedByThisRequest) return this.getForSeller(companyId, task.id);
    await this.runWhiteBackground(task.id, companyId, staffId, source.objectKey);
    return this.getForSeller(companyId, task.id);
  }

  async requestFreeTune(
    companyId: string,
    staffId: string,
    dto: RequestProductImageOptimizationDto,
  ) {
    if (!dto.planId) throw new BadRequestException('免费实景增强必须使用未过期的 AI 美化计划');
    const source = await this.prisma.sellerMediaAsset.findFirst({
      where: { id: dto.sourceAssetId, companyId, purpose: 'PRODUCT_IMAGE', status: SellerMediaAssetStatus.AVAILABLE, deletedAt: null },
    });
    if (!source) throw new NotFoundException('商品图片资产不存在');
    if ((source.scanSummary as { needsReview?: boolean } | null)?.needsReview) {
      throw new ConflictException('图片仍需人工安全复核，不能执行免费实景增强');
    }
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId, media: { some: { assetId: source.id } } },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('关联商品不存在，或该原图尚未用于该商品');
    const factEvidence = await this.assertFreeTuneFactEvidence(companyId, product.id, source);
    const plan = await this.prisma.productVisualPlan.findFirst({
      where: {
        id: dto.planId,
        companyId,
        productId: product.id,
        sourceAssetId: source.id,
        sourceHash: source.canonicalSha256,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, planHash: true, riskProfile: true, allowedModes: true, modelPolicyVersion: true, protectedRegionVersion: true },
    });
    if (!plan) throw new ConflictException('AI 美化计划已过期、已变更或不属于当前商品图片');
    if (plan.riskProfile !== 'STANDARD_FACTS'
      || !plan.allowedModes.includes('PRESERVE_REAL_SCENE')
      || plan.modelPolicyVersion !== 'model-policy-disabled-v1'
      || plan.protectedRegionVersion !== 'NOT_CREATED') {
      throw new ConflictException('当前风险档不允许无保护区的免费实景增强，请保留原图或等待后续受控验真路线');
    }
    const contract: DeterministicProductImageContract = {
      ...FREE_TUNE_CONTRACT,
      plan: { id: plan.id, hash: plan.planHash, sourceHash: source.canonicalSha256 },
      factEvidence: {
        id: factEvidence.id,
        sourceHash: source.canonicalSha256,
        policyVersion: 'product-image-fact-scan-v1',
      },
    };
    const contractHash = this.sha256(JSON.stringify(contract));
    const inputFingerprint = this.sha256(`${source.id}:${source.canonicalSha256}:${contractHash}:${product.id}`);
    const dedupeKey = this.sha256(`${inputFingerprint}:deterministic-free-tune-v1`);
    await this.expireLeases({ companyId, dedupeKey });
    const { task } = await this.createOrReuseTask({
      companyId,
      staffId,
      source,
      productId: product.id,
      idempotencyKey: dto.idempotencyKey,
      kind: ProductImageOptimizationKind.FREE_TUNE,
      contract,
      contractHash,
      inputFingerprint,
      dedupeKey,
    });
    if (task.status !== ProductImageOptimizationStatus.REQUESTED) return this.getForSeller(companyId, task.id);
    if (!await this.queue(task.id)) return this.getForSeller(companyId, task.id);
    await this.runFreeTune(task.id, companyId, staffId, product.id, source, {
      id: plan.id,
      hash: plan.planHash,
      factScanId: factEvidence.id,
    });
    return this.getForSeller(companyId, task.id);
  }

  async getForSeller(companyId: string, optimizationId: string) {
    await this.expireLeases({ id: optimizationId, companyId });
    const task = await this.prisma.productImageOptimization.findFirst({
      where: { id: optimizationId, companyId },
      include: {
        artifacts: {
          where: { kind: ProductImageArtifactKind.CANDIDATE },
          include: { asset: true },
          orderBy: { createdAt: 'asc' },
        },
        mediaRevisions: {
          where: { status: ProductMediaRevisionStatus.PENDING_REVIEW },
          select: { id: true, status: true, productId: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!task) throw new NotFoundException('商品视觉任务不存在');
    return this.toSellerTask(task);
  }

  async cancel(companyId: string, optimizationId: string) {
    await this.expireLeases({ id: optimizationId, companyId });
    const task = await this.prisma.productImageOptimization.findFirst({
      where: { id: optimizationId, companyId },
      select: { id: true, status: true },
    });
    if (!task) throw new NotFoundException('商品视觉任务不存在');
    if (task.status === ProductImageOptimizationStatus.RUNNING) {
      throw new ConflictException('任务正在运行，需等待受控结果或超时对账，不能直接取消');
    }
    assertProductImageOptimizationTransition(task.status, ProductImageOptimizationStatus.CANCELLED);
    const cancelled = await this.prisma.productImageOptimization.updateMany({
      where: { id: task.id, status: task.status },
      data: { status: ProductImageOptimizationStatus.CANCELLED, completedAt: new Date(), failureCode: 'CANCELLED_BY_SELLER' },
    });
    if (cancelled.count !== 1) throw new ConflictException('任务状态已变化，请刷新后重试');
    return this.getForSeller(companyId, optimizationId);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStaleLeases(): Promise<number> {
    const expired = await this.expireLeases({});
    await this.retireUnlinkedCandidateAssets();
    return expired;
  }

  async adopt(
    companyId: string,
    staffId: string,
    optimizationId: string,
    dto: AdoptProductImageOptimizationDto,
  ) {
    if (!dto.quantityConfirmed || !dto.labelsConfirmed || !dto.factsConfirmed) {
      throw new ConflictException('请确认数量、包装文字和商品事实均未改变');
    }
    const task = await this.prisma.productImageOptimization.findFirst({
      where: { id: optimizationId, companyId, status: ProductImageOptimizationStatus.SUCCEEDED },
      include: {
        artifacts: {
          where: { kind: { in: [ProductImageArtifactKind.CANDIDATE, ProductImageArtifactKind.FOREGROUND_REFERENCE] } },
          include: { asset: true },
        },
      },
    });
    if (!task) throw new NotFoundException('可采用的商品视觉任务不存在');
    if (task.productId !== dto.productId) {
      throw new ConflictException('该候选仅可用于创建任务时绑定的商品');
    }
    const candidate = task.artifacts.find((artifact) => artifact.kind === ProductImageArtifactKind.CANDIDATE && artifact.asset);
    const source = task.artifacts.find((artifact) => artifact.kind === ProductImageArtifactKind.FOREGROUND_REFERENCE && artifact.asset);
    const candidateAsset = candidate?.asset;
    const sourceAsset = source?.asset;
    if (!candidateAsset || !sourceAsset
      || candidateAsset.status !== SellerMediaAssetStatus.CANDIDATE
      || sourceAsset.status !== SellerMediaAssetStatus.AVAILABLE) {
      throw new ConflictException('候选或原实拍资产状态不可采用');
    }
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId },
      select: { id: true, status: true, auditStatus: true },
    });
    if (!product) throw new NotFoundException('关联商品不存在');

    const attestation = {
      quantityConfirmed: true,
      labelsConfirmed: true,
      factsConfirmed: true,
    };
    if (product.status === 'ACTIVE' && product.auditStatus === 'APPROVED') {
      const revision = await this.mediaRevisions.applyOptimizationAdoption({
        companyId,
        staffId,
        productId: product.id,
        optimizationId,
        candidateAssetId: candidateAsset.id,
        sourceAssetId: sourceAsset.id,
        attestation,
      });
      return { mode: 'APPLIED' as const, revisionId: revision.id, taskId: optimizationId };
    }

    const unpublishedOutcome = await this.prisma.$transaction(async (tx) => {
      const activeTask = await tx.productImageOptimization.findFirst({
        where: { id: optimizationId, companyId, productId: dto.productId, status: ProductImageOptimizationStatus.SUCCEEDED },
        select: { id: true },
      });
      const activeProduct = await tx.product.findFirst({
        where: { id: dto.productId, companyId },
        include: { media: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!activeTask || !activeProduct) throw new ConflictException('任务或商品状态已变化，请刷新后重试');
      if (activeProduct.status === 'ACTIVE' && activeProduct.auditStatus === 'APPROVED') {
        // The product crossed the publication boundary after the first read.
        // Leave media untouched in this transaction, then use the dedicated
        // immediate-publication path with its own CAS and history record.
        return { kind: 'NOW_PUBLIC' as const };
      }
      const sourceIsAttached = activeProduct.media.some((media) => media.assetId === sourceAsset.id);
      if (!sourceIsAttached) {
        throw new ConflictException('原实拍图已不再属于该商品，不能采用候选');
      }
      const finalMediaCount = activeProduct.media.length + 1;
      if (finalMediaCount > 9) {
        throw new ConflictException('采用候选后商品图片将超过 9 张，请先移除一张非证据图片');
      }
      const assetRows = await tx.sellerMediaAsset.findMany({
        where: {
          id: { in: [candidateAsset.id, sourceAsset.id] },
          companyId,
          purpose: 'PRODUCT_IMAGE',
          deletedAt: null,
        },
        select: { id: true, status: true, objectKey: true },
      });
      const assetsById = new Map(assetRows.map((asset) => [asset.id, asset]));
      if (assetsById.get(candidateAsset.id)?.status !== SellerMediaAssetStatus.CANDIDATE
        || assetsById.get(sourceAsset.id)?.status !== SellerMediaAssetStatus.AVAILABLE) {
        throw new ConflictException('候选或原实拍资产状态已变化');
      }
      await tx.productMedia.updateMany({ where: { productId: activeProduct.id }, data: { sortOrder: { increment: 1 } } });
      await tx.productMedia.updateMany({
        where: { productId: activeProduct.id, assetId: sourceAsset.id },
        data: { isEvidenceImage: true },
      });
      await tx.productMedia.create({
        data: {
          productId: activeProduct.id,
          assetId: candidateAsset.id,
          type: 'IMAGE',
          url: this.uploadService.createProductMediaUrl(assetsById.get(candidateAsset.id)!.objectKey),
          sortOrder: 0,
          visualOrigin: task.kind === ProductImageOptimizationKind.FREE_TUNE
            ? ProductMediaVisualOrigin.DETERMINISTIC_ENHANCEMENT
            : task.kind === ProductImageOptimizationKind.BACKGROUND_GENERATION
              ? ProductMediaVisualOrigin.AI_BACKGROUND
              : ProductMediaVisualOrigin.DETERMINISTIC_COMPOSITE,
          optimizationId,
          isEvidenceImage: false,
        },
      });
      const candidateAdopted = await tx.sellerMediaAsset.updateMany({
        where: { id: candidateAsset.id, status: SellerMediaAssetStatus.CANDIDATE },
        data: { status: SellerMediaAssetStatus.ADOPTED },
      });
      if (candidateAdopted.count !== 1) throw new ConflictException('候选资产状态已变化，不能采用');
      const adopted = await tx.productImageOptimization.updateMany({
        where: { id: optimizationId, status: ProductImageOptimizationStatus.SUCCEEDED },
        data: { status: ProductImageOptimizationStatus.ADOPTED, adoptedAt: new Date(), adoptedByStaffId: staffId },
      });
      if (adopted.count !== 1) throw new ConflictException('任务状态已变化，不能采用');
      return { kind: 'UNPUBLISHED_APPLIED' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (unpublishedOutcome.kind === 'NOW_PUBLIC') {
      const revision = await this.mediaRevisions.applyOptimizationAdoption({
        companyId,
        staffId,
        productId: dto.productId,
        optimizationId,
        candidateAssetId: candidateAsset.id,
        sourceAssetId: sourceAsset.id,
        attestation,
      });
      return { mode: 'APPLIED' as const, revisionId: revision.id, taskId: optimizationId };
    }
    return { mode: 'APPLIED_TO_UNPUBLISHED_PRODUCT' as const, task: await this.getForSeller(companyId, optimizationId) };
  }

  private async createOrReuseTask(input: {
    companyId: string;
    staffId: string;
    source: { id: string; objectKey: string; canonicalSha256: string; mimeType: string; byteSize: number; width: number; height: number };
    productId: string;
    idempotencyKey: string;
    kind: ProductImageOptimizationKind;
    contract: DeterministicProductImageContract;
    contractHash: string;
    inputFingerprint: string;
    dedupeKey: string;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const idempotent = await tx.productImageOptimization.findUnique({
          where: { companyId_idempotencyKey: { companyId: input.companyId, idempotencyKey: input.idempotencyKey } },
        });
        if (idempotent) {
          this.assertTaskInputMatches(idempotent, input);
          return { task: idempotent, created: false };
        }
        const cached = await tx.productImageOptimization.findFirst({
          where: {
            companyId: input.companyId,
            dedupeKey: input.dedupeKey,
            status: ProductImageOptimizationStatus.SUCCEEDED,
          },
          orderBy: { completedAt: 'desc' },
        });
        if (cached) return { task: cached, created: false };
        const task = await tx.productImageOptimization.create({
          data: {
            companyId: input.companyId,
            productId: input.productId,
            kind: input.kind,
            processingContract: input.contract as unknown as Prisma.InputJsonValue,
            contractHash: input.contractHash,
            inputFingerprint: input.inputFingerprint,
            templateVersion: input.contract.version,
            provider: input.contract.provider,
            costTier: 'FREE',
            reservedCostCents: 0,
            requestedByStaffId: input.staffId,
            idempotencyKey: input.idempotencyKey,
            dedupeKey: input.dedupeKey,
          },
        });
        const foregroundArtifact = await tx.productImageArtifact.create({
          data: {
            optimizationId: task.id,
            kind: ProductImageArtifactKind.FOREGROUND_REFERENCE,
            assetId: input.source.id,
            objectKey: input.source.objectKey,
            sha256: input.source.canonicalSha256,
            mimeType: input.source.mimeType,
            byteSize: input.source.byteSize,
            width: input.source.width,
            height: input.source.height,
          },
        });
        await tx.productImageAssetLineage.create({
          data: {
            optimizationId: task.id,
            sourceAssetId: input.source.id,
            artifactId: foregroundArtifact.id,
            role: ProductImageAssetLineageRole.PRIMARY_SOURCE,
          },
        });
        return { task, created: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.productImageOptimization.findFirst({
          where: {
            companyId: input.companyId,
            OR: [
              { idempotencyKey: input.idempotencyKey },
              {
                dedupeKey: input.dedupeKey,
                status: {
                  in: [
                    ProductImageOptimizationStatus.REQUESTED,
                    ProductImageOptimizationStatus.QUEUED,
                    ProductImageOptimizationStatus.RUNNING,
                    ProductImageOptimizationStatus.RECONCILING,
                  ],
                },
              },
            ],
          },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) {
          this.assertTaskInputMatches(existing, input);
          return { task: existing, created: false };
        }
      }
      throw error;
    }
  }

  private assertTaskInputMatches(
    task: { productId: string | null; inputFingerprint: string; kind: ProductImageOptimizationKind },
    input: { productId: string; inputFingerprint: string; kind: ProductImageOptimizationKind },
  ) {
    if (task.productId !== input.productId || task.inputFingerprint !== input.inputFingerprint || task.kind !== input.kind) {
      throw new ConflictException('幂等键已用于另一张商品图片或商品');
    }
  }

  /** The asset JSON is only a pointer; the immutable fact-scan is the gate. */
  private async assertFreeTuneFactEvidence(
    companyId: string,
    productId: string,
    source: { id: string; canonicalSha256: string; scanSummary: unknown },
  ): Promise<{ id: string; createdAt: Date }> {
    const summary = source.scanSummary as {
      ocrTextVerifiedEmpty?: boolean;
      ocrFactScanId?: string;
      ocrFactScanSourceHash?: string;
      ocrFactScanPolicyVersion?: string;
    } | null;
    if (!summary?.ocrTextVerifiedEmpty || !summary.ocrFactScanId
      || summary.ocrFactScanSourceHash !== source.canonicalSha256
      || summary.ocrFactScanPolicyVersion !== 'product-image-fact-scan-v1') {
      throw new ConflictException('免费实景增强需要当前有效的 OCR、QR 和条码事实扫描证据');
    }
    const evidence = await this.prisma.productImageFactScan.findFirst({
      where: {
        id: summary.ocrFactScanId,
        companyId,
        productId,
        sourceAssetId: source.id,
        sourceCanonicalHash: source.canonicalSha256,
        status: ProductImageFactScanStatus.VERIFIED_EMPTY,
        emptyTextQrVerified: true,
        policyVersion: 'product-image-fact-scan-v1',
        expiresAt: { gt: new Date() },
        invocation: { is: { status: VisualAgentInvocationStatus.SUCCEEDED, provider: 'BAILIAN_QWEN_OCR' } },
      },
      select: { id: true, createdAt: true },
    });
    if (!evidence) throw new ConflictException('OCR、QR 或条码事实扫描证据已过期、失效或未完成对账');
    const newerScan = await this.prisma.productImageFactScan.findFirst({
      where: {
        companyId,
        productId,
        sourceAssetId: source.id,
        sourceCanonicalHash: source.canonicalSha256,
        createdAt: { gt: evidence.createdAt },
        status: {
          in: [
            ProductImageFactScanStatus.SCANNING,
            ProductImageFactScanStatus.FACTS_DETECTED,
            ProductImageFactScanStatus.INCONCLUSIVE,
            ProductImageFactScanStatus.RECONCILING,
          ],
        },
      },
      select: { id: true },
    });
    if (newerScan) throw new ConflictException('存在更新的 OCR、QR 或条码事实扫描结论，旧证据不能继续放行免费增强');
    return evidence;
  }

  private async queue(taskId: string): Promise<boolean> {
    const queued = await this.prisma.productImageOptimization.updateMany({
      where: { id: taskId, status: ProductImageOptimizationStatus.REQUESTED },
      data: { status: ProductImageOptimizationStatus.QUEUED },
    });
    return queued.count === 1;
  }

  private async runWhiteBackground(taskId: string, companyId: string, staffId: string, sourceObjectKey: string) {
    const leaseToken = randomUUID();
    const claimed = await this.prisma.productImageOptimization.updateMany({
      where: { id: taskId, companyId, status: ProductImageOptimizationStatus.QUEUED, leaseToken: null },
      data: {
        status: ProductImageOptimizationStatus.RUNNING,
        leaseGeneration: { increment: 1 },
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
        attemptCount: { increment: 1 },
        startedAt: new Date(),
      },
    });
    if (claimed.count !== 1) return;
    const lease = await this.prisma.productImageOptimization.findFirst({
      where: { id: taskId, companyId, status: ProductImageOptimizationStatus.RUNNING, leaseToken },
      select: { leaseGeneration: true },
    });
    if (!lease) return;
    const leaseGeneration = lease.leaseGeneration;
    let uncommittedCandidateAssetId: string | null = null;

    try {
      const sourceBuffer = await this.uploadService.getBuffer(sourceObjectKey);
      const composed = await this.composition.composeWhiteBackgroundWithProof(sourceBuffer, WHITE_BACKGROUND_CONTRACT.canvas);
      const candidate = await this.mediaAssets.createDerivedProductImageAsset(
        companyId,
        staffId,
        {
          buffer: composed.buffer,
          size: composed.buffer.length,
          mimetype: 'image/png',
          originalname: 'truth-locked-white-background.png',
        } as Express.Multer.File,
      );
      uncommittedCandidateAssetId = candidate.asset.id;
      const committed = await this.prisma.$transaction(async (tx) => {
        const active = await tx.productImageOptimization.findFirst({
          where: {
            id: taskId,
            companyId,
            status: ProductImageOptimizationStatus.RUNNING,
            leaseToken,
            leaseGeneration,
            leaseExpiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (!active) return false;
        const candidateArtifact = await tx.productImageArtifact.create({
          data: {
            optimizationId: taskId,
            kind: ProductImageArtifactKind.CANDIDATE,
            assetId: candidate.asset.id,
            objectKey: candidate.asset.objectKey,
            sha256: candidate.asset.canonicalSha256,
            mimeType: candidate.asset.mimeType,
            byteSize: candidate.asset.byteSize,
            width: candidate.asset.width,
            height: candidate.asset.height,
            isAigc: false,
            metadata: { integrityProof: composed.proof } as Prisma.InputJsonValue,
          },
        });
        const sourceArtifact = await tx.productImageArtifact.findFirstOrThrow({
          where: { optimizationId: taskId, kind: ProductImageArtifactKind.FOREGROUND_REFERENCE },
          select: { assetId: true },
        });
        await tx.productImageAssetLineage.create({
          data: {
            optimizationId: taskId,
            sourceAssetId: sourceArtifact.assetId!,
            artifactId: candidateArtifact.id,
            role: ProductImageAssetLineageRole.FOREGROUND_REFERENCE,
          },
        });
        const done = await tx.productImageOptimization.updateMany({
          where: {
            id: taskId,
            status: ProductImageOptimizationStatus.RUNNING,
            leaseToken,
            leaseGeneration,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            status: ProductImageOptimizationStatus.SUCCEEDED,
            actualCostCents: 0,
            completedAt: new Date(),
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (done.count !== 1) throw new ConflictException('任务租约已失效，候选图片未采用');
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (!committed) throw new ConflictException('任务租约已失效，候选图片未采用');
      uncommittedCandidateAssetId = null;
    } catch (error) {
      const failureCode = error instanceof BadRequestException
        ? 'TRANSPARENT_FOREGROUND_REQUIRED'
        : 'DETERMINISTIC_RENDER_FAILED';
      await this.prisma.productImageOptimization.updateMany({
        where: { id: taskId, companyId, status: ProductImageOptimizationStatus.RUNNING, leaseToken, leaseGeneration },
        data: {
          status: ProductImageOptimizationStatus.FAILED,
          failureCode,
          failureDetail: error instanceof Error ? error.message.slice(0, 400) : '未知渲染错误',
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (uncommittedCandidateAssetId) {
        try {
          await this.prisma.sellerMediaAsset.updateMany({
            where: {
              id: uncommittedCandidateAssetId,
              companyId,
              status: SellerMediaAssetStatus.CANDIDATE,
            },
            data: { status: SellerMediaAssetStatus.RETIRED },
          });
        } catch (cleanupError) {
          this.logger.error(`未提交候选资产退役失败: ${(cleanupError as Error).message}`);
        }
      }
    }
  }

  private async runFreeTune(
    taskId: string,
    companyId: string,
    staffId: string,
    productId: string,
    source: { id: string; objectKey: string; canonicalSha256: string },
    planRef: { id: string; hash: string; factScanId: string },
  ) {
    const leaseToken = randomUUID();
    const claimed = await this.prisma.productImageOptimization.updateMany({
      where: { id: taskId, companyId, productId, kind: ProductImageOptimizationKind.FREE_TUNE, status: ProductImageOptimizationStatus.QUEUED, leaseToken: null },
      data: {
        status: ProductImageOptimizationStatus.RUNNING,
        leaseGeneration: { increment: 1 },
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
        attemptCount: { increment: 1 },
        startedAt: new Date(),
      },
    });
    if (claimed.count !== 1) return;
    const lease = await this.prisma.productImageOptimization.findFirst({
      where: { id: taskId, companyId, productId, kind: ProductImageOptimizationKind.FREE_TUNE, status: ProductImageOptimizationStatus.RUNNING, leaseToken },
      select: { leaseGeneration: true },
    });
    if (!lease) return;

    let uncommittedCandidateAssetId: string | null = null;
    try {
      const [currentPlan, sourceStillAttached] = await Promise.all([
        this.prisma.productVisualPlan.findFirst({
          where: {
            id: planRef.id,
            companyId,
            sourceAssetId: source.id,
            sourceHash: source.canonicalSha256,
            planHash: planRef.hash,
            riskProfile: 'STANDARD_FACTS',
            expiresAt: { gt: new Date() },
          },
          select: { id: true, allowedModes: true, modelPolicyVersion: true, protectedRegionVersion: true },
        }),
        this.prisma.product.findFirst({
          where: { id: productId, companyId, media: { some: { assetId: source.id } } },
          select: { id: true },
        }),
      ]);
      const currentSource = await this.prisma.sellerMediaAsset.findFirst({
        where: { id: source.id, companyId, canonicalSha256: source.canonicalSha256, status: SellerMediaAssetStatus.AVAILABLE, deletedAt: null },
        select: { id: true, scanSummary: true },
      });
      if (!currentPlan || !currentPlan.allowedModes.includes('PRESERVE_REAL_SCENE')
        || currentPlan.modelPolicyVersion !== 'model-policy-disabled-v1'
        || currentPlan.protectedRegionVersion !== 'NOT_CREATED'
        || !sourceStillAttached) {
        throw new ConflictException('免费实景增强计划或商品原图绑定已失效');
      }
      if (!currentSource) {
        throw new ConflictException('免费实景增强原图已失效');
      }
      // The request-side check closes the fast path; repeat the immutable
      // database-backed evidence check after the lease is claimed so a newer
      // scan conclusion cannot race a queued deterministic render.
      const currentFactEvidence = await this.assertFreeTuneFactEvidence(companyId, productId, {
        ...source,
        scanSummary: currentSource.scanSummary,
      });
      if (currentFactEvidence.id !== planRef.factScanId) {
        throw new ConflictException('免费实景增强所依据的事实扫描已变化');
      }
      const sourceBuffer = await this.uploadService.getBuffer(source.objectKey);
      const enhanced = await this.composition.enhanceStandardRealScene(sourceBuffer);
      const candidate = await this.mediaAssets.createDerivedProductImageAsset(
        companyId,
        staffId,
        {
          buffer: enhanced.buffer,
          size: enhanced.buffer.length,
          mimetype: 'image/png',
          originalname: 'pixel-aligned-free-tune.png',
        } as Express.Multer.File,
      );
      uncommittedCandidateAssetId = candidate.asset.id;
      const committed = await this.prisma.$transaction(async (tx) => {
        const active = await tx.productImageOptimization.findFirst({
          where: {
            id: taskId,
            companyId,
            productId,
            kind: ProductImageOptimizationKind.FREE_TUNE,
            status: ProductImageOptimizationStatus.RUNNING,
            leaseToken,
            leaseGeneration: lease.leaseGeneration,
            leaseExpiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (!active) return false;
        const candidateArtifact = await tx.productImageArtifact.create({
          data: {
            optimizationId: taskId,
            kind: ProductImageArtifactKind.CANDIDATE,
            assetId: candidate.asset.id,
            objectKey: candidate.asset.objectKey,
            sha256: candidate.asset.canonicalSha256,
            mimeType: candidate.asset.mimeType,
            byteSize: candidate.asset.byteSize,
            width: candidate.asset.width,
            height: candidate.asset.height,
            isAigc: false,
            metadata: {
              integrityProof: enhanced.proof,
              contractVersion: FREE_TUNE_CONTRACT.version,
              factEvidence: {
                id: planRef.factScanId,
                sourceHash: source.canonicalSha256,
                policyVersion: 'product-image-fact-scan-v1',
              },
            } as Prisma.InputJsonValue,
          },
        });
        const sourceArtifact = await tx.productImageArtifact.findFirstOrThrow({
          where: { optimizationId: taskId, kind: ProductImageArtifactKind.FOREGROUND_REFERENCE },
          select: { assetId: true },
        });
        if (sourceArtifact.assetId !== source.id) {
          throw new ConflictException('免费实景增强任务的原图证据已不匹配');
        }
        await tx.productImageAssetLineage.create({
          data: {
            optimizationId: taskId,
            sourceAssetId: sourceArtifact.assetId!,
            artifactId: candidateArtifact.id,
            role: ProductImageAssetLineageRole.FOREGROUND_REFERENCE,
          },
        });
        const done = await tx.productImageOptimization.updateMany({
          where: {
            id: taskId,
            productId,
            kind: ProductImageOptimizationKind.FREE_TUNE,
            status: ProductImageOptimizationStatus.RUNNING,
            leaseToken,
            leaseGeneration: lease.leaseGeneration,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            status: ProductImageOptimizationStatus.SUCCEEDED,
            actualCostCents: 0,
            completedAt: new Date(),
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (done.count !== 1) throw new ConflictException('免费实景增强任务租约已失效，候选图片未采用');
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (!committed) throw new ConflictException('免费实景增强任务租约已失效，候选图片未采用');
      uncommittedCandidateAssetId = null;
    } catch (error) {
      await this.prisma.productImageOptimization.updateMany({
        where: {
          id: taskId,
          companyId,
          productId,
          kind: ProductImageOptimizationKind.FREE_TUNE,
          status: ProductImageOptimizationStatus.RUNNING,
          leaseToken,
          leaseGeneration: lease.leaseGeneration,
        },
        data: {
          status: ProductImageOptimizationStatus.FAILED,
          failureCode: 'FREE_TUNE_RENDER_FAILED',
          failureDetail: error instanceof Error ? error.message.slice(0, 400) : '免费实景增强失败',
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (uncommittedCandidateAssetId) {
        try {
          await this.prisma.sellerMediaAsset.updateMany({
            where: { id: uncommittedCandidateAssetId, companyId, status: SellerMediaAssetStatus.CANDIDATE },
            data: { status: SellerMediaAssetStatus.RETIRED },
          });
        } catch (cleanupError) {
          this.logger.error(`免费实景增强未提交候选资产退役失败: ${(cleanupError as Error).message}`);
        }
      }
    }
  }

  private async expireLeases(scope: Prisma.ProductImageOptimizationWhereInput): Promise<number> {
    const now = new Date();
    // The only runner implemented in this service is deterministic Sharp and
    // has no external charge. Its expired lease is a safe terminal failure.
    const free = await this.prisma.productImageOptimization.updateMany({
      where: {
        ...scope,
        kind: { in: [ProductImageOptimizationKind.WHITE_BACKGROUND, ProductImageOptimizationKind.FREE_TUNE] },
        costTier: 'FREE',
        status: ProductImageOptimizationStatus.RUNNING,
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: ProductImageOptimizationStatus.FAILED,
        failureCode: 'LEASE_EXPIRED',
        failureDetail: '免费保真渲染任务租约到期，候选结果未提交，已安全结束',
        completedAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    // A future paid provider may have accepted the request before a process
    // died. Keep its dedupe lock and reserve intact until provider/billing
    // reconciliation reaches a definite terminal result.
    const paid = await this.prisma.productImageOptimization.updateMany({
      where: {
        ...scope,
        costTier: 'PAID',
        status: ProductImageOptimizationStatus.RUNNING,
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: ProductImageOptimizationStatus.RECONCILING,
        failureCode: 'LEASE_RECONCILIATION_REQUIRED',
        failureDetail: '供应商请求结果未知，等待任务和费用对账',
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    return free.count + paid.count;
  }

  private async retireUnlinkedCandidateAssets(): Promise<number> {
    const staleBefore = new Date(Date.now() - 6 * 60_000);
    const result = await this.prisma.sellerMediaAsset.updateMany({
      where: {
        purpose: 'PRODUCT_IMAGE',
        status: SellerMediaAssetStatus.CANDIDATE,
        deletedAt: null,
        createdAt: { lt: staleBefore },
        OR: [
          { imageArtifacts: { none: {} } },
          {
            imageArtifacts: {
              some: {
                kind: ProductImageArtifactKind.CANDIDATE,
                optimization: { is: { productId: null } },
              },
            },
          },
        ],
      },
      data: { status: SellerMediaAssetStatus.RETIRED },
    });
    return result.count;
  }

  private async toSellerTask(task: any) {
    const candidate = task.artifacts?.find((artifact: any) => artifact.kind === ProductImageArtifactKind.CANDIDATE && artifact.asset);
    const access = candidate?.asset
      ? await this.uploadService.createPrivateAccessUrl(candidate.asset.objectKey, 300)
      : null;
    return {
      id: task.id,
      status: task.status,
      kind: task.kind,
      productId: task.productId,
      failureCode: task.failureCode,
      failureDetail: task.failureDetail,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      candidate: candidate ? {
        assetId: candidate.asset.id,
        displayUrl: access?.url,
        expiresAt: access?.expiresAt,
        integrityProof: (candidate.metadata as { integrityProof?: unknown } | null)?.integrityProof ?? null,
      } : null,
      pendingReview: task.mediaRevisions?.[0] ?? null,
    };
  }

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
