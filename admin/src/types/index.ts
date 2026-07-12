// ========== API 通用类型 ==========

/** 后端统一响应信封 */
export interface ApiResponse<T> {
  ok: boolean;
  data: T;
  error?: string;
}

/** 分页响应（后端返回 items 字段） */
export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 分页查询参数 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface UserLite {
  id: string;
  buyerNo: string | null;
  profile?: {
    nickname: string | null;
    avatarUrl?: string | null;
  } | null;
}

// ========== 管理员 ==========

export type AdminUserStatus = 'ACTIVE' | 'DISABLED';

export interface AdminUser {
  id: string;
  username: string;
  realName: string | null;
  phone: string | null;
  status: AdminUserStatus;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  loginFailCount: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  roles: AdminRole[];
}

export interface AdminRole {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  permissions: AdminPermission[];
}

export interface AdminPermission {
  id: string;
  code: string;
  module: string;
  action: string;
  description: string | null;
}

// ========== 认证 ==========

export interface LoginRequest {
  username: string;
  password: string;
  captchaId: string;
  captchaCode: string;
}

export interface LoginByPhoneCodeRequest {
  phone: string;
  code: string;
}

export interface CaptchaResponse {
  captchaId: string;
  svg: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  admin: {
    id: string;
    username: string;
    realName: string | null;
    roles: string[];
  };
}

export interface AdminProfile {
  id: string;
  username: string;
  realName: string | null;
  phone?: string | null;
  /** 后端返回角色名字符串数组，如 ["超级管理员"] */
  roles: string[];
  permissions: string[];
}

// ========== 审计日志 ==========

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'STATUS_CHANGE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'APPROVE'
  | 'REJECT'
  | 'REFUND'
  | 'SHIP'
  | 'CONFIG_CHANGE'
  | 'EXPORT'
  | 'ROLLBACK';

export interface AuditLog {
  id: string;
  adminUserId: string;
  adminUser?: { username: string; realName: string | null };
  action: AuditAction;
  module: string;
  targetType: string | null;
  targetId: string | null;
  summary: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  diff: Record<string, unknown> | null;
  ip: string | null;
  isReversible: boolean;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  rolledBackLogId: string | null;
  createdAt: string;
}

export interface AuditQueryParams extends PaginationParams {
  module?: string;
  action?: AuditAction;
  adminUserId?: string;
  targetType?: string;
  targetId?: string;
  startDate?: string;
  endDate?: string;
}

// ========== Dashboard 统计 ==========

export interface DashboardStats {
  totalUsers: number;
  totalOrders: number;
  totalRevenue: number;
  totalProducts: number;
  totalCompanies: number;
  todayOrderCount: number;
  pendingWithdrawals: number;
  recentOrders: Order[];
}

export interface SalesTrend {
  date: string;
  amount: number;
  count: number;
}

export interface OperationsOverview {
  today: {
    paidOrderCount: number;
    gmv: number;
    averageOrderAmount: number;
    normalOrderCount: number;
    vipOrderCount: number;
    groupBuyOrderCount: number;
    payments: Array<{ channel: string; amount: number; count: number }>;
  };
  pending: {
    productReviews: number;
    companyReviews: number;
    withdrawalReviews: number;
    withdrawalProcessing: number;
    withdrawalFailed: number;
    afterSaleRequests: number;
    afterSaleSellerReviews: number;
    afterSaleArbitrations: number;
    afterSaleReturns: number;
    afterSaleManualReviews: number;
    afterSaleRefunding: number;
    invoiceRequests: number;
    customerServiceQueue: number;
    openTickets: number;
  };
  capital: {
    rewardAvailableAmount: number;
    rewardFrozenAmount: number;
    rewardReturnFrozenAmount: number;
    rewardReservedAmount: number;
    rewardTodayCreatedAmount: number;
    digitalAssetAccountCount: number;
    digitalAssetTotalBalance: number;
    digitalAssetFrozenCreditBalance: number;
    digitalAssetCumulativeSpendAmount: number;
    digitalAssetTodayCreditAmount: number;
    withdrawalProcessingAmount: number;
    withdrawalFailedAmount: number;
  };
  activities: {
    totalCouponCampaigns: number;
    activeCouponCampaigns: number;
    couponIssuedCount: number;
    couponUsedCount: number;
    couponUsageRate: number;
    couponDiscountAmount: number;
    todayDraws: number;
    todayWins: number;
    activeLotteryPrizes: number;
    activeGroupBuyActivities: number;
    activeGroupBuyInstances: number;
    completedGroupBuyInstances: number;
    groupBuyCandidates: number;
    groupBuyValidReferrals: number;
    pendingGroupBuyRebateAmount: number;
  };
}

// ========== App 用户（买家） ==========

export type AppUserStatus = 'ACTIVE' | 'BANNED' | 'DELETED';

export interface AppUser {
  id: string;
  buyerNo: string | null;
  phone: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  memberTier: 'VIP' | 'NORMAL';
  normalShareCode?: string | null;
  normalShareStatus?: string | null;
  vipReferralCode?: string | null;
  status: AppUserStatus;
  orderCount: number;
  createdAt: string;
}

export interface AppUserStats {
  totalUsers: number;
  vipUsers: number;
  todayRegistered: number;
  bannedUsers: number;
}

export interface AppUserRecommendationUser {
  id: string;
  buyerNo: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  phoneMasked: string | null;
  memberTier: 'VIP' | 'NORMAL' | string | null;
}

export interface AppUserRecommendationCode {
  type: 'NORMAL_SHARE' | 'VIP_REFERRAL';
  code: string;
  status: string | null;
  url: string;
}

