/**
 * 平台红包仓储（Repo）
 *
 * 后端接口：
 * - GET  /api/v1/coupons/available → AvailableCampaignDto[]
 * - POST /api/v1/coupons/claim/:campaignId → MyCouponDto
 * - GET  /api/v1/coupons/my?status= → MyCouponDto[]
 * - POST /api/v1/coupons/checkout-eligible → CheckoutEligibleCoupon[]
 *
 * 注意：
 * - 平台红包（Coupon 体系）与分润奖励（Reward 体系）是两套完全独立的系统，严禁混淆
 * - 红包只能在结算时抵扣，不能提现；奖励只能提现，不能抵扣
 */
import type {
  AvailableCampaignDto,
  MyCouponDto,
  CheckoutEligibleCoupon,
  CheckoutEligibleRequest,
  CouponInstanceStatus,
  CouponShareEventRequest,
  CouponReviewEventRequest,
  CouponTriggerEventResult,
} from '../types/domain/Coupon';
import { Result } from '../types';
import { ApiClient } from './http/ApiClient';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';

// Mock 数据：可领取的红包活动
const mockCampaigns: AvailableCampaignDto[] = [
  {
    id: 'camp-1',
    name: '新人专享红包',
    description: '注册即送，全品类可用',
    discountType: 'FIXED',
    discountValue: 10,
    maxDiscountAmount: null,
    minOrderAmount: 50,
    remainingQuota: 100,
    userClaimedCount: 0,
    maxPerUser: 1,
    startAt: '2026-02-01T00:00:00Z',
    endAt: '2026-04-01T00:00:00Z',
    distributionMode: 'CLAIM',
  },
  {
    id: 'camp-2',
    name: '春季大促 8 折券',
    description: '满 100 元可用，最高减 30 元',
    discountType: 'PERCENT',
    discountValue: 20,
    maxDiscountAmount: 30,
    minOrderAmount: 100,
    remainingQuota: 50,
    userClaimedCount: 0,
    maxPerUser: 2,
    startAt: '2026-03-01T00:00:00Z',
    endAt: '2026-03-31T00:00:00Z',
    distributionMode: 'CLAIM',
  },
];

// Mock 数据：我的红包
const mockMyCoupons: MyCouponDto[] = [
  {
    id: 'ci-1',
    campaignName: '新人专享红包',
    discountType: 'FIXED',
    discountValue: 10,
    maxDiscountAmount: null,
    minOrderAmount: 50,
    status: 'AVAILABLE',
    issuedAt: '2026-02-20T10:00:00Z',
    expiresAt: '2026-04-01T00:00:00Z',
    usedAt: null,
    usedOrderId: null,
    usedAmount: null,
  },
  {
    id: 'ci-2',
    campaignName: '春季大促 8 折券',
    discountType: 'PERCENT',
    discountValue: 20,
    maxDiscountAmount: 30,
    minOrderAmount: 100,
    status: 'AVAILABLE',
    issuedAt: '2026-03-01T10:00:00Z',
    expiresAt: '2026-03-31T00:00:00Z',
    usedAt: null,
    usedOrderId: null,
    usedAmount: null,
  },
  {
    id: 'ci-3',
    campaignName: '周末特惠',
    discountType: 'FIXED',
    discountValue: 5,
    maxDiscountAmount: null,
    minOrderAmount: 0,
    status: 'USED',
    issuedAt: '2026-02-15T10:00:00Z',
    expiresAt: '2026-03-15T00:00:00Z',
    usedAt: '2026-02-28T14:30:00Z',
    usedOrderId: 'o-100',
    usedAmount: 5,
  },
];

// Mock 数据：结算可用红包
const mockCheckoutEligible: CheckoutEligibleCoupon[] = [
  {
    id: 'ci-1',
    campaignName: '新人专享红包',
    discountType: 'FIXED',
    discountValue: 10,
    maxDiscountAmount: null,
    minOrderAmount: 50,
    estimatedDiscount: 10,
    eligible: true,
    ineligibleReason: null,
    stackable: true,
    stackGroup: null,
    expiresAt: '2026-04-01T00:00:00Z',
  },
  {
    id: 'ci-2',
    campaignName: '春季大促 8 折券',
    discountType: 'PERCENT',
    discountValue: 20,
    maxDiscountAmount: 30,
    minOrderAmount: 100,
    estimatedDiscount: 20,
    eligible: true,
    ineligibleReason: null,
    stackable: false,
    stackGroup: 'PERCENT_MAIN',
    expiresAt: '2026-03-31T00:00:00Z',
  },
  {
    id: 'ci-4',
    campaignName: '无门槛红包',
    discountType: 'FIXED',
    discountValue: 3,
    maxDiscountAmount: null,
    minOrderAmount: 0,
    estimatedDiscount: 3,
    eligible: true,
    ineligibleReason: null,
    stackable: true,
    stackGroup: null,
    expiresAt: '2026-03-20T00:00:00Z',
  },
  {
    id: 'ci-5',
    campaignName: '会员专享大额券',
    discountType: 'FIXED',
    discountValue: 50,
    maxDiscountAmount: null,
    minOrderAmount: 300,
    estimatedDiscount: 50,
    eligible: false,
    ineligibleReason: '订单金额未满¥300',
    stackable: true,
    stackGroup: null,
    expiresAt: '2026-04-15T00:00:00Z',
  },
];

