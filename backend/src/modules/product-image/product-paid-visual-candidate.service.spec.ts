import { ProductImageArtifactKind, ProductImageOptimizationKind, ProductImageOptimizationStatus } from '@prisma/client';
import { ProductPaidVisualCandidateService } from './product-paid-visual-candidate.service';
import { UPLOAD_MAX_FILE_SIZE } from '../upload/upload.constants';
import { VisualAgentManagedOutputService } from '../visual-agent/visual-agent-managed-output.service';
const sharp = require('sharp') as typeof import('sharp').default;

const quote = {
  id: 'quote-1', quoteHash: 'c'.repeat(64), sourceAssetRef: 'source-asset', sourceHash: 'a'.repeat(64),
  visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE', riskProfile: 'STANDARD_FACTS', protectedRegionVersion: 'mask-v1', allowedOperations: ['LIGHTING'] },
  rateCardSnapshot: { modelProfile: 'BAILIAN_WAN_STANDARD' }, visualAgentInvocationId: 'invocation-1',
};

function samplePng() {
  return sharp({ create: { width: 320, height: 240, channels: 3, background: '#bb6655' } }).png().toBuffer();
}

function build() {
  const tx = {
    productImageOptimization: {
      create: jest.fn().mockResolvedValue({ id: 'optimization-1', status: ProductImageOptimizationStatus.RECONCILING }),
      findFirst: jest.fn().mockResolvedValue({ id: 'optimization-1', artifacts: [{ assetId: 'candidate-asset' }] }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    productImageArtifact: {
      create: jest.fn().mockResolvedValueOnce({ id: 'source-artifact' }).mockResolvedValueOnce({ id: 'candidate-artifact' }),
    },
    productImageAssetLineage: { create: jest.fn().mockResolvedValue({ id: 'lineage-1' }) },
    sellerMediaAsset: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    sellerMediaAsset: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'source-asset', objectKey: 'seller-product-assets/source.webp', canonicalSha256: 'a'.repeat(64),
        mimeType: 'image/webp', byteSize: 100, width: 800, height: 800,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    product: { findFirst: jest.fn().mockResolvedValue({ id: 'product-1' }) },
    productImageOptimization: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue({ id: 'optimization-1', processingContract: {}, artifacts: [{ assetId: 'candidate-asset' }] }),
      findMany: jest.fn().mockResolvedValue([{ id: 'optimization-1' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const assets = {
    createDerivedProductImageAsset: jest.fn().mockResolvedValue({
      asset: {
        id: 'candidate-asset', objectKey: 'seller-product-assets/candidate.png', canonicalSha256: 'b'.repeat(64),
        mimeType: 'image/png', byteSize: 200, width: 1024, height: 1024,
      },
    }),
  };
  const upload = { createPrivateAccessUrl: jest.fn().mockResolvedValue({ url: 'https://preview.example/image', expiresAt: '2026-08-26T12:05:00.000Z' }) };
  const managedOutputs = new VisualAgentManagedOutputService();
  return { service: new ProductPaidVisualCandidateService(prisma as any, assets as any, upload as any, managedOutputs), prisma, tx, assets, upload };
}

describe('ProductPaidVisualCandidateService', () => {
  it('persists a paid output as an AIGC candidate that cannot be adopted until settlement finalizes', async () => {
    const { service, tx, assets } = build();
    const buffer = await samplePng();
    const result = await service.persistPendingVerification({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'source-asset', sourceCanonicalHash: 'a'.repeat(64), provider: 'BAILIAN_WAN',
      quote, output: { buffer, mimeType: 'image/png' },
    });

    expect(result).toEqual({ id: 'optimization-1', status: ProductImageOptimizationStatus.RECONCILING, provider: null, candidateAssetId: 'candidate-asset', candidateObjectKey: 'seller-product-assets/candidate.png' });
    expect(assets.createDerivedProductImageAsset).toHaveBeenCalledWith('company-1', 'staff-1', expect.objectContaining({ mimetype: 'image/png' }));
    expect(tx.productImageOptimization.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: 'BACKGROUND_GENERATION', status: ProductImageOptimizationStatus.RECONCILING, costTier: 'PAID',
        idempotencyKey: 'paid-quote:quote-1',
      }),
    }));
    expect(tx.productImageArtifact.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ kind: ProductImageArtifactKind.CANDIDATE, assetId: 'candidate-asset', isAigc: true }),
    }));
  });

  it('persists a candidate for a newly uploaded owned source before that source is public product media', async () => {
    const { service, prisma } = build();
    const buffer = await samplePng();

    await service.persistPendingVerification({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'source-asset',
      sourceCanonicalHash: 'a'.repeat(64), provider: 'BAILIAN_WAN', quote,
      output: { buffer, mimeType: 'image/png' },
    });
    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'product-1', companyId: 'company-1' },
      select: { id: true },
    });
  });

  it('returns a persisted reconciling candidate for idempotent finalization recovery', async () => {
    const { service, prisma } = build();
    prisma.productImageOptimization.findUnique.mockResolvedValue({
      id: 'optimization-1', status: ProductImageOptimizationStatus.RECONCILING, provider: 'BAILIAN_WAN',
      artifacts: [{ kind: ProductImageArtifactKind.CANDIDATE, asset: { id: 'candidate-asset', objectKey: 'seller-product-assets/candidate.webp' } }],
    });

    await expect(service.getPendingVerification('company-1', 'quote-1')).resolves.toMatchObject({
      id: 'optimization-1', provider: 'BAILIAN_WAN', candidateObjectKey: 'seller-product-assets/candidate.webp',
    });
  });

  it('losslessly normalizes an oversized Provider PNG below the managed candidate limit', async () => {
    const { service, assets } = build();
    const oversized = await sharp({
      create: { width: 2100, height: 2100, channels: 3, background: '#bb3322' },
    }).png({ compressionLevel: 0 }).toBuffer();
    expect(oversized.length).toBeGreaterThan(UPLOAD_MAX_FILE_SIZE);

    await service.persistPendingVerification({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'source-asset',
      sourceCanonicalHash: 'a'.repeat(64), provider: 'BAILIAN_WAN', quote,
      output: { buffer: oversized, mimeType: 'image/png' },
    });

    const managedFile = (assets.createDerivedProductImageAsset as jest.Mock).mock.calls[0][2];
    expect(managedFile.mimetype).toBe('image/webp');
    expect(managedFile.size).toBeLessThanOrEqual(UPLOAD_MAX_FILE_SIZE);
    await expect(sharp(managedFile.buffer).metadata()).resolves.toMatchObject({ format: 'webp', width: 2100, height: 2100 });
  });

  it('normalizes a Provider JPEG to a lossless managed WebP candidate', async () => {
    const { service, assets } = build();
    const jpeg = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#448866' },
    }).jpeg({ quality: 95 }).toBuffer();

    await service.persistPendingVerification({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'source-asset',
      sourceCanonicalHash: 'a'.repeat(64), provider: 'BAILIAN_WAN', quote,
      output: { buffer: jpeg, mimeType: 'image/jpeg' },
    });

    const managedFile = (assets.createDerivedProductImageAsset as jest.Mock).mock.calls[0][2];
    expect(managedFile.mimetype).toBe('image/webp');
    expect(managedFile.size).toBeLessThanOrEqual(UPLOAD_MAX_FILE_SIZE);
  });

  it('retires an unlinked candidate if persistence fails after output storage', async () => {
    const { service, prisma } = build();
    const buffer = await samplePng();
    (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('transaction failed'));

    await expect(service.persistPendingVerification({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'source-asset', sourceCanonicalHash: 'a'.repeat(64), provider: 'BAILIAN_WAN',
      quote, output: { buffer, mimeType: 'image/png' },
    })).rejects.toThrow('transaction failed');
    expect(prisma.sellerMediaAsset.updateMany).toHaveBeenCalledWith({
      where: { id: 'candidate-asset', companyId: 'company-1', status: 'CANDIDATE' },
      data: { status: 'RETIRED' },
    });
  });

  it('makes a non-rejected paid candidate available for seller adoption and marks it for post-publication inspection', async () => {
    const { service, prisma } = build();
    await expect(service.finalizeVerification('company-1', 'quote-1', {
      local: { version: 'candidate-local-verification-v1', disposition: 'MANUAL_REVIEW', geometry: { verdict: 'PASS' } as any, qr: { verdict: 'PASS' } as any, barcode: { verdict: 'PASS' } as any, nextStep: 'QWEN_OCR_OR_HUMAN_FACT_REVIEW' },
      ocr: { version: 'candidate-ocr-verification-v1', state: 'SKIPPED_DISABLED', verdict: 'MANUAL_REVIEW', sourceTextDetected: null, candidateTextDetected: null, sourceTextLength: null, candidateTextLength: null, normalizedTextMatch: null },
    }, true)).resolves.toMatchObject({
      id: 'optimization-1', status: ProductImageOptimizationStatus.SUCCEEDED,
    });
    expect(prisma.productImageOptimization.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'optimization-1', status: ProductImageOptimizationStatus.RECONCILING },
      data: expect.objectContaining({
        status: ProductImageOptimizationStatus.SUCCEEDED,
        processingContract: expect.objectContaining({
          verification: expect.objectContaining({ state: 'ELIGIBLE_FOR_SELLER_ADOPTION_WITH_POST_PUBLICATION_INSPECTION', inspectionPriority: 'HIGH' }),
        }),
      }),
    }));
  });

  it('retires a candidate that local checks prove lost a protected fact', async () => {
    const { service, prisma } = build();
    await expect(service.finalizeVerification('company-1', 'quote-1', {
      local: { version: 'candidate-local-verification-v1', disposition: 'REJECT', geometry: {} as any, qr: {} as any, barcode: {} as any, nextStep: 'QWEN_OCR_OR_HUMAN_FACT_REVIEW' },
      ocr: { version: 'candidate-ocr-verification-v1', state: 'SKIPPED_DISABLED', verdict: 'MANUAL_REVIEW', sourceTextDetected: null, candidateTextDetected: null, sourceTextLength: null, candidateTextLength: null, normalizedTextMatch: null },
    }, true)).resolves.toMatchObject({ id: 'optimization-1', status: ProductImageOptimizationStatus.REJECTED });
    expect(prisma.sellerMediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['candidate-asset'] }, companyId: 'company-1', status: 'CANDIDATE' },
      data: { status: 'RETIRED' },
    }));
  });

  it('automatically unlocks only a no-human-review rate card whose local and OCR reports both pass', async () => {
    const { service, prisma } = build();
    await expect(service.finalizeVerification('company-1', 'quote-1', {
      local: { version: 'candidate-local-verification-v1', disposition: 'MANUAL_REVIEW', geometry: { verdict: 'PASS' } as any, qr: { verdict: 'PASS' } as any, barcode: { verdict: 'PASS' } as any, nextStep: 'QWEN_OCR_OR_HUMAN_FACT_REVIEW' },
      ocr: { version: 'candidate-ocr-verification-v1', state: 'MATCHED', verdict: 'AUTO_PASS', sourceTextDetected: true, candidateTextDetected: true, sourceTextLength: 12, candidateTextLength: 12, normalizedTextMatch: true },
    }, false)).resolves.toMatchObject({ id: 'optimization-1', status: ProductImageOptimizationStatus.SUCCEEDED });
    expect(prisma.productImageOptimization.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ProductImageOptimizationStatus.SUCCEEDED }),
    }));
  });

  it('lists only paid candidates that still need human fact review, without leaking provider artifacts', async () => {
    const { service, prisma } = build();

    await expect(service.listPendingForAdmin()).resolves.toEqual([{ id: 'optimization-1' }]);
    expect(prisma.productImageOptimization.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { kind: ProductImageOptimizationKind.BACKGROUND_GENERATION, status: ProductImageOptimizationStatus.PENDING_REVIEW },
      take: 200,
      select: expect.objectContaining({ product: expect.anything(), company: expect.anything() }),
    }));
  });

  it('lets an auditor approve or reject factual review without publishing media automatically', async () => {
    const { service, prisma, tx } = build();
    await expect(service.approveHumanFactReview('optimization-1')).resolves.toBeUndefined();
    expect(prisma.productImageOptimization.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: ProductImageOptimizationStatus.PENDING_REVIEW }),
      data: { status: ProductImageOptimizationStatus.SUCCEEDED },
    }));

    await expect(service.rejectHumanFactReview('optimization-1', '型号文字不一致')).resolves.toBeUndefined();
    expect(tx.productImageOptimization.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ProductImageOptimizationStatus.REJECTED, failureCode: 'HUMAN_FACT_REVIEW_REJECTED' }),
    }));
    expect(tx.sellerMediaAsset.updateMany).toHaveBeenCalledWith({
      where: { id: 'candidate-asset', status: 'CANDIDATE' },
      data: { status: 'RETIRED' },
    });
  });
});
