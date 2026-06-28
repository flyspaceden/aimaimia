export type DigitalAssetSubjectType =
  | 'CUMULATIVE_SPEND'
  | 'SEED_ASSET'
  | 'CREDIT_ASSET';

export type DigitalAssetSourceType =
  | 'CONSUMPTION_CONFIRMED'
  | 'ORDER_RECEIVED'
  | 'CONSUMPTION_PAID_FROZEN'
  | 'CONSUMPTION_FROZEN_RELEASED'
  | 'CONSUMPTION_FROZEN_VOIDED'
  | 'REFUND_REVERSAL'
  | 'SELF_VIP_PURCHASE'
  | 'REFERRAL_VIP_PURCHASE'
  | 'HISTORICAL_CONSUMPTION_GRANT'
  | 'ADMIN_ADJUSTMENT'
  | 'BACKFILL';

export type DigitalAssetLedgerDirection = 'CREDIT' | 'DEBIT';

export type DigitalAssetModuleKey = 'assetValue' | 'level' | 'benefits' | 'futureRights';

export interface DigitalAssetModuleInfo {
  key: DigitalAssetModuleKey;
  title: string;
  status?: 'COMING_SOON';
  enabled?: boolean;
  description: string;
}

export interface DigitalAssetCreditTierInfo {
  minAmount: number;
  maxAmount: number | null;
  multiplier: number;
  currentAmount?: number;
  remainingAmount?: number;
}

export interface DigitalAssetVipSeedRule {
  packageId: string;
  price: number;
  selfSeedAssetAmount: number;
  referralSeedAssetAmount: number;
}

export interface DigitalAssetActivationPrompt {
  title: string;
  description: string;
  actionLabel: string;
}

export interface DigitalAssetSummary {
  isVip: boolean;
  totalAssetBalance: number;
  seedAssetBalance: number;
  creditAssetBalance: number;
  frozenCreditAssetBalance: number;
  cumulativeSpendAmount: number;
  /** 当前 VIP 用户的数字资产排名；没有数字资产账户或非 VIP 时为 null */
  assetRank: number | null;
  activationPrompt?: DigitalAssetActivationPrompt;
  currentCreditTier?: DigitalAssetCreditTierInfo;
  nextCreditTier?: DigitalAssetCreditTierInfo | null;
  vipSeedRules: DigitalAssetVipSeedRule[];
  recentRecords: DigitalAssetLedger[];
  modules: DigitalAssetModuleInfo[];
}

export interface DigitalAssetLedger {
  id: string;
  type: DigitalAssetSourceType;
  sourceType: DigitalAssetSourceType;
  subjectType: DigitalAssetSubjectType;
  direction: DigitalAssetLedgerDirection;
  amount: number;
  assetAmount?: number | null;
  balanceAfter: number;
  frozenCreditAssetBalanceAfter?: number | null;
  frozenCumulativeSpendAfter?: number | null;
  status?: 'FROZEN' | 'RELEASED' | 'VOIDED';
  releaseHint?: string;
  title: string;
  description?: string;
  orderId?: string;
  createdAt: string;
}
