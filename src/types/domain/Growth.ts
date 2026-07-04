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

export type GrowthSummary = {
  pointsBalance: number;
  pointsTotalEarned: number;
  pointsTotalSpent: number;
  growthValue: number;
  level: GrowthLevel | null;
  nextLevel: GrowthLevel | null;
  levelProgress: GrowthProgress;
  updatedAt: string | null;
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
