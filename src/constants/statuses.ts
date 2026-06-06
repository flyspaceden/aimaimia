import { BookingStatus, GroupStatus, OrderStatus, AfterSaleDetailStatus, AfterSaleType } from '../types';

export const orderStatusLabels: Record<OrderStatus, string> = {
  PAID: '待发货',
  SHIPPED: '已发货',
  DELIVERED: '已送达',
  RECEIVED: '已收货',
  CANCELED: '已取消',
  REFUNDED: '已退款',
};

// 物流状态标签（与 backend Prisma ShipmentStatus 枚举对齐；未知值回退原文）
export const shipmentStatusLabels: Record<string, string> = {
  INIT: '待发货',
  SHIPPED: '已发货',
  IN_TRANSIT: '运输中',
  DELIVERED: '已送达',
  EXCEPTION: '异常',
};

export const bookingStatusLabels: Record<BookingStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  invited: '待成团邀请',
  joined: '已参团待支付',
  paid: '已支付',
};

export const groupStatusLabels: Record<GroupStatus, string> = {
  forming: '组团中',
  inviting: '成团邀请',
  confirmed: '待支付',
  paid: '已支付',
  completed: '已完成',
};

// ─── 统一售后状态标签 ─────────────────────────────────

export const afterSaleStatusLabels: Record<AfterSaleDetailStatus, string> = {
  REQUESTED: '待审核',
  UNDER_REVIEW: '审核中',
  APPROVED: '已同意',
  REJECTED: '已驳回',
  PENDING_ARBITRATION: '平台仲裁中',
  RETURN_SHIPPING: '退回中',
  RECEIVED_BY_SELLER: '卖家验收中',
  SELLER_REJECTED_RETURN: '验收不通过',
  REFUNDING: '退款中',
  REFUNDED: '已退款',
  REPLACEMENT_SHIPPED: '换货已发出',
  COMPLETED: '已完成',
  CLOSED: '已关闭',
  CANCELED: '已撤销',
};

export const afterSaleTypeLabels: Record<AfterSaleType, string> = {
  NO_REASON_RETURN: '七天无理由退货',
  NO_REASON_EXCHANGE: '七天无理由换货',
  QUALITY_RETURN: '质量问题退货',
  QUALITY_EXCHANGE: '质量问题换货',
};
