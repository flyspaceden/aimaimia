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
export type GroupBuyDefaultTab = 'CURRENT' | 'PRODUCTS';
export type GroupBuyPaymentChannel = 'wechat' | 'alipay' | 'bankcard';

export interface GroupBuyTier {
  sequence: number;
  label: string;
}

export interface GroupBuyProductSnapshot {
  id: string;
  title: string;
  imageUrl: string | null;
}

export interface GroupBuySkuSnapshot {
  id: string;
  title: string;
  stock: number;
  weightGram: number | null;
}

export interface GroupBuyActivity {
  id: string;
  title: string;
  description: string | null;
  price: number;
  freeShipping: boolean;
  shippingSummary: string;
  product: GroupBuyProductSnapshot;
  sku: GroupBuySkuSnapshot;
  tiers: GroupBuyTier[];
}

export interface GroupBuyActivityPage {
  items: GroupBuyActivity[];
}

export interface GroupBuyReferralProgress {
  id: string;
  status: GroupBuyReferralStatus;
  candidateSequence: number | null;
  effectiveSequence: number | null;
}

export interface GroupBuyCurrentInstance {
  id: string;
  status: GroupBuyInstanceStatus;
  validReferralCount: number;
  candidateCount: number;
  code: {
    code: string;
    status: GroupBuyCodeStatus;
  } | null;
  activity: GroupBuyActivity;
  referrals: GroupBuyReferralProgress[];
}

export interface GroupBuyCurrentState {
  current: GroupBuyCurrentInstance | null;
  occupiesSlot: boolean;
  defaultTab: GroupBuyDefaultTab;
  canBuyNew: boolean;
}

export interface GroupBuyCheckoutInput {
  activityId: string;
  addressId: string;
  paymentChannel?: GroupBuyPaymentChannel;
  expectedTotal?: number;
  shareCode?: string;
  idempotencyKey?: string;
}

export interface GroupBuyPaymentParams {
  channel?: GroupBuyPaymentChannel;
  orderStr?: string;
  [key: string]: unknown;
}

export interface GroupBuyCheckoutResponse {
  sessionId: string;
  merchantOrderNo: string;
  expectedTotal: number;
  goodsAmount: number;
  shippingFee: number;
  discountAmount: number;
  paymentParams: GroupBuyPaymentParams;
}

export interface GroupBuyLandingInfo {
  code: string;
  valid: boolean;
  activity: GroupBuyActivity | null;
  inviter: {
    userId: string;
    nickname: string | null;
    buyerNo?: string | null;
  } | null;
  reason?: string;
}

export interface GroupBuyRebateAccount {
  balance: number;
  reserved: number;
  withdrawn: number;
  deducted: number;
  available: number;
  total: number;
}

export type GroupBuyLedgerType =
  | 'PENDING_REBATE'
  | 'RELEASE'
  | 'VOID'
  | 'WITHDRAW'
  | 'DEDUCT'
  | 'REFUND_RETURN'
  | 'ADMIN_ADJUST';

export type GroupBuyLedgerStatus =
  | 'PENDING'
  | 'AVAILABLE'
  | 'RESERVED'
  | 'COMPLETED'
  | 'VOIDED'
  | 'FAILED';

export interface GroupBuyLedger {
  id: string;
  type: GroupBuyLedgerType;
  status: GroupBuyLedgerStatus;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  instanceId?: string | null;
  referralId?: string | null;
  orderId?: string | null;
  refType?: string | null;
  refId?: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
}

export interface GroupBuyLedgerPage {
  items: GroupBuyLedger[];
  total: number;
  page: number;
  pageSize: number;
  nextPage?: number;
}

export interface GroupBuyWithdrawRecord {
  id: string;
  amount: number;
  netAmount: number;
  taxAmount: number;
  channel: string;
  status: string;
  createdAt: string;
}

export interface GroupBuyWithdrawPage {
  items: GroupBuyWithdrawRecord[];
  total: number;
  page: number;
  pageSize: number;
  nextPage?: number;
}
