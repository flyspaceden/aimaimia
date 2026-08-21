import type {
  CheckoutFulfillmentSummary,
  FulfillmentInput,
  FulfillmentMode,
  MiniProgramPaymentParams,
} from '@/types';

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

export type GroupBuyTier = { sequence: number; label: string };

export type GroupBuyActivityItem = {
  productId: string;
  productTitle: string;
  imageUrl: string | null;
  skuId: string;
  skuTitle: string;
  stock: number;
  weightGram: number | null;
  quantity: number;
};

export type GroupBuyActivity = {
  id: string;
  companyId: string;
  status: GroupBuyActivityStatus;
  startAt: string | null;
  endAt: string | null;
  title: string;
  description: string | null;
  price: number;
  freeShipping: boolean;
  shippingSummary: string;
  product: { id: string; title: string; imageUrl: string | null };
  sku: { id: string; title: string; stock: number; weightGram: number | null };
  items?: GroupBuyActivityItem[];
  itemSummary?: string;
  availableStock?: number;
  totalWeightGram?: number;
  tiers: GroupBuyTier[];
};

export type GroupBuyActivityPage = { items: GroupBuyActivity[] };

export type GroupBuyCurrentInstance = {
  id: string;
  status: GroupBuyInstanceStatus;
  validReferralCount: number;
  candidateCount: number;
  code: { code: string; status: GroupBuyCodeStatus } | null;
  activity: GroupBuyActivity;
  referrals: Array<{
    id: string;
    status: GroupBuyReferralStatus;
    candidateSequence: number | null;
    effectiveSequence: number | null;
  }>;
};

export type GroupBuyCurrentState = {
  current: GroupBuyCurrentInstance | null;
  occupiesSlot: boolean;
  defaultTab: 'CURRENT' | 'PRODUCTS';
  canBuyNew: boolean;
};

export type GroupBuyLanding = {
  code: string;
  valid: boolean;
  activity: GroupBuyActivity | null;
  inviter: { userId: string; nickname: string | null; buyerNo?: string | null } | null;
  reason?: string;
};

export type GroupBuyCheckoutInput = {
  activityId: string;
  addressId?: string;
  fulfillment?: FulfillmentInput;
  expectedTotal: number;
  shareCode?: string;
  idempotencyKey?: string;
};

export type GroupBuyCheckoutPreview = {
  expectedTotal: number;
  goodsAmount: number;
  shippingFee: number;
  discountAmount: number;
  fulfillmentMode?: FulfillmentMode;
  fulfillment?: CheckoutFulfillmentSummary;
};

export type GroupBuyCheckoutSession = GroupBuyCheckoutPreview & {
  sessionId: string;
  merchantOrderNo: string;
  paymentScene: 'MINI_PROGRAM';
  paymentParams: MiniProgramPaymentParams;
};

export type GroupBuyRebateAccount = {
  balance: number;
  reserved: number;
  withdrawn: number;
  deducted: number;
  available: number;
  total: number;
};

export type GroupBuyLedgerType =
  | 'PENDING_REBATE'
  | 'RELEASE'
  | 'VOID'
  | 'WITHDRAW'
  | 'DEDUCT'
  | 'REFUND_RETURN'
  | 'ADMIN_ADJUST';
export type GroupBuyLedgerStatus = 'PENDING' | 'AVAILABLE' | 'RESERVED' | 'COMPLETED' | 'VOIDED' | 'FAILED';

export type GroupBuyLedger = {
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
};

export type GroupBuyLedgerPage = {
  items: GroupBuyLedger[];
  total: number;
  page: number;
  pageSize: number;
  nextPage?: number;
};
