import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductMediaRevisionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SellerMediaAssetsService } from './seller-media-assets.service';
import { UploadService } from '../upload/upload.service';
import { RequestProductMediaRevisionDto } from './product-media-revision.dto';

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
    const assets = await this.assets.assertOwnedProductImageAssets(companyId, dto.mediaAssetIds);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true, status: true, auditStatus: true, mediaVersion: true },
    });
    if (!product) throw new NotFoundException('商品不存在');
    if (product.status !== 'ACTIVE' || product.auditStatus !== 'APPROVED') {
      throw new ConflictException('仅已上架且审核通过的商品可提交封面变更审核');
    }
    try {
      return await this.prisma.productMediaRevision.create({
        data: {
          productId,
          companyId,
          expectedMediaVersion: product.mediaVersion,
          proposedMedia: assets.map((asset, sortOrder) => ({ assetId: asset.id, sortOrder, type: 'IMAGE' })),
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
      const proposed = revision.proposedMedia as Array<{ assetId?: string; sortOrder?: number }>;
      if (!Array.isArray(proposed) || proposed.length === 0 || proposed.length > 9) {
        throw new BadRequestException('封面变更媒体快照无效');
      }
      const assetIds = proposed.map((item) => item.assetId).filter((id): id is string => !!id);
      if (assetIds.length !== proposed.length || new Set(assetIds).size !== assetIds.length) {
        throw new BadRequestException('封面变更媒体资产无效');
      }
      const assets = await tx.sellerMediaAsset.findMany({
        where: { id: { in: assetIds }, companyId: revision.companyId, purpose: 'PRODUCT_IMAGE', deletedAt: null },
      });
      if (assets.length !== assetIds.length) throw new ConflictException('图片资产已不可用');
      const byId = new Map(assets.map((asset) => [asset.id, asset]));
      const media = proposed.map((item, index) => {
        const asset = byId.get(item.assetId!)!;
        return { assetId: asset.id, type: 'IMAGE' as const, url: this.uploadService.createProductMediaUrl(asset.objectKey), sortOrder: item.sortOrder ?? index };
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
    const updated = await this.prisma.productMediaRevision.updateMany({
      where: { id: revisionId, status: ProductMediaRevisionStatus.PENDING_REVIEW },
      data: { status: ProductMediaRevisionStatus.REJECTED, reviewedByAdminId: adminUserId, reviewedAt: new Date(), reviewNote },
    });
    if (updated.count !== 1) throw new ConflictException('该封面变更申请已处理或不存在');
    return this.prisma.productMediaRevision.findUniqueOrThrow({ where: { id: revisionId } });
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
      },
    });
    if (!revision) throw new NotFoundException('封面变更申请不存在');

    const proposed = revision.proposedMedia as Array<{ assetId?: string; sortOrder?: number; type?: string }>;
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
    };
  }
}
