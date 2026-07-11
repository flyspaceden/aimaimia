import client from './client';

export type AnnouncementAudienceType = 'ALL' | 'VIP' | 'NORMAL' | 'BUYER_NOS';
export type AnnouncementCategory = 'system' | 'transaction' | 'interaction';
export type AnnouncementType = 'platform_announcement' | 'platform_notice';
export type AnnouncementPriority = 'NORMAL' | 'IMPORTANT';
export type AnnouncementTargetRouteKey = 'PRODUCT_DETAIL';

export interface AnnouncementTarget {
  routeKey?: AnnouncementTargetRouteKey;
  route?: string;
  params?: Record<string, string>;
  label?: string;
}

export interface AnnouncementTargetProduct {
  id: string;
  title: string;
  basePrice: number;
  companyId: string;
  companyName: string;
  imageUrl: string | null;
  createdAt: string;
}

export interface AnnouncementAudience {
  type: AnnouncementAudienceType;
  buyerNos?: string[];
}

export interface AnnouncementRecord {
  id: string;
  title: string;
  content: string;
  category: AnnouncementCategory;
  type: AnnouncementType;
  priority: AnnouncementPriority;
  target?: AnnouncementTarget | null;
  audienceType: AnnouncementAudienceType;
  audienceFilter?: Record<string, unknown> | null;
  status: 'SENDING' | 'SENT' | 'PARTIAL_FAILED' | 'FAILED';
  recipientCount: number;
  successCount: number;
  failedCount: number;
  createdBy: string;
  sentAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnouncementPayload {
  title: string;
  content: string;
  category?: AnnouncementCategory;
  type?: AnnouncementType;
  priority?: AnnouncementPriority;
  target?: AnnouncementTarget;
  audience: AnnouncementAudience;
}

export interface AnnouncementPreviewResult {
  count: number;
  invalidBuyerNos: string[];
}

export const getAnnouncements = (params?: {
  page?: number;
  pageSize?: number;
}): Promise<{ items: AnnouncementRecord[]; total: number; page: number; pageSize: number }> =>
  client.get('/admin/announcements', { params });

export const getAnnouncementTargetProducts = (params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
}): Promise<{ items: AnnouncementTargetProduct[]; total: number; page: number; pageSize: number }> =>
  client.get('/admin/announcements/target-products', { params });

export const previewAnnouncement = (data: CreateAnnouncementPayload): Promise<AnnouncementPreviewResult> =>
  client.post('/admin/announcements/preview', data);

export const createAnnouncement = (data: CreateAnnouncementPayload): Promise<AnnouncementRecord> =>
  client.post('/admin/announcements', data);
