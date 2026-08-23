export type CaptainProfileStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';
export type CaptainApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

export type CaptainProfile = {
  id: string;
  userId: string;
  captainCode: string;
  displayName: string | null;
  status: CaptainProfileStatus;
};

export type CaptainAccount = {
  userId: string;
  balance: number;
  frozen: number;
  withdrawn: number;
  clawback: number;
};

export type CaptainMonthlyMetric = {
  month: string;
  personalGmv: number;
  directEffectiveBuyers: number;
  newEffectiveMembers: number;
  refundRate: number;
  qualified: boolean;
  qualifiedTier: string | null;
};

export type CaptainRelation = {
  id: string;
  buyerUserId: string;
  directCaptainUserId: string;
  codeUsed: string;
  status?: string;
  boundAt?: string;
};

export type CaptainMyProfile = {
  isCaptain: boolean;
  profile: CaptainProfile | null;
  account: CaptainAccount | null;
  metric: CaptainMonthlyMetric | null;
  boundRelation: CaptainRelation | null;
};

export type CaptainLanding = {
  code: string;
  valid: boolean;
  enabled: boolean;
  programName: string;
  captain: {
    userId: string;
    captainCode?: string;
    displayName?: string | null;
    buyerNo?: string | null;
    nickname?: string | null;
    avatarUrl?: string | null;
  } | null;
  reason?: string;
};

export type CaptainApplication = {
  id: string;
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
  reviewedAt?: string | null;
  rejectReason?: string | null;
  createdAt: string;
};

export type CaptainMyApplication = {
  isCaptain: boolean;
  profile: CaptainProfile | null;
  application: CaptainApplication | null;
  canSubmit: boolean;
};

export type SubmitCaptainApplication = {
  realName: string;
  contact: string;
  city: string;
  communityScale: string;
  expectedMonthlyGmv: string;
  resourceTypes: string[];
  promotionPlan: string;
  seafoodExperience: string;
  complianceAccepted: boolean;
};

export type CaptainLedger = {
  id: string;
  type: string;
  status: string;
  amount: number;
  createdAt: string;
};

export type CaptainOrder = {
  id: string;
  orderId: string;
  commissionBase: number;
  profitBaseAmount?: number | null;
  refundAmount: number;
  status: string;
  createdAt: string;
  order?: { id: string; status: string; totalAmount: number; createdAt: string };
  buyer?: { id: string; buyerNo: string | null; profile?: { nickname: string | null } | null };
};

export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };

export type Author = {
  id: string;
  name: string;
  avatar?: string;
  type: 'user' | 'company';
  verified?: boolean;
  title?: string;
  tags?: string[];
  companyId?: string;
  isFollowed?: boolean;
  followerCount?: number;
  city?: string;
  interestTags?: string[];
};

export type FollowListItem = { author: Author; followedAt: string };

export type ScanTarget =
  | { kind: 'referral'; code: string; inviteKind: 'normal' | 'vip'; url: string }
  | { kind: 'group-buy'; code: string; url: string }
  | { kind: 'captain'; code: string; url: string };
