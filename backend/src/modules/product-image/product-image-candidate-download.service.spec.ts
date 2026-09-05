import { ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ProductImageCandidateDownloadService } from './product-image-candidate-download.service';
import { ProductImageOptimizationController } from './product-image-optimization.controller';
const sharp = require('sharp') as typeof import('sharp').default;

async function build(options: { taskStatus?: string; assetStatus?: string; mimeType?: string } = {}) {
  const buffer = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#994455' } }).png().toBuffer();
  const asset = { id: 'asset-1', companyId: 'company-1', purpose: 'PRODUCT_IMAGE', status: options.assetStatus ?? 'CANDIDATE',
    deletedAt: null, scanSummary: { needsReview: false }, objectKey: 'seller-product-assets/candidate.png',
    canonicalSha256: createHash('sha256').update(buffer).digest('hex'), byteSize: buffer.length,
    mimeType: options.mimeType ?? 'image/png', width: 24, height: 16 };
  const artifact = { id: 'artifact-1', assetId: asset.id, objectKey: asset.objectKey, sha256: asset.canonicalSha256,
    mimeType: asset.mimeType, byteSize: asset.byteSize, width: 24, height: 16, asset };
  const task = { companyId: 'company-1', status: options.taskStatus ?? 'SUCCEEDED', artifacts: [artifact] };
  const prisma = { productImageOptimization: { findFirst: jest.fn().mockResolvedValueOnce(task)
    .mockResolvedValue({ id: 'optimization-1', artifacts: [{ asset: { scanSummary: { needsReview: false } } }] }) } };
  const upload = { getBuffer: jest.fn().mockResolvedValue(buffer) };
  return { service: new ProductImageCandidateDownloadService(prisma as any, upload as any), prisma, upload, task, asset, artifact, buffer };
}

describe('ProductImageCandidateDownloadService', () => {
  it.each([['SUCCEEDED', 'CANDIDATE'], ['ADOPTED', 'ADOPTED'], ['SUCCEEDED', 'AVAILABLE']])(
    'downloads only the existing managed bytes for %s / %s', async (taskStatus, assetStatus) => {
      const { service, prisma, upload, buffer } = await build({ taskStatus, assetStatus });
      const result = await service.download('company-1', 'optimization-1');
      expect(result.buffer.equals(buffer)).toBe(true);
      expect(result.mimeType).toBe('image/png');
      expect(result.filename).toMatch(/^product-image-[a-f0-9]{16}\.png$/);
      expect(upload.getBuffer).toHaveBeenCalledWith('seller-product-assets/candidate.png');
      expect(prisma.productImageOptimization.findFirst.mock.calls[0][0].where).toMatchObject({ companyId: 'company-1', id: 'optimization-1', status: { in: ['SUCCEEDED', 'ADOPTED'] } });
    },
  );

  it.each(['REJECTED', 'FAILED', 'RUNNING', 'PENDING_REVIEW', 'CANCELLED'])('rejects task status %s before storage access', async (taskStatus) => {
    const { service, upload } = await build({ taskStatus });
    await expect(service.download('company-1', 'optimization-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(upload.getBuffer).not.toHaveBeenCalled();
  });

  it('rejects foreign-company task or asset, missing task and retired assets before storage access', async () => {
    for (const invalid of ['task-company', 'asset-company', 'missing', 'retired', 'deleted', 'review']) {
      const { service, prisma, task, asset, upload } = await build();
      if (invalid === 'task-company') task.companyId = 'company-other';
      if (invalid === 'asset-company') asset.companyId = 'company-other';
      if (invalid === 'retired') asset.status = 'RETIRED';
      if (invalid === 'deleted') (asset as any).deletedAt = new Date();
      if (invalid === 'review') asset.scanSummary.needsReview = true;
      if (invalid === 'missing') prisma.productImageOptimization.findFirst.mockReset().mockResolvedValue(null);
      await expect(service.download('company-1', 'optimization-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(upload.getBuffer).not.toHaveBeenCalled();
    }
  });

  it.each(['size', 'hash', 'artifact', 'path', 'mime', 'dimensions'])('rejects invalid %s metadata or bytes', async (invalid) => {
    const { service, upload, buffer, artifact, asset } = await build();
    if (invalid === 'size') upload.getBuffer.mockResolvedValue(Buffer.concat([buffer, Buffer.from('x')]));
    if (invalid === 'hash') upload.getBuffer.mockResolvedValue(Buffer.alloc(buffer.length));
    if (invalid === 'artifact') artifact.sha256 = 'a'.repeat(64);
    if (invalid === 'path') { asset.objectKey = 'seller-product-assets/../secret'; artifact.objectKey = asset.objectKey; }
    if (invalid === 'mime') { asset.mimeType = 'image/jpeg'; artifact.mimeType = asset.mimeType; }
    if (invalid === 'dimensions') { asset.width = 25; artifact.width = 25; }
    await expect(service.download('company-1', 'optimization-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a candidate retired while storage download was in flight', async () => {
    const { service, prisma, task } = await build();
    prisma.productImageOptimization.findFirst.mockReset().mockResolvedValueOnce(task).mockResolvedValueOnce(null);
    await expect(service.download('company-1', 'optimization-1')).rejects.toThrow('状态已变化');
  });

  it('does not reveal internal storage details in a read failure', async () => {
    const { service, upload } = await build();
    upload.getBuffer.mockRejectedValue(new Error('storage-key/internal-host diagnostic'));
    await expect(service.download('company-1', 'optimization-1')).rejects.toThrow('候选文件暂时无法读取，请稍后重试');
  });

  it('writes an authenticated attachment without passing image bytes through the JSON response wrapper', async () => {
    const { service, buffer } = await build();
    const controller = new ProductImageOptimizationController({} as any, service);
    const res = { setHeader: jest.fn(), end: jest.fn() };
    await controller.download('company-1', 'optimization-1', res as any);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringMatching(/^attachment; filename="product-image-[a-f0-9]{16}\.png"$/));
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.end).toHaveBeenCalledWith(buffer);
  });
});
