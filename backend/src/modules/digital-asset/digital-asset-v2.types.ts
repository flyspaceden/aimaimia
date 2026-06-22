export type DigitalAssetSubjectType =
  | 'CUMULATIVE_SPEND'
  | 'SEED_ASSET'
  | 'CREDIT_ASSET';

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

export type CreditAssetTier = {
  minAmount: number;
  maxAmount: number | null;
  multiplier: number;
};
