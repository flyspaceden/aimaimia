import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ProductImageArtifactKind, ProductImageOptimizationStatus, SellerMediaAssetStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { UPLOAD_MAX_FILE_SIZE } from '../upload/upload.constants';
const sharp = require('sharp') as typeof import('sharp').default;

const MIME_FORMATS: Record<string, { format: string; extension: string }> = {
  'image/png': { format: 'png', extension: 'png' },
  'image/jpeg': { format: 'jpeg', extension: 'jpg' },
  'image/webp': { format: 'webp', extension: 'webp' },
};
const DOWNLOADABLE_TASKS: ProductImageOptimizationStatus[] = [ProductImageOptimizationStatus.SUCCEEDED, ProductImageOptimizationStatus.ADOPTED];
const DOWNLOADABLE_ASSETS: SellerMediaAssetStatus[] = [SellerMediaAssetStatus.CANDIDATE, SellerMediaAssetStatus.ADOPTED, SellerMediaAssetStatus.AVAILABLE];

@Injectable()
export class ProductImageCandidateDownloadService {
  constructor(private readonly prisma: PrismaService, private readonly upload: UploadService) {}

  async download(companyId: string, optimizationId: string) {
    const scope = { id: optimizationId, companyId, status: { in: DOWNLOADABLE_TASKS } };
    const task = await this.prisma.productImageOptimization.findFirst({
      where: scope,
      select: { companyId: true, status: true, artifacts: {
        where: { kind: ProductImageArtifactKind.CANDIDATE },
        select: { id: true, assetId: true, objectKey: true, sha256: true, mimeType: true, byteSize: true, width: true, height: true, asset: true },
        take: 2,
      } },
    });
    if (!task || task.companyId !== companyId || !DOWNLOADABLE_TASKS.includes(task.status)
      || task.artifacts.length !== 1) throw new NotFoundException('可下载的图片候选不存在');
    const artifact = task.artifacts[0];
    const asset = artifact.asset;
    if (!asset || asset.companyId !== companyId || asset.purpose !== 'PRODUCT_IMAGE' || asset.deletedAt
      || !DOWNLOADABLE_ASSETS.includes(asset.status)
      || (asset.scanSummary as { needsReview?: boolean } | null)?.needsReview) {
      throw new NotFoundException('可下载的图片候选不存在');
    }
    const imageType = MIME_FORMATS[asset.mimeType];
    if (!imageType || !/^seller-product-assets\/[a-zA-Z0-9_./-]+$/.test(asset.objectKey)
      || asset.objectKey.split('/').some((part) => part === '..' || part === '.')
      || !/^[a-f0-9]{64}$/.test(asset.canonicalSha256)
      || !Number.isInteger(asset.byteSize) || asset.byteSize <= 0 || asset.byteSize > UPLOAD_MAX_FILE_SIZE
      || !Number.isInteger(asset.width) || !Number.isInteger(asset.height)
      || asset.width < 1 || asset.height < 1 || asset.width * asset.height > 40_000_000
      || artifact.assetId !== asset.id || artifact.objectKey !== asset.objectKey || artifact.sha256 !== asset.canonicalSha256
      || artifact.mimeType !== asset.mimeType || artifact.byteSize !== asset.byteSize
      || artifact.width !== asset.width || artifact.height !== asset.height) {
      throw new ConflictException('候选图片文件记录不完整或已变化，暂时不能下载');
    }
    let buffer: Buffer;
    try { buffer = await this.upload.getBuffer(asset.objectKey); }
    catch { throw new ServiceUnavailableException('候选文件暂时无法读取，请稍后重试'); }
    if (buffer.length !== asset.byteSize || buffer.length > UPLOAD_MAX_FILE_SIZE
      || createHash('sha256').update(buffer).digest('hex') !== asset.canonicalSha256) {
      throw new ConflictException('候选图片内容与记录不一致，暂时不能下载');
    }
    try {
      const image = sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 });
      const meta = await image.metadata();
      if (meta.format !== imageType.format || meta.width !== asset.width || meta.height !== asset.height || (meta.pages ?? 1) !== 1) {
        throw new Error('invalid image metadata');
      }
      await image.stats();
    } catch { throw new ConflictException('候选图片无法安全解码，暂时不能下载'); }
    // 取文件期间可能发生拒绝或退役，发送前再次校验同一任务及资产。
    const stillReadable = await this.prisma.productImageOptimization.findFirst({
      where: { ...scope, artifacts: { some: {
        id: artifact.id, kind: ProductImageArtifactKind.CANDIDATE, assetId: asset.id,
        sha256: asset.canonicalSha256, objectKey: asset.objectKey,
        asset: { is: { id: asset.id, companyId, purpose: 'PRODUCT_IMAGE', deletedAt: null,
          status: { in: DOWNLOADABLE_ASSETS }, canonicalSha256: asset.canonicalSha256,
          objectKey: asset.objectKey, byteSize: asset.byteSize, mimeType: asset.mimeType,
          width: asset.width, height: asset.height } },
      } } },
      select: { id: true, artifacts: { where: { id: artifact.id }, select: { asset: { select: { scanSummary: true } } } } },
    });
    if (!stillReadable || (stillReadable.artifacts[0]?.asset?.scanSummary as { needsReview?: boolean } | null)?.needsReview) {
      throw new ConflictException('候选图片状态已变化，请刷新后重试');
    }
    const safeId = createHash('sha256').update(optimizationId).digest('hex').slice(0, 16);
    return { buffer, mimeType: asset.mimeType, filename: `product-image-${safeId}.${imageType.extension}` };
  }
}
