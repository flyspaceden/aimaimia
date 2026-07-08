import {
  CAPTAIN_SEAFOOD_CONFIG_KEY,
  DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
  validateCaptainSeafoodConfig,
} from './captain.constants';
import { CaptainConfigService } from './captain-config.service';

function createService(ruleConfigFindUniqueResult: unknown) {
  const prisma = {
    ruleConfig: {
      findUnique: jest.fn().mockResolvedValue(ruleConfigFindUniqueResult),
    },
  };
  return {
    prisma,
    service: new CaptainConfigService(prisma as any),
  };
}

describe('CaptainConfigService', () => {
  it('returns disabled default config when RuleConfig is absent', async () => {
    const { prisma, service } = createService(null);

    await expect(service.getConfig()).resolves.toMatchObject({
      enabled: false,
      perOrderCommission: {
        directRate: 0.09,
        indirectRate: 0.02,
        maxLevels: 2,
      },
      caps: {
        maxTotalIncentiveRate: 0.155,
      },
    });
    expect(prisma.ruleConfig.findUnique).toHaveBeenCalledWith({
      where: { key: CAPTAIN_SEAFOOD_CONFIG_KEY },
    });
  });

  it('unwraps RuleConfig value wrappers and validates the stored config', async () => {
    const storedConfig = {
      ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
      enabled: true,
      scope: {
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.scope,
        productIds: ['prod-1'],
      },
    };
    const { service } = createService({
      value: {
        value: storedConfig,
        description: '预包装海鲜团长经营激励配置',
      },
    });

    await expect(service.getConfig()).resolves.toMatchObject({
      enabled: true,
      scope: { productIds: ['prod-1'] },
    });
  });

  it('rejects any config where total incentive exceeds maxTotalIncentiveRate', () => {
    expect(() =>
      validateCaptainSeafoodConfig({
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
        monthlyRewards: {
          ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.monthlyRewards,
          growthBonusRate: 0.02,
        },
      }),
    ).toThrow('总激励率');
  });

  it('rejects maxLevels above two', () => {
    expect(() =>
      validateCaptainSeafoodConfig({
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
        perOrderCommission: {
          ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.perOrderCommission,
          maxLevels: 3,
        },
      }),
    ).toThrow('maxLevels');
  });

  it('rejects enabling VIP packages, group-buy, or prize orders', () => {
    expect(() =>
      validateCaptainSeafoodConfig({
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
        scope: {
          ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.scope,
          includeVipPackage: true,
        },
      }),
    ).toThrow('includeVipPackage');
    expect(() =>
      validateCaptainSeafoodConfig({
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
        scope: {
          ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.scope,
          includeGroupBuy: true,
        },
      }),
    ).toThrow('includeGroupBuy');
    expect(() =>
      validateCaptainSeafoodConfig({
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
        scope: {
          ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.scope,
          includePrize: true,
        },
      }),
    ).toThrow('includePrize');
  });
});
