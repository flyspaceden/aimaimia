import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ProductImageArtifactKind,
  ProductImageAssetLineageRole,
  ProductImageOptimizationStatus,
  ProductMediaVisualOrigin,
  SellerMediaAssetStatus,
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
      const revision = await this.mediaRevisions.requestOptimizationAdoption({
        companyId,
        staffId,
        productId: product.id,
        optimizationId,
        candidateAssetId: candidateAsset.id,
        sourceAssetId: sourceAsset.id,
        attestation,
      });
      return { mode: 'PENDING_REVIEW' as const, revisionId: revision.id, taskId: optimizationId };
    }

    await this.prisma.$transaction(async (tx) => {
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
        throw new ConflictException('商品已上架，请重新提交封面变更审核');
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
      const sourceIsAttached = activeProduct.media.some((media) => media.assetId === sourceAsset.id);
      if (!sourceIsAttached) {
        throw new ConflictException('原实拍图已不再属于该商品，不能采用候选');
      }
      const finalMediaCount = activeProduct.media.length + 1;
      if (finalMediaCount > 9) {
        throw new ConflictException('采用候选后商品图片将超过 9 张，请先移除一张非证据图片');
      }
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
          visualOrigin: ProductMediaVisualOrigin.DETERMINISTIC_COMPOSITE,
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { mode: 'APPLIED_TO_UNPUBLISHED_PRODUCT' as const, task: await this.getForSeller(companyId, optimizationId) };
  }

  private async createOrReuseTask(input: {
    companyId: string;
    staffId: string;
    source: { id: string; objectKey: string; canonicalSha256: string; mimeType: string; byteSize: number; width: number; height: number };
    productId: string;
    idempotencyKey: string;
    contract: typeof WHITE_BACKGROUND_CONTRACT;
    contractHash: string;
    inputFingerprint: string;
    dedupeKey: string;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const idempotent = await tx.productImageOptimization.findUnique({
          where: { companyId_idempotencyKey: { companyId: input.companyId, idempotencyKey: input.idempotencyKey } },
        });
        if (idempotent) return { task: idempotent, created: false };
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
            kind: 'WHITE_BACKGROUND',
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
        if (existing) return { task: existing, created: false };
      }
      throw error;
    }
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

  private async expireLeases(scope: Prisma.ProductImageOptimizationWhereInput): Promise<number> {
    const now = new Date();
    // The only runner implemented in this service is deterministic Sharp and
    // has no external charge. Its expired lease is a safe terminal failure.
    const free = await this.prisma.productImageOptimization.updateMany({
      where: {
        ...scope,
        kind: 'WHITE_BACKGROUND',
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
    };
  }

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
