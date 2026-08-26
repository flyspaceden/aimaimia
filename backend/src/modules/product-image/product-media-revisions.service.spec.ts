import { ConflictException } from '@nestjs/common';
import { ProductImageOptimizationStatus, ProductMediaRevisionStatus, SellerMediaAssetStatus } from '@prisma/client';
import { ProductMediaRevisionsService } from './product-media-revisions.service';

function buildService(mediaVersionUpdateCount = 1) {
  const revision = {
    id: 'rev-1', productId: 'product-1', companyId: 'company-1', expectedMediaVersion: 2,
    status: ProductMediaRevisionStatus.PENDING_REVIEW,
    proposedMedia: [{ assetId: 'asset-1', sortOrder: 0, type: 'IMAGE' }],
    product: { id: 'product-1', companyId: 'company-1', mediaVersion: 2, status: 'ACTIVE', auditStatus: 'APPROVED', media: [] },
  };
  const tx = {
    productMediaRevision: {
      findUnique: jest.fn().mockResolvedValue(revision),
      update: jest.fn().mockResolvedValue({ ...revision, status: ProductMediaRevisionStatus.APPROVED }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
    },
    productImageArtifact: { findFirst: jest.fn().mockResolvedValue({ assetId: 'candidate-asset' }), findMany: jest.fn() },
    productImageOptimization: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    sellerMediaAsset: {
      findMany: jest.fn().mockResolvedValue([{ id: 'asset-1', objectKey: 'seller-product-assets/a.webp', status: 'AVAILABLE' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    product: { updateMany: jest.fn().mockResolvedValue({ count: mediaVersionUpdateCount }) },
    productMedia: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    $transaction: jest.fn((fn: (tx: any) => unknown) => fn(tx)),
    productMediaRevision: tx.productMediaRevision,
    sellerMediaAsset: tx.sellerMediaAsset,
    productImageFactScan: { findFirst: jest.fn() },
  };
  const assets = { assertOwnedProductImageAssets: jest.fn() };
  const upload = {
    createProductMediaUrl: jest.fn().mockReturnValue('https://api.example/api/v1/upload/product-media/seller-product-assets/a.webp'),
    createPrivateAccessUrl: jest.fn().mockResolvedValue({ url: 'https://api.example/api/v1/upload/private/seller-product-assets/a.webp?sig=preview', expiresAt: '2026-08-21T12:05:00.000Z' }),
  };
  return { service: new ProductMediaRevisionsService(prisma as any, assets as any, upload as any), tx, prisma, upload };
}

describe('ProductMediaRevisionsService approval', () => {
  it('binds an optimization adoption review to the product recorded on the task', async () => {
    const product = {
      id: 'product-1', companyId: 'company-1', status: 'ACTIVE', auditStatus: 'APPROVED', mediaVersion: 2,
      media: [{ assetId: 'source-asset', type: 'IMAGE', sortOrder: 0, visualOrigin: 'ORIGINAL', optimizationId: null, isEvidenceImage: false }],
    };
    const task = { kind: 'WHITE_BACKGROUND', artifacts: [{ assetId: 'candidate-asset' }] };
    const prisma = {
      product: { findFirst: jest.fn().mockResolvedValue(product) },
      productImageOptimization: { findFirst: jest.fn().mockResolvedValue(task) },
      sellerMediaAsset: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'candidate-asset', status: 'CANDIDATE' },
          { id: 'source-asset', status: 'AVAILABLE' },
        ]),
      },
      productMediaRevision: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'revision-1' }) },
    };
    const service = new ProductMediaRevisionsService(prisma as any, {} as any, {} as any);

    await service.requestOptimizationAdoption({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', optimizationId: 'task-1',
      candidateAssetId: 'candidate-asset', sourceAssetId: 'source-asset',
      attestation: { quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true },
    });

    expect(prisma.productImageOptimization.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'task-1', productId: 'product-1' }),
    }));
  });

  it('records FREE_TUNE as deterministic enhancement rather than a white-background composite', async () => {
    const product = {
      id: 'product-1', companyId: 'company-1', status: 'ACTIVE', auditStatus: 'APPROVED', mediaVersion: 2,
      media: [{ assetId: 'source-asset', type: 'IMAGE', sortOrder: 0, visualOrigin: 'ORIGINAL', optimizationId: null, isEvidenceImage: false }],
    };
    const prisma = {
      product: { findFirst: jest.fn().mockResolvedValue(product) },
      productImageOptimization: { findFirst: jest.fn().mockResolvedValue({ kind: 'FREE_TUNE', artifacts: [{ assetId: 'candidate-asset' }] }) },
      sellerMediaAsset: { findMany: jest.fn().mockResolvedValue([{ id: 'candidate-asset', status: 'CANDIDATE' }, { id: 'source-asset', status: 'AVAILABLE' }]) },
      productMediaRevision: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'revision-1' }) },
    };
    const service = new ProductMediaRevisionsService(prisma as any, {} as any, {} as any);

    await service.requestOptimizationAdoption({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', optimizationId: 'task-1',
      candidateAssetId: 'candidate-asset', sourceAssetId: 'source-asset',
      attestation: { quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true },
    });

    expect(prisma.productMediaRevision.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        proposedMedia: expect.arrayContaining([expect.objectContaining({
          assetId: 'candidate-asset', visualOrigin: 'DETERMINISTIC_ENHANCEMENT', optimizationId: 'task-1',
        })]),
      }),
    }));
  });

  it('does not create an adoption review after the original source is removed from the product', async () => {
    const prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'product-1', companyId: 'company-1', status: 'ACTIVE', auditStatus: 'APPROVED', mediaVersion: 2, media: [],
        }),
      },
      productImageOptimization: { findFirst: jest.fn().mockResolvedValue({ artifacts: [{ assetId: 'candidate-asset' }] }) },
      sellerMediaAsset: { findMany: jest.fn() },
      productMediaRevision: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    };
    const service = new ProductMediaRevisionsService(prisma as any, {} as any, {} as any);

    await expect(service.requestOptimizationAdoption({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', optimizationId: 'task-1',
      candidateAssetId: 'candidate-asset', sourceAssetId: 'source-asset',
      attestation: { quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true },
    })).rejects.toThrow('原实拍图已不再属于该商品');

    expect(prisma.sellerMediaAsset.findMany).not.toHaveBeenCalled();
    expect(prisma.productMediaRevision.create).not.toHaveBeenCalled();
  });

  it('returns the existing pending adoption review instead of creating a duplicate', async () => {
    const existingRevision = { id: 'revision-1', status: ProductMediaRevisionStatus.PENDING_REVIEW };
    const prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'product-1', companyId: 'company-1', status: 'ACTIVE', auditStatus: 'APPROVED', mediaVersion: 2, media: [],
        }),
      },
      productImageOptimization: { findFirst: jest.fn() },
      sellerMediaAsset: { findMany: jest.fn() },
      productMediaRevision: { findFirst: jest.fn().mockResolvedValue(existingRevision), create: jest.fn() },
    };
    const service = new ProductMediaRevisionsService(prisma as any, {} as any, {} as any);

    await expect(service.requestOptimizationAdoption({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', optimizationId: 'task-1',
      candidateAssetId: 'candidate-asset', sourceAssetId: 'source-asset',
      attestation: { quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true },
    })).resolves.toBe(existingRevision);

    expect(prisma.productImageOptimization.findFirst).not.toHaveBeenCalled();
    expect(prisma.productMediaRevision.create).not.toHaveBeenCalled();
  });

  it('keeps an adopted image only when it is already attached to this product and preserves its evidence metadata', async () => {
    const adoptedMedia = { assetId: 'adopted-asset', visualOrigin: 'DETERMINISTIC_COMPOSITE', optimizationId: 'optimization-1', isEvidenceImage: false, sortOrder: 0 };
    const evidenceMedia = { assetId: 'source-asset', visualOrigin: 'ORIGINAL', optimizationId: null, isEvidenceImage: true, sortOrder: 1 };
    const prisma = {
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product-1', status: 'ACTIVE', auditStatus: 'APPROVED', mediaVersion: 2, media: [adoptedMedia, evidenceMedia] }) },
      productMediaRevision: { create: jest.fn().mockResolvedValue({ id: 'revision-2' }) },
    };
    const assets = {
      assertOwnedProductImageAssets: jest.fn().mockResolvedValue([
        { id: 'adopted-asset' }, { id: 'source-asset' },
      ]),
    };
    const service = new ProductMediaRevisionsService(prisma as any, assets as any, {} as any);

    await expect(service.request('company-1', 'staff-1', 'product-1', {
      mediaAssetIds: ['adopted-asset', 'source-asset'],
      idempotencyKey: 'retry-1', quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true,
    })).resolves.toEqual({ id: 'revision-2' });

    expect(assets.assertOwnedProductImageAssets).toHaveBeenCalledWith('company-1', ['adopted-asset', 'source-asset'], {
      allowedAdoptedAssetIds: ['adopted-asset', 'source-asset'],
    });
    expect(prisma.productMediaRevision.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        proposedMedia: expect.arrayContaining([
          expect.objectContaining({ assetId: 'adopted-asset', visualOrigin: 'DETERMINISTIC_COMPOSITE', optimizationId: 'optimization-1' }),
          expect.objectContaining({ assetId: 'source-asset', isEvidenceImage: true }),
        ]),
      }),
    }));
  });

  it('atomically replaces public media only after a matching media-version CAS', async () => {
    const { service, tx, upload } = buildService(1);
    await expect(service.approve('rev-1', 'admin-1')).resolves.toMatchObject({ status: ProductMediaRevisionStatus.APPROVED });
    expect(tx.product.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'product-1',
        companyId: 'company-1',
        mediaVersion: 2,
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
      },
    }));
    expect(tx.productMedia.deleteMany).toHaveBeenCalledWith({ where: { productId: 'product-1' } });
    expect(upload.createProductMediaUrl).toHaveBeenCalledWith('seller-product-assets/a.webp');
    expect(tx.productMedia.createMany).toHaveBeenCalledWith({ data: [{ productId: 'product-1', assetId: 'asset-1', type: 'IMAGE', url: 'https://api.example/api/v1/upload/product-media/seller-product-assets/a.webp', sortOrder: 0, visualOrigin: 'ORIGINAL', optimizationId: null, isEvidenceImage: false }] });
  });

  it('approves an enhancement candidate only when its persisted optimization kind matches enhancement origin', async () => {
    const { service, tx } = buildService(1);
    tx.productMediaRevision.findUnique.mockResolvedValue({
      id: 'rev-1', productId: 'product-1', companyId: 'company-1', expectedMediaVersion: 2,
      status: ProductMediaRevisionStatus.PENDING_REVIEW, optimizationId: 'task-1',
      proposedMedia: [
        { assetId: 'candidate-asset', sortOrder: 0, type: 'IMAGE', visualOrigin: 'DETERMINISTIC_ENHANCEMENT', optimizationId: 'task-1', isEvidenceImage: false },
        { assetId: 'source-asset', sortOrder: 1, type: 'IMAGE', visualOrigin: 'ORIGINAL', optimizationId: null, isEvidenceImage: true },
      ],
      product: { id: 'product-1', companyId: 'company-1', mediaVersion: 2 },
    });
    tx.productImageArtifact.findMany = jest.fn().mockResolvedValue([
      { assetId: 'candidate-asset', kind: 'CANDIDATE', optimization: { kind: 'FREE_TUNE' } },
      { assetId: 'source-asset', kind: 'FOREGROUND_REFERENCE', optimization: { kind: 'FREE_TUNE' } },
    ]);
    tx.sellerMediaAsset.findMany.mockResolvedValue([
      { id: 'candidate-asset', objectKey: 'seller-product-assets/candidate.png', status: 'CANDIDATE', scanSummary: null },
      { id: 'source-asset', objectKey: 'seller-product-assets/source.webp', status: 'AVAILABLE', scanSummary: null },
    ]);

    await expect(service.approve('rev-1', 'admin-1')).resolves.toMatchObject({ status: ProductMediaRevisionStatus.APPROVED });
    expect(tx.productMedia.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({
        assetId: 'candidate-asset', visualOrigin: 'DETERMINISTIC_ENHANCEMENT', optimizationId: 'task-1',
      })]),
    }));
  });

  it('expires a revision on media-version conflict without deleting public media', async () => {
    const { service, tx, prisma } = buildService(0);
    prisma.$transaction.mockImplementation(async (work: (client: typeof tx) => Promise<unknown>) => {
      const outcome = await work(tx);
      expect(outcome).toEqual({ kind: 'EXPIRED' });
      return outcome;
    });
    await expect(service.approve('rev-1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.productMedia.deleteMany).not.toHaveBeenCalled();
    expect(tx.productMedia.createMany).not.toHaveBeenCalled();
    expect(tx.productMediaRevision.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: ProductMediaRevisionStatus.EXPIRED }) }));
  });

  it('does not approve an asset that still requires a safety review', async () => {
    const { service, tx } = buildService(1);
    tx.sellerMediaAsset.findMany.mockResolvedValueOnce([{
      id: 'asset-1',
      objectKey: 'seller-product-assets/a.webp',
      scanSummary: { needsReview: true },
    }]);

    await expect(service.approve('rev-1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);

    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.productMedia.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects without touching public media', async () => {
    const { service, tx } = buildService(1);
    tx.productMediaRevision.findUniqueOrThrow.mockResolvedValue({ id: 'rev-1', status: ProductMediaRevisionStatus.REJECTED });
    await expect(service.reject('rev-1', 'admin-1', '包装文字不清晰')).resolves.toMatchObject({ status: ProductMediaRevisionStatus.REJECTED });
    expect(tx.productMedia.deleteMany).not.toHaveBeenCalled();
    expect(tx.productMedia.createMany).not.toHaveBeenCalled();
  });

  it('marks the linked candidate terminal and retires it when its review is rejected', async () => {
    const { service, tx } = buildService(1);
    tx.productMediaRevision.findUnique.mockResolvedValue({
      id: 'rev-1', status: ProductMediaRevisionStatus.PENDING_REVIEW, optimizationId: 'task-1',
    });
    tx.productMediaRevision.findUniqueOrThrow.mockResolvedValue({ id: 'rev-1', status: ProductMediaRevisionStatus.REJECTED });

    await expect(service.reject('rev-1', 'admin-1', '包装型号不清晰')).resolves.toMatchObject({
      status: ProductMediaRevisionStatus.REJECTED,
    });

    expect(tx.productImageOptimization.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-1', status: ProductImageOptimizationStatus.SUCCEEDED },
      data: expect.objectContaining({ status: ProductImageOptimizationStatus.REJECTED, failureCode: 'MEDIA_REVISION_REJECTED' }),
    }));
    expect(tx.sellerMediaAsset.updateMany).toHaveBeenCalledWith({
      where: { id: 'candidate-asset', status: SellerMediaAssetStatus.CANDIDATE },
      data: { status: SellerMediaAssetStatus.RETIRED },
    });
  });

  it('returns a short-lived candidate preview only to the admin review endpoint', async () => {
    const { service, upload } = buildService(1);

    await expect(service.getForAdmin('rev-1')).resolves.toMatchObject({
      revision: { id: 'rev-1', status: ProductMediaRevisionStatus.PENDING_REVIEW },
      proposedMedia: [{ assetId: 'asset-1', displayUrl: expect.stringContaining('/upload/private/') }],
    });

    expect(upload.createPrivateAccessUrl).toHaveBeenCalledWith('seller-product-assets/a.webp', 300);
  });

  it('returns only the bound free-tune fact-scan summary to an admin reviewer', async () => {
    const { service, tx, prisma } = buildService(1);
    tx.productMediaRevision.findUnique.mockResolvedValue({
      id: 'rev-1', productId: 'product-1', companyId: 'company-1', expectedMediaVersion: 2,
      status: ProductMediaRevisionStatus.PENDING_REVIEW,
      proposedMedia: [
        { assetId: 'candidate-asset', sortOrder: 0, type: 'IMAGE', visualOrigin: 'DETERMINISTIC_ENHANCEMENT', isEvidenceImage: false },
        { assetId: 'source-asset', sortOrder: 1, type: 'IMAGE', visualOrigin: 'ORIGINAL', isEvidenceImage: true },
      ],
      optimization: {
        id: 'task-1', kind: 'FREE_TUNE', status: ProductImageOptimizationStatus.SUCCEEDED,
        provider: 'deterministic-sharp', costTier: 'FREE', templateVersion: 'phase-p1b-free-tune-v1', processingContract: {}, createdAt: new Date(),
        artifacts: [
          { kind: 'CANDIDATE', assetId: 'candidate-asset', metadata: { factEvidence: { id: 'fact-scan-1' } } },
          { kind: 'FOREGROUND_REFERENCE', assetId: 'source-asset', metadata: null },
        ],
      },
      product: { id: 'product-1', title: '智能手环', status: 'ACTIVE', auditStatus: 'APPROVED', mediaVersion: 2, media: [] },
      company: { id: 'company-1', name: '测试商户' }, attestation: {}, createdAt: new Date(), reviewNote: null,
    });
    tx.sellerMediaAsset.findMany.mockResolvedValue([
      { id: 'candidate-asset', objectKey: 'seller-product-assets/candidate.png', width: 800, height: 800, scanSummary: null },
      { id: 'source-asset', objectKey: 'seller-product-assets/source.webp', width: 800, height: 800, scanSummary: null },
    ]);
    prisma.productImageFactScan.findFirst.mockResolvedValue({
      id: 'fact-scan-1', status: 'VERIFIED_EMPTY', textDetected: false, qrCodesDetected: 0,
      barcodeStatus: 'NONE', emptyTextQrVerified: true, failureCode: null,
      completedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    });

    const detail = await service.getForAdmin('rev-1');

    expect(detail).toMatchObject({
      reviewContext: {
        optimization: { id: 'task-1', kind: 'FREE_TUNE', costTier: 'FREE' },
        factScan: { id: 'fact-scan-1', status: 'VERIFIED_EMPTY', freeTuneEligible: true, barcodeStatus: 'NONE' },
      },
      proposedMedia: [
        { assetId: 'candidate-asset', visualOrigin: 'DETERMINISTIC_ENHANCEMENT', isEvidenceImage: false },
        { assetId: 'source-asset', visualOrigin: 'ORIGINAL', isEvidenceImage: true },
      ],
    });
    expect(JSON.stringify(detail)).not.toContain('ocrTextHash');
    expect(prisma.productImageFactScan.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'fact-scan-1', sourceAssetId: 'source-asset' }),
    }));
  });
});
