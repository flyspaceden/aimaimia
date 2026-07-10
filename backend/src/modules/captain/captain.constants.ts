import type {
  CaptainSeafoodConfig,
  CaptainSeafoodConfigV2,
  CaptainSeafoodConfigV3,
} from './captain.types';

export const CAPTAIN_SEAFOOD_CONFIG_KEY = 'CAPTAIN_SEAFOOD_CONFIG';
export const CAPTAIN_SEAFOOD_PROGRAM_CODE = 'SEAFOOD_PREPACKAGED' as const;

const DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2: CaptainSeafoodConfigV2 = {
  schemaVersion: 2,
  enabled: false,
  programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
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
  perOrderCommission: {
    directRate: 0.11,
  },
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

export const DEFAULT_CAPTAIN_SEAFOOD_CONFIG: CaptainSeafoodConfigV3 = {
  schemaVersion: 3,
  enabled: false,
  programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
  programName: '预包装海鲜团长经营激励',
  // 2026-08-01 00:00:00 in Asia/Shanghai, persisted in the database's UTC form.
  effectiveFrom: '2026-07-31T16:00:00.000Z',
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
  perOrderCommission: {
    directProfitRate: 0,
  },
  monthlyQualification: {
    minDirectEffectiveBuyers: 12,
    minDirectMonthlyGmv: 8000,
    minNewEffectiveBuyers: 1,
  },
  monthlyRewards: {
    baseTierGmv: 25000,
    baseManagementProfitRate: 0,
    growthTierGmv: 70000,
    growthBonusProfitRate: 0,
    excellentTierGmv: 140000,
    cultivationBonusProfitRate: 0,
    performanceBonusProfitRate: 0,
  },
  unitEconomics: {
    fulfillmentCostRate: 0,
  },
  caps: {
    maxTotalIncentiveProfitRate: 0,
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

export function cloneCaptainSeafoodConfig<T extends CaptainSeafoodConfig>(
  value: T = DEFAULT_CAPTAIN_SEAFOOD_CONFIG as T,
): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function unwrapRuleConfigValue<T>(raw: unknown): T {
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    'value' in raw
  ) {
    return (raw as { value: T }).value;
  }
  return raw as T;
}

function normalizeRisk(risk: unknown) {
  const { maxSameDeviceEffectiveBuyers, maxSameAddressEffectiveBuyers, ...supportedRisk } =
    (risk && typeof risk === 'object' && !Array.isArray(risk) ? risk : {}) as Record<string, any>;
  return supportedRisk;
}

const ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function isValidIsoTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function normalizeV3EffectiveFrom(value: unknown): unknown {
  return isValidIsoTime(value) ? new Date(value).toISOString() : value;
}

export function normalizeCaptainSeafoodConfig(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const raw = value as Record<string, any>;
  if (raw.schemaVersion === 3) {
    return {
      ...raw,
      effectiveFrom: normalizeV3EffectiveFrom(raw.effectiveFrom),
      risk: normalizeRisk(raw.risk),
    };
  }
  if (raw.schemaVersion === 2) {
    return {
      ...raw,
      effectiveFrom: typeof raw.effectiveFrom === 'string' && raw.effectiveFrom.trim()
        ? raw.effectiveFrom
        : null,
      risk: normalizeRisk(raw.risk),
    };
  }

  const legacyPerOrder = raw.perOrderCommission ?? {};
  const legacyQualification = raw.monthlyQualification ?? {};
  const legacyRewards = raw.monthlyRewards ?? {};
  return {
    ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2,
    ...raw,
    schemaVersion: 2,
    effectiveFrom: typeof raw.effectiveFrom === 'string' && raw.effectiveFrom.trim()
      ? raw.effectiveFrom
      : null,
    perOrderCommission: {
      directRate: Number(legacyPerOrder.directRate ?? 0) + Number(legacyPerOrder.indirectRate ?? 0),
    },
    monthlyQualification: {
      minDirectEffectiveBuyers: legacyQualification.minDirectEffectiveBuyers
        ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2.monthlyQualification.minDirectEffectiveBuyers,
      minDirectMonthlyGmv: Math.max(
        Number(legacyQualification.minPersonalMonthlyGmv ?? 0),
        Number(legacyQualification.minTeamMonthlyGmv ?? 0),
        Number(DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2.monthlyQualification.minDirectMonthlyGmv),
      ),
      minNewEffectiveBuyers: legacyQualification.minNewEffectiveMembers
        ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2.monthlyQualification.minNewEffectiveBuyers,
    },
    monthlyRewards: {
      baseTierGmv: legacyRewards.baseTierGmv ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2.monthlyRewards.baseTierGmv,
      baseManagementRate: legacyRewards.baseManagementRate
        ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2.monthlyRewards.baseManagementRate,
      growthTierGmv: legacyRewards.growthTierGmv ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2.monthlyRewards.growthTierGmv,
      growthBonusRate: legacyRewards.growthBonusRate
        ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2.monthlyRewards.growthBonusRate,
      excellentTierGmv: legacyRewards.excellentTierGmv
        ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2.monthlyRewards.excellentTierGmv,
      cultivationBonusRate: legacyRewards.cultivationBonusRate
        ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2.monthlyRewards.cultivationBonusRate,
      performanceBonusRate: legacyRewards.teamPoolRate
        ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2.monthlyRewards.performanceBonusRate,
    },
    caps: {
      maxTotalIncentiveRate: raw.caps?.maxTotalIncentiveRate
        ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2.caps.maxTotalIncentiveRate,
      targetNetProfitRate: raw.caps?.targetNetProfitRate
        ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2.caps.targetNetProfitRate,
      coldChainRiskReserveRate: raw.caps?.coldChainRiskReserveRate
        ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG_V2.caps.coldChainRiskReserveRate,
    },
    risk: normalizeRisk(raw.risk),
  };
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} 必须是对象`);
  }
}

function assertString(value: unknown, path: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} 必须是非空字符串`);
  }
}

