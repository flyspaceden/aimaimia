import client from './client';

export type FundType =
  | 'LEGACY_INDUSTRY_FUND'
  | 'INDUSTRY_FUND'
  | 'CHARITY_FUND'
  | 'TECH_FUND'
  | 'RESERVE_FUND'
  | 'PLATFORM_PROFIT'
  | 'FUND_POOL'
  | 'POINTS';

export type LedgerSourceType = 'NORMAL' | 'VIP' | 'LEGACY' | string;
export type LedgerEventType =
  | 'ACCRUAL'
  | 'FREEZE'
  | 'RELEASE'
  | 'REVERSAL'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'RESERVE'
  | 'UNRESERVE'
  | 'PAYMENT'
  | 'PAYMENT_REVERSAL'
  | 'RECOVERY'
  | string;

export interface FundLedgerQuery {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  sourceType?: string;
  orderId?: string;
  companyId?: string;
  eventType?: string;
}

export interface FundSummaryRow {
  fundType: FundType;
  initialBalance?: number;
  periodIncome?: number;
  periodExpense?: number;
  currentBalance?: number;
  lastEntryAt?: string | null;
  companyPayable?: number;
  frozen?: number;
  available?: number;
  reserved?: number;
  paid?: number;
  recoverable?: number;
  sourceBreakdown?: Record<string, number>;
}

export interface FundSummaryResponse {
  from?: string | null;
  to?: string | null;
  funds: FundSummaryRow[];
  industry?: {
    accrued?: number;
    companyPayable?: number;
    frozen?: number;
    available?: number;
    reserved?: number;
    paid?: number;
    recoverable?: number;
    unassigned?: number;
  } | null;
  unassigned?: { amount: number; count: number } | null;
}

export interface FundLedgerEntry {
  id: string;
  entryNo?: string | null;
  fundType?: FundType;
  eventType: LedgerEventType;
  direction?: 'CREDIT' | 'DEBIT' | 'INTERNAL' | string;
  amount: number;
  occurredAt?: string | null;
  createdAt: string;
  balanceAfter?: number | null;
  availableAfter?: number | null;
  frozenAfter?: number | null;
  reservedAfter?: number | null;
  sourceType?: LedgerSourceType | null;
  orderId?: string | null;
  allocationId?: string | null;
  accrualId?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  paymentId?: string | null;
  reversalOfId?: string | null;
  relatedEntryId?: string | null;
  ruleVersion?: string | null;
  profitBase?: number | null;
  allocationRatio?: number | null;
  reason?: string | null;
  snapshot?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  operator?: { id?: string; username?: string; realName?: string | null } | null;
  source?: Record<string, unknown> | null;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  nextCursor?: string | null;
  asOf?: string | null;
}

export interface IndustryFundCompany {
  id: string;
  companyNo?: string | null;
  name: string;
  status?: string | null;
  bankAccountName?: string | null;
  bankAccountNoMasked?: string | null;
  bankName?: string | null;
  frozen?: number;
  available?: number;
  reserved?: number;
  paid?: number;
  accrued?: number;
  reversed?: number;
  recoverable?: number;
  lastEntryAt?: string | null;
  updatedAt?: string | null;
  balances?: {
    frozen?: number;
    available?: number;
    reserved?: number;
    paid?: number;
    accrued?: number;
    reversed?: number;
    recoverable?: number;
  };
}

export interface IndustryFundCompanyDetail extends IndustryFundCompany {
  company?: Record<string, unknown>;
  account?: Record<string, unknown>;
  ledgers?: PageResult<FundLedgerEntry>;
}

export interface IndustryFundCompanyQuery extends FundLedgerQuery {
  status?: string;
  search?: string;
}

export interface IndustryFundUnassignedEntry {
  originalAmount?: number;
  reversedAmount?: number;
  events?: Array<{ id: string; createdAt: string; reversedBefore: number; reversedAfter: number }>;
  id: string;
  amount: number;
  orderId?: string | null;
  reason?: string | null;
  occurredAt?: string | null;
  createdAt: string;
  companyId?: string | null;
  assignedAt?: string | null;
}

export interface IndustryFundPaymentItem {
  id?: string;
  accrualId: string;
  amount: number;
  orderId?: string | null;
  sourceAmount?: number | null;
  remainingAmount?: number | null;
}

export type IndustryFundPaymentStatus =
  | 'RESERVED'
  | 'PAID'
  | 'CANCELLED'
  | 'REVERSED'
  | 'PAYMENT_RESERVED'
  | 'PAYMENT_UNRESERVED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_REVERSED'
  | 'REVERSAL_PENDING'
  | string;

export interface IndustryFundPayment {
  id: string;
  paymentNo?: string | null;
  companyId: string;
  company?: IndustryFundCompany | { id?: string; name?: string } | null;
  amount: number;
  reservedAmount?: number | null;
  actualAmount?: number | null;
  payeeName?: string | null;
  bankAccount?: string | null;
  bankName?: string | null;
  status: IndustryFundPaymentStatus;
  needsReview?: boolean;
  reviewReason?: string | null;
  paidAt?: string | null;
  sourceAccountRef?: string | null;
  bankReference?: string | null;
  proofKey?: string | null;
  reason?: string | null;
  items?: IndustryFundPaymentItem[];
  recoveries?: IndustryFundRecovery[];
  reversalReason?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  operator?: { id?: string; username?: string; realName?: string | null } | null;
}

