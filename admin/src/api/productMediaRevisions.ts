import client from './client';

export type ProductMediaRevisionQueueItem = {
  id: string;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'EXPIRED';
  expectedMediaVersion: number;
  attestation: { quantityConfirmed?: boolean; labelsConfirmed?: boolean; factsConfirmed?: boolean };
  createdAt: string;
  product: { id: string; title: string; mediaVersion: number };
  company: { id: string; name: string };
};

export type ProductMediaRevisionDetail = {
  revision: Pick<ProductMediaRevisionQueueItem, 'id' | 'status' | 'expectedMediaVersion' | 'attestation' | 'createdAt'> & { reviewNote?: string | null };
  product: {
    id: string;
    title: string;
    status: string;
    auditStatus: string;
    mediaVersion: number;
    media: Array<{ id: string; url: string; sortOrder: number }>;
  };
  company: { id: string; name: string };
  proposedMedia: Array<{ assetId: string; sortOrder: number; width: number; height: number; displayUrl: string; expiresAt: string | null }>;
};

export const getPendingProductMediaRevisions = (): Promise<ProductMediaRevisionQueueItem[]> =>
  client.get('/admin/product-media-revisions');

export const getProductMediaRevision = (id: string): Promise<ProductMediaRevisionDetail> =>
  client.get(`/admin/product-media-revisions/${id}`);

export const approveProductMediaRevision = (id: string): Promise<unknown> =>
  client.post(`/admin/product-media-revisions/${id}/approve`);

export const rejectProductMediaRevision = (id: string, reviewNote: string): Promise<unknown> =>
  client.post(`/admin/product-media-revisions/${id}/reject`, { reviewNote });
