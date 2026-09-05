import { NotFoundException } from '@nestjs/common';
import { ProductMediaAccessService } from './product-media-access.service';

describe('ProductMediaAccessService', () => {
  const build = (asset: unknown) => {
    const prisma = { sellerMediaAsset: { findFirst: jest.fn().mockResolvedValue(asset) } };
    return { service: new ProductMediaAccessService(prisma as any), prisma };
  };

  it('permits only a safe asset currently referenced by an active approved product', async () => {
    const { service, prisma } = build({ scanSummary: { needsReview: false } });

    await expect(service.assertPublicReadable('seller-product-assets/asset.webp')).resolves.toBeUndefined();
    expect(prisma.sellerMediaAsset.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        objectKey: 'seller-product-assets/asset.webp',
        productMedia: { some: { product: { status: 'ACTIVE', auditStatus: 'APPROVED' } } },
      }),
    }));
  });

  it('does not expose pending or safety-review assets through the public route', async () => {
    await expect(build(null).service.assertPublicReadable('seller-product-assets/pending.webp')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ scanSummary: { needsReview: true } }).service.assertPublicReadable('seller-product-assets/review.webp')).rejects.toBeInstanceOf(NotFoundException);
  });
});
