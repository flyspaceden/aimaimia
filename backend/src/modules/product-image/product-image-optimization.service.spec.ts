import { ProductImageArtifactKind, ProductImageOptimizationStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { ProductImageOptimizationService } from './product-image-optimization.service';

describe('ProductImageOptimizationService deterministic white-background task', () => {
  const source = {
    id: 'source-asset', companyId: 'company-1', objectKey: 'seller-product-assets/source.webp', canonicalSha256: 'source-sha',
    mimeType: 'image/webp', byteSize: 100, width: 100, height: 100, scanSummary: { needsReview: false },
  };
  const createdTask = {
    id: 'task-1', status: ProductImageOptimizationStatus.REQUESTED, kind: 'WHITE_BACKGROUND', productId: 'product-1',
    createdAt: new Date(), completedAt: null, failureCode: null, failureDetail: null,
  };
  const completedTask = {
    ...createdTask,
    status: ProductImageOptimizationStatus.SUCCEEDED,
    completedAt: new Date(),
    leaseGeneration: 1,
    artifacts: [{
      kind: ProductImageArtifactKind.CANDIDATE,
      metadata: { integrityProof: { verified: true } },
      asset: { id: 'candidate-asset', objectKey: 'seller-product-assets/candidate.png' },
    }],
  };

  const build = () => {
    const tx = {
      productImageOptimization: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'task-1' }),
        create: jest.fn().mockResolvedValue(createdTask),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      productImageArtifact: {
        create: jest.fn().mockResolvedValueOnce({ id: 'source-artifact' }).mockResolvedValueOnce({ id: 'candidate-artifact' }),
        findFirstOrThrow: jest.fn().mockResolvedValue({ assetId: 'source-asset' }),
      },
      productImageAssetLineage: { create: jest.fn().mockResolvedValue({ id: 'lineage' }) },
    };
    const prisma = {
      sellerMediaAsset: { findFirst: jest.fn().mockResolvedValue(source) },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product-1' }) },
      productImageOptimization: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(completedTask),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const upload = {
      getBuffer: jest.fn().mockResolvedValue(Buffer.from('transparent-source')),
      createPrivateAccessUrl: jest.fn().mockResolvedValue({ url: 'https://preview.example/candidate', expiresAt: '2026-08-21T00:05:00.000Z' }),
    };
    const mediaAssets = {
      createDerivedProductImageAsset: jest.fn().mockResolvedValue({
        asset: { id: 'candidate-asset', objectKey: 'seller-product-assets/candidate.png', canonicalSha256: 'candidate-sha', mimeType: 'image/png', byteSize: 200, width: 800, height: 1000 },
      }),
    };
    const composition = {
      composeWhiteBackgroundWithProof: jest.fn().mockResolvedValue({
        buffer: Buffer.from('candidate'),
        proof: { verified: true, outputSha256: 'candidate-sha' },
      }),
    };
    const revisions = { requestOptimizationAdoption: jest.fn() };
    return {
      service: new ProductImageOptimizationService(prisma as any, upload as any, mediaAssets as any, composition as any, revisions as any),
      prisma, tx, upload, mediaAssets, composition,
    };
  };

  it('creates a free, leased, auditable task and returns only a short-lived private candidate preview', async () => {
    const { service, prisma, tx, upload, mediaAssets, composition } = build();

    const result = await service.requestWhiteBackground('company-1', 'staff-1', {
      sourceAssetId: 'source-asset', productId: 'product-1', intent: 'WHITE_BACKGROUND', idempotencyKey: 'request-1',
    });

    expect(tx.productImageOptimization.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ productId: 'product-1', kind: 'WHITE_BACKGROUND', costTier: 'FREE', reservedCostCents: 0 }),
    }));
    expect(tx.productImageArtifact.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ kind: ProductImageArtifactKind.FOREGROUND_REFERENCE, assetId: 'source-asset' }),
    }));
    expect(tx.productImageArtifact.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ kind: ProductImageArtifactKind.CANDIDATE, assetId: 'candidate-asset', isAigc: false }),
    }));
    expect(prisma.productImageOptimization.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ProductImageOptimizationStatus.QUEUED }),
    }));
    expect(mediaAssets.createDerivedProductImageAsset).toHaveBeenCalledWith('company-1', 'staff-1', expect.objectContaining({ mimetype: 'image/png' }));
    expect(composition.composeWhiteBackgroundWithProof).toHaveBeenCalled();
    expect(upload.createPrivateAccessUrl).toHaveBeenCalledWith('seller-product-assets/candidate.png', 300);
    expect(result).toMatchObject({ status: ProductImageOptimizationStatus.SUCCEEDED, candidate: { assetId: 'candidate-asset', displayUrl: 'https://preview.example/candidate' } });
  });

  it('binds a task to a source image that is already attached to its target product', async () => {
    const { service, prisma, tx } = build();
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(service.requestWhiteBackground('company-1', 'staff-1', {
      sourceAssetId: 'source-asset', productId: 'product-1', intent: 'WHITE_BACKGROUND', idempotencyKey: 'unattached-source',
    })).rejects.toThrow('原图尚未用于该商品');

    expect(tx.productImageOptimization.create).not.toHaveBeenCalled();
  });

  it('records an opaque source as a controlled task failure instead of calling a model or publishing a candidate', async () => {
    const { service, prisma, mediaAssets, composition } = build();
    composition.composeWhiteBackgroundWithProof.mockRejectedValue(new BadRequestException('保真白底合成需要实际透明区域'));
    prisma.productImageOptimization.findFirst.mockResolvedValue({
      ...createdTask,
      status: ProductImageOptimizationStatus.FAILED,
      failureCode: 'TRANSPARENT_FOREGROUND_REQUIRED',
      failureDetail: '保真白底合成需要实际透明区域',
      artifacts: [],
    });

    const result = await service.requestWhiteBackground('company-1', 'staff-1', {
      sourceAssetId: 'source-asset', productId: 'product-1', intent: 'WHITE_BACKGROUND', idempotencyKey: 'request-opaque',
    });

    expect(mediaAssets.createDerivedProductImageAsset).not.toHaveBeenCalled();
    expect(prisma.productImageOptimization.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ProductImageOptimizationStatus.FAILED, failureCode: 'TRANSPARENT_FOREGROUND_REQUIRED' }),
    }));
    expect(result).toMatchObject({ status: ProductImageOptimizationStatus.FAILED, candidate: null });
  });

  it('returns the already claimed task when a concurrent identical request has advanced it first', async () => {
    const { service, prisma, composition } = build();
    // Free + paid stale-lease recovery run before the queue claim.
    prisma.productImageOptimization.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await service.requestWhiteBackground('company-1', 'staff-1', {
      sourceAssetId: 'source-asset', productId: 'product-1', intent: 'WHITE_BACKGROUND', idempotencyKey: 'same-request',
    });

    expect(composition.composeWhiteBackgroundWithProof).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'task-1', status: ProductImageOptimizationStatus.SUCCEEDED });
  });

  it('returns an existing pending review with a successful candidate task', async () => {
    const { service, prisma } = build();
    prisma.productImageOptimization.findFirst.mockResolvedValue({
      ...completedTask,
      mediaRevisions: [{ id: 'revision-1', status: 'PENDING_REVIEW', productId: 'product-1', createdAt: new Date() }],
    });

    await expect(service.getForSeller('company-1', 'task-1')).resolves.toMatchObject({
      pendingReview: { id: 'revision-1', status: 'PENDING_REVIEW' },
    });
  });

  it('recovers expired free leases and quarantines paid leases for reconciliation', async () => {
    const taskUpdates = jest.fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });
    const candidateUpdates = jest.fn().mockResolvedValue({ count: 1 });
    const service = new ProductImageOptimizationService(
      {
        productImageOptimization: { updateMany: taskUpdates },
        sellerMediaAsset: { updateMany: candidateUpdates },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.expireStaleLeases()).resolves.toBe(3);
    expect(taskUpdates).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ kind: 'WHITE_BACKGROUND', costTier: 'FREE', status: ProductImageOptimizationStatus.RUNNING }),
      data: expect.objectContaining({ status: ProductImageOptimizationStatus.FAILED, failureCode: 'LEASE_EXPIRED' }),
    }));
    expect(taskUpdates).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ costTier: 'PAID', status: ProductImageOptimizationStatus.RUNNING }),
      data: expect.objectContaining({ status: ProductImageOptimizationStatus.RECONCILING }),
    }));
    expect(candidateUpdates).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'CANDIDATE',
        OR: expect.arrayContaining([
          { imageArtifacts: { none: {} } },
          expect.objectContaining({ imageArtifacts: expect.anything() }),
        ]),
      }),
      data: { status: 'RETIRED' },
    }));
  });

  it('adopts a candidate into an unpublished product only through an evidence-preserving transaction', async () => {
    const candidate = { id: 'candidate-asset', status: 'CANDIDATE', objectKey: 'seller-product-assets/candidate.png' };
    const sourceAsset = { id: 'source-asset', status: 'AVAILABLE', objectKey: 'seller-product-assets/source.webp' };
    const succeededTask = {
      id: 'task-1', companyId: 'company-1', productId: 'product-1', status: ProductImageOptimizationStatus.SUCCEEDED,
      artifacts: [
        { kind: ProductImageArtifactKind.CANDIDATE, asset: candidate },
        { kind: ProductImageArtifactKind.FOREGROUND_REFERENCE, asset: sourceAsset },
      ],
    };
    const adoptedTask = { ...succeededTask, status: ProductImageOptimizationStatus.ADOPTED };
    const tx = {
      productImageOptimization: { findFirst: jest.fn().mockResolvedValue({ id: 'task-1' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product-1', media: [{ assetId: 'source-asset' }] }) },
      sellerMediaAsset: { findMany: jest.fn().mockResolvedValue([candidate, sourceAsset]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productMedia: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({ id: 'media' }) },
    };
    const prisma = {
      productImageOptimization: {
        findFirst: jest.fn().mockResolvedValueOnce(succeededTask).mockResolvedValueOnce({ ...adoptedTask, artifacts: [] }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product-1', status: 'INACTIVE', auditStatus: 'PENDING' }) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const upload = { createProductMediaUrl: jest.fn((key: string) => `https://api.example/${key}`) };
    const service = new ProductImageOptimizationService(prisma as any, upload as any, {} as any, {} as any, {} as any);

    const result = await service.adopt('company-1', 'staff-1', 'task-1', {
      productId: 'product-1', quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true,
    });

    expect(tx.productMedia.updateMany).toHaveBeenCalledWith({
      where: { productId: 'product-1', assetId: 'source-asset' },
      data: { isEvidenceImage: true },
    });
    expect(tx.productMedia.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assetId: 'candidate-asset', optimizationId: 'task-1', visualOrigin: 'DETERMINISTIC_COMPOSITE' }),
    }));
    expect(tx.productImageOptimization.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ProductImageOptimizationStatus.ADOPTED, adoptedByStaffId: 'staff-1' }),
    }));
    expect(tx.sellerMediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'ADOPTED' },
    }));
    expect(result.mode).toBe('APPLIED_TO_UNPUBLISHED_PRODUCT');
  });

  it('refuses to adopt a candidate into a product other than the one bound to the task', async () => {
    const task = {
      id: 'task-1', companyId: 'company-1', productId: 'product-1', status: ProductImageOptimizationStatus.SUCCEEDED, artifacts: [],
    };
    const prisma = {
      productImageOptimization: { findFirst: jest.fn().mockResolvedValue(task) },
      product: { findFirst: jest.fn() },
    };
    const service = new ProductImageOptimizationService(prisma as any, {} as any, {} as any, {} as any, {} as any);

    await expect(service.adopt('company-1', 'staff-1', 'task-1', {
      productId: 'product-2', quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true,
    })).rejects.toThrow('仅可用于创建任务时绑定的商品');

    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it('does not directly write candidate media if the product becomes active and approved during adoption', async () => {
    const candidate = { id: 'candidate-asset', status: 'CANDIDATE', objectKey: 'seller-product-assets/candidate.png' };
    const sourceAsset = { id: 'source-asset', status: 'AVAILABLE', objectKey: 'seller-product-assets/source.webp' };
    const tx = {
      productImageOptimization: { findFirst: jest.fn().mockResolvedValue({ id: 'task-1' }), updateMany: jest.fn() },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product-1', status: 'ACTIVE', auditStatus: 'APPROVED', media: [] }) },
      sellerMediaAsset: { findMany: jest.fn() },
      productMedia: { updateMany: jest.fn(), create: jest.fn() },
    };
    const task = {
      id: 'task-1', companyId: 'company-1', productId: 'product-1', status: ProductImageOptimizationStatus.SUCCEEDED,
      artifacts: [
        { kind: ProductImageArtifactKind.CANDIDATE, asset: candidate },
        { kind: ProductImageArtifactKind.FOREGROUND_REFERENCE, asset: sourceAsset },
      ],
    };
    const prisma = {
      productImageOptimization: { findFirst: jest.fn().mockResolvedValue(task) },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product-1', status: 'INACTIVE', auditStatus: 'PENDING' }) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = new ProductImageOptimizationService(prisma as any, {} as any, {} as any, {} as any, {} as any);

    await expect(service.adopt('company-1', 'staff-1', 'task-1', {
      productId: 'product-1', quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true,
    })).rejects.toThrow('商品已上架');
    expect(tx.productMedia.create).not.toHaveBeenCalled();
  });

  it('refuses adoption before adding a tenth media item', async () => {
    const candidate = { id: 'candidate-asset', status: 'CANDIDATE', objectKey: 'seller-product-assets/candidate.png' };
    const sourceAsset = { id: 'source-asset', status: 'AVAILABLE', objectKey: 'seller-product-assets/source.webp' };
    const task = {
      id: 'task-1', companyId: 'company-1', productId: 'product-1', status: ProductImageOptimizationStatus.SUCCEEDED,
      artifacts: [
        { kind: ProductImageArtifactKind.CANDIDATE, asset: candidate },
        { kind: ProductImageArtifactKind.FOREGROUND_REFERENCE, asset: sourceAsset },
      ],
    };
    const tx = {
      productImageOptimization: { findFirst: jest.fn().mockResolvedValue({ id: 'task-1' }), updateMany: jest.fn() },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product-1', status: 'INACTIVE', auditStatus: 'PENDING', media: Array.from({ length: 9 }, (_value, index) => ({ assetId: index === 0 ? 'source-asset' : `asset-${index}` })) }) },
      sellerMediaAsset: { findMany: jest.fn(), updateMany: jest.fn() },
      productMedia: { updateMany: jest.fn(), create: jest.fn() },
    };
    const prisma = {
      productImageOptimization: { findFirst: jest.fn().mockResolvedValue(task) },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product-1', status: 'INACTIVE', auditStatus: 'PENDING' }) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = new ProductImageOptimizationService(prisma as any, {} as any, {} as any, {} as any, {} as any);

    await expect(service.adopt('company-1', 'staff-1', 'task-1', {
      productId: 'product-1', quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true,
    })).rejects.toThrow('超过 9 张');
    expect(tx.productMedia.create).not.toHaveBeenCalled();
  });
});