function assertStringArray(value: unknown, path: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${path} 必须是字符串数组`);
  }
}

function assertBoolean(value: unknown, path: string) {
  if (typeof value !== 'boolean') {
    throw new Error(`${path} 必须是布尔值`);
  }
}

function assertNumberInRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
  integer = false,
) {
  const validNumber = typeof value === 'number' && Number.isFinite(value);
  if (!validNumber || (integer && !Number.isInteger(value))) {
    throw new Error(`${path} 必须是${integer ? '整数' : '数字'}`);
  }
  if (value < min || value > max) {
    throw new Error(`${path} 必须在 ${min} 到 ${max} 之间`);
  }
}

function assertFalse(value: unknown, path: string) {
  if (value !== false) {
    throw new Error(`${path} 必须固定为 false`);
  }
}

function validateCommonConfig(value: Record<string, unknown>) {
  assertBoolean(value.enabled, 'enabled');
  if (value.programCode !== CAPTAIN_SEAFOOD_PROGRAM_CODE) {
    throw new Error(`programCode 必须是 ${CAPTAIN_SEAFOOD_PROGRAM_CODE}`);
  }
  assertString(value.programName, 'programName');

  assertObject(value.scope, 'scope');
  assertStringArray(value.scope.categoryIds, 'scope.categoryIds');
  assertStringArray(value.scope.productIds, 'scope.productIds');
  assertStringArray(value.scope.companyIds, 'scope.companyIds');
  assertStringArray(value.scope.excludedProductIds, 'scope.excludedProductIds');
  assertFalse(value.scope.includeVipPackage, 'includeVipPackage');
  assertFalse(value.scope.includeGroupBuy, 'includeGroupBuy');
  assertFalse(value.scope.includePrize, 'includePrize');
  const scopeCount =
    (value.scope.categoryIds as string[]).length +
    (value.scope.productIds as string[]).length +
    (value.scope.companyIds as string[]).length;
  if (value.enabled === true && scopeCount === 0) {
    throw new Error('启用团长配置前必须至少配置一个适用类目、商品或商户');
  }

  assertObject(value.orderRules, 'orderRules');
  assertNumberInRange(value.orderRules.freezeDaysAfterReceived, 'orderRules.freezeDaysAfterReceived', 0, 365, true);
  assertNumberInRange(value.orderRules.minCommissionBase, 'orderRules.minCommissionBase', 0, 1000000);
  assertFalse(value.orderRules.includeShippingFee, 'includeShippingFee');
  assertFalse(value.orderRules.includeCouponDiscount, 'includeCouponDiscount');
  assertFalse(value.orderRules.includeRewardDeduction, 'includeRewardDeduction');

  assertObject(value.monthlyQualification, 'monthlyQualification');
  assertNumberInRange(value.monthlyQualification.minDirectEffectiveBuyers, 'monthlyQualification.minDirectEffectiveBuyers', 0, 100000, true);
  assertNumberInRange(value.monthlyQualification.minDirectMonthlyGmv, 'monthlyQualification.minDirectMonthlyGmv', 0, 100000000);
  assertNumberInRange(value.monthlyQualification.minNewEffectiveBuyers, 'monthlyQualification.minNewEffectiveBuyers', 0, 100000, true);

  assertObject(value.tax, 'tax');
  assertBoolean(value.tax.enabled, 'tax.enabled');
  assertNumberInRange(value.tax.withholdingRate, 'tax.withholdingRate', 0, 1);
  if (value.tax.incomeType !== 'LABOR_SERVICE') {
    throw new Error('tax.incomeType 必须是 LABOR_SERVICE');
  }

  assertObject(value.risk, 'risk');
  assertNumberInRange(value.risk.maxMonthlyRefundRate, 'risk.maxMonthlyRefundRate', 0, 1);
  assertBoolean(value.risk.holdSettlementOnRisk, 'risk.holdSettlementOnRisk');
}

function assertValidIsoTime(value: unknown, path: string) {
  if (!isValidIsoTime(value)) {
    throw new Error(`${path} 必须是有效的 ISO 时间`);
  }
}

function assertShanghaiNaturalMonthStart(value: unknown) {
  assertValidIsoTime(value, 'effectiveFrom');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value as string));
  const local = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (local.day !== '01' || local.hour !== '00' || local.minute !== '00' || local.second !== '00') {
    throw new Error('effectiveFrom 必须是 Asia/Shanghai 自然月第一天 00:00:00 对应的 UTC 时间');
  }
}

function validateV2Config(value: Record<string, unknown>): CaptainSeafoodConfigV2 {
  if (value.enabled === true) {
    throw new Error('V2 团长销售额配置必须迁移到 V3 后才能启用新归因');
  }
  validateCommonConfig(value);
  if (value.effectiveFrom !== null) {
    assertValidIsoTime(value.effectiveFrom, 'effectiveFrom');
  }

  assertObject(value.perOrderCommission, 'perOrderCommission');
  assertNumberInRange(value.perOrderCommission.directRate, 'directRate', 0, 1);
  if ('indirectRate' in value.perOrderCommission) {
    throw new Error('indirectRate 不再支持');
  }

  assertObject(value.monthlyRewards, 'monthlyRewards');
  assertNumberInRange(value.monthlyRewards.baseTierGmv, 'monthlyRewards.baseTierGmv', 0, 100000000);
  assertNumberInRange(value.monthlyRewards.baseManagementRate, 'monthlyRewards.baseManagementRate', 0, 1);
  assertNumberInRange(value.monthlyRewards.growthTierGmv, 'monthlyRewards.growthTierGmv', 0, 100000000);
  assertNumberInRange(value.monthlyRewards.growthBonusRate, 'monthlyRewards.growthBonusRate', 0, 1);
  assertNumberInRange(value.monthlyRewards.excellentTierGmv, 'monthlyRewards.excellentTierGmv', 0, 100000000);
  assertNumberInRange(value.monthlyRewards.cultivationBonusRate, 'monthlyRewards.cultivationBonusRate', 0, 1);
  assertNumberInRange(value.monthlyRewards.performanceBonusRate, 'monthlyRewards.performanceBonusRate', 0, 1);
  assertTierOrder(value.monthlyRewards);

  assertObject(value.caps, 'caps');
  assertNumberInRange(value.caps.maxTotalIncentiveRate, 'caps.maxTotalIncentiveRate', 0, 0.155);
  assertNumberInRange(value.caps.targetNetProfitRate, 'caps.targetNetProfitRate', 0, 1);
  assertNumberInRange(value.caps.coldChainRiskReserveRate, 'caps.coldChainRiskReserveRate', 0, 1);
  const totalIncentiveRate =
    (value.perOrderCommission.directRate as number) +
    (value.monthlyRewards.baseManagementRate as number) +
    (value.monthlyRewards.growthBonusRate as number) +
    (value.monthlyRewards.cultivationBonusRate as number) +
    (value.monthlyRewards.performanceBonusRate as number);
  if (totalIncentiveRate - (value.caps.maxTotalIncentiveRate as number) > 0.0000001) {
    throw new Error('总激励率不能超过 maxTotalIncentiveRate');
  }
  return value as unknown as CaptainSeafoodConfigV2;
}

function validateV3Config(value: Record<string, unknown>): CaptainSeafoodConfigV3 {
  validateCommonConfig(value);
  assertValidIsoTime(value.effectiveFrom, 'effectiveFrom');
  const effectiveFrom = new Date(value.effectiveFrom as string).toISOString();
  assertShanghaiNaturalMonthStart(effectiveFrom);

  assertObject(value.perOrderCommission, 'perOrderCommission');
  assertNumberInRange(value.perOrderCommission.directProfitRate, 'directProfitRate', 0, 1);
  if ('directRate' in value.perOrderCommission || 'indirectRate' in value.perOrderCommission) {
    throw new Error('V3 perOrderCommission 只支持 directProfitRate，indirectRate 不再支持');
  }

  assertObject(value.monthlyRewards, 'monthlyRewards');
  assertNumberInRange(value.monthlyRewards.baseTierGmv, 'monthlyRewards.baseTierGmv', 0, 100000000);
  assertNumberInRange(value.monthlyRewards.baseManagementProfitRate, 'baseManagementProfitRate', 0, 1);
  assertNumberInRange(value.monthlyRewards.growthTierGmv, 'monthlyRewards.growthTierGmv', 0, 100000000);
  assertNumberInRange(value.monthlyRewards.growthBonusProfitRate, 'growthBonusProfitRate', 0, 1);
  assertNumberInRange(value.monthlyRewards.excellentTierGmv, 'monthlyRewards.excellentTierGmv', 0, 100000000);
  assertNumberInRange(value.monthlyRewards.cultivationBonusProfitRate, 'cultivationBonusProfitRate', 0, 1);
  assertNumberInRange(value.monthlyRewards.performanceBonusProfitRate, 'performanceBonusProfitRate', 0, 1);
  assertTierOrder(value.monthlyRewards);

  assertObject(value.unitEconomics, 'unitEconomics');
  assertNumberInRange(value.unitEconomics.fulfillmentCostRate, 'unitEconomics.fulfillmentCostRate', 0, 1);

  assertObject(value.caps, 'caps');
  assertNumberInRange(value.caps.maxTotalIncentiveProfitRate, 'caps.maxTotalIncentiveProfitRate', 0, 1);
  assertNumberInRange(value.caps.targetNetProfitRate, 'caps.targetNetProfitRate', 0, 1);
  assertNumberInRange(value.caps.coldChainRiskReserveRate, 'caps.coldChainRiskReserveRate', 0, 1);
  const totalIncentiveRate =
    (value.perOrderCommission.directProfitRate as number) +
    (value.monthlyRewards.baseManagementProfitRate as number) +
    (value.monthlyRewards.growthBonusProfitRate as number) +
    (value.monthlyRewards.cultivationBonusProfitRate as number) +
    (value.monthlyRewards.performanceBonusProfitRate as number);
  if (totalIncentiveRate - (value.caps.maxTotalIncentiveProfitRate as number) > 0.0000001) {
    throw new Error('总激励率不能超过 maxTotalIncentiveProfitRate');
  }
  return { ...value, effectiveFrom } as unknown as CaptainSeafoodConfigV3;
}

function assertTierOrder(rewards: Record<string, unknown>) {
  const baseTierGmv = rewards.baseTierGmv as number;
  const growthTierGmv = rewards.growthTierGmv as number;
  const excellentTierGmv = rewards.excellentTierGmv as number;
  if (baseTierGmv > growthTierGmv || growthTierGmv > excellentTierGmv) {
    throw new Error('月度档位 GMV 必须满足 baseTierGmv <= growthTierGmv <= excellentTierGmv');
  }
}

export function validateCaptainSeafoodConfig(value: unknown): CaptainSeafoodConfig {
  assertObject(value, CAPTAIN_SEAFOOD_CONFIG_KEY);
  if (value.schemaVersion === 2) {
    return validateV2Config(value);
  }
  if (value.schemaVersion === 3) {
    return validateV3Config(value);
  }
  throw new Error('schemaVersion 必须是 2 或 3');
}
