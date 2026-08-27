import client from './client';

export type VisualWelcomePolicy = {
  tenantId: string;
  enabled: boolean;
  grantCredits: number;
  creditValueCents: number;
  policyVersion: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

export type VisualRateCard = {
  id: string;
  code: string;
  displayName: string;
  description: string;
  modelProfile: string;
  outputSpec: Record<string, unknown>;
  allowedDirections: string[];
  allowedRiskProfiles: string[];
  candidateRole: string;
  requiresHumanReview: boolean;
  candidateCount: number;
  creditCost: number;
  status: 'ACTIVE' | 'PAUSED' | 'RETIRED';
  version: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

export type VisualRateCardInput = Omit<VisualRateCard, 'id' | 'effectiveFrom' | 'effectiveUntil'> & {
  clientId: string;
  adapterNamespace: string;
};

export type VisualCreditAccount = {
  id?: string;
  billingOwnerType: string;
  billingOwnerId: string;
  availableCredits: number;
  reservedCredits: number;
  exists?: boolean;
};

export type VisualCreditLedger = {
  id: string;
  type: 'WELCOME_GRANT' | 'PURCHASE' | 'RESERVE' | 'SETTLE' | 'RELEASE' | 'EXPIRE' | 'ADMIN_ADJUST' | 'REVERSAL';
  availableDelta: number;
  reservedDelta: number;
  availableBalanceAfter: number;
  reservedBalanceAfter: number;
  reason: string;
  createdAt: string;
};

export type PaidVisualCandidateQueueItem = {
  id: string;
  status: 'PENDING_REVIEW';
  createdAt: string;
  provider: string | null;
  modelVersion: string | null;
  costTier: 'PAID';
  product: { id: string; title: string };
  company: { id: string; name: string };
};

export type PaidVisualCandidateDetail = {
  task: {
    id: string;
    status: string;
    productId: string;
    createdAt: string;
    verification?: {
      state?: string;
      local?: { geometry?: { verdict?: string }; qr?: { verdict?: string }; barcode?: { verdict?: string } };
      ocr?: { state?: string; verdict?: string; normalizedTextMatch?: boolean | null };
    } | null;
  };
  product: { id: string; title: string };
  company: { id: string; name: string };
  source: { assetId: string; displayUrl: string; expiresAt: string };
  candidate: { assetId: string; displayUrl: string; expiresAt: string; isAigc: true };
};

export type VisualBudgetPolicy = {
  id: string;
  scope: 'PLATFORM' | 'PROVIDER' | 'TENANT' | 'CLIENT' | 'EXTERNAL_OBJECT' | 'ACTOR';
  scopeKey: string;
  provider: 'BAILIAN_WAN' | 'BAILIAN_QWEN_IMAGE';
  model: 'wan2.7-image' | 'wan2.7-image-pro' | 'qwen-image-3.0' | 'qwen-image-3.0-pro';
  visualMode: 'PRESERVE_REAL_SCENE' | 'CATALOG_STUDIO' | 'PRODUCT_RETOUCH';
  reserveCents: number;
  perTaskCapCents: number;
  dailyCapCents: number;
  weeklyCapCents: number;
  timezone: 'Asia/Shanghai';
  policyVersion: string;
  enabled: boolean;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

export type VisualReconciliation = {
  id: string;
  tenantId: string;
  ownerClientId: string;
  adapterNamespace: string;
  externalObjectId: string;
  actorId: string;
  provider: string;
  model: string;
  visualMode: string;
  providerTaskId: string | null;
  providerRequestId: string | null;
  reservedCostCents: number;
  actualCostCents: number | null;
  reconciliationReason: string | null;
  createdAt: string;
  updatedAt: string;
  creditQuote: { id: string; status: string; creditCost: number } | null;
};

const tenantBase = (tenantId: string) => `/admin/visual-agent/tenants/${encodeURIComponent(tenantId)}`;
const accountBase = (tenantId: string, ownerType: string, ownerId: string) => `${tenantBase(tenantId)}/credit-accounts/${encodeURIComponent(ownerType)}/${encodeURIComponent(ownerId)}`;

export const getVisualWelcomePolicy = (tenantId: string): Promise<VisualWelcomePolicy | null> =>
  client.get(`${tenantBase(tenantId)}/welcome-credit-policy`);

export const saveVisualWelcomePolicy = (tenantId: string, data: Omit<VisualWelcomePolicy, 'tenantId' | 'effectiveFrom' | 'effectiveUntil'>): Promise<VisualWelcomePolicy> =>
  client.put(`${tenantBase(tenantId)}/welcome-credit-policy`, data);

export const listVisualRateCards = (tenantId: string, clientId: string, adapterNamespace: string): Promise<VisualRateCard[]> =>
  client.get(`${tenantBase(tenantId)}/rate-cards`, { params: { clientId, adapterNamespace } });

export const saveVisualRateCard = (tenantId: string, data: VisualRateCardInput): Promise<VisualRateCard> =>
  client.post(`${tenantBase(tenantId)}/rate-cards`, data);

export const getVisualCreditAccount = (tenantId: string, ownerType: string, ownerId: string): Promise<VisualCreditAccount> =>
  client.get(accountBase(tenantId, ownerType, ownerId));

export const getVisualCreditLedger = (tenantId: string, ownerType: string, ownerId: string): Promise<VisualCreditLedger[]> =>
  client.get(`${accountBase(tenantId, ownerType, ownerId)}/ledger`, { params: { take: 100 } });

export const grantVisualWelcomeCredits = (tenantId: string, ownerType: string, ownerId: string): Promise<VisualCreditAccount> =>
  client.post(`${accountBase(tenantId, ownerType, ownerId)}/grant-welcome`);

export const adjustVisualCredits = (tenantId: string, ownerType: string, ownerId: string, data: { availableDelta: number; reason: string; idempotencyKey: string }): Promise<VisualCreditAccount> =>
  client.post(`${accountBase(tenantId, ownerType, ownerId)}/adjust`, data);

export const getPendingPaidVisualCandidates = (): Promise<PaidVisualCandidateQueueItem[]> =>
  client.get('/admin/product-paid-visual-candidates');

export const getPaidVisualCandidate = (id: string): Promise<PaidVisualCandidateDetail> =>
  client.get(`/admin/product-paid-visual-candidates/${id}`);

export const approvePaidVisualCandidateFacts = (id: string): Promise<{ approved: true }> =>
  client.post(`/admin/product-paid-visual-candidates/${id}/approve-facts`);

export const rejectPaidVisualCandidateFacts = (id: string, reason: string): Promise<{ rejected: true }> =>
  client.post(`/admin/product-paid-visual-candidates/${id}/reject-facts`, { reason });

export const listVisualBudgetPolicies = (): Promise<VisualBudgetPolicy[]> =>
  client.get('/admin/visual-agent/budget-policies');

export const saveVisualBudgetPolicy = (data: Omit<VisualBudgetPolicy, 'id' | 'timezone' | 'effectiveFrom' | 'effectiveUntil'>): Promise<VisualBudgetPolicy> =>
  client.post('/admin/visual-agent/budget-policies', data);

export const listVisualReconciliations = (): Promise<VisualReconciliation[]> =>
  client.get('/admin/visual-agent/reconciliations', { params: { take: 100 } });

export const resolveVisualReconciliation = (id: string, data: { decision: 'RELEASED' | 'BILLING_EXCEPTION'; creditDecision: 'RELEASE' | 'SETTLE'; evidenceRef: string }): Promise<{ resolved: true }> =>
  client.post(`/admin/visual-agent/reconciliations/${id}/resolve`, data);
