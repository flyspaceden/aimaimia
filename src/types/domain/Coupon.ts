/**
 * 域模型：平台红包/优惠券（Coupon）
 *
 * 用途：
 * - 平台红包活动列表、领取、我的红包、结算抵扣
 *
 * 注意：
 * - 平台红包（Coupon 体系）与分润奖励（Reward 体系）是两套完全独立的系统，严禁混淆
 * - 红包只能在结算时抵扣，不能提现；奖励只能提现，不能抵扣
 */

/** 红包活动状态 */
export type CouponCampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';

/** 抵扣类型 */
export type CouponDiscountType = 'FIXED' | 'PERCENT';

/** 触发类型 */
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

/** 发放方式 */
export type CouponDistributionMode = 'AUTO' | 'CLAIM' | 'MANUAL';

/** 红包实例状态 */
export type CouponInstanceStatus = 'AVAILABLE' | 'RESERVED' | 'USED' | 'EXPIRED' | 'REVOKED';

/** 可领取的红包活动 */
export interface AvailableCampaignDto {
  id: string;
  name: string;
  description: string;
  discountType: CouponDiscountType;
  discountValue: number;
  /** 最大抵扣金额（元），null 表示无上限（仅 PERCENT 类型生效） */
  maxDiscountAmount: number | null;
  /** 最低订单金额门槛（元） */
  minOrderAmount: number;
  /** 剩余可领数量 */
  remainingQuota: number;
  /** 当前用户已领数量 */
  userClaimedCount: number;
  /** 每人最多可领数量 */
  maxPerUser: number;
  /** 活动开始时间 */
  startAt: string;
  /** 活动结束时间 */
  endAt: string;
  /** 发放方式 */
  distributionMode: CouponDistributionMode;
}

/** 我的红包 */
export interface MyCouponDto {
  id: string;
  campaignName: string;
  discountType: CouponDiscountType;
  discountValue: number;
  /** 最大抵扣金额（元），null 表示无上限 */
  maxDiscountAmount: number | null;
  /** 最低订单金额门槛（元） */
  minOrderAmount: number;
  status: CouponInstanceStatus;
  /** 发放时间 */
  issuedAt: string;
  /** 过期时间 */
  expiresAt: string;
  /** 使用时间 */
  usedAt: string | null;
  /** 使用时关联的订单 ID */
  usedOrderId: string | null;
  /** 实际抵扣金额（元） */
  usedAmount: number | null;
}

/** 结算可用红包查询请求 */
export interface CheckoutEligibleRequest {
  /** 订单金额（元） */
  orderAmount: number;
  /** 商品所属分类 ID 列表 */
  categoryIds: string[];
  /** 商品所属商家 ID 列表 */
  companyIds: string[];
}

/** 结算可用红包（后端预计算 estimatedDiscount） */
export interface CheckoutEligibleCoupon {
  id: string;
  campaignName: string;
  discountType: CouponDiscountType;
  discountValue: number;
  /** 最大抵扣金额（元），null 表示无上限 */
  maxDiscountAmount: number | null;
  /** 最低订单金额门槛（元） */
  minOrderAmount: number;
  /** 预估抵扣金额（元，后端根据订单金额计算） */
  estimatedDiscount: number;
  /** 当前订单是否满足使用条件 */
  eligible: boolean;
  /** 不满足条件的原因说明 */
  ineligibleReason: string | null;
  /** 是否支持叠加使用 */
  stackable: boolean;
  /** 叠加分组标识（同组内不可叠加） */
  stackGroup: string | null;
  /** 过期时间 */
  expiresAt: string;
}

/** 上报分享事件请求 */
export interface CouponShareEventRequest {
  scene?: string;
  targetId?: string;
}

/** 上报评价事件请求 */
export interface CouponReviewEventRequest {
  orderId: string;
  reviewId?: string;
}

/** 触发事件处理结果 */
export interface CouponTriggerEventResult {
  triggered: boolean;
  reason: 'TRIGGERED' | 'DUPLICATE';
  eventKey: string;
}
