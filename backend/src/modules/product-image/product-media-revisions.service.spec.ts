import { ConflictException } from '@nestjs/common';
import { ProductImageOptimizationStatus, ProductMediaRevisionStatus, SellerMediaAssetStatus } from '@prisma/client';
import { ProductMediaRevisionsService } from './product-media-revisions.service';
import { productVisualFactHash } from './product-visual-fact-hash';

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
  return { service: new ProductMediaRevisionsService(prisma as any, assets as any, upload as any, { emit: jest.fn() } as any), tx, prisma, upload };
}

describe('ProductMediaRevisionsService publication governance', () => {
  it('immediately applies a seller media change while retaining the previous public snapshot', async () => {
    const adoptedMedia = { assetId: 'adopted-asset', type: 'IMAGE', visualOrigin: 'DETERMINISTIC_COMPOSITE', optimizationId: 'optimization-1', isEvidenceImage: false, sortOrder: 0 };
    const evidenceMedia = { assetId: 'source-asset', type: 'IMAGE', visualOrigin: 'ORIGINAL', optimizationId: null, isEvidenceImage: true, sortOrder: 1 };
    const product = { id: 'product-1', status: 'ACTIVE', auditStatus: 'APPROVED', mediaVersion: 2, media: [adoptedMedia, evidenceMedia] };
    const tx = {
      productMediaRevision: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'revision-2', status: ProductMediaRevisionStatus.APPLIED_BY_SELLER }) },
      product: { findFirst: jest.fn().mockResolvedValue(product), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      sellerMediaAsset: { findMany: jest.fn().mockResolvedValue([{ id: 'adopted-asset', objectKey: 'seller-product-assets/adopted.webp', status: SellerMediaAssetStatus.ADOPTED }, { id: 'source-asset', objectKey: 'seller-product-assets/source.webp', status: SellerMediaAssetStatus.AVAILABLE }]) },
      productMedia: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    const prisma = {
      product: { findFirst: jest.fn().mockResolvedValue(product) },
      productMediaRevision: tx.productMediaRevision,
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const assets = {
      assertOwnedProductImageAssets: jest.fn().mockResolvedValue([
        { id: 'adopted-asset' }, { id: 'source-asset' },
      ]),
    };
    const upload = { createProductMediaUrl: jest.fn((key: string) => `https://api.example/${key}`) };
    const service = new ProductMediaRevisionsService(prisma as any, assets as any, upload as any, { emit: jest.fn() } as any);

    await expect(service.request('company-1', 'staff-1', 'product-1', {
      mediaAssetIds: ['adopted-asset', 'source-asset'],
      idempotencyKey: 'retry-1', quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true,
    })).resolves.toEqual({ id: 'revision-2', status: ProductMediaRevisionStatus.APPLIED_BY_SELLER });

    expect(assets.assertOwnedProductImageAssets).toHaveBeenCalledWith('company-1', ['adopted-asset', 'source-asset'], {
      allowedAdoptedAssetIds: ['adopted-asset', 'source-asset'],
    });
    expect(tx.productMediaRevision.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: ProductMediaRevisionStatus.APPLIED_BY_SELLER,
        previousMedia: expect.arrayContaining([expect.objectContaining({ assetId: 'source-asset' })]),
        proposedMedia: expect.arrayContaining([
          expect.objectContaining({ assetId: 'adopted-asset', visualOrigin: 'DETERMINISTIC_COMPOSITE', optimizationId: 'optimization-1' }),
          expect.objectContaining({ assetId: 'source-asset', isEvidenceImage: true }),
        ]),
      }),
    }));
    expect(tx.product.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ mediaVersion: 2 }) }));
  });

  it('rejects reusing a manual image-update idempotency key for a different product or media snapshot', async () => {
    const product = {
      id: 'product-1', status: 'ACTIVE', auditStatus: 'APPROVED', mediaVersion: 2,
      media: [{ assetId: 'source-asset', type: 'IMAGE', visualOrigin: 'ORIGINAL', optimizationId: null, isEvidenceImage: false, sortOrder: 0 }],
    };
    const existing = {
      id: 'revision-other', productId: 'product-other',
      proposedMedia: [{ assetId: 'other-asset', sortOrder: 0, type: 'IMAGE' }],
    };
    const tx = {
      productMediaRevision: { findFirst: jest.fn().mockResolvedValue(existing), create: jest.fn() },
      product: { findFirst: jest.fn(), updateMany: jest.fn() },
      sellerMediaAsset: { findMany: jest.fn() },
      productMedia: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    const prisma = {
      product: { findFirst: jest.fn().mockResolvedValue(product) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const assets = { assertOwnedProductImageAssets: jest.fn().mockResolvedValue([{ id: 'source-asset' }]) };
    const service = new ProductMediaRevisionsService(prisma as any, assets as any, {} as any, { emit: jest.fn() } as any);

    await expect(service.request('company-1', 'staff-1', 'product-1', {
      mediaAssetIds: ['source-asset'], idempotencyKey: 'shared-key', quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true,
    })).rejects.toThrow('幂等键已用于另一项商品图片变更');
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.productMedia.deleteMany).not.toHaveBeenCalled();
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

  it('immediately applies an AI candidate with a pre-change snapshot and one media-version CAS', async () => {
    const product = {
      id: 'product-1', companyId: 'company-1', status: 'ACTIVE', auditStatus: 'APPROVED', mediaVersion: 8,
      media: [{ assetId: 'source-asset', type: 'IMAGE', sortOrder: 0, visualOrigin: 'ORIGINAL', optimizationId: null, isEvidenceImage: false }],
    };
    const tx = {
      product: { findFirst: jest.fn().mockResolvedValue(product), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productMediaRevision: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'revision-1' }) },
      productImageOptimization: { findFirst: jest.fn().mockResolvedValue({ kind: 'BACKGROUND_GENERATION', artifacts: [{ assetId: 'candidate-asset' }] }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      sellerMediaAsset: { findMany: jest.fn().mockResolvedValue([
        { id: 'source-asset', status: SellerMediaAssetStatus.AVAILABLE, objectKey: 'source.webp', scanSummary: null },
        { id: 'candidate-asset', status: SellerMediaAssetStatus.CANDIDATE, objectKey: 'candidate.webp', scanSummary: null },
      ]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productMedia: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }), createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const prisma = { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) };
    const upload = { createProductMediaUrl: jest.fn((key: string) => `https://media.example/${key}`) };
    const service = new ProductMediaRevisionsService(prisma as any, {} as any, upload as any, { emit: jest.fn() } as any);

    await expect(service.applyOptimizationAdoption({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', optimizationId: 'task-1', candidateAssetId: 'candidate-asset', sourceAssetId: 'source-asset',
      attestation: { quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true },
    })).resolves.toEqual({ id: 'revision-1' });

    expect(tx.productMediaRevision.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: ProductMediaRevisionStatus.APPLIED_BY_SELLER,
      expectedMediaVersion: 8,
      appliedMediaVersion: 9,
      previousMedia: [expect.objectContaining({ assetId: 'source-asset' })],
    }) }));
    expect(tx.product.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ mediaVersion: 8 }) }));
    expect(tx.productMedia.deleteMany).toHaveBeenCalledWith({ where: { productId: 'product-1' } });
    expect(tx.productMedia.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([
      expect.objectContaining({ assetId: 'candidate-asset', visualOrigin: 'AI_BACKGROUND', sortOrder: 0 }),
      expect.objectContaining({ assetId: 'source-asset', isEvidenceImage: true }),
    ]) }));
  });

  it('publishes a newly uploaded source beside its adopted candidate without losing existing public media', async () => {
    const product = {
      id: 'product-1', companyId: 'company-1', status: 'ACTIVE', auditStatus: 'APPROVED', mediaVersion: 3,
      media: [{ assetId: 'old-public', type: 'IMAGE', sortOrder: 0, visualOrigin: 'ORIGINAL', optimizationId: null, isEvidenceImage: false }],
    };
    const tx = {
      product: { findFirst: jest.fn().mockResolvedValue(product), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productMediaRevision: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'revision-new-source' }) },
      productImageOptimization: { findFirst: jest.fn().mockResolvedValue({ kind: 'BACKGROUND_GENERATION', artifacts: [{ assetId: 'candidate-asset' }] }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      sellerMediaAsset: { findMany: jest.fn().mockResolvedValue([
        { id: 'old-public', status: SellerMediaAssetStatus.AVAILABLE, objectKey: 'old.webp', scanSummary: null },
        { id: 'source-asset', status: SellerMediaAssetStatus.AVAILABLE, objectKey: 'source.webp', scanSummary: null },
        { id: 'candidate-asset', status: SellerMediaAssetStatus.CANDIDATE, objectKey: 'candidate.webp', scanSummary: null },
      ]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productMedia: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }), createMany: jest.fn().mockResolvedValue({ count: 3 }) },
    };
    const service = new ProductMediaRevisionsService(
      { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) } as any,
      {} as any,
      { createProductMediaUrl: jest.fn((key: string) => `https://media.example/${key}`) } as any,
      { emit: jest.fn() } as any,
    );

    await service.applyOptimizationAdoption({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', optimizationId: 'task-1',
      candidateAssetId: 'candidate-asset', sourceAssetId: 'source-asset',
      attestation: { quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true },
    });

    expect(tx.productMedia.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [
      expect.objectContaining({ assetId: 'candidate-asset', sortOrder: 0, isEvidenceImage: false }),
      expect.objectContaining({ assetId: 'source-asset', sortOrder: 1, isEvidenceImage: true, visualOrigin: 'ORIGINAL' }),
      expect.objectContaining({ assetId: 'old-public', sortOrder: 2 }),
    ] }));
  });

  it('does not replace public media when immediate AI adoption loses the media-version CAS', async () => {
    const product = {
      id: 'product-1', companyId: 'company-1', status: 'ACTIVE', auditStatus: 'APPROVED', mediaVersion: 8,
      media: [{ assetId: 'source-asset', type: 'IMAGE', sortOrder: 0, visualOrigin: 'ORIGINAL', optimizationId: null, isEvidenceImage: false }],
    };
    const tx = {
      product: { findFirst: jest.fn().mockResolvedValue(product), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      productMediaRevision: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'revision-1' }) },
      productImageOptimization: { findFirst: jest.fn().mockResolvedValue({ kind: 'BACKGROUND_GENERATION', artifacts: [{ assetId: 'candidate-asset' }] }), updateMany: jest.fn() },
      sellerMediaAsset: { findMany: jest.fn().mockResolvedValue([
        { id: 'source-asset', status: SellerMediaAssetStatus.AVAILABLE, objectKey: 'source.webp', scanSummary: null },
        { id: 'candidate-asset', status: SellerMediaAssetStatus.CANDIDATE, objectKey: 'candidate.webp', scanSummary: null },
      ]), updateMany: jest.fn() },
      productMedia: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    const service = new ProductMediaRevisionsService({ $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) } as any, {} as any, { createProductMediaUrl: jest.fn() } as any, { emit: jest.fn() } as any);

    await expect(service.applyOptimizationAdoption({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', optimizationId: 'task-1', candidateAssetId: 'candidate-asset', sourceAssetId: 'source-asset',
      attestation: { quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true },
    })).rejects.toThrow('商品图片已被其他操作更新');
    expect(tx.productMedia.deleteMany).not.toHaveBeenCalled();
  });

  it('rechecks the saved product fact hash inside the public-image adoption transaction', async () => {
    const originalFacts = {
      title: '原商品', subtitle: null, description: '原说明', categoryId: 'category-1',
      updatedAt: new Date('2026-09-02T00:00:00.000Z'), mediaVersion: 8,
    };
    const tx = {
      product: { findFirst: jest.fn().mockResolvedValue({
        id: 'product-1', companyId: 'company-1', status: 'ACTIVE', auditStatus: 'APPROVED', media: [],
        ...originalFacts, title: '事务前已变化', updatedAt: new Date('2026-09-02T00:01:00.000Z'),
      }) },
      productMediaRevision: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ProductMediaRevisionsService(
      { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.applyOptimizationAdoption({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', optimizationId: 'task-1',
      candidateAssetId: 'candidate-asset', sourceAssetId: 'source-asset',
      expectedProductFactHash: productVisualFactHash(originalFacts),
      attestation: { quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true },
    })).rejects.toThrow('商品资料已在候选生成后变化');
  });

  it('restores only the exact published version and emits one seller notification', async () => {
    const revision = {
      id: 'revision-1', productId: 'product-1', companyId: 'company-1', status: ProductMediaRevisionStatus.APPLIED_BY_SELLER, appliedMediaVersion: 9,
      previousMedia: [{ assetId: 'source-asset', type: 'IMAGE', sortOrder: 0, visualOrigin: 'ORIGINAL', optimizationId: null, isEvidenceImage: true }],
      product: { id: 'product-1', companyId: 'company-1', mediaVersion: 9, status: 'ACTIVE', auditStatus: 'APPROVED' },
    };
    const tx = {
      productMediaRevision: { findUnique: jest.fn().mockResolvedValue(revision), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      sellerMediaAsset: { findMany: jest.fn().mockResolvedValue([{ id: 'source-asset', status: SellerMediaAssetStatus.AVAILABLE, objectKey: 'source.webp' }]) },
      product: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productMedia: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    const service = new ProductMediaRevisionsService({ $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) } as any, {} as any, { createProductMediaUrl: jest.fn((key: string) => `https://media.example/${key}`) } as any, notifications as any);

    await expect(service.rollbackPublished('revision-1', 'admin-1', '包装型号与商品不符')).resolves.toEqual({ rolledBack: true, revisionId: 'revision-1', productId: 'product-1' });
    expect(tx.product.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ mediaVersion: 9 }) }));
    expect(tx.productMedia.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ assetId: 'source-asset', isEvidenceImage: true })] }));
    expect(notifications.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'product.mediaRolledBackForSeller', payload: expect.objectContaining({ companyId: 'company-1', productId: 'product-1' }) }),
      tx,
    );
  });

  it('refuses an administrative rollback after a newer merchant picture change', async () => {
    const revision = {
      id: 'revision-1', productId: 'product-1', companyId: 'company-1', status: ProductMediaRevisionStatus.APPLIED_BY_SELLER, appliedMediaVersion: 9,
      previousMedia: [{ assetId: 'source-asset', type: 'IMAGE', sortOrder: 0, visualOrigin: 'ORIGINAL', optimizationId: null, isEvidenceImage: true }],
      product: { id: 'product-1', companyId: 'company-1', mediaVersion: 10, status: 'ACTIVE', auditStatus: 'APPROVED' },
    };
    const tx = {
      productMediaRevision: { findUnique: jest.fn().mockResolvedValue(revision), updateMany: jest.fn() },
      sellerMediaAsset: { findMany: jest.fn().mockResolvedValue([{ id: 'source-asset', status: SellerMediaAssetStatus.AVAILABLE, objectKey: 'source.webp' }]) },
      product: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      productMedia: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    const notifications = { emit: jest.fn() };
    const service = new ProductMediaRevisionsService({ $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) } as any, {} as any, { createProductMediaUrl: jest.fn() } as any, notifications as any);

    await expect(service.rollbackPublished('revision-1', 'admin-1', '规则不符')).rejects.toThrow('商品图片在该历史版本后已更新');
    expect(tx.productMedia.deleteMany).not.toHaveBeenCalled();
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('writes the seller rollback notification inside the same transaction', async () => {
    const revision = {
      id: 'revision-1', productId: 'product-1', companyId: 'company-1', status: ProductMediaRevisionStatus.APPLIED_BY_SELLER, appliedMediaVersion: 9,
      previousMedia: [{ assetId: 'source-asset', type: 'IMAGE', sortOrder: 0, visualOrigin: 'ORIGINAL', optimizationId: null, isEvidenceImage: true }],
      product: { id: 'product-1', companyId: 'company-1', mediaVersion: 9, status: 'ACTIVE', auditStatus: 'APPROVED' },
    };
    const tx = {
      productMediaRevision: { findUnique: jest.fn().mockResolvedValue(revision), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      sellerMediaAsset: { findMany: jest.fn().mockResolvedValue([{ id: 'source-asset', status: SellerMediaAssetStatus.AVAILABLE, objectKey: 'source.webp' }]) },
      product: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productMedia: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    const notifications = { emit: jest.fn().mockRejectedValue(new Error('outbox unavailable')) };
    const prisma = { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) };
    const service = new ProductMediaRevisionsService(prisma as any, {} as any, { createProductMediaUrl: jest.fn() } as any, notifications as any);

    await expect(service.rollbackPublished('revision-1', 'admin-1', '规则不符')).rejects.toThrow('outbox unavailable');
    expect(notifications.emit).toHaveBeenCalledWith(expect.any(Object), tx);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('lists only minimal inspection metadata and does not return a raw processing contract', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new ProductMediaRevisionsService({ productMediaRevision: { findMany } } as any, {} as any, {} as any, { emit: jest.fn() } as any);

    await expect(service.listPublishedForAdmin()).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: [ProductMediaRevisionStatus.APPLIED_BY_SELLER, ProductMediaRevisionStatus.ROLLED_BACK_BY_ADMIN] } },
      include: expect.objectContaining({
        optimization: { select: { id: true, provider: true, costTier: true } },
      }),
    }));
    expect(JSON.stringify(findMany.mock.calls[0][0])).not.toContain('processingContract');
  });
});
