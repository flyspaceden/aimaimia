import { ProductImageArtifactKind, ProductImageOptimizationKind, ProductImageOptimizationStatus } from '@prisma/client';
import { ProductPaidVisualCandidateService } from './product-paid-visual-candidate.service';

const quote = {
  id: 'quote-1', quoteHash: 'c'.repeat(64), sourceAssetRef: 'source-asset', sourceHash: 'a'.repeat(64),
  visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE', riskProfile: 'STANDARD_FACTS', protectedRegionVersion: 'mask-v1', allowedOperations: ['LIGHTING'] },
  rateCardSnapshot: { modelProfile: 'BAILIAN_WAN_STANDARD' }, visualAgentInvocationId: 'invocation-1',
};

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
  return { service: new ProductPaidVisualCandidateService(prisma as any, assets as any, upload as any), prisma, tx, assets, upload };
}

describe('ProductPaidVisualCandidateService', () => {
  it('persists a paid output as an AIGC candidate that cannot be adopted until settlement finalizes', async () => {
    const { service, tx, assets } = build();
    const result = await service.persistPendingVerification({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'source-asset', sourceCanonicalHash: 'a'.repeat(64), provider: 'BAILIAN_WAN',
      quote, output: { buffer: Buffer.from('candidate'), mimeType: 'image/png' },
    });

    expect(result).toEqual({ id: 'optimization-1', status: ProductImageOptimizationStatus.RECONCILING, candidateAssetId: 'candidate-asset', candidateObjectKey: 'seller-product-assets/candidate.png' });
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

  it('retires an unlinked candidate if persistence fails after output storage', async () => {
    const { service, prisma } = build();
    (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('transaction failed'));

    await expect(service.persistPendingVerification({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'source-asset', sourceCanonicalHash: 'a'.repeat(64), provider: 'BAILIAN_WAN',
      quote, output: { buffer: Buffer.from('candidate'), mimeType: 'image/png' },
    })).rejects.toThrow('transaction failed');
    expect(prisma.sellerMediaAsset.updateMany).toHaveBeenCalledWith({
      where: { id: 'candidate-asset', companyId: 'company-1', status: 'CANDIDATE' },
      data: { status: 'RETIRED' },
    });
  });

  it('moves a locally clean paid candidate to human review and persists only its minimal verification report', async () => {
    const { service, prisma } = build();
    await expect(service.finalizeLocalVerification('company-1', 'quote-1', {
      version: 'candidate-local-verification-v1', disposition: 'MANUAL_REVIEW', geometry: {} as any, qr: {} as any, barcode: {} as any, nextStep: 'QWEN_OCR_OR_HUMAN_FACT_REVIEW',
    })).resolves.toEqual({
      id: 'optimization-1', status: ProductImageOptimizationStatus.PENDING_REVIEW,
    });
    expect(prisma.productImageOptimization.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'optimization-1', status: ProductImageOptimizationStatus.RECONCILING },
      data: expect.objectContaining({ status: ProductImageOptimizationStatus.PENDING_REVIEW }),
    }));
  });

  it('retires a candidate that local checks prove lost a protected fact', async () => {
    const { service, prisma } = build();
    await expect(service.finalizeLocalVerification('company-1', 'quote-1', {
      version: 'candidate-local-verification-v1', disposition: 'REJECT', geometry: {} as any, qr: {} as any, barcode: {} as any, nextStep: 'QWEN_OCR_OR_HUMAN_FACT_REVIEW',
    })).resolves.toEqual({ id: 'optimization-1', status: ProductImageOptimizationStatus.REJECTED });
    expect(prisma.sellerMediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['candidate-asset'] }, companyId: 'company-1', status: 'CANDIDATE' },
      data: { status: 'RETIRED' },
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