export interface IndustryFundRecovery {
  id: string;
  paymentId?: string | null;
  companyId?: string | null;
  amount: number;
  recoveredAt?: string | null;
  bankReference?: string | null;
  proofKey?: string | null;
  reason?: string | null;
  createdAt: string;
  operator?: { id?: string; username?: string; realName?: string | null } | null;
}

export interface IndustryFundPaymentQuery extends FundLedgerQuery {
  status?: IndustryFundPaymentStatus;
  search?: string;
}

export interface CreateIndustryFundPaymentInput {
  companyId: string;
  amount: number;
  payeeName: string;
  bankAccount: string;
  bankName: string;
  reason: string;
  idempotencyKey: string;
}

export interface ConfirmIndustryFundPaymentInput {
  actualAmount: number;
  paidAt: string;
  sourceAccountRef: string;
  bankReference: string;
  proofKey: string;
  confirmActualPayment?: boolean;
  reviewReason?: string;
  idempotencyKey: string;
}

export interface CancelIndustryFundPaymentInput {
  reason: string;
  idempotencyKey: string;
}

export interface ReverseIndustryFundPaymentInput {
  reason: string;
  idempotencyKey: string;
}

export interface RecoveryInput {
  amount: number;
  recoveredAt: string;
  bankReference: string;
  proofKey: string;
  reason: string;
  idempotencyKey: string;
}

export const getFundSummary = (params?: Pick<FundLedgerQuery, 'from' | 'to'>): Promise<FundSummaryResponse> =>
  client.get('/admin/fund-ledgers/summary', { params });

export const getFundLedgerEntries = (
  fundType: FundType,
  params?: FundLedgerQuery,
): Promise<PageResult<FundLedgerEntry>> =>
  client.get(`/admin/fund-ledgers/${fundType}/entries`, { params });

export const getFundLedgerEntry = (
  fundType: FundType,
  entryId: string,
): Promise<FundLedgerEntry> =>
  client.get(`/admin/fund-ledgers/${fundType}/entries/${entryId}`);

export const getIndustryFundSummary = (): Promise<FundSummaryResponse> =>
  client.get('/admin/industry-funds/summary');

export const getIndustryFundCompanies = (
  params?: IndustryFundCompanyQuery,
): Promise<PageResult<IndustryFundCompany>> =>
  client.get('/admin/industry-funds/companies', { params });

export const getIndustryFundCompany = (
  companyId: string,
): Promise<IndustryFundCompanyDetail> =>
  client.get(`/admin/industry-funds/companies/${companyId}`);

export const getIndustryFundCompanyLedgers = (
  companyId: string,
  params?: FundLedgerQuery,
): Promise<PageResult<FundLedgerEntry>> =>
  client.get(`/admin/industry-funds/companies/${companyId}/ledgers`, { params });

export const getIndustryFundUnassigned = (
  params?: FundLedgerQuery,
): Promise<PageResult<IndustryFundUnassignedEntry>> =>
  client.get('/admin/industry-funds/unassigned', { params });

export const getIndustryFundPayments = (
  params?: IndustryFundPaymentQuery,
): Promise<PageResult<IndustryFundPayment>> =>
  client.get('/admin/industry-funds/payments', { params });

export const getIndustryFundPayment = (paymentId: string): Promise<IndustryFundPayment> =>
  client.get(`/admin/industry-funds/payments/${paymentId}`);

export const createIndustryFundPayment = (
  input: CreateIndustryFundPaymentInput,
): Promise<IndustryFundPayment> =>
  client.post('/admin/industry-funds/payments', input);

export const confirmIndustryFundPayment = (
  paymentId: string,
  input: ConfirmIndustryFundPaymentInput,
): Promise<IndustryFundPayment> =>
  client.post(`/admin/industry-funds/payments/${paymentId}/confirm`, input);

export const cancelIndustryFundPayment = (
  paymentId: string,
  input: CancelIndustryFundPaymentInput,
): Promise<IndustryFundPayment> =>
  client.post(`/admin/industry-funds/payments/${paymentId}/cancel`, input);

export const reverseIndustryFundPayment = (
  paymentId: string,
  input: ReverseIndustryFundPaymentInput,
): Promise<IndustryFundPayment> =>
  client.post(`/admin/industry-funds/payments/${paymentId}/reverse`, input);

export const createIndustryFundRecovery = (
  paymentId: string,
  input: RecoveryInput,
): Promise<IndustryFundRecovery> =>
  client.post(`/admin/industry-funds/payments/${paymentId}/recoveries`, input);

export const uploadIndustryFundProof = (file: File): Promise<{ id: string }> => {
  const formData = new FormData();
  formData.append('file', file);
  return client.post('/admin/industry-funds/proofs', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const downloadIndustryFundProof = (proofKey: string): Promise<Blob> =>
  client.get(`/admin/industry-funds/proofs/${encodeURIComponent(proofKey)}`, {
    responseType: 'blob',
  });
