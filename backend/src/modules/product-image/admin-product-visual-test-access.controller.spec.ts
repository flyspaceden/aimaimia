import { AdminProductVisualTestAccessController } from './admin-product-visual-test-access.controller';

describe('AdminProductVisualTestAccessController', () => {
  it('exposes global credit-based availability without a per-merchant grant action', () => {
    const access = {
      status: jest.fn().mockReturnValue({ allMerchantsEnabled: true }),
    };
    const controller = new AdminProductVisualTestAccessController(access as any);

    expect(controller.status()).toEqual({ allMerchantsEnabled: true });
    expect(Object.getOwnPropertyNames(AdminProductVisualTestAccessController.prototype)).toEqual(['constructor', 'status']);
  });
});
