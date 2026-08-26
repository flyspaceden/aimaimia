import client from './client';

export type ProductImageOptimizationTask = {
  id: string;
  status: 'REQUESTED' | 'QUEUED' | 'RUNNING' | 'RECONCILING' | 'SUCCEEDED' | 'FAILED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED' | 'ADOPTED';
  kind: 'WHITE_BACKGROUND' | 'FREE_TUNE';
  productId?: string | null;
  failureCode?: string | null;
  failureDetail?: string | null;
  pendingReview?: {
    id: string;
    status: 'PENDING_REVIEW';
    productId: string;
    createdAt: string;
  } | null;
  candidate?: {
    assetId: string;
    displayUrl?: string | null;
    expiresAt?: string | null;
    integrityProof?: { verified?: boolean; protectedPixelCount?: number } | null;
  } | null;
};

export const requestWhiteBackground = (data: {
  sourceAssetId: string;
  productId: string;
  idempotencyKey: string;
}): Promise<ProductImageOptimizationTask> => client.post('/seller/product-image-optimizations', {
  ...data,
  intent: 'WHITE_BACKGROUND',
});

export const requestFreeTune = (data: {
  sourceAssetId: string;
  productId: string;
  planId: string;
  idempotencyKey: string;
}): Promise<ProductImageOptimizationTask> => client.post('/seller/product-image-optimizations', {
  ...data,
  intent: 'FREE_TUNE',
});

export const getProductImageOptimization = (id: string): Promise<ProductImageOptimizationTask> =>
  client.get(`/seller/product-image-optimizations/${id}`);

export const adoptProductImageOptimization = (id: string, data: {
  productId: string;
  quantityConfirmed: boolean;
  labelsConfirmed: boolean;
  factsConfirmed: boolean;
}): Promise<{ mode: 'PENDING_REVIEW' | 'APPLIED_TO_UNPUBLISHED_PRODUCT'; revisionId?: string; taskId?: string }> =>
  client.post(`/seller/product-image-optimizations/${id}/adopt`, data);
