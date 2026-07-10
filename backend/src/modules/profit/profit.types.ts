export type ProfitCalculationStatus = 'READY' | 'RECONCILIATION_REQUIRED';

export type ProfitCalculationErrorCode =
  | 'ORDER_PROFIT_COST_MISSING'
  | 'ORDER_PROFIT_CONSERVATION_FAILED';

export interface ProfitCalculationItemInput {
  id: string;
  unitPriceCents: number;
  quantity: number;
  unitCostCents?: number | null;
  explicitDiscountCents?: number;
  isPrize: boolean;
  captainEligible: boolean;
}

export interface ProfitCalculationInput {
  grossGoodsAmountCents: number;
  items: ProfitCalculationItemInput[];
  vipDiscountCents?: number;
  rewardDeductionCents?: number;
  groupBuyRebateDeductionCents?: number;
  couponDiscountCents?: number;
  otherGoodsDiscountCents?: number;
}

export interface ProfitItemBreakdown {
  orderItemId: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  grossGoodsAmountCents: number;
  explicitDiscountCents: number;
  vipDiscountCents: number;
  rewardDeductionCents: number;
  groupBuyRebateDeductionCents: number;
  couponDiscountCents: number;
  totalDiscountCents: number;
  netGoodsRevenueCents: number;
  productCostCents: number;
  grossProfitCents: number;
  distributableProfitShareCents: number;
  captainEligible: boolean;
}

export interface ProfitCalculationResult {
  status: ProfitCalculationStatus;
  grossGoodsAmountCents: number;
  vipDiscountCents: number;
  rewardDeductionCents: number;
  groupBuyRebateDeductionCents: number;
  couponDiscountCents: number;
  otherGoodsDiscountCents: number;
  totalDiscountCents: number;
  netGoodsRevenueCents: number;
  productCostCents: number;
  distributableProfitCents: number;
  captainEligibleProfitCents: number;
  itemBreakdown: ProfitItemBreakdown[];
  errorCode?: ProfitCalculationErrorCode;
  errorMeta?: Record<string, unknown>;
}
