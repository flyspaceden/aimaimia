export type CaptainProgramCode = 'SEAFOOD_PREPACKAGED';

export interface CaptainSeafoodConfig {
  schemaVersion: 2;
  enabled: boolean;
  programCode: CaptainProgramCode;
  programName: string;
  effectiveFrom: string | null;
  scope: {
    categoryIds: string[];
    productIds: string[];
    companyIds: string[];
    excludedProductIds: string[];
    includeVipPackage: false;
    includeGroupBuy: false;
    includePrize: false;
  };
  orderRules: {
    freezeDaysAfterReceived: number;
    minCommissionBase: number;
    includeShippingFee: false;
    includeCouponDiscount: false;
    includeRewardDeduction: false;
  };
  perOrderCommission: {
    directRate: number;
  };
  monthlyQualification: {
    minDirectEffectiveBuyers: number;
    minDirectMonthlyGmv: number;
    minNewEffectiveBuyers: number;
  };
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
  tax: {
    enabled: boolean;
    withholdingRate: number;
    incomeType: 'LABOR_SERVICE';
  };
  risk: {
    maxMonthlyRefundRate: number;
    holdSettlementOnRisk: boolean;
  };
}
