import { Prisma, ProductImageArtifactKind, ProductImageOptimizationStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { ProductImageOptimizationService } from './product-image-optimization.service';

describe('ProductImageOptimizationService deterministic white-background task', () => {
  const source = {
    id: 'source-asset', companyId: 'company-1', objectKey: 'seller-product-assets/source.webp', canonicalSha256: 'source-sha',
    mimeType: 'image/webp', byteSize: 100, width: 100, height: 100,
    scanSummary: {
      needsReview: false,
      ocrTextVerifiedEmpty: true,
      ocrFactScanId: 'fact-scan-1',
      ocrFactScanSourceHash: 'source-sha',
      ocrFactScanPolicyVersion: 'product-image-fact-scan-v1',
    },
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
      sellerMediaAsset: { findFirst: jest.fn().mockResolvedValue(source), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product-1' }) },
      productVisualPlan: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'plan-1', planHash: 'plan-sha', riskProfile: 'STANDARD_FACTS',
          allowedModes: ['PRESERVE_REAL_SCENE'], modelPolicyVersion: 'model-policy-disabled-v1', protectedRegionVersion: 'NOT_CREATED',
        }),
      },
      productImageFactScan: {
        findFirst: jest.fn((args: { where?: { createdAt?: unknown } }) => (
          args?.where?.createdAt
            ? null
            : { id: 'fact-scan-1', createdAt: new Date('2026-08-24T12:00:00.000Z') }
        )),
      },
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
      enhanceStandardRealScene: jest.fn().mockResolvedValue({
        buffer: Buffer.from('free-tune-candidate'),
        proof: { algorithm: 'pixel-aligned-deterministic-free-tune-v1', geometryIdentity: true, outputSha256: 'candidate-sha' },
      }),
    };
    const revisions = { applyOptimizationAdoption: jest.fn() };
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

  it('runs FREE_TUNE only from an unexpired standard-facts plan and never calls a model renderer', async () => {
    const { service, prisma, tx, mediaAssets, composition } = build();

    const result = await service.requestFreeTune('company-1', 'staff-1', {
      sourceAssetId: 'source-asset', productId: 'product-1', intent: 'FREE_TUNE', planId: 'plan-1', idempotencyKey: 'free-tune-1',
    });

    expect(prisma.productVisualPlan.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'plan-1', sourceAssetId: 'source-asset', sourceHash: 'source-sha' }),
    }));
    expect(tx.productImageOptimization.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: 'FREE_TUNE',
        costTier: 'FREE',
        reservedCostCents: 0,
        processingContract: expect.objectContaining({ factEvidence: expect.objectContaining({ id: 'fact-scan-1' }) }),
      }),
    }));
    expect(composition.enhanceStandardRealScene).toHaveBeenCalledWith(Buffer.from('transparent-source'));
    expect(composition.composeWhiteBackgroundWithProof).not.toHaveBeenCalled();
    expect(mediaAssets.createDerivedProductImageAsset).toHaveBeenCalledWith('company-1', 'staff-1', expect.objectContaining({ mimetype: 'image/png' }));
    expect(result).toMatchObject({ status: ProductImageOptimizationStatus.SUCCEEDED, candidate: { assetId: 'candidate-asset' } });
  });

  it('refuses FREE_TUNE for a strict-facts plan until protected-region verification exists', async () => {
    const { service, prisma, tx, composition } = build();
    prisma.productVisualPlan.findFirst.mockResolvedValue({
      id: 'plan-1', planHash: 'plan-sha', riskProfile: 'STRICT_FACTS',
      allowedModes: ['PRESERVE_REAL_SCENE'], modelPolicyVersion: 'model-policy-disabled-v1', protectedRegionVersion: 'NOT_CREATED',
    });

    await expect(service.requestFreeTune('company-1', 'staff-1', {
      sourceAssetId: 'source-asset', productId: 'product-1', intent: 'FREE_TUNE', planId: 'plan-1', idempotencyKey: 'free-tune-strict',
    })).rejects.toThrow('当前风险档不允许');
    expect(tx.productImageOptimization.create).not.toHaveBeenCalled();
    expect(composition.enhanceStandardRealScene).not.toHaveBeenCalled();
  });

  it('fails closed until server-side OCR has verified that no readable facts exist in the source', async () => {
    const { service, prisma, tx, composition } = build();
    prisma.sellerMediaAsset.findFirst.mockResolvedValue({ ...source, scanSummary: { needsReview: false } });

    await expect(service.requestFreeTune('company-1', 'staff-1', {
      sourceAssetId: 'source-asset', productId: 'product-1', intent: 'FREE_TUNE', planId: 'plan-1', idempotencyKey: 'free-tune-no-ocr',
    })).rejects.toThrow('需要当前有效的 OCR、QR 和条码事实扫描证据');
    expect(tx.productImageOptimization.create).not.toHaveBeenCalled();
    expect(composition.enhanceStandardRealScene).not.toHaveBeenCalled();
  });

  it('rechecks fact evidence after the lease claim and refuses a newer unresolved scan', async () => {
    const { service, prisma, tx, composition } = build();
    const verified = { id: 'fact-scan-1', createdAt: new Date('2026-08-24T12:00:00.000Z') };
    const findFactScan = prisma.productImageFactScan.findFirst as jest.Mock;
    findFactScan
      .mockReset()
      // Request validation: valid evidence, no newer conclusion.
      .mockResolvedValueOnce(verified)
      .mockResolvedValueOnce(null)
      // Worker validation: an updated scan has appeared after queueing.
      .mockResolvedValueOnce(verified)
      .mockResolvedValueOnce({ id: 'newer-inconclusive-scan' });

    await service.requestFreeTune('company-1', 'staff-1', {
      sourceAssetId: 'source-asset', productId: 'product-1', intent: 'FREE_TUNE', planId: 'plan-1', idempotencyKey: 'free-tune-superseded',
    });

    expect(composition.enhanceStandardRealScene).not.toHaveBeenCalled();
    expect(tx.productImageArtifact.create).toHaveBeenCalledTimes(1);
    expect(tx.productImageArtifact.create).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: ProductImageArtifactKind.CANDIDATE }),
    }));
    expect(prisma.productImageOptimization.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ProductImageOptimizationStatus.FAILED, failureCode: 'FREE_TUNE_RENDER_FAILED' }),
    }));
  });

  it('pins the candidate to the exact fact scan recorded in its processing contract', async () => {
    const { service, prisma, tx, composition } = build();
    const firstEvidence = { id: 'fact-scan-1', createdAt: new Date('2026-08-24T12:00:00.000Z') };
    const replacementEvidence = { id: 'fact-scan-2', createdAt: new Date('2026-08-24T12:01:00.000Z') };
    prisma.sellerMediaAsset.findFirst
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce({
        ...source,
        scanSummary: {
          ...source.scanSummary,
          ocrFactScanId: 'fact-scan-2',
        },
      });
    const findFactScan = prisma.productImageFactScan.findFirst as jest.Mock;
    findFactScan
      .mockReset()
      .mockResolvedValueOnce(firstEvidence)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(replacementEvidence)
      .mockResolvedValueOnce(null);

    await service.requestFreeTune('company-1', 'staff-1', {
      sourceAssetId: 'source-asset', productId: 'product-1', intent: 'FREE_TUNE', planId: 'plan-1', idempotencyKey: 'free-tune-new-evidence',
    });

    expect(composition.enhanceStandardRealScene).not.toHaveBeenCalled();
    expect(tx.productImageArtifact.create).toHaveBeenCalledTimes(1);
    expect(prisma.productImageOptimization.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ProductImageOptimizationStatus.FAILED, failureCode: 'FREE_TUNE_RENDER_FAILED' }),
    }));
  });

  it('rejects reusing an idempotency key for a different product source', async () => {
    const { service, tx } = build();
    tx.productImageOptimization.findUnique.mockResolvedValue({
      ...createdTask,
      productId: 'product-other',
      inputFingerprint: 'other-source-fingerprint',
    });

    await expect(service.requestWhiteBackground('company-1', 'staff-1', {
      sourceAssetId: 'source-asset', productId: 'product-1', intent: 'WHITE_BACKGROUND', idempotencyKey: 'reused-key',
    })).rejects.toThrow('幂等键已用于另一张商品图片或商品');

    expect(tx.productImageOptimization.create).not.toHaveBeenCalled();
  });

  it('keeps the same input binding when a concurrent unique-key race is recovered', async () => {
    const { service, prisma, tx } = build();
    tx.productImageOptimization.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'unique conflict',
      { code: 'P2002', clientVersion: 'test' },
    ));
    prisma.productImageOptimization.findFirst.mockResolvedValue({
      ...createdTask,
      productId: 'product-other',
      inputFingerprint: 'other-source-fingerprint',
    });

    await expect(service.requestWhiteBackground('company-1', 'staff-1', {
      sourceAssetId: 'source-asset', productId: 'product-1', intent: 'WHITE_BACKGROUND', idempotencyKey: 'raced-reused-key',
    })).rejects.toThrow('幂等键已用于另一张商品图片或商品');
  });

  it('does not reuse a successful task for a separately managed source with identical bytes', async () => {
    const first = build();
    const second = build();
    second.prisma.sellerMediaAsset.findFirst.mockResolvedValue({ ...source, id: 'source-asset-b' });

    await first.service.requestWhiteBackground('company-1', 'staff-1', {
      sourceAssetId: 'source-asset', productId: 'product-1', intent: 'WHITE_BACKGROUND', idempotencyKey: 'source-a',
    });
    await second.service.requestWhiteBackground('company-1', 'staff-1', {
      sourceAssetId: 'source-asset-b', productId: 'product-1', intent: 'WHITE_BACKGROUND', idempotencyKey: 'source-b',
    });

    const firstFingerprint = first.tx.productImageOptimization.create.mock.calls[0][0].data.inputFingerprint;
    const secondFingerprint = second.tx.productImageOptimization.create.mock.calls[0][0].data.inputFingerprint;
    expect(firstFingerprint).not.toBe(secondFingerprint);
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

  it('returns the already claimed task when a concurrent identical request has advanced it first', async () => {
    const { service, prisma, composition } = build();
    // The first two updates are stale-lease recovery for free/paid work; the
    // third is the queue claim. A concurrent request has already claimed it.
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

  it('retires a candidate when its worker loses the lease before committing it', async () => {
    const { service, prisma, tx } = build();
    // First lookup is the dedupe cache; the second is the lease-protected
    // completion transaction. A stale lease must not publish its candidate.
    tx.productImageOptimization.findFirst.mockReset();
    tx.productImageOptimization.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await service.requestWhiteBackground('company-1', 'staff-1', {
      sourceAssetId: 'source-asset', productId: 'product-1', intent: 'WHITE_BACKGROUND', idempotencyKey: 'stale-worker',
    });

    expect(prisma.sellerMediaAsset.updateMany).toHaveBeenCalledWith({
      where: { id: 'candidate-asset', companyId: 'company-1', status: 'CANDIDATE' },
      data: { status: 'RETIRED' },
    });
  });

  it('expires stale RUNNING leases so the task can be retried safely', async () => {
    const updateMany = jest.fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 0 });
    const retireCandidates = jest.fn().mockResolvedValue({ count: 1 });
    const service = new ProductImageOptimizationService(
      { productImageOptimization: { updateMany }, sellerMediaAsset: { updateMany: retireCandidates } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.expireStaleLeases()).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: ProductImageOptimizationStatus.RUNNING,
        kind: { in: ['WHITE_BACKGROUND', 'FREE_TUNE'] },
        leaseExpiresAt: { lt: expect.any(Date) },
      }),
      data: expect.objectContaining({
        status: ProductImageOptimizationStatus.FAILED,
        failureCode: 'LEASE_EXPIRED',
        leaseToken: null,
        leaseExpiresAt: null,
      }),
    }));
    expect(retireCandidates).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'CANDIDATE',
        OR: expect.arrayContaining([{ imageArtifacts: { none: {} } }]),
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

  it('keeps a marketing-scene candidate preview-only and never publishes it as a fact image', async () => {
    const task = {
      id: 'task-1', companyId: 'company-1', productId: 'product-1', status: ProductImageOptimizationStatus.SUCCEEDED,
      processingContract: { rateCard: { candidateRole: 'MARKETING_IMAGE' } }, artifacts: [],
    };
    const prisma = {
      productImageOptimization: { findFirst: jest.fn().mockResolvedValue(task) },
      product: { findFirst: jest.fn() },
    };
    const service = new ProductImageOptimizationService(prisma as any, {} as any, {} as any, {} as any, {} as any);

    await expect(service.adopt('company-1', 'staff-1', 'task-1', {
      productId: 'product-1', quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true,
    })).rejects.toThrow('AI 营销场景图目前仅供预览');
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it('uses the immediate-publication history path if the product becomes active during adoption', async () => {
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
    const revisions = { applyOptimizationAdoption: jest.fn().mockResolvedValue({ id: 'revision-1' }) };
    const service = new ProductImageOptimizationService(prisma as any, {} as any, {} as any, {} as any, revisions as any);

    await expect(service.adopt('company-1', 'staff-1', 'task-1', {
      productId: 'product-1', quantityConfirmed: true, labelsConfirmed: true, factsConfirmed: true,
    })).resolves.toEqual({ mode: 'APPLIED', revisionId: 'revision-1', taskId: 'task-1' });
    expect(tx.productMedia.create).not.toHaveBeenCalled();
    expect(revisions.applyOptimizationAdoption).toHaveBeenCalledWith(expect.objectContaining({
      productId: 'product-1', optimizationId: 'task-1', candidateAssetId: 'candidate-asset', sourceAssetId: 'source-asset',
    }));
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
