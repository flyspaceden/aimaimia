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
  task: { id: string; status: string; productId: string; createdAt: string };
  product: { id: string; title: string };
  company: { id: string; name: string };
  source: { assetId: string; displayUrl: string; expiresAt: string };
  candidate: { assetId: string; displayUrl: string; expiresAt: string; isAigc: true };
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
