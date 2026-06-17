import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminDigitalAssetService } from './admin-digital-asset.service';
import { AdminAdjustDigitalAssetDto } from '../../digital-asset/dto/admin-adjust-digital-asset.dto';

describe('AdminDigitalAssetService V2', () => {
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

  it('getRules returns credit tiers and module settings together', async () => {
    const { service, prisma } = makeService();
    prisma.ruleConfig.findUnique
      .mockResolvedValueOnce({
        key: 'DIGITAL_ASSET_CREDIT_TIERS',
        value: {
          tiers: [
            { minAmount: 0, maxAmount: 500, multiplier: 3 },
            { minAmount: 500, maxAmount: null, multiplier: 10 },
          ],
        },
      })
      .mockResolvedValueOnce({
        key: 'DIGITAL_ASSET_MODULE_SETTINGS',
        value: {
          modules: [
            { key: 'assetValue', title: '资产价值', enabled: false, description: '规则待公布' },
          ],
        },
      });

    const result = await (service as any).getRules();

    expect(result).toEqual({
      tiers: [
        { minAmount: 0, maxAmount: 500, multiplier: 3 },
        { minAmount: 500, maxAmount: null, multiplier: 10 },
      ],
      modules: [
        { key: 'assetValue', title: '资产价值', enabled: false, description: '规则待公布' },
      ],
    });
  });

  it('updateRules rejects credit tiers with gaps or overlaps', async () => {
    const { service } = makeService();

    await expect((service as any).updateRules({
      tiers: [
        { minAmount: 0, maxAmount: 500, multiplier: 3 },
        { minAmount: 600, maxAmount: null, multiplier: 10 },
      ],
      modules: [
        { key: 'assetValue', title: '资产价值', enabled: false, description: '规则待公布' },
      ],
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('overview returns V2 cumulative spend and asset balance totals', async () => {
    const { service, prisma } = makeService();
    prisma.digitalAssetAccount.aggregate.mockResolvedValue({
      _count: { _all: 2 },
      _sum: {
        cumulativeSpendAmount: 880.5,
        seedAssetBalance: 3000,
        creditAssetBalance: 4600,
      },
    });
    prisma.digitalAssetLedger.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 120 } })
      .mockResolvedValueOnce({ _sum: { amount: 20 } });

    await expect(service.getOverview()).resolves.toEqual(expect.objectContaining({
      accountCount: 2,
      totalCumulativeSpendAmount: 880.5,
      totalSeedAssetBalance: 3000,
      totalCreditAssetBalance: 4600,
      totalAssetBalance: 7600,
    }));
  });

  it('account list returns vip status and all V2 balances', async () => {
    const { service, prisma } = makeService();
    prisma.digitalAssetAccount.findMany.mockResolvedValue([
      {
        id: 'account-1',
        userId: 'user-1',
        cumulativeSpendAmount: 880.5,
        seedAssetBalance: 3000,
        creditAssetBalance: 4600,
        createdAt: new Date('2026-06-16T00:00:00.000Z'),
        updatedAt: new Date('2026-06-16T01:00:00.000Z'),
        user: {
          id: 'user-1',
          buyerNo: 'AIMM20260616000001',
          status: 'ACTIVE',
          profile: { nickname: 'VIP 买家', avatarUrl: null },
          authIdentities: [{ identifier: '13812345678' }],
          memberProfile: { tier: 'VIP' },
        },
      },
    ]);
    prisma.digitalAssetAccount.count.mockResolvedValue(1);

    const result = await service.findAccounts({});

    expect(result.items[0]).toEqual(expect.objectContaining({
      cumulativeSpendAmount: 880.5,
      seedAssetBalance: 3000,
      creditAssetBalance: 4600,
      totalAssetBalance: 7600,
      user: expect.objectContaining({
        vipStatus: 'VIP',
      }),
    }));
  });

  it('export uses V2 CSV headers and balance columns', async () => {
    const { service, prisma } = makeService();
    prisma.digitalAssetAccount.findMany.mockResolvedValue([
      {
        id: 'account-1',
        userId: 'user-1',
        cumulativeSpendAmount: 880.5,
        seedAssetBalance: 3000,
        creditAssetBalance: 4600,
        updatedAt: new Date('2026-06-16T01:00:00.000Z'),
        user: {
          buyerNo: 'AIMM20260616000001',
          profile: { nickname: 'VIP 买家' },
          authIdentities: [{ identifier: '13812345678' }],
          memberProfile: { tier: 'VIP' },
        },
      },
    ]);

    const csv = await service.exportAccounts({});

    expect(csv.split('\n')[0]).toBe(
      '买家编号,用户ID,昵称,手机号,VIP状态,数字资产总额,种子资产,信用资产,累计消费,账户更新时间',
    );
    expect(csv).toContain('VIP');
    expect(csv).toContain('7600');
    expect(csv).toContain('3000');
    expect(csv).toContain('4600');
  });

  it('getAccount returns V2 balances from summary', async () => {
    const { service, prisma, digitalAssetService } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      buyerNo: 'AIMM20260616000001',
      status: 'ACTIVE',
      profile: { nickname: '买家', avatarUrl: null },
      authIdentities: [{ identifier: '13812345678' }],
      digitalAssetAccount: { id: 'account-1', updatedAt: new Date('2026-06-16T00:00:00.000Z') },
      memberProfile: { tier: 'VIP' },
    });
    digitalAssetService.getSummary.mockResolvedValue({
      isVip: true,
      totalAssetBalance: 7600,
      seedAssetBalance: 3000,
      creditAssetBalance: 4600,
      cumulativeSpendAmount: 880.5,
      modules: [],
    });

    const result = await service.getAccount('user-1');

    expect(result.account).toEqual(expect.objectContaining({
      totalAssetBalance: 7600,
      seedAssetBalance: 3000,
      creditAssetBalance: 4600,
      cumulativeSpendAmount: 880.5,
    }));
    expect(result.user).toEqual(expect.objectContaining({
      vipStatus: 'VIP',
    }));
  });

  it('blocks manual adjustment for non super admins', async () => {
    const { service, digitalAssetService } = makeService();

    await expect(service.adjustAccount(
      'user-1',
      { direction: 'CREDIT', subjectType: 'SEED_ASSET', amount: 10, reason: 'manual correction' } as any,
      { sub: 'admin-1', roles: ['运营'] },
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(digitalAssetService.adjustByAdmin).not.toHaveBeenCalled();
  });

  it('passes required subjectType through admin adjustments', async () => {
    const { service, prisma, digitalAssetService } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      buyerNo: 'AIMM20260616000001',
      status: 'ACTIVE',
      profile: { nickname: '测试用户', avatarUrl: null },
      authIdentities: [],
      digitalAssetAccount: { id: 'account-1', updatedAt: new Date('2026-06-14T00:00:00.000Z') },
      memberProfile: { tier: 'VIP' },
    });
    digitalAssetService.adjustByAdmin.mockResolvedValue(undefined);
    digitalAssetService.getSummary.mockResolvedValue({
      isVip: true,
      totalAssetBalance: 10,
      seedAssetBalance: 10,
      creditAssetBalance: 0,
      cumulativeSpendAmount: 0,
      modules: [],
    });

    await service.adjustAccount(
      'user-1',
      { direction: 'CREDIT', subjectType: 'SEED_ASSET', amount: 10, reason: 'manual correction' } as any,
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

  it('admin adjustment dto only allows seed/credit subject types', async () => {
    const errors = await validate(plainToInstance(AdminAdjustDigitalAssetDto, {
      direction: 'CREDIT',
      subjectType: 'CUMULATIVE_SPEND',
      amount: 12,
      reason: 'manual correction',
    }));

    expect(errors.map((item) => item.property)).toContain('subjectType');
  });
});
