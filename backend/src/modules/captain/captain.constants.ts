import type { CaptainSeafoodConfig } from './captain.types';

export const CAPTAIN_SEAFOOD_CONFIG_KEY = 'CAPTAIN_SEAFOOD_CONFIG';
export const CAPTAIN_SEAFOOD_PROGRAM_CODE = 'SEAFOOD_PREPACKAGED';

export const DEFAULT_CAPTAIN_SEAFOOD_CONFIG: CaptainSeafoodConfig = {
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
    maxSameDeviceEffectiveBuyers: 3,
    maxSameAddressEffectiveBuyers: 5,
    holdSettlementOnRisk: true,
  },
};

export function cloneCaptainSeafoodConfig(
  value: CaptainSeafoodConfig = DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
): CaptainSeafoodConfig {
  return JSON.parse(JSON.stringify(value)) as CaptainSeafoodConfig;
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

export function normalizeCaptainSeafoodConfig(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const raw = value as Record<string, any>;
  if (raw.schemaVersion === 2) {
    return raw;
  }

  const legacyPerOrder = raw.perOrderCommission ?? {};
  const legacyQualification = raw.monthlyQualification ?? {};
  const legacyRewards = raw.monthlyRewards ?? {};
  return {
    ...raw,
    schemaVersion: 2,
    perOrderCommission: {
      directRate: Number(legacyPerOrder.directRate ?? 0) + Number(legacyPerOrder.indirectRate ?? 0),
    },
    monthlyQualification: {
      minDirectEffectiveBuyers: legacyQualification.minDirectEffectiveBuyers,
      minDirectMonthlyGmv: Math.max(
        Number(legacyQualification.minPersonalMonthlyGmv ?? 0),
        Number(legacyQualification.minTeamMonthlyGmv ?? 0),
      ),
      minNewEffectiveBuyers: legacyQualification.minNewEffectiveMembers,
    },
    monthlyRewards: {
      baseTierGmv: legacyRewards.baseTierGmv,
      baseManagementRate: legacyRewards.baseManagementRate,
      growthTierGmv: legacyRewards.growthTierGmv,
      growthBonusRate: legacyRewards.growthBonusRate,
      excellentTierGmv: legacyRewards.excellentTierGmv,
      cultivationBonusRate: legacyRewards.cultivationBonusRate,
      performanceBonusRate: legacyRewards.teamPoolRate,
    },
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

export function validateCaptainSeafoodConfig(value: unknown): CaptainSeafoodConfig {
  assertObject(value, CAPTAIN_SEAFOOD_CONFIG_KEY);

  if (value.schemaVersion !== 2) {
    throw new Error('schemaVersion 必须是 2');
  }
  assertBoolean(value.enabled, 'enabled');
  if (value.programCode !== CAPTAIN_SEAFOOD_PROGRAM_CODE) {
    throw new Error(`programCode 必须是 ${CAPTAIN_SEAFOOD_PROGRAM_CODE}`);
  }
  assertString(value.programName, 'programName');
  if (value.effectiveFrom !== null && typeof value.effectiveFrom !== 'string') {
    throw new Error('effectiveFrom 必须是字符串或 null');
  }

  assertObject(value.scope, 'scope');
  assertStringArray(value.scope.categoryIds, 'scope.categoryIds');
  assertStringArray(value.scope.productIds, 'scope.productIds');
  assertStringArray(value.scope.companyIds, 'scope.companyIds');
  assertStringArray(value.scope.excludedProductIds, 'scope.excludedProductIds');
  assertFalse(value.scope.includeVipPackage, 'includeVipPackage');
  assertFalse(value.scope.includeGroupBuy, 'includeGroupBuy');
  assertFalse(value.scope.includePrize, 'includePrize');
  const categoryIds = value.scope.categoryIds as string[];
  const productIds = value.scope.productIds as string[];
  const companyIds = value.scope.companyIds as string[];
  const scopeCount =
    categoryIds.length +
    productIds.length +
    companyIds.length;
  if (value.enabled === true && scopeCount === 0) {
    throw new Error('启用团长配置前必须至少配置一个适用类目、商品或商户');
  }

  assertObject(value.orderRules, 'orderRules');
  assertNumberInRange(value.orderRules.freezeDaysAfterReceived, 'orderRules.freezeDaysAfterReceived', 0, 365, true);
  assertNumberInRange(value.orderRules.minCommissionBase, 'orderRules.minCommissionBase', 0, 1000000);
  assertFalse(value.orderRules.includeShippingFee, 'includeShippingFee');
  assertFalse(value.orderRules.includeCouponDiscount, 'includeCouponDiscount');
  assertFalse(value.orderRules.includeRewardDeduction, 'includeRewardDeduction');

  assertObject(value.perOrderCommission, 'perOrderCommission');
  assertNumberInRange(value.perOrderCommission.directRate, 'directRate', 0, 1);
  if ('indirectRate' in value.perOrderCommission) {
    throw new Error('indirectRate 不再支持');
  }

  assertObject(value.monthlyQualification, 'monthlyQualification');
  assertNumberInRange(value.monthlyQualification.minDirectEffectiveBuyers, 'monthlyQualification.minDirectEffectiveBuyers', 0, 100000, true);
  assertNumberInRange(value.monthlyQualification.minDirectMonthlyGmv, 'monthlyQualification.minDirectMonthlyGmv', 0, 100000000);
  assertNumberInRange(value.monthlyQualification.minNewEffectiveBuyers, 'monthlyQualification.minNewEffectiveBuyers', 0, 100000, true);

  assertObject(value.monthlyRewards, 'monthlyRewards');
  assertNumberInRange(value.monthlyRewards.baseTierGmv, 'monthlyRewards.baseTierGmv', 0, 100000000);
  assertNumberInRange(value.monthlyRewards.baseManagementRate, 'monthlyRewards.baseManagementRate', 0, 1);
  assertNumberInRange(value.monthlyRewards.growthTierGmv, 'monthlyRewards.growthTierGmv', 0, 100000000);
  assertNumberInRange(value.monthlyRewards.growthBonusRate, 'monthlyRewards.growthBonusRate', 0, 1);
  assertNumberInRange(value.monthlyRewards.excellentTierGmv, 'monthlyRewards.excellentTierGmv', 0, 100000000);
  assertNumberInRange(value.monthlyRewards.cultivationBonusRate, 'monthlyRewards.cultivationBonusRate', 0, 1);
  assertNumberInRange(value.monthlyRewards.performanceBonusRate, 'monthlyRewards.performanceBonusRate', 0, 1);
  const baseTierGmv = value.monthlyRewards.baseTierGmv as number;
  const growthTierGmv = value.monthlyRewards.growthTierGmv as number;
  const excellentTierGmv = value.monthlyRewards.excellentTierGmv as number;
  if (
    baseTierGmv > growthTierGmv ||
    growthTierGmv > excellentTierGmv
  ) {
    throw new Error('月度档位 GMV 必须满足 baseTierGmv <= growthTierGmv <= excellentTierGmv');
  }

  assertObject(value.caps, 'caps');
  assertNumberInRange(value.caps.maxTotalIncentiveRate, 'caps.maxTotalIncentiveRate', 0, 0.155);
  assertNumberInRange(value.caps.targetNetProfitRate, 'caps.targetNetProfitRate', 0, 1);
  assertNumberInRange(value.caps.coldChainRiskReserveRate, 'caps.coldChainRiskReserveRate', 0, 1);

  assertObject(value.tax, 'tax');
  assertBoolean(value.tax.enabled, 'tax.enabled');
  assertNumberInRange(value.tax.withholdingRate, 'tax.withholdingRate', 0, 1);
  if (value.tax.incomeType !== 'LABOR_SERVICE') {
    throw new Error('tax.incomeType 必须是 LABOR_SERVICE');
  }

  assertObject(value.risk, 'risk');
  assertNumberInRange(value.risk.maxMonthlyRefundRate, 'risk.maxMonthlyRefundRate', 0, 1);
  assertNumberInRange(value.risk.maxSameDeviceEffectiveBuyers, 'risk.maxSameDeviceEffectiveBuyers', 0, 100000, true);
  assertNumberInRange(value.risk.maxSameAddressEffectiveBuyers, 'risk.maxSameAddressEffectiveBuyers', 0, 100000, true);
  assertBoolean(value.risk.holdSettlementOnRisk, 'risk.holdSettlementOnRisk');

  const totalIncentiveRate =
    (value.perOrderCommission.directRate as number) +
    (value.monthlyRewards.baseManagementRate as number) +
    (value.monthlyRewards.growthBonusRate as number) +
    (value.monthlyRewards.cultivationBonusRate as number) +
    (value.monthlyRewards.performanceBonusRate as number);
  if (totalIncentiveRate - (value.caps.maxTotalIncentiveRate as number) > 0.0000001) {
    throw new Error('总激励率不能超过 maxTotalIncentiveRate');
  }

  return value as unknown as CaptainSeafoodConfig;
}
