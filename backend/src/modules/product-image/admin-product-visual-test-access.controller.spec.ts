import { ProductVisualMode } from '@prisma/client';
import { AdminProductVisualTestAccessController } from './admin-product-visual-test-access.controller';

describe('AdminProductVisualTestAccessController', () => {
  it('maps a validated staging authorization request to the exact access service', async () => {
    const access = { grant: jest.fn().mockResolvedValue({ companyId: 'company-1' }) };
    const controller = new AdminProductVisualTestAccessController(access as any);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();

    await expect(controller.grant({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1',
      visualMode: ProductVisualMode.MARKETING_SCENE, dailyCallLimit: 2, weeklyCallLimit: 5,
      expiresAt, grantWelcomeCredits: true,
    })).resolves.toEqual({ companyId: 'company-1' });
    expect(access.grant).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: new Date(expiresAt) }));
  });
});
