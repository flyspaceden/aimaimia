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
