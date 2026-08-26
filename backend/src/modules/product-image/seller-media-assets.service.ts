import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SellerMediaAssetStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { ProductImageQualityService } from './product-image-quality.service';
import { ProductImageCompositionService } from './product-image-composition.service';

@Injectable()
export class SellerMediaAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly qualityService: ProductImageQualityService,
    private readonly composition: ProductImageCompositionService,
  ) {}

  async createProductImageAsset(companyId: string, staffId: string, file: Express.Multer.File) {
    return this.createManagedProductImageAsset(
      companyId,
      staffId,
      file,
      { preserveQrCodes: true, preserveEvidencePixels: true },
      'phase-a-evidence-v2',
      SellerMediaAssetStatus.AVAILABLE,
    );
  }

  async createDerivedProductImageAsset(companyId: string, staffId: string, file: Express.Multer.File) {
    return this.createManagedProductImageAsset(
      companyId,
      staffId,
      file,
      { preserveQrCodes: true, preserveLosslessImage: true },
      'phase-b-deterministic-v1',
      SellerMediaAssetStatus.CANDIDATE,
    );
  }

  private async createManagedProductImageAsset(
    companyId: string,
    staffId: string,
    file: Express.Multer.File,
    uploadOptions: { preserveQrCodes: boolean; preserveLosslessImage?: boolean; preserveEvidencePixels?: boolean },
    diagnosisVersion: string,
    assetStatus: SellerMediaAssetStatus,
  ) {
    if (!file?.mimetype?.startsWith('image/')) {
      throw new BadRequestException('商品视觉 Agent 仅接受图片文件');
    }
    const diagnosis = await this.qualityService.analyze(file.buffer);
    const uploaded = await this.uploadService.uploadFile(file, 'seller-product-assets', uploadOptions);
    if (!uploaded.canonicalSha256 || !uploaded.width || !uploaded.height) {
      throw new BadRequestException('图片规范化结果不完整，无法建立受管资产');
    }
    const asset = await this.prisma.sellerMediaAsset.create({
      data: {
        companyId,
        uploadedByStaffId: staffId,
        purpose: 'PRODUCT_IMAGE',
        status: assetStatus,
        objectKey: uploaded.key,
        canonicalSha256: uploaded.canonicalSha256,
        mimeType: uploaded.mimeType,
        byteSize: uploaded.size,
        width: uploaded.width,
        height: uploaded.height,
        scanSummary: {
          needsReview: uploaded.needsReview === true,
          qrCodesDetected: uploaded.qrCodesDetected ?? 0,
          qrLocked: (uploaded.qrCodesDetected ?? 0) > 0,
        },
        diagnosis: diagnosis as unknown as Prisma.InputJsonValue,
        diagnosisVersion,
        diagnosedAt: new Date(),
      },
    });
    const access = await this.uploadService.createPrivateAccessUrl(uploaded.key);
    return { asset, displayUrl: access.url, expiresAt: access.expiresAt };
  }

  async composeWhiteBackground(companyId: string, staffId: string, assetId: string) {
    const source = await this.prisma.sellerMediaAsset.findFirst({ where: { id: assetId, companyId, purpose: 'PRODUCT_IMAGE', deletedAt: null } });
    if (!source) throw new NotFoundException('图片资产不存在');
    if ((source.scanSummary as { needsReview?: boolean } | null)?.needsReview) {
      throw new ConflictException('图片仍需人工安全复核，不能合成白底图');
    }
    const sourceBuffer = await this.uploadService.getBuffer(source.objectKey);
    const composed = await this.composition.composeWhiteBackgroundWithProof(sourceBuffer, { width: 800, height: 1000 });
    const file = { buffer: composed.buffer, size: composed.buffer.length, mimetype: 'image/png', originalname: 'white-background.png' } as Express.Multer.File;
    const candidate = await this.createDerivedProductImageAsset(companyId, staffId, file);
    return { ...candidate, integrityProof: composed.proof };
  }

  async getProductImageAsset(companyId: string, assetId: string) {
    const asset = await this.prisma.sellerMediaAsset.findFirst({
      where: { id: assetId, companyId, purpose: 'PRODUCT_IMAGE', deletedAt: null },
    });
    if (!asset) throw new NotFoundException('图片资产不存在');
    const access = await this.uploadService.createPrivateAccessUrl(asset.objectKey);
    return { asset, displayUrl: access.url, expiresAt: access.expiresAt };
  }

  getStableProductMediaUrl(objectKey: string) {
    return this.uploadService.createProductMediaUrl(objectKey);
  }

  async assertOwnedProductImageAssets(
    companyId: string,
    assetIds: string[],
    options: { allowedAdoptedAssetIds?: string[] } = {},
  ) {
    const uniqueIds = [...new Set(assetIds)];
    if (uniqueIds.length !== assetIds.length) {
      throw new BadRequestException('商品图片不能重复引用同一资产');
    }
    const assets = await this.prisma.sellerMediaAsset.findMany({
      where: {
        id: { in: uniqueIds },
        companyId,
        purpose: 'PRODUCT_IMAGE',
        status: { in: [SellerMediaAssetStatus.AVAILABLE, SellerMediaAssetStatus.ADOPTED] },
        deletedAt: null,
      },
    });
    if (assets.length !== uniqueIds.length) {
      throw new ForbiddenException('图片资产不属于当前商户或已不可用');
    }
    const allowedAdoptedIds = new Set(options.allowedAdoptedAssetIds ?? []);
    if (assets.some((asset) => asset.status === SellerMediaAssetStatus.ADOPTED && !allowedAdoptedIds.has(asset.id))) {
      throw new ForbiddenException('已采用的优化图片只能保留在当前已关联商品中');
    }
    if (assets.some((asset) => (asset.scanSummary as { needsReview?: boolean } | null)?.needsReview === true)) {
      throw new ConflictException('图片仍需人工安全复核，暂不能用于商品展示');
    }
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    return uniqueIds.map((id) => byId.get(id)!);
  }
}
