import type { PageResult } from '@/types/pagination';

export type WalletSummary = {
  balance: number;
  frozen: number;
  total: number;
  deductibleBalance?: number;
  withdrawableBalance?: number;
};

export type WalletLedgerEntry = {
  id: string;
  entryType: string;
  source?: 'REWARD' | 'GROUP_BUY_REBATE';
  type?: string;
  amount: number;
  status: string;
  balanceAfter?: number | null;
  refType: string | null;
  /** 服务端允许的流水展示字段；内部记账 meta 不下发。 */
  meta: { orderNo?: string; requiredLevel?: number; expiresAt?: string } | null;
  sourceLabel?: string | null;
  createdAt: string;
  accountType: string | null;
};

export type WalletLedgerPage = {
  items: WalletLedgerEntry[];
  /** 该接口由服务端直接给出下一页，不使用客户端猜测总数。 */
  nextPage?: number;
};

export type WithdrawStatus = 'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'REJECTED' | 'FAILED';

export type WithdrawRecord = {
  id: string;
  amount: number;
  channel: string;
  status: WithdrawStatus;
  createdAt: string;
};

export type WechatWithdrawResult = {
  withdrawId: string;
  grossAmount: number;
  taxAmount: number;
  taxRate: number;
  netAmount: number;
  status: 'PROCESSING' | 'PAID' | 'FAILED';
  message: string;
  mchId?: string;
  appId?: string;
  package?: string;
};

export type CouponInstanceStatus = 'AVAILABLE' | 'RESERVED' | 'USED' | 'EXPIRED' | 'REVOKED';
export type CouponDiscountType = 'FIXED' | 'PERCENT';
export type CouponCenterView = 'claimable' | 'claimed' | 'active';
export type CouponCenterDisplayStatus = 'CLAIMABLE' | 'CLAIMED' | 'SOLD_OUT' | 'NOT_ELIGIBLE' | 'ENDED';

export type MyCoupon = {
  id: string;
  campaignName: string;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  status: CouponInstanceStatus;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedOrderId: string | null;
  usedAmount: number | null;
};

export type CouponClaimSummary = {
  total: number;
  available: number;
  used: number;
  expired: number;
  reserved: number;
  revoked: number;
  nearestExpiresAt: string | null;
};

export type CouponCenterCampaign = {
  id: string;
  name: string;
  description: string | null;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  remainingQuota: number;
  userClaimedCount: number;
  maxPerUser: number;
  startAt: string;
  endAt: string | null;
  distributionMode: 'CLAIM';
  canClaim: boolean;
  displayStatus: CouponCenterDisplayStatus;
  statusLabel: string;
  ineligibleReason: string | null;
  claimedSummary: CouponClaimSummary;
};

export type DigitalAssetSubjectType = 'CUMULATIVE_SPEND' | 'SEED_ASSET' | 'CREDIT_ASSET';
export type DigitalAssetSourceType =
  | 'ORDER_RECEIVED'
  | 'CONSUMPTION_CONFIRMED'
  | 'CONSUMPTION_PAID_FROZEN'
  | 'CONSUMPTION_FROZEN_RELEASED'
  | 'CONSUMPTION_FROZEN_VOIDED'
  | 'REFUND_REVERSAL'
  | 'SELF_VIP_PURCHASE'
  | 'REFERRAL_VIP_PURCHASE'
  | 'HISTORICAL_CONSUMPTION_GRANT'
  | 'ADMIN_ADJUSTMENT'
  | 'BACKFILL';

export type DigitalAssetLedger = {
  id: string;
  type: DigitalAssetSourceType;
  sourceType: DigitalAssetSourceType;
  subjectType: DigitalAssetSubjectType;
  direction: 'CREDIT' | 'DEBIT';
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
};

export type DigitalAssetSummary = {
  isVip: boolean;
  totalAssetBalance: number;
  seedAssetBalance: number;
  creditAssetBalance: number;
  frozenCreditAssetBalance: number;
  cumulativeSpendAmount: number;
  assetRank: number | null;
  recentRecords: DigitalAssetLedger[];
};

export type DigitalAssetLedgerQuery = {
  page?: number;
  pageSize?: number;
  subjectType?: DigitalAssetSubjectType;
  sourceType?: DigitalAssetSourceType;
};

export type DigitalAssetLedgerPage = PageResult<DigitalAssetLedger>;
