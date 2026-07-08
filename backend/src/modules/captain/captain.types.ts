export type CaptainProgramCode = 'SEAFOOD_PREPACKAGED';

export interface CaptainSeafoodConfig {
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
    indirectRate: number;
    maxLevels: 2;
  };
  monthlyQualification: {
    minDirectEffectiveBuyers: number;
    minPersonalMonthlyGmv: number;
    minTeamEffectiveMembers: number;
    minTeamMonthlyGmv: number;
    minNewEffectiveMembers: number;
  };
  monthlyRewards: {
    baseTierGmv: number;
    baseManagementRate: number;
    growthTierGmv: number;
    growthBonusRate: number;
    excellentTierGmv: number;
    cultivationBonusRate: number;
    teamPoolRate: number;
    captainTeamPoolWeight: number;
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
    maxSameDeviceEffectiveBuyers: number;
    maxSameAddressEffectiveBuyers: number;
    holdSettlementOnRisk: boolean;
  };
}
