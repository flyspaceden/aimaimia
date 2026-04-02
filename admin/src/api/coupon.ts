import client from './client';
import type { PaginatedData, PaginationParams } from '@/types';

// ========== 红包活动（CouponCampaign）相关类型 ==========

export type CouponCampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
export type CouponDiscountType = 'FIXED' | 'PERCENT';
export type CouponTriggerType =
  | 'REGISTER'
  | 'FIRST_ORDER'
  | 'BIRTHDAY'
  | 'CHECK_IN'
  | 'INVITE'
  | 'REVIEW'
  | 'SHARE'
  | 'CUMULATIVE_SPEND'
  | 'WIN_BACK'
  | 'HOLIDAY'
  | 'FLASH'
  | 'MANUAL';
export type CouponDistributionMode = 'AUTO' | 'CLAIM' | 'MANUAL';
export type CouponInstanceStatus = 'AVAILABLE' | 'RESERVED' | 'USED' | 'EXPIRED' | 'REVOKED';

export interface CouponCampaign {
  id: string;
  name: string;
  description: string | null;
  status: CouponCampaignStatus;
  triggerType: CouponTriggerType;
  distributionMode: CouponDistributionMode;
  triggerConfig: Record<string, unknown> | null;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  applicableCategories: string[];
  applicableCompanyIds: string[];
  stackable: boolean;
  stackGroup: string | null;
  totalQuota: number;
  issuedCount: number;
  maxPerUser: number;
  validDays: number;
  startAt: string;
  endAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CouponInstance {
  id: string;
  campaignId: string;
  campaign?: { id: string; name: string };
  userId: string;
  user?: { id: string; profile?: { nickname: string | null } | null };
  status: CouponInstanceStatus;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedOrderId: string | null;
  usedAmount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CouponUsageRecord {
  id: string;
  couponInstanceId: string;
  couponInstance?: {
    id: string;
    campaign?: { id: string; name: string };
    user?: { id: string; profile?: { nickname: string | null } | null };
  };
  orderId: string;
  order?: { id: string; orderNo: string };
  discountAmount: number;
  createdAt: string;
}

export interface CouponStats {
  totalCampaigns: number;
  activeCampaigns: number;
  totalIssued: number;
  totalUsed: number;
  totalDiscountAmount: number;
  avgUsageRate?: number;
  usageRate?: number;
  dailyTrend?: Array<{
    date: string;
    issued: number;
    used: number;
    discountAmount?: number;
  }>;
  campaignUsageRates?: Array<{
    name: string;
    usageRate: number;
    issued: number;
    used: number;
  }>;
  discountDistribution?: Array<{
    type: string;
    amount: number;
  }>;
}

// ========== 查询参数 ==========

export interface CampaignQueryParams extends PaginationParams {
  status?: CouponCampaignStatus;
  triggerType?: CouponTriggerType;
  keyword?: string;
}

export interface InstanceQueryParams extends PaginationParams {
  status?: CouponInstanceStatus;
  userId?: string;
}

export interface UsageQueryParams extends PaginationParams {
  orderId?: string;
  userId?: string;
}

// ========== 创建/更新 DTO ==========

export interface CreateCampaignDto {
  name: string;
  description?: string;
  triggerType: CouponTriggerType;
  distributionMode: CouponDistributionMode;
  triggerConfig?: Record<string, unknown>;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountAmount?: number;
  minOrderAmount?: number;
  applicableCategories?: string[];
  applicableCompanyIds?: string[];
  stackable?: boolean;
  stackGroup?: string;
  totalQuota: number;
  maxPerUser?: number;
  validDays?: number;
  startAt: string;
  endAt: string;
}

export interface UpdateCampaignDto extends Partial<CreateCampaignDto> {}

export interface ManualIssueDto {
  userIds: string[];
}

export interface ManualIssueResult {
  issued: number;
  skipped: number;
  skippedUsers: string[];
}

// ========== API 方法 ==========

/** 活动列表 */
export const getCampaigns = (params?: CampaignQueryParams): Promise<PaginatedData<CouponCampaign>> =>
  client.get('/admin/coupons/campaigns', { params });

/** 活动详情 */
export const getCampaign = (id: string): Promise<CouponCampaign> =>
  client.get(`/admin/coupons/campaigns/${id}`);

/** 创建活动 */
export const createCampaign = (data: CreateCampaignDto): Promise<CouponCampaign> =>
  client.post('/admin/coupons/campaigns', data);

/** 更新活动 */
export const updateCampaign = (id: string, data: UpdateCampaignDto): Promise<CouponCampaign> =>
  client.patch(`/admin/coupons/campaigns/${id}`, data);

/** 更新活动状态（上架/暂停/结束） */
export const updateCampaignStatus = (id: string, status: CouponCampaignStatus): Promise<CouponCampaign> =>
  client.patch(`/admin/coupons/campaigns/${id}/status`, { status });

/** 活动发放记录（实例列表） */
export const getCampaignInstances = (id: string, params?: InstanceQueryParams): Promise<PaginatedData<CouponInstance>> =>
  client.get(`/admin/coupons/campaigns/${id}/instances`, { params });

/** 活动使用记录 */
export const getCampaignUsage = (id: string, params?: UsageQueryParams): Promise<PaginatedData<CouponUsageRecord>> =>
  client.get(`/admin/coupons/campaigns/${id}/usage`, { params });

/** 手动发放红包 */
export const manualIssue = (id: string, data: ManualIssueDto): Promise<ManualIssueResult> =>
  client.post(`/admin/coupons/campaigns/${id}/manual-issue`, data);

/** 撤回红包实例 */
export const revokeInstance = (instanceId: string): Promise<CouponInstance> =>
  client.post(`/admin/coupons/instances/${instanceId}/revoke`);

/** 全局发放记录 */
export const getInstances = (params?: InstanceQueryParams): Promise<PaginatedData<CouponInstance>> =>
  client.get('/admin/coupons/instances', { params });

/** 全局使用记录 */
export const getUsageRecords = (params?: UsageQueryParams): Promise<PaginatedData<CouponUsageRecord>> =>
  client.get('/admin/coupons/usage', { params });

/** 红包统计概览 */
export const getCouponStats = (): Promise<CouponStats> =>
  client.get('/admin/coupons/stats');

/** 单个活动统计 */
export const getCampaignStats = (id: string): Promise<CouponStats> =>
  client.get(`/admin/coupons/stats/${id}`);
