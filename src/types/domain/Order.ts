/**
 * 域模型：订单（Order）
 *
 * 用途：
 * - 订单列表/详情、支付方式、售后状态与时间线
 *
 * 后端接入建议：
 * - 订单/售后状态机应由后端推进，前端只做展示与触发（见 `说明文档/后端接口清单.md#6-订单order--aftersale--checkout`）
 */
/**
 * 订单状态（与后端 Prisma OrderStatus 枚举严格对齐）
 *
 * 付款后建单架构 → 不存在 PENDING_PAYMENT 状态
 * "afterSale" 是 UI 派生展示（issueFlag/afterSaleStatus 非空时），不在数据库枚举中
 */
export type OrderStatus = 'PAID' | 'SHIPPED' | 'DELIVERED' | 'RECEIVED' | 'CANCELED' | 'REFUNDED';

import { PaymentMethod } from './Payment';
import { ServerCart } from './ServerCart';
import type { Invoice, InvoiceStatus } from './Invoice';

export type AfterSaleStatus =
  | 'applying'
  | 'reviewing'
  | 'approved'
  | 'arbitrating'
  | 'returnShipping'
  | 'sellerReceived'
  | 'sellerRejected'
  | 'shipped'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'refunded'
  | 'closed'
  | 'canceled'
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
  /** SKU 规格名（如 "5斤装"） */
  skuTitle?: string;
  image: string;
  price: number;
  quantity: number;
  /** 商品所属商户 ID（用于按商户聚合展示） */
  companyId?: string;
  /** 商户名称（Phase 2 后端 join 自 Company） */
  companyName?: string;
  /** 商户 logo（Phase 2 后端 join 自 Company） */
  companyLogo?: string;
  /** 是否为抽奖奖品（奖品不支持退换） */
  isPrize?: boolean;
  /** 是否来自已完成的换货（不支持无理由退货）—— Phase 2 后端将补齐派生 */
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

export type RefundStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REFUNDING' | 'REFUNDED' | 'FAILED';

export type RefundSummary = {
  id: string;
  amount: number;
  status: RefundStatus;
  reason: string;
  merchantRefundNo?: string;
  providerRefundId?: string | null;
  updatedAt?: string | null;
};

export type RepurchaseSkipReason =
  | 'PRIZE_ITEM'
  | 'SKU_MISSING'
  | 'SKU_INACTIVE'
  | 'PRODUCT_INACTIVE'
  | 'COMPANY_INACTIVE'
  | 'PLATFORM_PRODUCT'
  | 'MAX_PER_ORDER_EXCEEDED'
  | 'LOW_STOCK_ADJUSTED'
  | 'OUT_OF_STOCK_VIRTUAL';

export type RepurchaseResultItem = {
  orderItemId: string;
  skuId: string;
  title: string;
  quantity: number;
  status: 'ADDED' | 'SKIPPED';
  reason?: RepurchaseSkipReason;
  stockStatus?: 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  stock?: number;
  adjustedQuantity?: number;
  virtual?: boolean;
  priceChanged?: boolean;
  originalPrice?: number;
  currentPrice?: number;
  message?: string;
};

export type RepurchaseResult = {
  addedItemCount: number;
  addedQuantity: number;
  skippedItemCount: number;
  skippedQuantity: number;
  priceChangedCount: number;
  cart: ServerCart;
  items: RepurchaseResultItem[];
};

// ─── 统一售后系统类型 ───────────────────────────────────

export type AfterSaleType =
  | 'NO_REASON_RETURN'
  | 'NO_REASON_EXCHANGE'
  | 'QUALITY_RETURN'
  | 'QUALITY_EXCHANGE';

export type ReturnShippingPaymentStatus =
  | 'NOT_REQUIRED'
  | 'UNPAID'
  | 'PENDING'
  | 'PAID'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'FAILED'
  | 'CLOSED';

export type ReturnShippingPayer = 'BUYER' | 'SELLER' | 'PLATFORM';

