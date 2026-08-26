import { SellerMediaAssetsService } from './seller-media-assets.service';

describe('SellerMediaAssetsService derived deterministic assets', () => {
  it('writes an original product image through the lossless evidence-source path', async () => {
    const prisma = { sellerMediaAsset: { create: jest.fn().mockResolvedValue({ id: 'source-asset' }) } };
    const upload = {
      uploadFile: jest.fn().mockResolvedValue({
        key: 'seller-product-assets/source.webp', canonicalSha256: 'source-sha', mimeType: 'image/webp',
        size: 123, width: 800, height: 1000, needsReview: false, qrCodesDetected: 1,
      }),
      createPrivateAccessUrl: jest.fn().mockResolvedValue({ url: 'https://preview.example/source', expiresAt: '2026-08-21T00:05:00.000Z' }),
    };
    const quality = { analyze: jest.fn().mockResolvedValue({ width: 800, height: 1000, advisories: [] }) };
    const service = new SellerMediaAssetsService(prisma as any, upload as any, quality as any, {} as any);
    const file = { buffer: Buffer.from('png'), size: 3, mimetype: 'image/png', originalname: 'source.png' } as Express.Multer.File;

    await service.createProductImageAsset('company-1', 'staff-1', file);

    expect(upload.uploadFile).toHaveBeenCalledWith(file, 'seller-product-assets', {
      preserveQrCodes: true,
      preserveEvidencePixels: true,
    });
    expect(prisma.sellerMediaAsset.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ diagnosisVersion: 'phase-a-evidence-v2', scanSummary: expect.objectContaining({ qrLocked: true }) }),
    }));
  });

  it('does not let an unapplied candidate pass the ordinary mediaAssetIds gate', async () => {
    const prisma = {
      sellerMediaAsset: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new SellerMediaAssetsService(prisma as any, {} as any, {} as any, {} as any);

    await expect(service.assertOwnedProductImageAssets('company-1', ['candidate-asset'])).rejects.toThrow('不属于当前商户或已不可用');
    expect(prisma.sellerMediaAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['AVAILABLE', 'ADOPTED'] } }),
    }));
  });

  it('does not let an adopted candidate be attached to a different product through the ordinary gate', async () => {
    const prisma = {
      sellerMediaAsset: {
        findMany: jest.fn().mockResolvedValue([{ id: 'adopted-asset', status: 'ADOPTED', scanSummary: null }]),
      },
    };
    const service = new SellerMediaAssetsService(prisma as any, {} as any, {} as any, {} as any);

    await expect(service.assertOwnedProductImageAssets('company-1', ['adopted-asset'])).rejects.toThrow('只能保留在当前已关联商品中');
  });

  it('writes a renderer candidate through the managed, lossless upload path', async () => {
    const prisma = {
      sellerMediaAsset: {
        create: jest.fn().mockResolvedValue({ id: 'candidate-asset', objectKey: 'seller-product-assets/candidate.png' }),
      },
    };
    const upload = {
      uploadFile: jest.fn().mockResolvedValue({
        key: 'seller-product-assets/candidate.png',
        canonicalSha256: 'candidate-sha',
        mimeType: 'image/png',
        size: 123,
        width: 800,
        height: 1000,
        needsReview: false,
        qrCodesDetected: 0,
      }),
      createPrivateAccessUrl: jest.fn().mockResolvedValue({ url: 'https://preview.example/candidate', expiresAt: '2026-08-21T00:05:00.000Z' }),
    };
    const quality = { analyze: jest.fn().mockResolvedValue({ width: 800, height: 1000, advisories: [] }) };
    const service = new SellerMediaAssetsService(prisma as any, upload as any, quality as any, {} as any);
    const file = { buffer: Buffer.from('png'), size: 3, mimetype: 'image/png', originalname: 'candidate.png' } as Express.Multer.File;

    await expect(service.createDerivedProductImageAsset('company-1', 'staff-1', file)).resolves.toMatchObject({
      asset: { id: 'candidate-asset' },
      displayUrl: 'https://preview.example/candidate',
    });

    expect(upload.uploadFile).toHaveBeenCalledWith(file, 'seller-product-assets', {
      preserveQrCodes: true,
      preserveLosslessImage: true,
    });
    expect(prisma.sellerMediaAsset.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ diagnosisVersion: 'phase-b-deterministic-v1', mimeType: 'image/png' }),
    }));
  });
});
