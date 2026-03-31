/**
 * 域模型：订单（Order）
 *
 * 用途：
 * - 订单列表/详情、支付方式、售后状态与时间线
 *
 * 后端接入建议：
 * - 订单/售后状态机应由后端推进，前端只做展示与触发（见 `说明文档/后端接口清单.md#6-订单order--aftersale--checkout`）
 */
export type OrderStatus = 'pendingPay' | 'pendingShip' | 'shipping' | 'delivered' | 'afterSale' | 'completed' | 'canceled';

import { PaymentMethod } from './Payment';

export type AfterSaleStatus =
  | 'applying'
  | 'reviewing'
  | 'approved'
  | 'shipped'
  | 'completed'
  | 'rejected'
  | 'failed'
  // 兼容历史退款售后状态
  | 'refunding';

export type AfterSaleProgress = {
  status: AfterSaleStatus;
  title: string;
  time: string;
  note?: string;
};

export type OrderItem = {
  id: string;
  productId: string;
  skuId?: string;
  title: string;
  image: string;
  price: number;
  quantity: number;
  /** 是否为抽奖奖品（奖品不支持退换） */
  isPrize?: boolean;
  /** 是否来自已完成的换货（不支持无理由退货） */
  isPostReplacement?: boolean;
};

/** 物流详情（独立查询 GET /shipments/:orderId） */
export type ShipmentDetail = {
  id: string;
  carrierCode: string;
  carrierName: string;
  trackingNo: string | null;
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  events: { id: string; occurredAt: string; message: string; location?: string; statusCode?: string }[];
  shipments?: Array<{
    id: string;
    companyId?: string | null;
    carrierCode: string;
    carrierName: string;
    trackingNo: string | null;
    trackingNoMasked?: string | null;
    status: string;
    shippedAt: string | null;
    deliveredAt: string | null;
    events: { id: string; occurredAt: string; message: string; location?: string; statusCode?: string }[];
  }>;
};

export type OrderBizType = 'NORMAL_GOODS' | 'VIP_PACKAGE';

// ─── 统一售后系统类型 ───────────────────────────────────

export type AfterSaleType = 'NO_REASON_RETURN' | 'QUALITY_RETURN' | 'QUALITY_EXCHANGE';

export type AfterSaleDetailStatus =
  | 'REQUESTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED'
  | 'PENDING_ARBITRATION' | 'RETURN_SHIPPING' | 'RECEIVED_BY_SELLER'
  | 'SELLER_REJECTED_RETURN' | 'REFUNDING' | 'REFUNDED'
  | 'REPLACEMENT_SHIPPED' | 'COMPLETED' | 'CLOSED' | 'CANCELED';

export type AfterSaleRequest = {
  id: string;
  orderId: string;
  orderItemId: string;
  afterSaleType: AfterSaleType;
  reasonType?: string;
  reason?: string;
  photos: string[];
  status: AfterSaleDetailStatus;
  requiresReturn: boolean;
  isPostReplacement: boolean;
  refundAmount?: number;
  returnCarrierName?: string;
  returnWaybillNo?: string;
  returnShippedAt?: string;
  sellerRejectReason?: string;
  sellerRejectPhotos?: string[];
  sellerReturnWaybillNo?: string;
  reviewNote?: string;
  reviewedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  order?: { id: string; status: string; totalAmount: number };
  orderItem?: { id: string; unitPrice: number; quantity: number; productSnapshot?: any };
};

export type Order = {
  id: string;
  status: OrderStatus;
  bizType?: OrderBizType;
  issueFlag?: boolean;
  afterSaleStatus?: AfterSaleStatus;
  afterSaleReason?: string;
  afterSaleNote?: string;
  afterSaleTimeline?: AfterSaleProgress[];
  paymentMethod?: PaymentMethod;
  logisticsStatus?: string;
  trackingNo?: string;
  trackingEvents?: { time: string; message: string; location?: string }[];
  shipments?: Array<{
    id: string;
    companyId?: string | null;
    carrierCode: string;
    carrierName: string;
    trackingNo: string | null;
    trackingNoMasked?: string | null;
    status: string;
    shippedAt: string | null;
    deliveredAt: string | null;
    trackingEvents: { time: string; message: string; location?: string }[];
  }>;
  tracePreview?: string;
  totalPrice: number;
  /** 商品金额（抵扣前） */
  goodsAmount?: number;
  /** 运费 */
  shippingFee?: number;
  /** 红包抵扣金额（元） */
  discountAmount?: number;
  /** VIP折扣金额（元） */
  vipDiscountAmount?: number;
  /** 无理由退货窗口截止时间 */
  returnWindowExpiresAt?: string;
  createdAt: string;
  items: OrderItem[];
};
