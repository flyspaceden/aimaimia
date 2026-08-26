import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductImageArtifactKind, ProductImageFactScanStatus, ProductImageOptimizationKind, ProductImageOptimizationStatus, ProductMediaRevisionStatus, ProductMediaVisualOrigin, SellerMediaAssetStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SellerMediaAssetsService } from './seller-media-assets.service';
import { UploadService } from '../upload/upload.service';
import { RequestProductMediaRevisionDto } from './product-media-revision.dto';
import { randomUUID } from 'crypto';

const directlyUsableAssetStatuses: SellerMediaAssetStatus[] = [
  SellerMediaAssetStatus.AVAILABLE,
  SellerMediaAssetStatus.ADOPTED,
];

function visualOriginForOptimization(kind: ProductImageOptimizationKind): ProductMediaVisualOrigin {
  return kind === ProductImageOptimizationKind.FREE_TUNE
    ? ProductMediaVisualOrigin.DETERMINISTIC_ENHANCEMENT
    : ProductMediaVisualOrigin.DETERMINISTIC_COMPOSITE;
}

@Injectable()
export class ProductMediaRevisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: SellerMediaAssetsService,
    private readonly uploadService: UploadService,
  ) {}

  async request(companyId: string, staffId: string, productId: string, dto: RequestProductMediaRevisionDto) {
    if (!dto.quantityConfirmed || !dto.labelsConfirmed || !dto.factsConfirmed) {
      throw new BadRequestException('请确认数量、包装文字和商品事实均未改变');
    }
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      include: { media: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.status !== 'ACTIVE' || product.auditStatus !== 'APPROVED') {
      throw new ConflictException('仅已上架且审核通过的商品可提交封面变更审核');
    }
    const existingByAssetId = new Map(product.media
      .filter((media) => !!media.assetId)
      .map((media) => [media.assetId!, media]));
    const assets = await this.assets.assertOwnedProductImageAssets(companyId, dto.mediaAssetIds, {
      allowedAdoptedAssetIds: [...existingByAssetId.keys()],
    });
    const proposedMedia = assets.map((asset, sortOrder) => {
      const previous = existingByAssetId.get(asset.id);
      return {
        assetId: asset.id,
        sortOrder,
        type: 'IMAGE',
        ...(previous && {
          visualOrigin: previous.visualOrigin,
          optimizationId: previous.optimizationId ?? null,
          isEvidenceImage: previous.isEvidenceImage === true,
        }),
      };
    });
    const preservesOptimization = product.media.some((media) => media.optimizationId)
      || proposedMedia.some((media) => media.optimizationId);
    const evidenceAssetIds = product.media
      .filter((media) => media.isEvidenceImage === true && media.assetId)
      .map((media) => media.assetId!);
    if (preservesOptimization && (evidenceAssetIds.length === 0 || evidenceAssetIds.some((assetId) => !proposedMedia.some((media) => media.assetId === assetId)))) {
      throw new ConflictException('优化图片必须保留原实拍证据图，不能只提交候选图片');
    }
    try {
      return await this.prisma.productMediaRevision.create({
        data: {
          productId,
          companyId,
          expectedMediaVersion: product.mediaVersion,
          proposedMedia: proposedMedia as unknown as Prisma.InputJsonValue,
          requestedByStaffId: staffId,
          attestation: {
            quantityConfirmed: true,
            labelsConfirmed: true,
            factsConfirmed: true,
          },
          idempotencyKey: dto.idempotencyKey,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该商品已有待审核封面变更，或本次请求已提交');
      }
      throw error;
    }
  }

  async requestOptimizationAdoption(input: {
    companyId: string;
    staffId: string;
    productId: string;
    optimizationId: string;
    candidateAssetId: string;
    sourceAssetId: string;
    attestation: { quantityConfirmed: boolean; labelsConfirmed: boolean; factsConfirmed: boolean };
  }) {
    if (!input.attestation.quantityConfirmed || !input.attestation.labelsConfirmed || !input.attestation.factsConfirmed) {
      throw new BadRequestException('请确认数量、包装文字和商品事实均未改变');
    }
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, companyId: input.companyId },
      include: { media: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.status !== 'ACTIVE' || product.auditStatus !== 'APPROVED') {
      throw new ConflictException('仅已上架且审核通过的商品需提交封面变更审核');
    }
    const existingPending = await this.prisma.productMediaRevision.findFirst({
      where: {
        companyId: input.companyId,
        productId: input.productId,
        optimizationId: input.optimizationId,
        status: ProductMediaRevisionStatus.PENDING_REVIEW,
      },
    });
    if (existingPending) return existingPending;
    const task = await this.prisma.productImageOptimization.findFirst({
      where: {
        id: input.optimizationId,
        companyId: input.companyId,
        productId: input.productId,
        status: ProductImageOptimizationStatus.SUCCEEDED,
      },
      include: {
        artifacts: { where: { kind: ProductImageArtifactKind.CANDIDATE }, select: { assetId: true } },
      },
    });
    if (!task || task.artifacts[0]?.assetId !== input.candidateAssetId) {
      throw new ConflictException('候选图片不属于可采用的成功任务');
    }
    if (!product.media.some((media) => media.assetId === input.sourceAssetId)) {
      throw new ConflictException('原实拍图已不再属于该商品，不能提交候选审核');
    }
    const assets = await this.prisma.sellerMediaAsset.findMany({
      where: {
        id: { in: [input.candidateAssetId, input.sourceAssetId, ...product.media.map((media) => media.assetId).filter((id): id is string => !!id) ] },
        companyId: input.companyId,
        purpose: 'PRODUCT_IMAGE',
        deletedAt: null,
      },
      select: { id: true, status: true },
    });
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    if (byId.get(input.candidateAssetId)?.status !== SellerMediaAssetStatus.CANDIDATE
      || byId.get(input.sourceAssetId)?.status !== SellerMediaAssetStatus.AVAILABLE
      || product.media.some((media) => !media.assetId || !directlyUsableAssetStatuses.includes(byId.get(media.assetId)?.status as SellerMediaAssetStatus))) {
      throw new ConflictException('候选或当前商品图片状态不可采用');
    }
    const current = product.media.map((media) => ({
      assetId: media.assetId!,
      sortOrder: media.sortOrder + 1,
      type: media.type,
      visualOrigin: media.visualOrigin,
      optimizationId: media.optimizationId,
      isEvidenceImage: media.isEvidenceImage || media.assetId === input.sourceAssetId,
    }));
    if (!current.some((media) => media.assetId === input.sourceAssetId)) {
      current.push({
        assetId: input.sourceAssetId,
        sortOrder: current.length + 1,
        type: 'IMAGE',
        visualOrigin: ProductMediaVisualOrigin.ORIGINAL,
        optimizationId: null,
        isEvidenceImage: true,
      });
    }
    const proposedMedia = [
      {
        assetId: input.candidateAssetId,
        sortOrder: 0,
        type: 'IMAGE',
        visualOrigin: visualOriginForOptimization(task.kind),
        optimizationId: input.optimizationId,
        isEvidenceImage: false,
      },
      ...current,
    ];
    if (proposedMedia.length > 9) {
      throw new ConflictException('采用候选后商品图片将超过 9 张，请先移除一张非证据图片');
    }
    try {
      return await this.prisma.productMediaRevision.create({
        data: {
          productId: input.productId,
          companyId: input.companyId,
          optimizationId: input.optimizationId,
          expectedMediaVersion: product.mediaVersion,
          proposedMedia: proposedMedia as unknown as Prisma.InputJsonValue,
          requestedByStaffId: input.staffId,
          attestation: input.attestation,
          idempotencyKey: `optimization:${input.optimizationId}:${randomUUID()}`,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const racedPending = await this.prisma.productMediaRevision.findFirst({
          where: {
            companyId: input.companyId,
            productId: input.productId,
            optimizationId: input.optimizationId,
            status: ProductMediaRevisionStatus.PENDING_REVIEW,
          },
        });
        if (racedPending) return racedPending;
        throw new ConflictException('该候选已提交审核或商品已有待审核封面变更');
      }
      throw error;
    }
  }

  async approve(revisionId: string, adminUserId: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const revision = await tx.productMediaRevision.findUnique({
        where: { id: revisionId },
        include: { product: { select: { id: true, companyId: true, mediaVersion: true } } },
      });
      if (!revision) throw new NotFoundException('封面变更申请不存在');
      if (revision.status !== ProductMediaRevisionStatus.PENDING_REVIEW) {
        throw new ConflictException('该封面变更申请已处理');
      }
      const proposed = revision.proposedMedia as Array<{
        assetId?: string;
        sortOrder?: number;
        visualOrigin?: ProductMediaVisualOrigin;
        optimizationId?: string | null;
        isEvidenceImage?: boolean;
      }>;
      if (!Array.isArray(proposed) || proposed.length === 0 || proposed.length > 9) {
        throw new BadRequestException('封面变更媒体快照无效');
      }
      const assetIds = proposed.map((item) => item.assetId).filter((id): id is string => !!id);
      if (assetIds.length !== proposed.length || new Set(assetIds).size !== assetIds.length) {
        throw new BadRequestException('封面变更媒体资产无效');
      }
      const optimizationArtifacts = revision.optimizationId
        ? await tx.productImageArtifact.findMany({
            where: {
              optimizationId: revision.optimizationId,
              kind: { in: [ProductImageArtifactKind.CANDIDATE, ProductImageArtifactKind.FOREGROUND_REFERENCE] },
              optimization: { status: ProductImageOptimizationStatus.SUCCEEDED },
            },
            select: { assetId: true, kind: true, optimization: { select: { kind: true } } },
          })
        : [];
      const candidateArtifact = optimizationArtifacts.find((artifact) => artifact.kind === ProductImageArtifactKind.CANDIDATE);
      const foregroundArtifact = optimizationArtifacts.find((artifact) => artifact.kind === ProductImageArtifactKind.FOREGROUND_REFERENCE);
      if (revision.optimizationId && (!candidateArtifact?.assetId || !foregroundArtifact?.assetId)) {
        throw new ConflictException('候选优化任务已不可采用');
      }
      const assets = await tx.sellerMediaAsset.findMany({
        where: { id: { in: assetIds }, companyId: revision.companyId, purpose: 'PRODUCT_IMAGE', deletedAt: null },
      });
      if (assets.length !== assetIds.length) throw new ConflictException('图片资产已不可用');
      const candidateAssetId = candidateArtifact?.assetId;
      if (assets.some((asset) => !directlyUsableAssetStatuses.includes(asset.status) && asset.id !== candidateAssetId)) {
        throw new ConflictException('候选图片不能绕过显式采用流程');
      }
      if (candidateAssetId) {
        const candidateProposal = proposed.filter((item) => item.assetId === candidateAssetId);
        const candidateOrigin = candidateArtifact?.optimization?.kind
          ? visualOriginForOptimization(candidateArtifact.optimization.kind)
          : null;
        if (candidateProposal.length !== 1
          || candidateProposal[0].visualOrigin !== candidateOrigin
          || candidateProposal[0].optimizationId !== revision.optimizationId
          || !proposed.some((item) => item.isEvidenceImage === true && item.assetId === foregroundArtifact!.assetId)) {
          throw new ConflictException('候选采用必须保留一张原实拍证据图');
        }
      }
      if (assets.some((asset) => (asset.scanSummary as { needsReview?: boolean } | null)?.needsReview === true)) {
        throw new ConflictException('图片仍需人工安全复核，不能通过封面变更');
      }
      const byId = new Map(assets.map((asset) => [asset.id, asset]));
      const media = proposed.map((item, index) => {
        const asset = byId.get(item.assetId!)!;
        return {
          assetId: asset.id,
          type: 'IMAGE' as const,
          url: this.uploadService.createProductMediaUrl(asset.objectKey),
          sortOrder: item.sortOrder ?? index,
          visualOrigin: item.visualOrigin ?? ProductMediaVisualOrigin.ORIGINAL,
          optimizationId: item.optimizationId ?? null,
          isEvidenceImage: item.isEvidenceImage === true,
        };
      });
      const cas = await tx.product.updateMany({
        where: {
          id: revision.productId,
          companyId: revision.companyId,
          mediaVersion: revision.expectedMediaVersion,
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
        },
        data: { mediaVersion: { increment: 1 } },
      });
      if (cas.count !== 1) {
        await tx.productMediaRevision.update({
          where: { id: revisionId },
          data: { status: ProductMediaRevisionStatus.EXPIRED, reviewedByAdminId: adminUserId, reviewedAt: new Date(), reviewNote: '商品状态或媒体已更新，请商家重新提交' },
        });
        // Return normally so the EXPIRED state commits; report the conflict
        // only after the serializable transaction has closed.
        return { kind: 'EXPIRED' as const };
      }
      await tx.productMedia.deleteMany({ where: { productId: revision.productId } });
      await tx.productMedia.createMany({ data: media.map((item) => ({ productId: revision.productId, ...item })) });
      if (revision.optimizationId) {
        const candidateAdopted = await tx.sellerMediaAsset.updateMany({
          where: { id: candidateAssetId!, status: SellerMediaAssetStatus.CANDIDATE },
          data: { status: SellerMediaAssetStatus.ADOPTED },
        });
        if (candidateAdopted.count !== 1) throw new ConflictException('候选资产状态已变化，不能采用');
        const adopted = await tx.productImageOptimization.updateMany({
          where: { id: revision.optimizationId, status: ProductImageOptimizationStatus.SUCCEEDED },
          data: { status: ProductImageOptimizationStatus.ADOPTED, adoptedAt: new Date() },
        });
        if (adopted.count !== 1) throw new ConflictException('候选优化任务状态已变化，不能采用');
      }
      const revisionResult = await tx.productMediaRevision.update({
        where: { id: revisionId },
        data: { status: ProductMediaRevisionStatus.APPROVED, reviewedByAdminId: adminUserId, reviewedAt: new Date(), appliedAt: new Date() },
      });
      return { kind: 'APPROVED' as const, revision: revisionResult };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (outcome.kind === 'EXPIRED') {
      throw new ConflictException('商品状态或图片已更新，封面变更申请已过期');
    }
    return outcome.revision;
  }

  async reject(revisionId: string, adminUserId: string, reviewNote: string) {
    if (!reviewNote.trim()) throw new BadRequestException('请填写驳回原因');
    return this.prisma.$transaction(async (tx) => {
      const revision = await tx.productMediaRevision.findUnique({ where: { id: revisionId } });
      if (!revision || revision.status !== ProductMediaRevisionStatus.PENDING_REVIEW) {
        throw new ConflictException('该封面变更申请已处理或不存在');
      }
      const updated = await tx.productMediaRevision.updateMany({
        where: { id: revisionId, status: ProductMediaRevisionStatus.PENDING_REVIEW },
        data: { status: ProductMediaRevisionStatus.REJECTED, reviewedByAdminId: adminUserId, reviewedAt: new Date(), reviewNote },
      });
      if (updated.count !== 1) throw new ConflictException('该封面变更申请已处理或不存在');
      if (revision.optimizationId) {
        const candidateArtifact = await tx.productImageArtifact.findFirst({
          where: { optimizationId: revision.optimizationId, kind: ProductImageArtifactKind.CANDIDATE },
          select: { assetId: true },
        });
        const rejected = await tx.productImageOptimization.updateMany({
          where: { id: revision.optimizationId, status: ProductImageOptimizationStatus.SUCCEEDED },
          data: {
            status: ProductImageOptimizationStatus.REJECTED,
            failureCode: 'MEDIA_REVISION_REJECTED',
            failureDetail: reviewNote.slice(0, 400),
            completedAt: new Date(),
          },
        });
        if (rejected.count !== 1) throw new ConflictException('候选任务状态已变化，不能驳回审核');
        if (candidateArtifact?.assetId) {
          await tx.sellerMediaAsset.updateMany({
            where: { id: candidateArtifact.assetId, status: SellerMediaAssetStatus.CANDIDATE },
            data: { status: SellerMediaAssetStatus.RETIRED },
          });
        }
      }
      return tx.productMediaRevision.findUniqueOrThrow({ where: { id: revisionId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listPendingForAdmin() {
    return this.prisma.productMediaRevision.findMany({
      where: { status: ProductMediaRevisionStatus.PENDING_REVIEW },
      orderBy: { createdAt: 'asc' },
      include: {
        product: { select: { id: true, title: true, mediaVersion: true } },
        company: { select: { id: true, name: true } },
      },
    });
  }

  async getForAdmin(revisionId: string) {
    const revision = await this.prisma.productMediaRevision.findUnique({
      where: { id: revisionId },
      include: {
        product: {
          select: {
            id: true,
            title: true,
            status: true,
            auditStatus: true,
            mediaVersion: true,
            media: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, sortOrder: true } },
          },
        },
        company: { select: { id: true, name: true } },
        optimization: {
          select: {
            id: true,
            kind: true,
            status: true,
            provider: true,
            costTier: true,
            templateVersion: true,
            processingContract: true,
            createdAt: true,
            artifacts: {
              where: { kind: { in: [ProductImageArtifactKind.CANDIDATE, ProductImageArtifactKind.FOREGROUND_REFERENCE] } },
              select: { kind: true, assetId: true, metadata: true },
            },
          },
        },
      },
    });
    if (!revision) throw new NotFoundException('封面变更申请不存在');

    const proposed = revision.proposedMedia as Array<{
      assetId?: string;
      sortOrder?: number;
      type?: string;
      visualOrigin?: ProductMediaVisualOrigin;
      isEvidenceImage?: boolean;
    }>;
    if (!Array.isArray(proposed) || proposed.length === 0 || proposed.length > 9) {
      throw new BadRequestException('封面变更媒体快照无效');
    }
    const assetIds = proposed.map((item) => item.assetId).filter((id): id is string => !!id);
    if (assetIds.length !== proposed.length || new Set(assetIds).size !== assetIds.length) {
      throw new BadRequestException('封面变更媒体资产无效');
    }
    const assets = await this.prisma.sellerMediaAsset.findMany({
      where: { id: { in: assetIds }, companyId: revision.companyId, purpose: 'PRODUCT_IMAGE', deletedAt: null },
      select: { id: true, scanSummary: true, objectKey: true, width: true, height: true },
    });
    if (assets.length !== assetIds.length) throw new ConflictException('候选图片资产已不可用');
    if (assets.some((asset) => (asset.scanSummary as { needsReview?: boolean } | null)?.needsReview === true)) {
      throw new ConflictException('候选图片仍需人工安全复核');
    }
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const candidateArtifact = revision.optimization?.artifacts.find((artifact) => artifact.kind === ProductImageArtifactKind.CANDIDATE);
    const sourceArtifact = revision.optimization?.artifacts.find((artifact) => artifact.kind === ProductImageArtifactKind.FOREGROUND_REFERENCE);
    const factEvidenceId = this.factEvidenceId(candidateArtifact?.metadata)
      ?? this.factEvidenceId(revision.optimization?.processingContract);
    const factScan = factEvidenceId && sourceArtifact?.assetId
      ? await this.prisma.productImageFactScan.findFirst({
          where: {
            id: factEvidenceId,
            companyId: revision.companyId,
            productId: revision.productId,
            sourceAssetId: sourceArtifact.assetId,
          },
          select: {
            id: true,
            status: true,
            textDetected: true,
            qrCodesDetected: true,
            barcodeStatus: true,
            emptyTextQrVerified: true,
            failureCode: true,
            completedAt: true,
            expiresAt: true,
          },
        })
      : null;
    const proposedMedia = await Promise.all(proposed.map(async (item, index) => {
      const asset = byId.get(item.assetId!)!;
      const access = await this.uploadService.createPrivateAccessUrl(asset.objectKey, 300);
      return {
        assetId: asset.id,
        sortOrder: item.sortOrder ?? index,
        width: asset.width,
        height: asset.height,
        displayUrl: access.url,
        expiresAt: access.expiresAt,
        visualOrigin: item.visualOrigin ?? ProductMediaVisualOrigin.ORIGINAL,
        isEvidenceImage: item.isEvidenceImage === true,
      };
    }));

    return {
      revision: {
        id: revision.id,
        status: revision.status,
        expectedMediaVersion: revision.expectedMediaVersion,
        attestation: revision.attestation,
        createdAt: revision.createdAt,
        reviewNote: revision.reviewNote,
      },
      product: revision.product,
      company: revision.company,
      proposedMedia,
      reviewContext: {
        optimization: revision.optimization ? {
          id: revision.optimization.id,
          kind: revision.optimization.kind,
          status: revision.optimization.status,
          provider: revision.optimization.provider,
          costTier: revision.optimization.costTier,
          templateVersion: revision.optimization.templateVersion,
          createdAt: revision.optimization.createdAt,
        } : null,
        factScan: factScan ? {
          id: factScan.id,
          status: factScan.status,
          textDetected: factScan.textDetected,
          qrCodesDetected: factScan.qrCodesDetected,
          barcodeStatus: factScan.barcodeStatus,
          emptyTextQrVerified: factScan.emptyTextQrVerified,
          freeTuneEligible: factScan.status === ProductImageFactScanStatus.VERIFIED_EMPTY
            && factScan.emptyTextQrVerified
            && factScan.expiresAt > new Date(),
          failureCode: factScan.failureCode,
          completedAt: factScan.completedAt,
          expiresAt: factScan.expiresAt,
        } : null,
      },
    };
  }

  /** Extracts a safe pointer only; never return OCR output or hash material. */
  private factEvidenceId(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const factEvidence = (value as { factEvidence?: unknown }).factEvidence;
    if (!factEvidence || typeof factEvidence !== 'object') return null;
    const id = (factEvidence as { id?: unknown }).id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }
}
