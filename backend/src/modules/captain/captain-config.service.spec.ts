import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CAPTAIN_SEAFOOD_CONFIG_KEY,
  DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
  normalizeCaptainSeafoodConfig,
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
  const v2Config = {
    schemaVersion: 2,
    enabled: false,
    programCode: 'SEAFOOD_PREPACKAGED',
    programName: '预包装海鲜团长经营激励',
    effectiveFrom: null,
    scope: {
      categoryIds: [],
      productIds: [],
      companyIds: [],
      excludedProductIds: [],
      includeVipPackage: false,
      includeGroupBuy: false,
      includePrize: false,
    },
    orderRules: {
      freezeDaysAfterReceived: 7,
      minCommissionBase: 0,
      includeShippingFee: false,
      includeCouponDiscount: false,
      includeRewardDeduction: false,
    },
    perOrderCommission: { directRate: 0.11 },
    monthlyQualification: {
      minDirectEffectiveBuyers: 12,
      minDirectMonthlyGmv: 8000,
      minNewEffectiveBuyers: 1,
    },
    monthlyRewards: {
      baseTierGmv: 25000,
      baseManagementRate: 0.022,
      growthTierGmv: 70000,
      growthBonusRate: 0.007,
      excellentTierGmv: 140000,
      cultivationBonusRate: 0.006,
      performanceBonusRate: 0.01,
    },
    caps: {
      maxTotalIncentiveRate: 0.155,
      targetNetProfitRate: 0.09,
      coldChainRiskReserveRate: 0.02,
    },
    tax: {
      enabled: true,
      withholdingRate: 0.2,
      incomeType: 'LABOR_SERVICE',
    },
    risk: {
      maxMonthlyRefundRate: 0.15,
      holdSettlementOnRisk: true,
    },
  };
  const v3Config = {
    ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
    schemaVersion: 3,
    effectiveFrom: '2026-07-31T16:00:00.000Z',
    perOrderCommission: {
      directProfitRate: 0.01,
    },
    monthlyRewards: {
      baseTierGmv: 25000,
      baseManagementProfitRate: 0.022,
      growthTierGmv: 70000,
      growthBonusProfitRate: 0.007,
      excellentTierGmv: 140000,
      cultivationBonusProfitRate: 0.006,
      performanceBonusProfitRate: 0.01,
    },
    unitEconomics: {
      fulfillmentCostRate: 0.12,
    },
    caps: {
      maxTotalIncentiveProfitRate: 0.155,
      targetNetProfitRate: 0.09,
      coldChainRiskReserveRate: 0.02,
    },
  };

  it('defines the disabled V3 profit configuration contract', () => {
    expect(DEFAULT_CAPTAIN_SEAFOOD_CONFIG.schemaVersion).toBe(3);
    expect(DEFAULT_CAPTAIN_SEAFOOD_CONFIG.enabled).toBe(false);
    expect(DEFAULT_CAPTAIN_SEAFOOD_CONFIG.perOrderCommission).toEqual({
      directProfitRate: 0,
    });
    expect(() => validateCaptainSeafoodConfig({ ...v2Config, enabled: true })).toThrow('V2');
    expect(() => validateCaptainSeafoodConfig(v3Config)).not.toThrow();
  });

  it('requires the first V3 effectiveFrom to be a Shanghai natural-month boundary', () => {
    expect(() => validateCaptainSeafoodConfig(v3Config)).not.toThrow();
    expect(() =>
      validateCaptainSeafoodConfig({
        ...v3Config,
        effectiveFrom: '2026-08-01T00:00:00.000Z',
      }),
    ).toThrow('Asia/Shanghai');
  });

  it('canonicalizes an equivalent V3 timezone input to UTC across normalize and validate', async () => {
    const persistedConfig = {
      ...v3Config,
      effectiveFrom: '2026-08-01T00:00:00.000+08:00',
    };
    const { service } = createService({ value: persistedConfig });

    expect(normalizeCaptainSeafoodConfig(persistedConfig)).toMatchObject({
      effectiveFrom: '2026-07-31T16:00:00.000Z',
    });
    expect(validateCaptainSeafoodConfig(persistedConfig)).toMatchObject({
      effectiveFrom: '2026-07-31T16:00:00.000Z',
    });
    await expect(service.getConfig()).resolves.toMatchObject({
      effectiveFrom: '2026-07-31T16:00:00.000Z',
    });
  });

  it('rejects a nonexistent V3 calendar date before UTC normalization', () => {
    const effectiveFrom = '2026-02-29T00:00:00.000+08:00';
    const invalidConfig = { ...v3Config, effectiveFrom };

    expect(normalizeCaptainSeafoodConfig(invalidConfig)).toMatchObject({ effectiveFrom });
    expect(() => validateCaptainSeafoodConfig(invalidConfig)).toThrow('effectiveFrom');
  });

  it('returns disabled default config when RuleConfig is absent', async () => {
    const { prisma, service } = createService(null);

    await expect(service.getConfig()).resolves.toMatchObject({
      enabled: false,
      schemaVersion: 3,
      perOrderCommission: {
        directProfitRate: 0,
      },
      caps: {
        maxTotalIncentiveProfitRate: 0,
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
      ...v2Config,
      risk: {
        ...v2Config.risk,
        maxSameDeviceEffectiveBuyers: 3,
        maxSameAddressEffectiveBuyers: 5,
      },
    };
    const { service } = createService({ value: storedConfig });

    const config = await service.getConfig();

    expect(config.risk).not.toHaveProperty('maxSameDeviceEffectiveBuyers');
    expect(config.risk).not.toHaveProperty('maxSameAddressEffectiveBuyers');
  });

  it('returns a complete disabled persisted V2 fixture for legacy lifecycle reads', async () => {
    const { service } = createService({ value: v2Config });

    await expect(service.getConfig()).resolves.toMatchObject({
      schemaVersion: 2,
      enabled: false,
      perOrderCommission: { directRate: 0.11 },
      monthlyRewards: { baseManagementRate: 0.022 },
    });
  });

  it('returns a complete enabled persisted V2 fixture for historical snapshot reads while save validation rejects it', async () => {
    const persistedConfig = {
      ...v2Config,
      enabled: true,
      scope: {
        ...v2Config.scope,
        productIds: ['prod-legacy-v2'],
      },
    };
    const { service } = createService({ value: persistedConfig });

    await expect(service.getSnapshot()).resolves.toEqual(persistedConfig);
    expect(() => validateCaptainSeafoodConfig(persistedConfig)).toThrow('V2');
  });

  it('defines a funding amount CHECK that rejects all non-finite float values', () => {
    const migrationPath = join(
      process.cwd(),
      'prisma/migrations/20260710030000_captain_profit_v3/migration.sql',
    );
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/"amount"\s*<>\s*'NaN'::double precision/i);
    expect(sql).toMatch(/"amount"\s*<>\s*'Infinity'::double precision/i);
    expect(sql).toMatch(/"amount"\s*<>\s*'-Infinity'::double precision/i);
    expect(sql).toMatch(/"type"\s*=\s*'REFUND_ADJUSTMENT'/);
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
          growthBonusProfitRate: 0.02,
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