export interface AppUserNormalShareProfile {
  id: string;
  userId: string;
  code: string;
  status: string;
  disabledReason: string | null;
  shareUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppUserOrderSummary {
  id: string;
  orderNo: string | null;
  totalAmount: number;
  status: string;
  createdAt: string;
}

export interface AppUserNormalInvitee {
  id: string;
  inviterUserId: string;
  inviteeUserId: string;
  code: string;
  source: string;
  relationStatus: string | null;
  relationInvalidAt: string | null;
  relationInvalidReason: string | null;
  effectiveInviterUserId: string | null;
  boundAt: string;
  firstOrderId: string | null;
  rewardStatus: string;
  rewardIssuedAt: string | null;
  createdAt: string;
  updatedAt: string;
  inviter: AppUserRecommendationUser | null;
  invitee: AppUserRecommendationUser | null;
  effectiveInviter: AppUserRecommendationUser | null;
  firstOrder: AppUserOrderSummary | null;
}

export interface AppUserVipReferralLink {
  id: string;
  inviterUserId: string;
  inviteeUserId: string;
  codeUsed: string;
  channel: string | null;
  createdAt: string;
  inviter: AppUserRecommendationUser | null;
  invitee: AppUserRecommendationUser | null;
  direction: 'received' | 'made';
}

export interface AppUserVipInvitee {
  userId: string;
  tier: 'VIP' | string;
  referralCode: string | null;
  vipPurchasedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: AppUserRecommendationUser | null;
}

export interface AppUserRecommendation {
  visibleCode: AppUserRecommendationCode | null;
  normalShareProfile: AppUserNormalShareProfile | null;
  vipReferralCode: string | null;
  currentInviter: AppUserRecommendationUser | null;
  normalBindingReceived: AppUserNormalInvitee | null;
  vipReferralReceived: AppUserVipReferralLink | null;
  directNormalInvitees: AppUserNormalInvitee[];
  directVipInvitees: AppUserVipInvitee[];
  counts: {
    directNormalInvitees: number;
    activeNormalInvitees: number;
    directVipInvitees: number;
  };
}

export interface AppUserDetail {
  id: string;
  buyerNo: string | null;
  phone: string | null;
  phoneMasked: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  level: string;
  growthPoints: number;
  points: number;
  gender: string | null;
  birthday: string | null;
  city: string | null;
  status: AppUserStatus;
  memberTier: 'VIP' | 'NORMAL';
  orderCount: number;
  addressCount: number;
  followCount: number;
  authIdentitiesMasked: Array<{
    provider: string;
    identifierMasked: string;
    verified: boolean;
  }>;
  recommendation: AppUserRecommendation;
  createdAt: string;
  updatedAt: string;
}

// ========== 预包装海鲜团长经营 ==========

export type CaptainProfileStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';
export type CaptainRelationStatus = 'ACTIVE' | 'INACTIVE';
export type CaptainLedgerType =
  | 'DIRECT_ORDER'
  | 'LEGACY_INDIRECT_ORDER'
  | 'MANAGEMENT_ALLOWANCE'
  | 'GROWTH_BONUS'
  | 'CULTIVATION_BONUS'
  | 'PERFORMANCE_BONUS'
  | 'TEAM_POOL'
  | 'VOID'
  | 'ADJUSTMENT';
export type CaptainLedgerStatus =
  | 'FROZEN'
  | 'AVAILABLE'
  | 'VOIDED'
  | 'WITHDRAWN'
  | 'CLAWBACK_PENDING';
export type CaptainSettlementStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'PAID'
  | 'REJECTED';
export type CaptainApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export type CaptainCalculationModel = 'SALES_V2' | 'PROFIT_V3';

export interface CaptainApplicationSnapshot {
  capturedAt?: string;
  buyerNo?: string | null;
  nickname?: string | null;
  phone?: string | null;
  phoneVerified?: boolean;
  userStatus?: string;
  isVip?: boolean;
  memberTier?: string | null;
  orderCount?: number;
  paidAmount?: number;
  refundCount?: number;
  refundAmount?: number;
  refundRate?: number;
  boundCaptain?: {
    userId: string;
    buyerNo: string | null;
    nickname: string | null;
  } | null;
}

export interface CaptainAccount {
  id: string;
  userId: string;
  programCode: string;
  balance: number;
  frozen: number;
  withdrawn: number;
  clawback: number;
}

export interface CaptainMonthlyMetric {
  id: string;
  captainUserId: string;
  month: string;
  programCode: string;
  personalGmv: number;
  teamGmv: number;
  directEffectiveBuyers: number;
  teamEffectiveMembers: number;
  newEffectiveMembers: number;
  refundRate: number;
  qualified: boolean;
  qualifiedTier: string | null;
}

export interface CaptainProfile {
  id: string;
  userId: string;
  captainCode: string;
  programCode: string;
  displayName: string | null;
  status: CaptainProfileStatus;
  approvedAt: string | null;
  pausedAt: string | null;
  disabledAt: string | null;
  statusReason: string | null;
  createdAt: string;
  user?: UserLite & {
    captainAccounts?: CaptainAccount[];
    captainMonthlyMetrics?: CaptainMonthlyMetric[];
  };
  account?: CaptainAccount | null;
}

export interface CaptainApplication {
  id: string;
  userId: string;
  programCode: string;
  status: CaptainApplicationStatus;
  realName: string;
  contact: string;
  city: string;
  communityScale: string;
  expectedMonthlyGmv: string;
  resourceTypes: string[];
  promotionPlan: string;
  seafoodExperience: string;
  complianceAccepted: boolean;
  systemSnapshot: CaptainApplicationSnapshot;
  reviewedByAdminId: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  captainProfileUserId: string | null;
  createdAt: string;
  updatedAt: string;
  user?: UserLite & {
    authIdentities?: Array<{
      identifier: string;
      verified: boolean;
    }>;
  };
}

export interface CaptainRelation {
  id: string;
  buyerUserId: string;
  directCaptainUserId: string;
  programCode: string;
  codeUsed: string;
  source: string | null;
  status: CaptainRelationStatus;
  boundAt: string;
  buyer?: UserLite;
  directCaptain?: UserLite;
}

export interface CaptainOrderAttribution {
  id: string;
  orderId: string;
  buyerUserId: string;
  directCaptainUserId: string;
  programCode: string;
  commissionBase: number;
  eligibleGoodsAmount: number;
  couponDiscountAmount: number;
  rewardDeductionAmount: number;
  refundAmount: number;
  directRate: number;
  calculationModel: CaptainCalculationModel;
  profitSnapshotId: string | null;
  profitConfigVersion: string | null;
  profitBaseAmount: number | null;
  status: string;
  createdAt: string;
  order?: { id: string; status: string; totalAmount: number; createdAt: string };
  buyer?: UserLite;
  directCaptain?: UserLite;
}

export interface CaptainCommissionLedger {
  id: string;
  userId: string;
  orderId: string | null;
  settlementId: string | null;
  programCode: string;
  type: CaptainLedgerType;
  status: CaptainLedgerStatus;
  amount: number;
  commissionBase: number | null;
  rate: number | null;
  balanceAfter: number | null;
  frozenAfter: number | null;
  refType: string | null;
  refId: string | null;
  configSnapshot?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
  user?: UserLite;
  settlement?: { id: string; month: string; status: CaptainSettlementStatus };
  orderAttribution?: {
    id: string;
    orderId: string;
    buyerUserId: string;
    calculationModel?: CaptainCalculationModel;
    profitBaseAmount?: number | null;
  } | null;
}

export interface CaptainMonthlySettlement {
  id: string;
  captainUserId: string;
  metricId: string | null;
  month: string;
  programCode: string;
  status: CaptainSettlementStatus;
  baseManagementAmount: number;
  growthBonusAmount: number;
  cultivationBonusAmount: number;
  teamPoolAmount: number;
  totalAmount: number;
  taxAmount: number;
  netAmount: number;
  reviewedByAdminId: string | null;
  paidByAdminId: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
  rejectReason: string | null;
  configSnapshot?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  profitBaseAmount?: number | null;
  reviewBlockedReason?: string | null;
  createdAt: string;
  captain?: UserLite;
  metric?: CaptainMonthlyMetric | null;
}

export interface CaptainSeafoodConfig {
  schemaVersion: 3;
  enabled: boolean;
  programCode: 'SEAFOOD_PREPACKAGED';
  programName: string;
  effectiveFrom: string;
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
    directProfitRate: number;
  };
  monthlyQualification: {
    minDirectEffectiveBuyers: number;
    minDirectMonthlyGmv: number;
    minNewEffectiveBuyers: number;
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

export type ProfitSafetyScenarioKey =
  | 'VIP_BUYER_VIP_INVITER'
  | 'VIP_BUYER_NORMAL_INVITER'
  | 'NORMAL_BUYER_VIP_INVITER'
  | 'NORMAL_BUYER_NORMAL_INVITER';

export interface ProfitSafetyLimitingSku {
  skuId: string;
  productId: string;
  productTitle?: string | null;
  skuTitle?: string | null;
  scenarioKey: ProfitSafetyScenarioKey;
  price: number;
  cost: number | null;
  automaticPrice: number | null;
  grossMarginRate: number;
  platformRetainedRevenueRate: number;
  platformRequiredRevenueRate: number;
  shortfall: number;
  reason: string;
}

export interface ProfitSafetyScenario {
  key: ProfitSafetyScenarioKey;
  buyerPath: 'VIP' | 'NORMAL';
  inviterPath: 'VIP' | 'NORMAL';
  treeProfitRate: number;
  industryFundProfitRate: number;
  directReferralProfitRate: number;
  captainProfitRate: number;
  externalProfitRate: number;
  platformRequiredRevenueRate: number;
  limitingSkuId: string | null;
  limitingGrossMarginRate: number;
  platformRetainedRevenueRate: number;
  shortfall: number;
  safe: boolean;
}

export interface ProfitSafetySummary {
  safe: boolean;
  scenarios: ProfitSafetyScenario[];
  limitingSkus: ProfitSafetyLimitingSku[];
  shortfall: number;
  evaluatedSkuCount: number;
  platformRequiredRevenueRate: number;
  captainMaximumProfitRate: number;
  captainConfiguredCap: number;
  captainConfigState: 'DISABLED' | 'ENABLED' | 'INVALID';
  errors: string[];
  profitSafetyConfigCompleteness?: {
    complete: boolean;
    requiredKeys: string[];
    presentKeys: string[];
    missingKeys: string[];
  };
  ruleConfigCompleteness?: {
    complete: boolean;
    requiredKeys: string[];
    presentKeys: string[];
    missingKeys: string[];
  };
}

export interface CaptainQueryParams extends PaginationParams {
  keyword?: string;
  status?: string;
  month?: string;
  userId?: string;
  captainUserId?: string;
  buyerUserId?: string;
  orderId?: string;
  settlementId?: string;
  type?: string;
}

// ========== 数字资产 ==========

export type DigitalAssetSubjectType =
  | 'CUMULATIVE_SPEND'
  | 'SEED_ASSET'
  | 'CREDIT_ASSET';

export type DigitalAssetLedgerType =
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

export type DigitalAssetLedgerDirection = 'CREDIT' | 'DEBIT';
export type DigitalAssetSourceType = DigitalAssetLedgerType;

export interface DigitalAssetOverview {
  accountCount: number;
  totalAssetBalance: number;
  totalSeedAssetBalance: number;
  totalCreditAssetBalance: number;
  totalFrozenCreditAssetBalance: number;
  totalCumulativeSpendAmount: number;
  todayCumulativeSpendCreditAmount: number;
  todayCumulativeSpendDebitAmount: number;
  todaySeedAssetCreditAmount: number;
  todaySeedAssetDebitAmount: number;
  todayCreditAssetCreditAmount: number;
  todayFrozenCreditAssetCreditAmount: number;
  todayCreditAssetDebitAmount: number;
  todayAssetCreditAmount: number;
  todayAssetDebitAmount: number;
}

export type DigitalAssetAccountSortField =
  | 'totalAssetBalance'
  | 'seedAssetBalance'
  | 'creditAssetBalance'
  | 'frozenCreditAssetBalance'
  | 'cumulativeSpendAmount'
  | 'updatedAt';

export interface DigitalAssetAccountQueryParams extends PaginationParams {
  keyword?: string;
  minAmount?: number;
  maxAmount?: number;
  startDate?: string;
  endDate?: string;
  sortField?: DigitalAssetAccountSortField;
  sortOrder?: 'ascend' | 'descend';
}

export interface DigitalAssetLedgerQueryParams extends PaginationParams {
  type?: DigitalAssetLedgerType;
}

export interface DigitalAssetAccountRow {
  id: string;
  userId: string;
  assetRank: number | null;
  totalAssetBalance: number;
  seedAssetBalance: number;
  creditAssetBalance: number;
  frozenCreditAssetBalance: number;
  cumulativeSpendAmount: number;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    buyerNo: string | null;
    nickname: string | null;
    avatarUrl: string | null;
    phone: string | null;
    status: string | null;
    vipStatus: 'NORMAL' | 'VIP';
  };
}

export interface DigitalAssetModuleInfo {
  key: 'assetValue' | 'level' | 'benefits' | 'futureRights';
  title: string;
  enabled?: boolean;
  status?: 'COMING_SOON';
  description: string;
}

export interface DigitalAssetAccountDetail {
  user: {
    id: string;
    buyerNo: string | null;
    nickname: string | null;
    avatarUrl: string | null;
    phone: string | null;
    status: string;
    vipStatus: 'NORMAL' | 'VIP';
  };
  account: {
    id: string | null;
    totalAssetBalance: number;
    seedAssetBalance: number;
    creditAssetBalance: number;
    frozenCreditAssetBalance: number;
    cumulativeSpendAmount: number;
    updatedAt: string | null;
  };
  modules: DigitalAssetModuleInfo[];
}

export interface DigitalAssetCreditTier {
  minAmount: number;
  maxAmount: number | null;
  multiplier: number;
}

export interface DigitalAssetLedger {
  id: string;
  type: DigitalAssetLedgerType;
  sourceType: DigitalAssetSourceType;
  subjectType: DigitalAssetSubjectType;
  direction: DigitalAssetLedgerDirection;
  amount: number;
  assetAmount: number | null;
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

export interface DigitalAssetAdjustPayload {
  direction: DigitalAssetLedgerDirection;
  subjectType: Extract<DigitalAssetSubjectType, 'SEED_ASSET' | 'CREDIT_ASSET'>;
  amount: number;
  reason: string;
  clientIdempotencyKey?: string;
}

export interface DigitalAssetSettings {
  modules: DigitalAssetModuleInfo[];
}

export interface DigitalAssetRules {
  tiers: DigitalAssetCreditTier[];
  modules: DigitalAssetModuleInfo[];
}

// ========== 积分成长体系 ==========

export interface AdminGrowthDashboard {
  accountCount: number;
  normalAccountCount?: number;
  vipAccountCount?: number;
  totalPointsBalance: number;
  totalPointsEarned: number;
  totalPointsSpent: number;
  totalGrowthValue: number;
  todayPointsDelta: number;
  todayGrowthDelta: number;
  exchangeSuccessCount: number;
  pendingShareRewardCount: number;
  activeRuleCount: number;
  activeExchangeItemCount: number;
}

export interface AdminGrowthUserSummary {
  id: string;
  buyerNo: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  phone: string | null;
  status?: string | null;
  vipStatus?: 'NORMAL' | 'VIP' | null;
  normalShareCode?: string | null;
  normalShareStatus?: string | null;
  vipReferralCode?: string | null;
}

export interface AdminGrowthLevel {
  id?: string;
  code: string;
  name: string;
  threshold: number;
  benefits?: Record<string, unknown> | null;
  avatarFrameType?: string | null;
  titleLabel?: string | null;
  monthlyExchangeLimit?: number | null;
  sortOrder?: number;
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminGrowthRule {
  id?: string;
  code: string;
  name: string;
  categoryCode: string;
  pointsReward?: number;
  growthReward?: number;
  grantTiming?: string;
  dailyLimit?: number | null;
  weeklyLimit?: number | null;
  monthlyLimit?: number | null;
  lifetimeLimit?: number | null;
  applicableUserType?: 'ALL' | 'NORMAL' | 'VIP';
  vipPointsMultiplier?: number | null;
  vipGrowthMultiplier?: number | null;
  riskPolicy?: Record<string, unknown> | null;
  startAt?: string | null;
  endAt?: string | null;
  enabled?: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminGrowthAccountQueryParams extends PaginationParams {
  keyword?: string;
  levelCode?: string;
  userType?: 'ALL' | 'NORMAL' | 'VIP';
  sortBy?: 'pointsBalance' | 'pointsTotalEarned' | 'pointsTotalSpent' | 'growthValue' | 'updatedAt';
  sortOrder?: 'ascend' | 'descend' | 'asc' | 'desc';
}

export interface AdminGrowthAccountRow {
  id: string;
  userId: string;
  pointsBalance: number;
  pointsTotalEarned: number;
  pointsTotalSpent: number;
  growthValue: number;
  currentLevelCode: string | null;
  currentLevel?: AdminGrowthLevel | null;
  createdAt: string;
  updatedAt: string;
  user: AdminGrowthUserSummary;
  directReferralInviterUserId?: string | null;
  directReferralStatus?: string | null;
  directReferralSource?: string | null;
  directReferralInvalidAt?: string | null;
  directReferralInvalidReason?: string | null;
  directReferralInviter?: AdminGrowthUserSummary | null;
}

export interface AdminGrowthSettings {
  growthEnabled: boolean;
  pointsExpireDays: number;
  pointsExpireRemindDays: number;
  dailyPointsCap: number;
  monthlyPointsCap: number;
  dailyShareRewardUserCap: number;
  monthlyInviteFirstOrderCap: number;
  refundReversalEnabled: boolean;
  autoSuspendExchangeRisk: boolean;
  autoVipBySpendEnabled: boolean;
  autoVipCumulativeSpendThreshold: number;
}

export interface AdminGrowthLedgerQueryParams extends PaginationParams {
  userId?: string;
  behaviorCode?: string;
  type?: string;
  sortBy?: 'createdAt' | 'pointsDelta' | 'growthDelta';
  sortOrder?: 'ascend' | 'descend' | 'asc' | 'desc';
}

export interface AdminGrowthLedger {
  id: string;
  userId: string;
  accountId: string;
  type: string;
  behaviorCode: string | null;
  pointsDelta: number;
  growthDelta: number;
  status: string;
  idempotencyKey: string;
  refType: string | null;
  refId: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
  user?: AdminGrowthUserSummary | null;
  autoVipTreeInviter?: AdminGrowthUserSummary | null;
}

export interface AdminGrowthExchangeItem {
  id: string;
  type: 'COUPON' | 'SHIPPING_COUPON' | 'LOTTERY_CHANCE' | 'VIP_DISCOUNT_COUPON' | 'DECORATION';
  name: string;
  description: string | null;
  pointsCost: number;
  couponCampaignId: string | null;
  couponCampaign?: { id: string; name: string; status: string; triggerType: string } | null;
  stockTotal: number | null;
  stockDaily: number | null;
  issuedTotal: number;
  issuedToday: number;
  issuedTodayDate: string | null;
  perUserDailyLimit: number | null;
  perUserMonthlyLimit: number | null;
  requiredLevelCode: string | null;
  requiredLevel?: AdminGrowthLevel | null;
  startAt: string | null;
  endAt: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SOLD_OUT';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminGrowthExchangeItemPayload {
  type: AdminGrowthExchangeItem['type'];
  name: string;
  description?: string | null;
  pointsCost: number;
  couponCampaignId?: string | null;
  stockTotal?: number | null;
  stockDaily?: number | null;
  perUserDailyLimit?: number | null;
  perUserMonthlyLimit?: number | null;
  requiredLevelCode?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  status?: AdminGrowthExchangeItem['status'];
  sortOrder?: number;
}

export interface AdminGrowthAdjustPayload {
  pointsDelta?: number;
  growthDelta?: number;
  reason: string;
}

export interface AdminNormalShareBindingQueryParams extends PaginationParams {
  keyword?: string;
  rewardStatus?: string;
  sortField?: 'boundAt' | 'rewardIssuedAt' | 'updatedAt';
  sortOrder?: 'ascend' | 'descend' | 'asc' | 'desc';
}

export interface AdminNormalShareBinding {
  id: string;
  inviterUserId: string;
  inviteeUserId: string;
  code: string;
  source: string;
  boundAt: string;
  firstOrderId: string | null;
  rewardStatus: string;
  rewardIssuedAt: string | null;
  relationStatus?: string | null;
  relationInvalidAt?: string | null;
  relationInvalidReason?: string | null;
  effectiveInviterUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  inviter: AdminGrowthUserSummary | null;
  invitee: AdminGrowthUserSummary | null;
  effectiveInviter?: AdminGrowthUserSummary | null;
}

// ========== 商品 ==========

export type ProductStatus = 'ACTIVE' | 'INACTIVE';
export type ProductAuditStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ProductType = 'SIMPLE' | 'BUNDLE';

export interface ProductMedia {
  id: string;
  url: string;
  type: string;
  sortOrder: number;
}

export interface ProductSKU {
  id: string;
  title: string;
  price: number;
  stock: number;
  weightGram: number;
  attrs: Record<string, unknown> | null;
  cost?: number | null;
  status?: string;
  skuCode?: string | null;
  maxPerOrder?: number | null;
}

export interface ProductBundleItem {
  skuId: string;
  quantity: number;
  sortOrder?: number;
  productTitle?: string;
  skuTitle?: string;
  imageUrl?: string | null;
  price?: number | null;
  stock?: number | null;
  weightGram?: number | null;
  sku?: {
    id?: string;
    title?: string | null;
    price?: number | null;
    stock?: number | null;
    weightGram?: number | null;
    product?: {
      id?: string;
      title?: string | null;
    } | null;
  } | null;
}

export interface Product {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  basePrice: number;
  type: ProductType;
  bundleItems?: ProductBundleItem[];
  bundleReferenceTotal?: number | null;
  bundleAvailableStock?: number | null;
  bundleTotalWeightGram?: number | null;
  categoryId: string | null;
  category?: { id: string; name: string; returnPolicy?: string } | null;
  origin: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
  aiKeywords: string[];
  unit?: string | null;
  status: ProductStatus;
  auditStatus: ProductAuditStatus;
  auditNote: string | null;
  submissionCount?: number;
  companyId: string;
  company?: { id: string; name: string; status?: CompanyStatus };
  images: { url: string }[];
  media?: ProductMedia[];
  skus?: ProductSKU[];
  createdAt: string;
  updatedAt: string;
}

// ========== 团购分享回馈 ==========

export type GroupBuyActivityStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
export type GroupBuyInstanceStatus =
  | 'QUALIFICATION_PENDING'
  | 'SHARING'
  | 'COMPLETED'
  | 'TERMINATED'
  | 'QUALIFICATION_ABANDONED'
  | 'QUALIFICATION_INVALID'
  | 'EXPIRED';
export type GroupBuyCodeStatus = 'PENDING' | 'ACTIVE' | 'DISABLED' | 'COMPLETED' | 'EXPIRED';
export type GroupBuyReferralStatus = 'CANDIDATE' | 'VALID' | 'INVALID' | 'VOIDED';
export type GroupBuyRebateLedgerType =
  | 'PENDING_REBATE'
  | 'RELEASE'
  | 'VOID'
  | 'WITHDRAW'
  | 'DEDUCT'
  | 'REFUND_RETURN'
  | 'ADMIN_ADJUST';
export type GroupBuyRebateLedgerStatus =
  | 'PENDING'
  | 'AVAILABLE'
  | 'RESERVED'
  | 'COMPLETED'
  | 'VOIDED'
  | 'FAILED';

export interface AdminGroupBuyUserSummary {
  id: string;
  buyerNo: string | null;
  profile?: {
    nickname: string | null;
    avatarUrl?: string | null;
  } | null;
}

export interface AdminGroupBuyTier {
  id: string;
  activityId: string;
  sequence: number;
  basisPoints: number;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminGroupBuyProductSnapshot {
  id: string;
  title: string;
  status: ProductStatus | string;
  companyId: string;
  media?: ProductMedia[];
}

export interface AdminGroupBuySkuSnapshot {
  id: string;
  title: string;
  status: string;
  price: number;
  stock: number;
  weightGram: number | null;
}

export interface AdminGroupBuyActivityItem {
  id?: string;
  activityId?: string;
  productId: string;
  skuId: string;
  quantity: number;
  sortOrder: number;
  product?: AdminGroupBuyProductSnapshot | null;
  sku?: AdminGroupBuySkuSnapshot | null;
}

export interface AdminGroupBuyActivity {
  id: string;
  title: string;
  description: string | null;
  productId: string;
  skuId: string;
  price: number;
  freeShipping: boolean;
  status: GroupBuyActivityStatus;
  startAt: string | null;
  endAt: string | null;
  displayOrder: number;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  product?: AdminGroupBuyProductSnapshot | null;
  sku?: AdminGroupBuySkuSnapshot | null;
  items?: AdminGroupBuyActivityItem[];
  tiers: AdminGroupBuyTier[];
  _count?: {
    instances: number;
  };
}

export interface GroupBuyActivityQueryParams extends PaginationParams {
  keyword?: string;
  status?: GroupBuyActivityStatus;
}

export interface AdminGroupBuyCodeSummary {
  code: string;
  status: GroupBuyCodeStatus;
  activatedAt?: string | null;
  disabledAt?: string | null;
  completedAt?: string | null;
}

export interface AdminGroupBuyOrderSummary {
  id: string;
  status: OrderStatus | string;
  totalAmount: number;
  goodsAmount?: number;
  receivedAt?: string | null;
  returnWindowExpiresAt?: string | null;
  createdAt?: string;
}

export interface AdminGroupBuyInstance {
  id: string;
  userId: string;
  activityId: string;
  initiatorOrderId: string;
  status: GroupBuyInstanceStatus;
  priceSnapshot: number;
  shippingFeeSnapshot: number;
  freeShippingSnapshot: boolean;
  tierSnapshot?: Array<{ sequence?: number; basisPoints?: number; label?: string | null }> | null;
  validReferralCount: number;
  candidateCount: number;
  activatedAt: string | null;
  completedAt: string | null;
  terminatedAt: string | null;
  abandonedAt: string | null;
  expiredAt: string | null;
  invalidatedAt: string | null;
  invalidReason: string | null;
  createdAt: string;
  updatedAt: string;
  user?: AdminGroupBuyUserSummary;
  activity?: Pick<AdminGroupBuyActivity, 'id' | 'title' | 'price' | 'status'>;
  code?: AdminGroupBuyCodeSummary | null;
  initiatorOrder?: AdminGroupBuyOrderSummary;
  referrals?: AdminGroupBuyReferral[];
  rebateLedgers?: AdminGroupBuyRebateLedger[];
  _count?: {
    referrals: number;
    rebateLedgers: number;
  };
}

export interface AdminGroupBuyReferral {
  id: string;
  instanceId: string;
  codeId: string | null;
  status: GroupBuyReferralStatus;
  referredUserId: string;
  referredOrderId: string;
  referredInstanceId: string | null;
  candidateSequence: number | null;
  effectiveSequence: number | null;
  amountSnapshot: number | null;
  invalidReason: string | null;
  validAt: string | null;
  invalidatedAt: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  referredUser?: AdminGroupBuyUserSummary;
  referredOrder?: AdminGroupBuyOrderSummary;
  referredInstance?: Pick<AdminGroupBuyInstance, 'id' | 'status' | 'validReferralCount' | 'candidateCount'> | null;
}

export interface GroupBuyInstanceQueryParams extends PaginationParams {
  keyword?: string;
  status?: GroupBuyInstanceStatus;
  activityId?: string;
  userId?: string;
}

export interface AdminGroupBuyOrder {
  id: string;
  userId: string;
  status: OrderStatus | string;
  bizType: 'GROUP_BUY';
  totalAmount: number;
  goodsAmount: number;
  shippingFee: number;
  discountAmount: number;
  paidAt: string | null;
  receivedAt: string | null;
  returnWindowExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  user?: AdminGroupBuyUserSummary;
  groupBuyInitiatedInstance?: Pick<AdminGroupBuyInstance, 'id' | 'status' | 'validReferralCount' | 'candidateCount'> & {
    activity?: Pick<AdminGroupBuyActivity, 'id' | 'title' | 'price'>;
    code?: Pick<AdminGroupBuyCodeSummary, 'code' | 'status'> | null;
  };
  groupBuyReferredPurchase?: Pick<
    AdminGroupBuyReferral,
    'id' | 'status' | 'candidateSequence' | 'effectiveSequence' | 'amountSnapshot'
  > & {
    instance?: Pick<AdminGroupBuyInstance, 'id' | 'status'> & {
      user?: AdminGroupBuyUserSummary;
      activity?: Pick<AdminGroupBuyActivity, 'id' | 'title' | 'price'>;
      code?: Pick<AdminGroupBuyCodeSummary, 'code' | 'status'> | null;
    };
  } | null;
}

export interface GroupBuyOrderQueryParams extends PaginationParams {
  keyword?: string;
  status?: OrderStatus;
  activityId?: string;
  userId?: string;
}

export interface AdminGroupBuyRebateLedger {
  id: string;
  userId: string;
  instanceId: string | null;
  referralId: string | null;
  orderId: string | null;
  type: GroupBuyRebateLedgerType;
  status: GroupBuyRebateLedgerStatus;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  refType: string | null;
  refId: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  user?: AdminGroupBuyUserSummary;
  instance?: Pick<AdminGroupBuyInstance, 'id' | 'status'> & {
    activity?: Pick<AdminGroupBuyActivity, 'id' | 'title' | 'price'>;
    code?: Pick<AdminGroupBuyCodeSummary, 'code' | 'status'> | null;
  } | null;
  referral?: Pick<AdminGroupBuyReferral, 'id' | 'status' | 'candidateSequence' | 'effectiveSequence' | 'referredOrderId'> & {
    referredUser?: AdminGroupBuyUserSummary;
  } | null;
  order?: AdminGroupBuyOrderSummary | null;
}

export interface GroupBuyRebateLedgerQueryParams extends PaginationParams {
  keyword?: string;
  type?: GroupBuyRebateLedgerType;
  status?: GroupBuyRebateLedgerStatus;
  userId?: string;
  instanceId?: string;
}

export interface GroupBuySettings {
  maxMonthlyLaunches: number;
}

export interface UpdateGroupBuySettingsInput {
  maxMonthlyLaunches: number;
}

export interface GroupBuyTierInput {
  sequence: number;
  basisPoints: number;
  label?: string | null;
}

export interface GroupBuyActivityItemInput {
  productId: string;
  skuId: string;
  quantity: number;
  sortOrder?: number;
}

export interface CreateGroupBuyActivityInput {
  title: string;
  description?: string | null;
  productId?: string;
  skuId?: string;
  items?: GroupBuyActivityItemInput[];
  price: number;
  freeShipping?: boolean;
  status?: GroupBuyActivityStatus;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  displayOrder?: number;
  tiers: GroupBuyTierInput[];
}

export interface UpdateGroupBuyActivityInput {
  title?: string;
  description?: string | null;
  productId?: string;
  skuId?: string;
  items?: GroupBuyActivityItemInput[];
  price?: number;
  freeShipping?: boolean;
  status?: GroupBuyActivityStatus;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  displayOrder?: number;
  tiers?: GroupBuyTierInput[];
}

export interface GroupBuyCatalogSku {
  id: string;
  title: string;
  price: number;
  stock: number;
  weightGram: number;
  status: string;
}

export interface GroupBuyCatalogProduct {
  id: string;
  title: string;
  type: ProductType | string;
  basePrice: number;
  unit: string;
  media?: Array<{ id?: string; url: string; sortOrder?: number }>;
  skus: GroupBuyCatalogSku[];
  bundleItems?: Array<{
    id: string;
    quantity: number;
    sortOrder: number;
    sku: GroupBuyCatalogSku & {
      product?: {
        id: string;
        title: string;
        media?: Array<{ url: string; sortOrder?: number }>;
      };
    };
  }>;
}

// ========== 订单 ==========

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'RECEIVED'
  | 'CANCELED'
  | 'REFUNDED';

export interface OrderItem {
  id: string;
  productId: string;
  productTitle: string;
  productImage?: string | null;
  skuName: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface Order {
  id: string;
  orderNo: string;
  userId: string;
  user?: { id?: string; buyerNo?: string | null; phone: string; phoneMasked?: string | null; nickname: string | null };
  company?: { id: string; name: string } | null;
  status: OrderStatus;
  totalAmount: number;
  paymentAmount: number;
  discountAmount?: number;
  shippingFee?: number;
  paymentMethod?: string;
  paidAt?: string;
  transactionId?: string;
  remark?: string;
  items: OrderItem[];
  itemsSummary?: string;
  itemCount?: number;
  address: Record<string, unknown> | null;
  receiverInfoEditable?: boolean;
  shipment?: {
    id?: string;
    companyId?: string;
    carrierCode?: string;
    carrierName?: string;
    waybillNo?: string;
    waybillNoMasked?: string;
    trackingNo?: string;
    trackingNoMasked?: string;
    sfOrderId?: string | null;
    status?: string;
    shippedAt?: string | null;
  } | null;
  shipments?: Array<{
    id: string;
    companyId?: string;
    carrierCode?: string;
    carrierName?: string;
    waybillNo?: string;
    waybillNoMasked?: string;
    trackingNo?: string;
    trackingNoMasked?: string;
    sfOrderId?: string | null;
    status?: string;
    shippedAt?: string | null;
  }>;
  refundSummary?: Refund | null;
  refunds?: Refund[];
  bizType?: string;
  buyerNote?: string | null;
  totalCouponDiscount?: number | null;
  vipDiscountAmount?: number | null;
  goodsAmount?: number;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  receivedAt?: string | null;
  autoReceiveAt?: string | null;
  returnWindowExpiresAt?: string | null;
  statusHistory?: Array<{
    id: string;
    fromStatus: string;
    toStatus: string;
    reason?: string | null;
    meta?: Record<string, unknown> | null;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface OrderQueryParams extends PaginationParams {
  status?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
  companyId?: string;
  paymentChannel?: string;
  userId?: string;
}

export type OrderStatsMap = Record<string, number>;

// ========== 企业 ==========

// I28修复：添加 'ACTIVE' 状态，与 companyStatusMap 对齐
export type CompanyStatus = 'PENDING' | 'ACTIVE' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface CompanyDocument {
  id: string;
  type: string;
  title: string;
  fileUrl: string;
  issuer: string | null;
  verifyStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  verifyNote: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface Company {
  id: string;
  name: string;
  shortName: string | null;
  status: CompanyStatus;
  description: string | null;
  logo: string | null;
  servicePhone: string | null;
  serviceWeChat: string | null;
  address: Record<string, unknown> | null;
  contactName: string | null;
  contactPhone: string | null;
  contact?: Record<string, string>;
  documents?: CompanyDocument[];
  profile?: { highlights?: Record<string, string> } | null;
  _count?: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

// ========== 企业员工 ==========

export type CompanyStaffRole = 'OWNER' | 'MANAGER' | 'OPERATOR';
export type CompanyStaffStatus = 'ACTIVE' | 'DISABLED';

export interface CompanyStaff {
  id: string;
  userId: string;
  companyId: string;
  role: CompanyStaffRole;
  status: CompanyStaffStatus;
  joinedAt: string;
  user?: {
    id: string;
    profile?: { nickname: string | null; avatarUrl: string | null } | null;
    authIdentities?: { identifier: string }[];
  };
}

// ========== AI 搜索资料 ==========

export interface AiSearchProfile {
  companyType: string | null;
}

export const COMPANY_TYPE_OPTIONS = [
  { value: 'farm', label: '农场' },
  { value: 'company', label: '公司' },
  { value: 'cooperative', label: '合作社' },
  { value: 'base', label: '基地' },
  { value: 'factory', label: '工厂' },
  { value: 'store', label: '店铺' },
];

// ========== 退款 ==========

export type RefundStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REFUNDING' | 'REFUNDED' | 'FAILED';

/** 退款状态变更历史记录 */
export interface RefundStatusHistoryItem {
  fromStatus: string | null;
  toStatus: string;
  remark: string | null;
  operatorId: string | null;
  createdAt: string;
}

export interface Refund {
  id: string;
  orderId: string;
  amount: number;
  status: RefundStatus;
  reason: string;
  merchantRefundNo?: string;
  providerRefundId?: string | null;
  createdAt: string;
  updatedAt: string;
  order?: Order;
  buyer?: { nickname: string | null; phone: string | null };
  company?: { id: string; name: string } | null;
  /** 支付渠道（从关联订单的支付记录提取） */
  paymentChannel?: string | null;
  /** 退款状态变更历史（含卖家处理记录） */
  statusHistory?: RefundStatusHistoryItem[];
}

// ========== 会员 / 奖励 ==========

export interface BonusMember {
  id: string;
  userId: string;
  buyerNo?: string | null;
  user?: { id: string; buyerNo?: string | null; profile?: { nickname: string | null } | null };
  tier: 'NORMAL' | 'VIP';
  referralCode: string | null;
  inviterUserId: string | null;
  /** 邀请人昵称（findMembers 接口拼接） */
  inviterNickname: string | null;
  /** 该会员邀请的 VIP 人数 */
  inviteeVipCount: number;
  vipPurchasedAt: string | null;
  vipNodeId: string | null;
  normalEligible: boolean;
  /** 手机号（明文，仅 admin 后台可见） */
  phone: string | null;
  /** 微信 openId（手机号缺失时兜底标识，多用于纯微信登录用户） */
  wechatOpenId: string | null;
  /** 微信 unionId（跨应用统一，可能为空） */
  wechatUnionId: string | null;
  /** VIP 奖励账户钱包 */
  wallet: { balance: number; frozen: number };
  /** VIP 三叉树位置 */
  treeRootId: string | null;
  treeLevel: number | null;
  treePosition: number | null;
  /** VIP 自购次数（决定解锁第几层下级分润） */
  selfPurchaseCount: number;
  /** 当前已解锁的下级层级（上限 15） */
  unlockedLevel: number;
  /** VIP 礼包购买快照 */
  vipPurchase: {
    amount: number;
    packageId: string | null;
    status: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

/** 会员详情（getMemberDetail 返回） */
export interface BonusMemberDetail {
  userId: string;
  buyerNo?: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  phone: string | null;
  tier: 'NORMAL' | 'VIP';
  referralCode: string | null;
  inviterUserId: string | null;
  vipPurchasedAt: string | null;
  wallet: {
    balance: number;
    frozen: number;
    totalEarned: number;
  };
  tree: {
    level: number;
    position: number;
    parentUserId: string | null;
    childCount: number;
    selfPurchaseCount: number;
    unlockedLevel: number;
    exitedAt: string | null;
  } | null;
  ledgers: {
    id: string;
    entryType: string;
    amount: number;
    status: string;
    refType: string | null;
    refId: string | null;
    createdAt: string;
    account: { type: string } | null;
  }[];
  withdrawals: {
    id: string;
    amount: number;
    status: string;
    channel: string;
    createdAt: string;
    reviewerAdminId: string | null;
  }[];
}

/** 奖励统计 Dashboard */
export interface BonusStats {
  totalDistributed: number;
  totalWithdrawn: number;
  vipCount: number;
  pendingWithdrawals: number;
  dailyTrend: { date: string; amount: number }[];
  totalMembers: number;
  vipRate: number;
}

export type WithdrawStatus = 'REQUESTED' | 'PROCESSING' | 'APPROVED' | 'REJECTED' | 'PAID' | 'FAILED';

export type WithdrawChannel = 'WECHAT' | 'ALIPAY' | 'BANKCARD';

export interface WithdrawRequest {
  id: string;
  userId: string;
  user?: { id: string; buyerNo?: string | null; profile?: { nickname: string | null } | null };
  amount: number;
  taxAmount?: number | null;
  netAmount?: number | null;
  taxRate?: number | null;
  outBizNo?: string | null;
  providerPayoutId?: string | null;
  providerFundOrderId?: string | null;
  providerStatus?: string | null;
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
  paidAt?: string | null;
  status: WithdrawStatus;
  channel: WithdrawChannel | string;
  /** 后端字段名为 accountSnapshot，包含脱敏账户信息 { name, account } */
  accountSnapshot: { name?: string; account?: string; [key: string]: unknown } | null;
  /** @deprecated 旧字段名，兼容保留 */
  accountInfo?: Record<string, unknown> | null;
  /** 账户类型：VIP_REWARD 或 NORMAL_REWARD */
  accountType: string;
  /** 拒绝原因 */
  rejectReason?: string | null;
  reviewerAdminId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ========== VIP 树可视化 ==========

export type VipNodeStatus = 'active' | 'silent' | 'frozen' | 'exited';

export interface VipTreeNodeView {
  userId: string;
  buyerNo?: string | null;
  nickname: string | null;
  phone: string | null;
  tier: 'NORMAL' | 'VIP';
  selfPurchaseCount: number;
  totalEarned: number;
  frozenAmount: number;
  childCount: number;
  level: number;
  status: VipNodeStatus;
  isSystemNode: boolean;
  children?: VipTreeNodeView[];

  // Phase 4: 通用扩展字段
  joinedTreeAt?: string | null;
  position?: number;
  unlockedLevel?: number;

  // Phase 4: VIP 特有字段
  referrerUserId?: string | null;
  referrerBuyerNo?: string | null;
  referrerNickname?: string | null;
  entryMode?: 'REFERRAL' | 'AUTO_PLACE' | 'SYSTEM';
  exitedAt?: string | null;
  rootId?: string;

  // Phase 4: 普通树特有字段
  balance?: number;
  frozenAt?: string | null;
  normalRewardEligible?: boolean;
  upgradedToVipAt?: string | null;
  stoppedReason?: 'UPGRADED_VIP' | 'FROZEN' | null;
}

export interface VipTreeContextResponse {
  breadcrumb: Array<{ userId: string | null; buyerNo?: string | null; nickname: string | null; level: number }>;
  parent: VipTreeNodeView | null;
  current: VipTreeNodeView;
  children: VipTreeNodeView[];
  /** 节点总数超出上限时为 true */
  truncated?: boolean;
}

// ========== 树根节点统计 ==========

/** VIP 树根节点统计 */
export interface VipRootStat {
  rootId: string;
  rootNodeId: string;
  totalNodes: number;
  activeNodes: number;
  activeRate: number;
  weeklyNew: number;
}

/** 普通树根节点统计 */
export interface NormalRootStat {
  rootId: string;
  totalNodes: number;
  activeNodes: number;
  activeRate: number;
  weeklyNew: number;
}

// ========== 树奖励记录 ==========

export interface TreeRewardRecord {
  id: string;
  entryType: string;
  amount: number;
  status: string;
  refType: string | null;
  refId: string | null;
  sourceUserId: string | null;
  sourceBuyerNo?: string | null;
  sourceNickname: string | null;
  layer: number | null;
  createdAt: string;
}

export interface TreeRelatedOrder {
  orderId: string;
  sourceUserId: string | null;
  sourceBuyerNo?: string | null;
  sourceNickname: string | null;
  totalReward: number;
  entryCount: number;
  latestStatus: string;
  latestEntryType: string;
  latestLayer: number | null;
  latestCreatedAt: string;
}

// ========== 奖励路径解释 ==========

export interface PathExplainNode {
  userId: string;
  buyerNo?: string | null;
  nickname: string | null;
  level: number;
  isSource: boolean;
  isTarget: boolean;
}

export interface PathExplainResponse {
  /** 消费用户 */
  sourceUserId: string | null;
  sourceBuyerNo?: string | null;
  sourceNickname: string | null;
  /** 第 k 次有效消费 */
  consumptionIndex: number | null;
  /** 奖励金额 */
  rewardAmount: number;
  /** 奖励状态 */
  rewardStatus: string;
  /** 奖励入账类型 */
  entryType: string;
  /** 接收者 */
  recipientUserId: string;
  recipientBuyerNo?: string | null;
  recipientNickname: string | null;
  /** 路径节点（从消费者到接收者） */
  path: PathExplainNode[];
  /** 命中结果说明 */
  hitResult: string;
}

// ========== 普通奖励滑动窗口 ==========

export interface BroadcastBucketInfo {
  bucketKey: string;
  totalOrders: number;
  totalAmount: number;
  totalReward: number;
}

export interface BroadcastWindowOrder {
  orderId: string;
  userId: string;
  buyerNo?: string | null;
  nickname: string | null;
  amount: number;
  rewardDistributed: number;
  createdAt: string;
}

export interface BroadcastWindowResponse {
  bucketInfo: BroadcastBucketInfo;
  windowOrders: BroadcastWindowOrder[];
  pagination: { total: number; page: number; pageSize: number };
}

export interface BroadcastDistribution {
  recipientId: string;
  recipientBuyerNo?: string | null;
  recipientName: string | null;
  amount: number;
  orderIndex: number;
  createdAt: string;
}

export interface BroadcastDistributionResponse {
  order: { id: string; amount: number; buyerNo?: string | null; buyerName: string | null };
  distributions: BroadcastDistribution[];
}

// ========== 溯源 ==========

export interface TraceBatch {
  id: string;
  companyId: string;
  company?: { id: string; name: string };
  batchCode: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ========== 系统配置 ==========

export interface RuleConfig {
  key: string;
  value: { value: unknown; description?: string } | unknown;
  updatedAt: string;
}

/** 配置值提取 — RuleConfig.value 可能是 { value, description } 或裸值 */
export function extractConfigValue(config: RuleConfig): unknown {
  const v = config.value;
  return v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : v;
}

export function extractConfigDescription(config: RuleConfig): string | null {
  const v = config.value;
  if (!v || typeof v !== 'object' || !('description' in v)) return null;
  const description = (v as { description?: unknown }).description;
  return typeof description === 'string' ? description : null;
}

export interface ConfigVersion {
  id: string;
  version: string;
  snapshot: Record<string, unknown>;
  changeNote: string | null;
  createdByAdminId: string | null;
  createdByAdmin?: { id: string; username: string; realName?: string };
  rollbackAllowed: boolean;
  rollbackBlockedReason: string | null;
  createdAt: string;
}