export const CouponRepo = {
  /** 查询可领取的红包活动 */
  getAvailableCampaigns: async (): Promise<Result<AvailableCampaignDto[]>> => {
    if (USE_MOCK) return simulateRequest(mockCampaigns);
    return ApiClient.get<AvailableCampaignDto[]>('/coupons/available');
  },

  /** 领取红包 */
  claimCoupon: async (campaignId: string): Promise<Result<MyCouponDto>> => {
    if (USE_MOCK) {
      const campaign = mockCampaigns.find((c) => c.id === campaignId);
      if (!campaign) {
        return simulateRequest({
          id: `ci-${Date.now()}`,
          campaignName: '未知活动',
          discountType: 'FIXED' as const,
          discountValue: 5,
          maxDiscountAmount: null,
          minOrderAmount: 0,
          status: 'AVAILABLE' as const,
          issuedAt: new Date().toISOString(),
          expiresAt: '2026-04-01T00:00:00Z',
          usedAt: null,
          usedOrderId: null,
          usedAmount: null,
        }, { delay: 400 });
      }
      return simulateRequest({
        id: `ci-${Date.now()}`,
        campaignName: campaign.name,
        discountType: campaign.discountType,
        discountValue: campaign.discountValue,
        maxDiscountAmount: campaign.maxDiscountAmount,
        minOrderAmount: campaign.minOrderAmount,
        status: 'AVAILABLE' as const,
        issuedAt: new Date().toISOString(),
        expiresAt: campaign.endAt,
        usedAt: null,
        usedOrderId: null,
        usedAmount: null,
      }, { delay: 400 });
    }
    return ApiClient.post<MyCouponDto>(`/coupons/claim/${campaignId}`);
  },

  /** 查询我的红包（按状态筛选） */
  getMyCoupons: async (status?: CouponInstanceStatus): Promise<Result<MyCouponDto[]>> => {
    if (USE_MOCK) {
      const filtered = status
        ? mockMyCoupons.filter((c) => c.status === status)
        : mockMyCoupons;
      return simulateRequest(filtered);
    }
    return ApiClient.get<MyCouponDto[]>('/coupons/my', status ? { status } : undefined);
  },

  /** 查询结算可用红包 */
  getCheckoutEligible: async (params: CheckoutEligibleRequest): Promise<Result<CheckoutEligibleCoupon[]>> => {
    if (USE_MOCK) {
      // Mock 模式：根据订单金额动态过滤 eligible 状态
      const result = mockCheckoutEligible.map((coupon) => {
        if (coupon.minOrderAmount > params.orderAmount) {
          return {
            ...coupon,
            eligible: false,
            ineligibleReason: `订单金额未满¥${coupon.minOrderAmount}`,
            estimatedDiscount: 0,
          };
        }
        // 重新计算预估抵扣
        let estimated = coupon.discountValue;
        if (coupon.discountType === 'PERCENT') {
          estimated = params.orderAmount * (coupon.discountValue / 100);
          if (coupon.maxDiscountAmount !== null) {
            estimated = Math.min(estimated, coupon.maxDiscountAmount);
          }
        }
        estimated = Math.min(estimated, params.orderAmount);
        return {
          ...coupon,
          eligible: true,
          ineligibleReason: null,
          estimatedDiscount: Number(estimated.toFixed(2)),
        };
      });
      return simulateRequest(result);
    }
    return ApiClient.post<CheckoutEligibleCoupon[]>('/coupons/checkout-eligible', params);
  },

  /** 上报分享事件（触发 SHARE 类型自动发放） */
  reportShareEvent: async (payload: CouponShareEventRequest): Promise<Result<CouponTriggerEventResult>> => {
    if (USE_MOCK) {
      const day = new Date().toISOString().slice(0, 10);
      const scene = (payload.scene || 'generic').trim();
      const targetId = (payload.targetId || 'global').trim();
      return simulateRequest({
        triggered: true,
        reason: 'TRIGGERED',
        eventKey: `${day}:${scene || 'generic'}:${targetId || 'global'}`,
      }, { delay: 250 });
    }
    return ApiClient.post<CouponTriggerEventResult>('/coupons/events/share', payload);
  },

  /** 上报评价事件（触发 REVIEW 类型自动发放） */
  reportReviewEvent: async (payload: CouponReviewEventRequest): Promise<Result<CouponTriggerEventResult>> => {
    if (USE_MOCK) {
      return simulateRequest({
        triggered: true,
        reason: 'TRIGGERED',
        eventKey: `order:${payload.orderId}`,
      }, { delay: 250 });
    }
    return ApiClient.post<CouponTriggerEventResult>('/coupons/events/review', payload);
  },
};
