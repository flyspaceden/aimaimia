export type GrowthLevel = {
  code: string;
  name: string;
  threshold: number;
  benefits?: Record<string, unknown> | null;
  avatarFrameType?: string | null;
  titleLabel?: string | null;
  monthlyExchangeLimit?: number | null;
};

export type GrowthProgress = {
  current: number;
  required: number | null;
  ratio: number;
};

export type DirectReferralStatus =
  | 'ACTIVE'
  | 'INVALIDATED_BY_INVITEE_VIP_UPGRADE'
  | 'SUPERSEDED_BY_VIP_TREE'
  | 'ADMIN_VOIDED';

export type DirectReferralInviterSummary = {
  id: string;
  nickname: string | null;
  buyerNo?: string | null;
};

export type GrowthSummary = {
  pointsBalance: number;
  pointsTotalEarned: number;
  pointsTotalSpent: number;
  growthValue: number;
  level: GrowthLevel | null;
  nextLevel: GrowthLevel | null;
  levelProgress: GrowthProgress;
  updatedAt: string | null;
  directReferralStatus?: DirectReferralStatus | null;
  directReferralInviter?: DirectReferralInviterSummary | null;
  autoVipBySpendEnabled?: boolean;
  autoVipCumulativeSpendThreshold?: number;
  autoVipRemainingSpend?: number | null;
  directReferralPercent?: number | null;
};

export type GrowthGuideRule = {
  code: string;
  name: string;
  categoryCode: string;
  pointsReward: number;
  growthReward: number;
  grantTiming: 'IMMEDIATE' | 'CONFIRMED_RECEIPT' | 'AFTER_SALE_WINDOW' | 'MANUAL' | string;
  dailyLimit: number | null;
  weeklyLimit: number | null;
  monthlyLimit: number | null;
  lifetimeLimit: number | null;
  sortOrder: number;
};

export type GrowthGuide = {
  inviteRules: GrowthGuideRule[];
  earningRules: GrowthGuideRule[];
  levels: GrowthLevel[];
  pointsNote: string;
  growthNote: string;
};

export type GrowthExchangeType =
  | 'COUPON'
  | 'SHIPPING_COUPON'
  | 'LOTTERY_CHANCE'
  | 'VIP_DISCOUNT_COUPON'
  | 'DECORATION';

export type GrowthExchangeItem = {
  id: string;
  type: GrowthExchangeType;
  name: string;
  description: string | null;
  pointsCost: number;
  stockTotal: number | null;
  stockDaily: number | null;
  issuedTotal: number;
  issuedToday: number;
  issuedTodayDate: string | null;
  perUserDailyLimit: number | null;
  perUserMonthlyLimit: number | null;
  requiredLevelCode: string | null;
  requiredLevel?: GrowthLevel | null;
  startAt: string | null;
  endAt: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SOLD_OUT';
  sortOrder: number;
  canExchange: boolean;
};

export type GrowthExchangeRecord = {
  id: string;
  itemId: string;
  pointsCost: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REVERSED';
  couponInstanceId: string | null;
  failureReason: string | null;
  createdAt: string;
  item?: GrowthExchangeItem;
};

export type NormalShareProfile = {
  id: string;
  userId: string;
  code: string;
  status: 'ACTIVE' | 'DISABLED';
  disabledReason: string | null;
  shareUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type NormalShareStats = {
  totalInvitees: number;
  rewardedInvitees: number;
  pendingInvitees: number;
};

export type NormalShareRecord = {
  id: string;
  inviterUserId: string;
  inviteeUserId: string;
  code: string;
  source: string;
  relationStatus?: 'ACTIVE' | 'SUPERSEDED_BY_VIP_TREE' | 'INVALIDATED_BY_INVITEE_VIP_UPGRADE' | 'ADMIN_VOIDED';
  boundAt: string;
  firstOrderId: string | null;
  rewardStatus: 'PENDING' | 'REGISTER_REWARDED' | 'FIRST_ORDER_PENDING' | 'ISSUED' | 'REVERSED' | 'VOIDED';
  rewardIssuedAt: string | null;
  createdAt: string;
  invitee?: {
    id: string;
    buyerNo: string | null;
    profile?: {
      nickname: string | null;
      avatarUrl?: string | null;
    } | null;
  };
  firstOrder?: {
    id: string;
    totalAmount: number;
    status: string;
    createdAt: string;
  } | null;
};
