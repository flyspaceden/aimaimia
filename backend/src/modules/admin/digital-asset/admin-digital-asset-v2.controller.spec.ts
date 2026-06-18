import { AdminDigitalAssetController } from './admin-digital-asset.controller';
import { PERMISSION_KEY } from '../common/decorators/require-permission';

describe('AdminDigitalAssetController V2 rules routes', () => {
  const makeController = () => {
    const service = {
      getOverview: jest.fn(),
      findAccounts: jest.fn(),
      exportAccounts: jest.fn(),
      getSettings: jest.fn(),
      updateSettings: jest.fn(),
      getRules: jest.fn(),
      updateRules: jest.fn(),
      getAccount: jest.fn(),
      listLedgers: jest.fn(),
      adjustAccount: jest.fn(),
    };

    return {
      controller: new AdminDigitalAssetController(service as any),
      service,
    };
  };

  it('getRules delegates to the admin digital asset service', async () => {
    const { controller, service } = makeController();
    service.getRules.mockResolvedValue({ tiers: [], modules: [] });

    await expect((controller as any).getRules()).resolves.toEqual({ tiers: [], modules: [] });
    expect(service.getRules).toHaveBeenCalledTimes(1);
  });

  it('allows digital asset read permission to GET rules', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, AdminDigitalAssetController.prototype.getRules)).toBe(
      'digital_assets:read',
    );
  });

  it('updateRules delegates to the admin digital asset service', async () => {
    const { controller, service } = makeController();
    const dto = {
      tiers: [{ minAmount: 0, maxAmount: null, multiplier: 3 }],
      modules: [{ key: 'assetValue', title: '资产价值', enabled: false, description: '规则待公布' }],
    };
    service.updateRules.mockResolvedValue(dto);

    await expect((controller as any).updateRules(dto)).resolves.toEqual(dto);
    expect(service.updateRules).toHaveBeenCalledWith(dto);
  });
});
