export type CaptainProgramCode = 'SEAFOOD_PREPACKAGED';

export interface CaptainScopeConfig {
  categoryIds: string[];
  productIds: string[];
  companyIds: string[];
  excludedProductIds: string[];
  includeVipPackage: false;
  includeGroupBuy: false;
  includePrize: false;
}

export interface CaptainOrderRules {
  freezeDaysAfterReceived: number;
  minCommissionBase: number;
  includeShippingFee: false;
  includeCouponDiscount: false;
  includeRewardDeduction: false;
}

export interface CaptainMonthlyQualification {
  minDirectEffectiveBuyers: number;
  minDirectMonthlyGmv: number;
  minNewEffectiveBuyers: number;
}

export interface CaptainTaxConfig {
  enabled: boolean;
  withholdingRate: number;
  incomeType: 'LABOR_SERVICE';
}

export interface CaptainRiskConfig {
  maxMonthlyRefundRate: number;
  holdSettlementOnRisk: boolean;
}

export interface CaptainSeafoodConfigV2 {
  schemaVersion: 2;
  enabled: boolean;
  programCode: CaptainProgramCode;
  programName: string;
  effectiveFrom: string | null;
  scope: CaptainScopeConfig;
  orderRules: CaptainOrderRules;
  perOrderCommission: {
    directRate: number;
  };
  monthlyQualification: CaptainMonthlyQualification;
  monthlyRewards: {
    baseTierGmv: number;
    baseManagementRate: number;
    growthTierGmv: number;
    growthBonusRate: number;
    excellentTierGmv: number;
    cultivationBonusRate: number;
    performanceBonusRate: number;
  };
  caps: {
    maxTotalIncentiveRate: number;
    targetNetProfitRate: number;
    coldChainRiskReserveRate: number;
  };
  tax: CaptainTaxConfig;
  risk: CaptainRiskConfig;
}

export interface CaptainSeafoodConfigV3 {
  schemaVersion: 3;
  enabled: boolean;
  programCode: CaptainProgramCode;
  programName: string;
  effectiveFrom: string;
  scope: CaptainScopeConfig;
  orderRules: CaptainOrderRules;
  monthlyQualification: CaptainMonthlyQualification;
  perOrderCommission: {
    directProfitRate: number;
  };
  monthlyRewards: {
    baseTierGmv: number;
    baseManagementProfitRate: number;
    growthTierGmv: number;
    growthBonusProfitRate: number;
    excellentTierGmv: number;
    cultivationBonusProfitRate: number;
    performanceBonusProfitRate: number;
  };
  unitEconomics: {
    fulfillmentCostRate: number;
  };
  caps: {
    maxTotalIncentiveProfitRate: number;
    targetNetProfitRate: number;
    coldChainRiskReserveRate: number;
  };
  tax: CaptainTaxConfig;
  risk: CaptainRiskConfig;
}

export type CaptainSeafoodConfig = CaptainSeafoodConfigV2 | CaptainSeafoodConfigV3;
