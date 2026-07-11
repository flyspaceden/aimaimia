import type { PaginationResult } from '../Pagination';

export type CaptainProfileStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';
export type CaptainApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export type CaptainCalculationModel = 'PROFIT_V3' | 'SALES_V2';
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

export interface CaptainUserSummary {
  userId: string;
  captainCode?: string;
  displayName?: string | null;
  buyerNo?: string | null;
  nickname?: string | null;
  avatarUrl?: string | null;
}

export interface CaptainLandingInfo {
  code: string;
  valid: boolean;
  enabled: boolean;
  programName: string;
  captain: CaptainUserSummary | null;
  reason?: string;
}

export interface CaptainBindResult {
  success: boolean;
  relation: CaptainRelation;
}

export interface CaptainRelation {
  id: string;
  buyerUserId: string;
  directCaptainUserId: string;
  codeUsed: string;
  status?: string;
  boundAt?: string;
  directCaptain?: {
    id: string;
    buyerNo: string | null;
    profile?: {
      nickname: string | null;
      avatarUrl?: string | null;
    } | null;
  };
}

export interface CaptainProfile {
  id: string;
  userId: string;
  captainCode: string;
  displayName: string | null;
  status: CaptainProfileStatus;
  createdAt?: string;
  user?: {
    id: string;
    buyerNo: string | null;
    profile?: {
      nickname: string | null;
      avatarUrl?: string | null;
    } | null;
  };
}

export interface CaptainAccount {
  userId: string;
  balance: number;
  frozen: number;
  withdrawn: number;
  clawback: number;
}

export interface CaptainMonthlyMetric {
  captainUserId: string;
  month: string;
  personalGmv: number;
  directEffectiveBuyers: number;
  newEffectiveMembers: number;
  refundRate: number;
  qualified: boolean;
  qualifiedTier: string | null;
}

export interface CaptainMyProfile {
  isCaptain: boolean;
  profile: CaptainProfile | null;
  account: CaptainAccount | null;
  metric: CaptainMonthlyMetric | null;
  boundRelation: CaptainRelation | null;
}

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
  systemSnapshot?: CaptainApplicationSnapshot | null;
  reviewedAt?: string | null;
  rejectReason?: string | null;
  captainProfileUserId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CaptainMyApplication {
  isCaptain: boolean;
  profile: CaptainProfile | null;
  application: CaptainApplication | null;
  canSubmit: boolean;
}

export interface SubmitCaptainApplicationInput {
  realName: string;
  contact: string;
  city: string;
  communityScale: string;
  expectedMonthlyGmv: string;
  resourceTypes: string[];
  promotionPlan: string;
  seafoodExperience: string;
  complianceAccepted: boolean;
}

export interface CaptainLedger {
  id: string;
  type: CaptainLedgerType;
  status: CaptainLedgerStatus;
  amount: number;
  commissionBase?: number | null;
  rate?: number | null;
  orderId?: string | null;
  settlementId?: string | null;
  refType?: string | null;
  refId?: string | null;
  createdAt: string;
  orderAttribution?: {
    id: string;
    orderId: string;
    buyerUserId: string;
    status: string;
    calculationModel: CaptainCalculationModel;
    profitBaseAmount?: number | null;
  } | null;
  settlement?: {
    id: string;
    month: string;
    status: string;
    meta?: {
      calculationModel?: string;
      [key: string]: unknown;
    } | null;
  } | null;
}

export interface CaptainOrderProgress {
  id: string;
  orderId: string;
  buyerUserId: string;
  directCaptainUserId: string;
  commissionBase: number;
  calculationModel: CaptainCalculationModel;
  profitBaseAmount?: number | null;
  eligibleGoodsAmount?: number;
  refundAmount: number;
  directRate: number;
  status: string;
  createdAt: string;
  order?: {
    id: string;
    status: string;
    totalAmount: number;
    createdAt: string;
  };
  buyer?: {
    id: string;
    buyerNo: string | null;
    profile?: {
      nickname: string | null;
      avatarUrl?: string | null;
    } | null;
  };
}

export type CaptainLedgerPage = PaginationResult<CaptainLedger>;
export type CaptainOrderPage = PaginationResult<CaptainOrderProgress>;
