import { SellerMediaAssetsService } from './seller-media-assets.service';

describe('SellerMediaAssetsService derived deterministic assets', () => {
  it('writes an original product image through the lossless evidence-source path', async () => {
    const sellerMediaAsset = { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'source-asset', objectKey: 'seller-product-assets/source.webp' }) };
    const tx = { sellerMediaAsset, $executeRaw: jest.fn() };
    const prisma = { sellerMediaAsset, $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) };
    const upload = {
      uploadFile: jest.fn().mockResolvedValue({
        key: 'seller-product-assets/source.webp', canonicalSha256: 'source-sha', mimeType: 'image/webp',
        size: 123, width: 800, height: 1000, needsReview: false, qrCodesDetected: 1,
      }),
      createPrivateAccessUrl: jest.fn().mockResolvedValue({ url: 'https://preview.example/source', expiresAt: '2026-08-21T00:05:00.000Z' }),
      deleteFile: jest.fn(),
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

  it('reuses the same normalized merchant image after a client timeout instead of creating a duplicate asset', async () => {
    const existing = { id: 'source-existing', objectKey: 'seller-product-assets/existing.webp', canonicalSha256: 'source-sha' };
    const prisma = {
      sellerMediaAsset: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const tx = { sellerMediaAsset: prisma.sellerMediaAsset, $executeRaw: jest.fn() };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));
    const upload = {
      uploadFile: jest.fn().mockResolvedValue({
        key: 'seller-product-assets/retry.webp', canonicalSha256: 'source-sha', mimeType: 'image/webp',
        size: 123, width: 800, height: 1000, needsReview: false, qrCodesDetected: 0,
      }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      createPrivateAccessUrl: jest.fn().mockResolvedValue({ url: 'https://preview.example/existing', expiresAt: null }),
    };
    const quality = { analyze: jest.fn().mockResolvedValue({ width: 800, height: 1000, advisories: [] }) };
    const service = new SellerMediaAssetsService(prisma as any, upload as any, quality as any, {} as any);
    const file = { buffer: Buffer.from('png'), size: 3, mimetype: 'image/png', originalname: 'source.png' } as Express.Multer.File;

    await expect(service.createProductImageAsset('company-1', 'staff-1', file)).resolves.toMatchObject({
      asset: { id: 'source-existing' },
      displayUrl: 'https://preview.example/existing',
    });
    expect(upload.deleteFile).toHaveBeenCalledWith('seller-product-assets/retry.webp');
    expect(prisma.sellerMediaAsset.create).not.toHaveBeenCalled();
  });

  it('does not reuse an older review-blocked asset when the latest scan is safe', async () => {
    const blocked = { id: 'blocked-source', objectKey: 'seller-product-assets/blocked.webp', scanSummary: { needsReview: true } };
    const created = { id: 'safe-source', objectKey: 'seller-product-assets/safe.webp', scanSummary: { needsReview: false } };
    const sellerMediaAsset = {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(created),
    };
    const tx = { sellerMediaAsset, $executeRaw: jest.fn() };
    const prisma = { sellerMediaAsset, $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) };
    const upload = {
      uploadFile: jest.fn().mockResolvedValue({
        key: 'seller-product-assets/safe.webp', canonicalSha256: 'same-sha', mimeType: 'image/webp',
        size: 123, width: 800, height: 1000, needsReview: false, qrCodesDetected: 0,
      }),
      deleteFile: jest.fn(),
      createPrivateAccessUrl: jest.fn().mockResolvedValue({ url: 'https://preview.example/safe', expiresAt: null }),
    };
    const quality = { analyze: jest.fn().mockResolvedValue({ width: 800, height: 1000, advisories: [] }) };
    const service = new SellerMediaAssetsService(prisma as any, upload as any, quality as any, {} as any);
    const file = { buffer: Buffer.from('png'), size: 3, mimetype: 'image/png', originalname: 'source.png' } as Express.Multer.File;

    await expect(service.createProductImageAsset('company-1', 'staff-1', file)).resolves.toMatchObject({ asset: created });
    expect(sellerMediaAsset.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ scanSummary: { path: ['needsReview'], equals: false } }),
    }));
    expect(sellerMediaAsset.create).toHaveBeenCalled();
    expect(upload.deleteFile).not.toHaveBeenCalled();
    expect(blocked.id).toBe('blocked-source');
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
      preserveManagedImage: true,
    });
    expect(prisma.sellerMediaAsset.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ diagnosisVersion: 'phase-b-deterministic-v1', mimeType: 'image/png' }),
    }));
  });
});