export type OrderAfterSaleSummary = {
  id: string;
  status: AfterSaleDetailStatus;
  type: AfterSaleType;
  requiresReturn: boolean;
  refundAmount?: number | null;
  returnShippingPayer?: ReturnShippingPayer;
  returnShippingCostNote?: string;
  isLegacyManualReturnShipping?: boolean;
  requiresBuyerShippingPayment?: boolean;
  returnShippingPaymentStatus?: ReturnShippingPaymentStatus;
};

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
  refundStatus?: RefundStatus;
  refundEscalatedToManual?: boolean;
  returnCarrierName?: string;
  returnCarrierCode?: string;
  returnWaybillNo?: string;
  returnWaybillUrl?: string;
  returnLabelUrl?: string;
  returnSfOrderId?: string;
  returnShippedAt?: string;
  returnShippingFee?: number | null;
  returnShippingPayer?: ReturnShippingPayer | null;
  returnShippingPaidAt?: string | null;
  returnShippingFeeDeducted?: boolean;
  returnShippingCostNote?: string;
  isLegacyManualReturnShipping?: boolean;
  requiresBuyerShippingPayment?: boolean;
  returnShippingPaymentStatus?: ReturnShippingPaymentStatus;
  sellerRejectReason?: string;
  sellerRejectPhotos?: string[];
  sellerReturnWaybillNo?: string;
  replacementCarrierName?: string;
  replacementCarrierCode?: string;
  replacementWaybillNo?: string;
  replacementWaybillUrl?: string;
  replacementShipmentId?: string;
  reviewNote?: string;
  reviewedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  order?: { id: string; status: string; totalAmount: number };
  orderItem?: {
    id: string;
    unitPrice: number;
    quantity: number;
    productSnapshot?: any;
    companyId?: string;
    company?: { id: string; name: string };
  };
  /** 顺丰物流轨迹（后端实时查询/推送落库；无该单号时为 null）*/
  returnTracking?: SfTrackingResult | null;
  sellerReturnTracking?: SfTrackingResult | null;
  replacementTracking?: SfTrackingResult | null;
};

/** 顺丰物流轨迹（来自 EXP_RECE_SEARCH_ROUTES，已过滤沙箱旧路由污染）*/
export type SfTrackingResult = {
  status: string;
  rawOpCode: string;
  events: Array<{
    time: string;
    message: string;
    location?: string;
    opCode?: string;
  }>;
};

export type Order = {
  id: string;
  status: OrderStatus;
  bizType?: OrderBizType;
  repurchasable?: boolean;
  invoiceEligible?: boolean;
  invoiceStatus?: InvoiceStatus | null;
  invoice?: Pick<
    Invoice,
    'id' | 'status' | 'invoiceNo' | 'pdfUrl' | 'requestedAt' | 'issuedAt' | 'failReason' | 'profileSnapshot'
  > | null;
  issueFlag?: boolean;
  afterSaleStatus?: AfterSaleStatus;
  afterSaleReason?: string;
  afterSaleNote?: string;
  afterSaleTimeline?: AfterSaleProgress[];
  afterSaleSummary?: OrderAfterSaleSummary | null;
  refundSummary?: RefundSummary | null;
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
  /** 奖励抵扣金额（元） */
  discountAmount?: number;
  /** VIP折扣金额（元） */
  vipDiscountAmount?: number;
  /** 平台红包抵扣金额（元） */
  totalCouponDiscount?: number;
  /** 无理由退货窗口截止时间 */
  returnWindowExpiresAt?: string;
  /** 支付完成时间（Phase 1 列表 DTO 已暴露） */
  paidAt?: string;
  /** 发货时间（Phase 1 列表 DTO 已暴露） */
  shippedAt?: string;
  /** 物流送达时间（已签收后才有值） */
  deliveredAt?: string;
  /** 自动确认收货时间（Phase 2 后端将暴露，前置类型保持前向兼容） */
  autoReceiveAt?: string;
  /** 物流摘要（Phase 2 列表 DTO 暴露） */
  logisticsSummary?: {
    status: string | null;
    latestEventMessage: string | null;
    latestEventTime: string | null;
  } | null;
  /** 收货地址结构化字段（Phase 2 详情 DTO 暴露 - 已脱敏） */
  address?: {
    recipientName: string;
    recipientPhone: string;
    fullAddress: string;
  } | null;
  /** 买家留言（Phase 3 字段） */
  buyerNote?: string;
  createdAt: string;
  items: OrderItem[];
};
