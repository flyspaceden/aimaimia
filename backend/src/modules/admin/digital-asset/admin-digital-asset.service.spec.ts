import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AdminDigitalAssetService } from './admin-digital-asset.service';

describe('AdminDigitalAssetService', () => {
  const makeService = () => {
    const prisma = {
      digitalAssetAccount: {
        aggregate: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
      digitalAssetLedger: {
        aggregate: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      ruleConfig: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const digitalAssetService = {
      adjustByAdmin: jest.fn(),
      getSummary: jest.fn(),
      listLedgers: jest.fn(),
    };
    const service = new AdminDigitalAssetService(prisma as any, digitalAssetService as any);
    return { service, prisma, digitalAssetService };
  };

  it('blocks manual adjustment for non super admins', async () => {
    const { service, digitalAssetService } = makeService();

    await expect(service.adjustAccount(
      'user-1',
      { direction: 'CREDIT', subjectType: 'SEED_ASSET', amount: 10, reason: 'manual correction' },
      { sub: 'admin-1', roles: ['运营'] },
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(digitalAssetService.adjustByAdmin).not.toHaveBeenCalled();
  });

  it('allows super admin manual adjustment through core digital asset service', async () => {
    const { service, prisma, digitalAssetService } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      status: 'ACTIVE',
      profile: { nickname: '测试用户', avatarUrl: null },
      authIdentities: [],
      digitalAssetAccount: { id: 'account-1', updatedAt: new Date('2026-06-14T00:00:00.000Z') },
    });
    digitalAssetService.adjustByAdmin.mockResolvedValue(undefined);
    digitalAssetService.getSummary.mockResolvedValue({ cumulativeSpendAmount: 10, modules: [] });

    await service.adjustAccount(
      'user-1',
      { direction: 'CREDIT', subjectType: 'SEED_ASSET', amount: 10, reason: 'manual correction' },
      { sub: 'admin-1', roles: ['超级管理员'] },
    );

    expect(digitalAssetService.adjustByAdmin).toHaveBeenCalledWith({
      targetUserId: 'user-1',
      adminUserId: 'admin-1',
      subjectType: 'SEED_ASSET',
      direction: 'CREDIT',
      amount: 10,
      reason: 'manual correction',
      clientIdempotencyKey: undefined,
    });
  });

  it('rejects undefined conversion/equity rule fields in settings payload', async () => {
    const { service } = makeService();

    await expect(service.updateSettings({
      modules: [{
        key: 'assetValue',
        title: '资产价值',
        enabled: false,
        description: '规则待公布',
        conversionRate: 1,
      } as any],
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores only presentation settings for digital asset placeholder modules', async () => {
    const { service, prisma } = makeService();
    prisma.ruleConfig.upsert.mockResolvedValue({});

    const result = await service.updateSettings({
      modules: [{
        key: 'assetValue',
        title: '资产价值',
        enabled: false,
        description: '规则待公布',
      }],
    });

    expect(result.modules[0]).toEqual({
      key: 'assetValue',
      title: '资产价值',
      enabled: false,
      description: '规则待公布',
    });
    expect(prisma.ruleConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'DIGITAL_ASSET_MODULE_SETTINGS' },
    }));
  });
});
