import type { MiniProgramPaymentParams, PageResult } from "@/types";

export type AfterSaleType =
  | "NO_REASON_RETURN"
  | "NO_REASON_EXCHANGE"
  | "QUALITY_RETURN"
  | "QUALITY_EXCHANGE";
export type AfterSaleStatus =
  | "REQUESTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "PENDING_ARBITRATION"
  | "RETURN_SHIPPING"
  | "RECEIVED_BY_SELLER"
  | "SELLER_REJECTED_RETURN"
  | "REFUNDING"
  | "REFUNDED"
  | "REPLACEMENT_SHIPPED"
  | "COMPLETED"
  | "CLOSED"
  | "CANCELED";
export type ReturnShippingPayer = "BUYER" | "SELLER" | "PLATFORM";
export type ReturnShippingPaymentStatus =
  | "NOT_REQUIRED"
  | "UNPAID"
  | "PENDING"
  | "PAID"
  | "FAILED"
  | "REFUNDING"
  | "REFUNDED"
  | "CLOSED";
export type QualityReason =
  | "QUALITY_ISSUE"
  | "WRONG_ITEM"
  | "DAMAGED"
  | "NOT_AS_DESCRIBED"
  | "SIZE_ISSUE"
  | "EXPIRED"
  | "OTHER";

export type ProductSnapshot = {
  title?: string;
  image?: string;
  images?: string[];
  skuTitle?: string;
  companyId?: string;
  companyName?: string;
  productType?: string;
  bundleItems?: unknown[];
};

export type SfTracking = {
  status: string;
  rawOpCode: string;
  events: Array<{
    time: string;
    message: string;
    location?: string;
    opCode?: string;
  }>;
};

export type AfterSaleRequest = {
  id: string;
  orderId: string;
  orderItemId: string;
  afterSaleType: AfterSaleType;
  reasonType?: QualityReason | string;
  reason?: string | null;
  photos: string[];
  status: AfterSaleStatus;
  requiresReturn: boolean;
  isPostReplacement: boolean;
  refundAmount?: number | null;
  refundStatus?: string | null;
  refundEscalatedToManual?: boolean;
  returnCarrierName?: string | null;
  returnCarrierCode?: string | null;
  returnWaybillNo?: string | null;
  returnWaybillUrl?: string | null;
  returnLabelUrl?: string | null;
  returnSfOrderId?: string | null;
  returnShippedAt?: string | null;
  returnShippingFee?: number | null;
  returnShippingPayer?: ReturnShippingPayer | null;
  returnShippingPaidAt?: string | null;
  returnShippingFeeDeducted?: boolean;
  returnShippingCostNote?: string | null;
  isLegacyManualReturnShipping?: boolean;
  requiresBuyerShippingPayment?: boolean;
  returnShippingPaymentStatus?: ReturnShippingPaymentStatus;
  sellerRejectReason?: string | null;
  sellerRejectPhotos?: string[];
  sellerReturnWaybillNo?: string | null;
  replacementCarrierName?: string | null;
  replacementWaybillNo?: string | null;
  replacementShipmentId?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  order?: {
    id: string;
    status: string;
    totalAmount: number;
    goodsAmount?: number;
    shippingFee?: number;
  };
  orderItem?: {
    id: string;
    unitPrice: number;
    quantity: number;
    productSnapshot?: ProductSnapshot;
    companyId?: string;
    company?: { id: string; name: string };
  };
  returnTracking?: SfTracking | null;
  sellerReturnTracking?: SfTracking | null;
  replacementTracking?: SfTracking | null;
};

export type EligibilityOption = {
  afterSaleType: AfterSaleType;
  enabled: boolean;
  disabledReason?: string | null;
  deadlineAt?: string | null;
  requiresReturn: boolean;
  returnShippingPayer?: ReturnShippingPayer;
  estimatedRefundAmount?: number | null;
  estimatedReturnShippingFee?: number | null;
  requiresBuyerShippingPayment?: boolean;
};

export type EligibilityItem = {
  orderItemId: string;
  skuId?: string;
  productId?: string;
  productTitle: string;
  productSnapshot?: ProductSnapshot;
  quantity: number;
  unitPrice: number;
  itemAmount: number;
  options: EligibilityOption[];
};

export type EligibilityResponse = {
  orderId: string;
  orderStatus: string;
  eligible: boolean;
  disabledReason?: string | null;
  items: EligibilityItem[];
};

export type ApplyAfterSaleInput = {
  orderItemId: string;
  afterSaleType: AfterSaleType;
  reasonType?: QualityReason;
  targetSkuId?: string;
  reason?: string;
  photos: string[];
};

export type TimelineResponse = {
  items: Array<{
    id: string;
    fromStatus?: AfterSaleStatus | null;
    toStatus: AfterSaleStatus;
    reason?: string | null;
    operatorType?: string | null;
    createdAt: string;
  }>;
};
export type ReturnPolicy = { title: string; content: string[] };
export type ReturnWaybillResult = {
  ok: boolean;
  carrierCode: string;
  carrierName: string;
  waybillNo: string;
  waybillUrl?: string | null;
  returnLabelUrl?: string | null;
};
export type AfterSaleShippingPayment = {
  id: string;
  afterSaleId: string;
  merchantPaymentNo: string;
  amount: number;
  status: Exclude<ReturnShippingPaymentStatus, "NOT_REQUIRED">;
  paymentScene: "MINI_PROGRAM";
  /** 已支付/关闭等终态由后端返回空对象，因此只有可支付状态才要求完整参数。 */
  paymentParams?: MiniProgramPaymentParams;
};
export type AfterSaleShippingActiveQueryResult = {
  status: Exclude<ReturnShippingPaymentStatus, "NOT_REQUIRED">;
  orderIds: [];
  expectedTotal: number;
  confirmedBy?: string;
};
export type AfterSalePage = PageResult<AfterSaleRequest>;
