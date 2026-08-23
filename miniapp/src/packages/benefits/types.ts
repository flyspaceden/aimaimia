export type MemberProfile = {
  tier: 'NORMAL' | 'VIP';
  referralCode: string | null;
  inviterUserId: string | null;
  inviter: { userId: string; nickname: string | null; maskedPhone: string | null } | null;
  /**
   * 推荐关系的服务端权威状态。会员中心必须依赖该字段，而不能只看
   * inviterUserId（失效关系仍可能保留历史 inviterUserId）。
   */
  directReferralStatus: 'ACTIVE' | 'INVALIDATED_BY_INVITEE_VIP_UPGRADE' | 'SUPERSEDED_BY_VIP_TREE' | 'ADMIN_VOIDED' | null;
  directReferralInviter: { id: string; nickname: string | null; buyerNo: string | null } | null;
  directReferralPercent?: number | null;
  inviteeVipCount: number;
  vipPurchasedAt: string | null;
  normalEligible: boolean;
  autoVipBySpendEnabled?: boolean;
  autoVipCumulativeSpendThreshold?: number;
  autoVipRemainingSpend?: number | null;
  vipProgress: { selfPurchaseCount: number; unlockedLevel: number } | null;
};

export type VipGiftItem = {
  skuId: string;
  productTitle: string;
  productImage: string | null;
  skuTitle: string;
  price: number;
  quantity: number;
};

export type VipGiftOption = {
  id: string;
  title: string;
  subtitle: string | null;
  badge: string | null;
  coverMode: 'AUTO_GRID' | 'AUTO_DIAGONAL' | 'AUTO_STACKED' | 'CUSTOM';
  coverUrl: string | null;
  totalPrice: number;
  available: boolean;
  items: VipGiftItem[];
};

export type VipPackage = { id: string; companyId: string; price: number; sortOrder: number; giftOptions: VipGiftOption[] };
export type VipGiftOptionsResponse = { packages: VipPackage[] };

export type VipTreeNode = {
  id: string;
  rootId?: string;
  userId?: string;
  level: number;
  position: number;
  childrenCount: number;
  children?: VipTreeNode[];
};
export type VipTree = { node: VipTreeNode | null; children: VipTreeNode[] };

export type NormalTreeContext = {
  inTree: boolean;
  node: null | {
    level: number;
    position: number;
    childrenCount: number;
    selfPurchaseCount: number;
    frozenAt: string | null;
  };
  breadcrumb: Array<{ level: number; isRoot: boolean }>;
  parent?: null | Record<string, unknown>;
  children: Array<{ level: number; position: number; childrenCount: number; hasUser: boolean }>;
  treeDepth?: number;
};

export type BenefitTask = {
  id: string;
  title: string;
  rewardLabel: string;
  rewardPoints?: number;
  rewardGrowth?: number;
  status: 'todo' | 'inProgress' | 'done';
  targetRoute: string;
};

export type GrowthLevel = {
  code: string;
  name: string;
  threshold: number;
  titleLabel?: string | null;
  monthlyExchangeLimit?: number | null;
};
export type GrowthSummary = {
  pointsBalance: number;
  pointsTotalEarned: number;
  pointsTotalSpent: number;
  growthValue: number;
  level: GrowthLevel | null;
  nextLevel: GrowthLevel | null;
  levelProgress: { current: number; required: number | null; ratio: number };
  updatedAt: string | null;
};
export type GrowthGuideRule = {
  code: string;
  name: string;
  categoryCode: string;
  pointsReward: number;
  growthReward: number;
  grantTiming: string;
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
export type GrowthExchangeItem = {
  id: string;
  type: 'COUPON' | 'SHIPPING_COUPON' | 'LOTTERY_CHANCE' | 'VIP_DISCOUNT_COUPON' | 'DECORATION';
  name: string;
  description: string | null;
  pointsCost: number;
  status: 'ACTIVE' | 'INACTIVE' | 'SOLD_OUT';
  canExchange: boolean;
  requiredLevelCode: string | null;
};
export type GrowthExchangeRecord = {
  id: string;
  itemId: string;
  pointsCost: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REVERSED';
  couponInstanceId: string | null;
  failureReason: string | null;
  createdAt: string;
};

export type LotteryPrize = {
  id: string;
  name: string;
  type: string;
  prizePrice?: number;
  threshold?: number;
  prizeQuantity?: number;
  expirationHours?: number | null;
  originalPrice?: number | null;
  expiresAt?: string | null;
  sortOrder?: number;
};
export type DrawResult = { won: boolean; prize?: LotteryPrize; message: string; claimToken?: string };
export type TodayStatus = { hasDrawn: boolean; remainingDraws: number; lastResult?: DrawResult };

export type QueueRewardStatus = {
  enabled: boolean;
  queueSize: number;
  splitUnitAmount: number;
  maxPositionsPerOrder: number;
  distributionMode: 'AVERAGE' | 'NORMAL_RANDOM';
  wallet: { available: number; total: number };
  totalActivePositions: number;
  positionPage: { pageSize: number; total: number; hasMore: boolean; nextSequence: string | null };
  activePositions: Array<{
    id: string; sequence: string; orderId: string; orderNo: string; unitIndex: number;
    status: 'ACTIVE' | 'CAPPED'; ahead: number; observedUnitCount: number;
    targetObservedUnitCount: number; remainingObservedUnitCount: number;
    sharedCapAmount: number; receivedAmount: number; joinedAt: string;
  }>;
  recentOrders: Array<{
    orderId: string; orderNo: string; eligiblePaidAmount: number; sharedCapAmount: number;
    availableReceivedAmount: number; status: 'ACTIVE' | 'CAPPED' | 'COMPLETED' | 'VOIDED';
    returnWindowExpiresAt: string | null; createdAt: string;
  }>;
  recentRewards: Array<{
    id: string; amount: number; status: 'AVAILABLE'; sourceOrderNo: string;
    releaseAt: string | null; releasedAt: string | null; voidedAt: string | null; createdAt: string;
  }>;
};

export type PendingPrizeClaim = {
  claimToken: string;
  prizeId: string;
  prizeName: string;
  createdAt: string;
  mergeKey: string;
};

export type VipCheckoutDraft = {
  userId: string;
  idempotencyKey: string;
  packageId: string;
  giftOptionId: string;
  addressId?: string;
  fulfillment: import('@/types').FulfillmentInput;
  expectedTotal: number;
  buyerNote?: string;
  createdAt: string;
};
