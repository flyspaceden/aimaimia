import { ProductVisualMode } from '@prisma/client';
import { ProductVisualCommerceController } from './product-visual-commerce.controller';

describe('ProductVisualCommerceController', () => {
  it('keeps quote reads product-bound and delegates rate-card filtering to the adapter', async () => {
    const visual = {
      getAccount: jest.fn(),
      listEligibleRateCards: jest.fn().mockResolvedValue([{ code: 'STANDARD_REAL_SCENE' }]),
      ensureDefaultTestAccess: jest.fn().mockResolvedValue({ enabled: true, created: true }),
      getQuote: jest.fn().mockResolvedValue({ quote: { id: 'quote-1' } }),
      issueQuote: jest.fn(),
      confirmAndExecute: jest.fn(),
      pollAndPersistCandidate: jest.fn(),
    };
    const controller = new ProductVisualCommerceController(visual as any);

    await expect(controller.listRateCards('company-1', 'staff-1', 'product-1', {
      sourceAssetId: 'asset-1', planId: 'plan-1', direction: ProductVisualMode.PRESERVE_REAL_SCENE,
    })).resolves.toEqual([{ code: 'STANDARD_REAL_SCENE' }]);
    await expect(controller.getQuote('company-1', 'product-1', 'quote-1')).resolves.toEqual({ quote: { id: 'quote-1' } });
    await expect(controller.ensureDefaultTestAccess('company-1', 'staff-1', 'product-1', {
      sourceAssetId: 'asset-1', planId: 'plan-1', direction: ProductVisualMode.PRESERVE_REAL_SCENE,
    })).resolves.toEqual({ enabled: true, created: true });

    expect(visual.listEligibleRateCards).toHaveBeenCalledWith({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceAssetId: 'asset-1', planId: 'plan-1', direction: ProductVisualMode.PRESERVE_REAL_SCENE,
    });
    expect(visual.getQuote).toHaveBeenCalledWith('company-1', 'product-1', 'quote-1');
    expect(visual.ensureDefaultTestAccess).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1',
    }));
  });
});
