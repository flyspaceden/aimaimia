import client from './client';

export type ProductVisualRiskProfile =
  | 'STRICT_FACTS'
  | 'CONSERVATIVE_FACTS'
  | 'STANDARD_FACTS'
  | 'ORGANIC_FACTS'
  | 'MARKETING_ONLY'
  | 'RETAKE_REQUIRED';

export type ProductVisualMode =
  | 'PRESERVE_REAL_SCENE'
  | 'CATALOG_STUDIO'
  | 'PRODUCT_RETOUCH'
  | 'MARKETING_SCENE';

export type ProductVisualPlan = {
  id: string;
  productId: string | null;
  sourceAssetId: string;
  sourceHash: string;
  riskProfile: ProductVisualRiskProfile;
  recommendedMode: ProductVisualMode | null;
  allowedModes: ProductVisualMode[];
  allowedOperations: string[];
  sceneAnalysis?: {
    reasons?: string[];
    sceneAssessment?: string;
    advisoryCodes?: string[];
  } | null;
  expiresAt: string;
};

export type ProductImageFactScan = {
  id: string;
  status: 'SCANNING' | 'FACTS_DETECTED' | 'VERIFIED_EMPTY' | 'INCONCLUSIVE' | 'RECONCILING' | 'FAILED' | 'EXPIRED';
  productId: string | null;
  sourceAssetId: string;
  textDetected: boolean;
  qrCodesDetected: number;
  barcodeStatus: 'NONE' | 'DETECTED' | 'INCONCLUSIVE' | 'NOT_IMPLEMENTED' | string;
  emptyTextQrVerified: boolean;
  freeTuneEligible: boolean;
  failureCode?: string | null;
  completedAt?: string | null;
  createdAt: string;
};

export type ProductVisualRateCard = {
  code: string;
  displayName: string;
  description: string;
  outputSpec: Record<string, unknown>;
  candidateCount: number;
  creditCost: number;
  requiresHumanReview: boolean;
};

export type ProductVisualCreditAccount = {
  availableCredits: number;
  reservedCredits: number;
  exists?: boolean;
};

export type ProductVisualQuote = {
  id: string;
  status: 'ISSUED' | 'RESERVED' | 'RECONCILING' | 'SETTLED' | 'RELEASED' | 'EXPIRED' | 'CANCELLED';
  externalObjectId: string;
  sourceAssetRef: string;
  creditCost: number;
  candidateCount: number;
  rateCardSnapshot: {
    displayName?: string;
    description?: string;
    candidateCount?: number;
    creditCost?: number;
    requiresHumanReview?: boolean;
  };
  quoteHash: string;
  expiresAt: string;
  failureReason?: string | null;
};

export type ProductVisualQuoteStatus = {
  quoteId?: string;
  invocationId?: string | null;
  providerTaskId?: string;
  optimizationId?: string;
  status: 'QUEUED' | 'RUNNING' | 'VERIFYING' | 'PENDING_REVIEW' | 'SUCCEEDED' | 'RECONCILING' | 'RELEASED' | 'ALREADY_BOUND';
  candidate?: { candidateAssetId: string | null };
};

export const requestProductVisualPlan = (productId: string, data: {
  sourceAssetId: string;
  requestedMode?: ProductVisualMode;
}): Promise<ProductVisualPlan> => client.post(`/seller/products/${productId}/visual-enhancements/plan`, data);

export const requestProductImageFactScan = (sourceAssetId: string, data: {
  productId: string;
  idempotencyKey: string;
}): Promise<ProductImageFactScan> => client.post(`/seller/media-assets/${sourceAssetId}/fact-scan`, data);

export const getProductImageFactScan = (scanId: string): Promise<ProductImageFactScan> =>
  client.get(`/seller/media-assets/fact-scans/${scanId}`);

export const getProductVisualCreditAccount = (productId: string): Promise<ProductVisualCreditAccount> =>
  client.get(`/seller/products/${productId}/visual-credit-account`);

export const listProductVisualRateCards = (productId: string, params: {
  sourceAssetId: string;
  planId: string;
  direction: ProductVisualMode;
}): Promise<ProductVisualRateCard[]> =>
  client.get(`/seller/products/${productId}/visual-rate-cards`, { params });

export const issueProductVisualQuote = (productId: string, data: {
  sourceAssetId: string;
  planId: string;
  direction: ProductVisualMode;
  rateCode: string;
  idempotencyKey: string;
}): Promise<{ quote: ProductVisualQuote; account: ProductVisualCreditAccount }> =>
  client.post(`/seller/products/${productId}/visual-quotes`, data);

export const confirmProductVisualQuote = (productId: string, quoteId: string, quoteHash: string): Promise<{
  confirmed: unknown;
  execution: ProductVisualQuoteStatus;
}> => client.post(`/seller/products/${productId}/visual-quotes/${quoteId}/confirm`, { quoteHash });

export const pollProductVisualQuote = (productId: string, quoteId: string): Promise<ProductVisualQuoteStatus> =>
  client.post(`/seller/products/${productId}/visual-quotes/${quoteId}/poll`);

export const getProductVisualQuote = (productId: string, quoteId: string): Promise<{
  quote: ProductVisualQuote;
  billingAccount: ProductVisualCreditAccount;
}> => client.get(`/seller/products/${productId}/visual-quotes/${quoteId}`);
