import { NotFoundException } from '@nestjs/common';
import { ProductVisualMode, ProductVisualRiskProfile } from '@prisma/client';
import { ProductVisualPlanningService } from './product-visual-planning.service';

function build(overrides: { source?: unknown; product?: unknown } = {}) {
  const source = Object.prototype.hasOwnProperty.call(overrides, 'source') ? overrides.source : {
    id: 'asset-1', canonicalSha256: 'sha-1', width: 1200, height: 900,
    diagnosis: { advisories: [] }, scanSummary: { qrCodesDetected: 0 },
  };
  const product = Object.prototype.hasOwnProperty.call(overrides, 'product') ? overrides.product : {
    id: 'product-1', title: '厨房鲜虾', subtitle: null, description: '餐桌实拍的新鲜虾', categoryId: 'category-1',
    updatedAt: new Date('2026-08-22T00:00:00.000Z'), mediaVersion: 1, category: { name: '海鲜' },
  };
  const prisma = {
    sellerMediaAsset: { findFirst: jest.fn().mockResolvedValue(source) },
    product: { findFirst: jest.fn().mockResolvedValue(product) },
    productVisualPlan: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({
        id: 'plan-1', ...data, createdAt: new Date('2026-08-22T00:00:00.000Z'),
      })),
    },
  };
  const tx = {
    productVisualPlan: prisma.productVisualPlan,
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  Object.assign(prisma, {
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  });
  return { service: new ProductVisualPlanningService(prisma as any), prisma };
}

describe('ProductVisualPlanningService', () => {
  it('recommends preserving a reasonable organic real scene without invoking a model', async () => {
    const { service, prisma } = build();

    const result = await service.createPlan('company-1', 'staff-1', 'product-1', { sourceAssetId: 'asset-1' });

    expect(result).toMatchObject({
      riskProfile: ProductVisualRiskProfile.ORGANIC_FACTS,
      recommendedMode: ProductVisualMode.PRESERVE_REAL_SCENE,
      allowedModes: [ProductVisualMode.PRESERVE_REAL_SCENE, ProductVisualMode.CATALOG_STUDIO, ProductVisualMode.MARKETING_SCENE],
      sourceHash: 'sha-1',
      protectedRegionVersion: 'NOT_CREATED',
      sceneAnalysis: expect.objectContaining({ productFactHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      processingPlan: expect.objectContaining({ requiresModel: false }),
    });
    expect(prisma.productVisualPlan.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId: 'company-1', productId: 'product-1', sourceAssetId: 'asset-1' }),
    }));
  });

  it('serializes the lookup with a transaction advisory lock and reuses an unexpired plan', async () => {
    const { service, prisma } = build();
    const first = await service.createPlan('company-1', 'staff-1', 'product-1', { sourceAssetId: 'asset-1' });
    prisma.productVisualPlan.findFirst.mockResolvedValueOnce(first);

    const second = await service.createPlan('company-1', 'staff-1', 'product-1', { sourceAssetId: 'asset-1' });

    expect(second.id).toBe('plan-1');
    expect((prisma as any).$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.productVisualPlan.create).toHaveBeenCalledTimes(1);
  });

  it('allows an organic product to request a secondary marketing scene without changing the default recommendation', async () => {
    const { service } = build();

    const result = await service.createPlan('company-1', 'staff-1', 'product-1', {
      sourceAssetId: 'asset-1', requestedMode: ProductVisualMode.MARKETING_SCENE,
    });

    expect(result).toMatchObject({
      riskProfile: ProductVisualRiskProfile.ORGANIC_FACTS,
      recommendedMode: ProductVisualMode.MARKETING_SCENE,
      allowedModes: expect.arrayContaining([ProductVisualMode.PRESERVE_REAL_SCENE, ProductVisualMode.MARKETING_SCENE]),
    });
  });

  it('does not allow a requested product retouch for QR/packaging strict images', async () => {
    const { service } = build({
      source: {
        id: 'asset-1', canonicalSha256: 'sha-1', width: 1200, height: 900,
        diagnosis: { advisories: [] }, scanSummary: { qrCodesDetected: 1 },
      },
      product: { id: 'product-1', title: '智能手环', subtitle: null, description: '带包装和型号', categoryId: 'category-2', updatedAt: new Date('2026-08-22T00:00:00.000Z'), mediaVersion: 1, category: { name: '数码' } },
    });

    const result = await service.createPlan('company-1', 'staff-1', 'product-1', {
      sourceAssetId: 'asset-1', requestedMode: ProductVisualMode.PRODUCT_RETOUCH,
    });

    expect(result.riskProfile).toBe(ProductVisualRiskProfile.STRICT_FACTS);
    expect(result.allowedModes).not.toContain(ProductVisualMode.PRODUCT_RETOUCH);
    expect(result.recommendedMode).toBe(ProductVisualMode.PRESERVE_REAL_SCENE);
  });

  it('requires retaking a critically undersized source instead of promising a model rescue', async () => {
    const { service } = build({
      source: {
        id: 'asset-1', canonicalSha256: 'sha-1', width: 320, height: 240,
        diagnosis: { tooSmall: true, advisories: [{ code: 'IMAGE_TOO_SMALL' }] }, scanSummary: {},
      },
    });

    const result = await service.createPlan('company-1', 'staff-1', 'product-1', { sourceAssetId: 'asset-1' });

    expect(result).toMatchObject({
      riskProfile: ProductVisualRiskProfile.RETAKE_REQUIRED,
      recommendedMode: null,
      allowedModes: [],
    });
  });

  it('does not plan an owned asset for a product outside the current company', async () => {
    const { service, prisma } = build({ product: null });

    await expect(service.createPlan('company-1', 'staff-1', 'product-1', { sourceAssetId: 'asset-1' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.productVisualPlan.create).not.toHaveBeenCalled();
  });

  it('allows a newly uploaded owned asset to be planned before the draft autosave attaches it', async () => {
    const { service, prisma } = build();

    await expect(service.createPlan('company-1', 'staff-1', 'product-1', { sourceAssetId: 'asset-1' }))
      .resolves.toMatchObject({ productId: 'product-1', sourceAssetId: 'asset-1' });
    expect(prisma.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'product-1', companyId: 'company-1' },
    }));
  });
});
