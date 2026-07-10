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
      schemaVersion: 2,
      perOrderCommission: {
        directRate: 0.11,
      },
      caps: {
        maxTotalIncentiveRate: 0.155,
      },
    });
    expect(prisma.ruleConfig.findUnique).toHaveBeenCalledWith({
      where: { key: CAPTAIN_SEAFOOD_CONFIG_KEY },
    });
  });

  it('normalizes a persisted two-level config into the one-level direct rule', async () => {
    const legacyConfig = {
      ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
      schemaVersion: 1,
      perOrderCommission: {
        directRate: 0.09,
        indirectRate: 0.02,
        maxLevels: 2,
      },
      monthlyQualification: {
        minDirectEffectiveBuyers: 12,
        minPersonalMonthlyGmv: 2800,
        minTeamEffectiveMembers: 35,
        minTeamMonthlyGmv: 8000,
        minNewEffectiveMembers: 1,
      },
      monthlyRewards: {
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.monthlyRewards,
        teamPoolRate: 0.01,
        captainTeamPoolWeight: 0.4,
      },
    };
    const { service } = createService({ value: legacyConfig });

    await expect(service.getConfig()).resolves.toMatchObject({
      schemaVersion: 2,
      perOrderCommission: { directRate: 0.11 },
      monthlyQualification: {
        minDirectEffectiveBuyers: 12,
        minDirectMonthlyGmv: 8000,
        minNewEffectiveBuyers: 1,
      },
      monthlyRewards: { performanceBonusRate: 0.01 },
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

  it('removes retired device and address thresholds from a persisted V2 config', async () => {
    const storedConfig = {
      ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
      risk: {
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.risk,
        maxSameDeviceEffectiveBuyers: 3,
        maxSameAddressEffectiveBuyers: 5,
      },
    };
    const { service } = createService({ value: storedConfig });

    const config = await service.getConfig();

    expect(config.risk).not.toHaveProperty('maxSameDeviceEffectiveBuyers');
    expect(config.risk).not.toHaveProperty('maxSameAddressEffectiveBuyers');
  });

  it('rejects a non-ISO activation timestamp', () => {
    expect(() =>
      validateCaptainSeafoodConfig({
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
        effectiveFrom: 'tomorrow morning',
      }),
    ).toThrow('effectiveFrom');
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

  it('rejects active configuration that includes a secondary commission field', () => {
    expect(() =>
      validateCaptainSeafoodConfig({
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
        perOrderCommission: {
          ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.perOrderCommission,
          indirectRate: 0.02,
        },
      }),
    ).toThrow('indirectRate');
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
