import { ConflictException } from '@nestjs/common';
import { ProductImageOptimizationStatus, ProductMediaRevisionStatus, SellerMediaAssetStatus } from '@prisma/client';
import { ProductMediaRevisionsService } from './product-media-revisions.service';

function buildService(mediaVersionUpdateCount = 1) {
  const revision = {
    id: 'rev-1', productId: 'product-1', companyId: 'company-1', expectedMediaVersion: 2,
    status: ProductMediaRevisionStatus.PENDING_REVIEW,
    proposedMedia: [{ assetId: 'asset-1', sortOrder: 0, type: 'IMAGE' }],
    product: { id: 'product-1', companyId: 'company-1', mediaVersion: 2 },
  };
  const tx = {
    productMediaRevision: {
      findUnique: jest.fn().mockResolvedValue(revision),
      update: jest.fn().mockResolvedValue({ ...revision, status: ProductMediaRevisionStatus.APPROVED }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
    },
    productImageArtifact: { findFirst: jest.fn().mockResolvedValue({ assetId: 'candidate-asset' }) },
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
  };
  const assets = { assertOwnedProductImageAssets: jest.fn() };
  const upload = {
    createProductMediaUrl: jest.fn().mockReturnValue('https://api.example/api/v1/upload/product-media/seller-product-assets/a.webp'),
    createPrivateAccessUrl: jest.fn().mockResolvedValue({ url: 'https://api.example/api/v1/upload/private/seller-product-assets/a.webp?sig=preview', expiresAt: '2026-08-21T12:05:00.000Z' }),
  };
  return { service: new ProductMediaRevisionsService(prisma as any, assets as any, upload as any), tx, upload };
}

describe('ProductMediaRevisionsService approval', () => {
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
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'product-1', companyId: 'company-1', status: 'ACTIVE', auditStatus: 'APPROVED', mediaVersion: 2,
          media: [adoptedMedia, evidenceMedia],
        }),
      },
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

  it('expires a revision on media-version conflict without deleting public media', async () => {
    const { service, tx } = buildService(0);
    await expect(service.approve('rev-1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.productMedia.deleteMany).not.toHaveBeenCalled();
    expect(tx.productMedia.createMany).not.toHaveBeenCalled();
    expect(tx.productMediaRevision.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: ProductMediaRevisionStatus.EXPIRED }) }));
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
});
