import type { Cart } from './cart';

export type FulfillmentOrderStatus =
  | 'PAID'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'RECEIVED'
  | 'CANCELED'
  | 'REFUNDED';

/**
 * 新架构付款后才建单，不会新增 PENDING_PAYMENT。
 * 该状态仅用于读取历史订单，不得恢复旧订单支付入口；待支付续付统一走 CheckoutSession。
 */
export type HistoricalOrderStatus = 'PENDING_PAYMENT';
export type OrderStatus = FulfillmentOrderStatus | HistoricalOrderStatus;

export type OrderListFilter = FulfillmentOrderStatus | 'afterSale' | 'shipping';
export type OrderBizType = 'NORMAL_GOODS' | 'VIP_PACKAGE' | 'GROUP_BUY';
export type OrderInvoiceStatus = 'REQUESTED' | 'ISSUED' | 'FAILED' | 'CANCELED';
export type OrderAfterSaleStatus =
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
  | 'refunding';

export type OrderItem = {
  id: string;
  productId: string;
  skuId?: string;
  title: string;
  skuTitle?: string;
  image: string;
  price: number;
  quantity: number;
  companyId?: string;
  companyName?: string;
  companyLogo?: string | null;
  isPrize?: boolean;
};

export type Order = {
  id: string;
  status: OrderStatus;
  bizType?: OrderBizType;
  repurchasable?: boolean;
  totalPrice: number;
  goodsAmount?: number;
  shippingFee?: number;
  discountAmount?: number;
  vipDiscountAmount?: number;
  totalCouponDiscount?: number;
  createdAt: string;
  paidAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  autoReceiveAt?: string | null;
  logisticsSummary?: {
    status: string | null;
    latestEventMessage: string | null;
    latestEventTime: string | null;
  } | null;
  address?: {
    recipientName: string;
    recipientPhone: string;
    fullAddress: string;
  } | null;
  addressSnapshot?: {
    recipientName?: string;
    receiverName?: string;
    phone?: string;
    regionCode?: string;
    regionText?: string;
    province?: string;
    city?: string;
    district?: string;
    detail?: string;
  } | null;
  receiverInfoEditable?: boolean;
  buyerNote?: string | null;
  /** 小程序只区分本端微信支付与历史其他渠道，不提供其他渠道支付入口。 */
  paymentMethod?: 'wechat' | 'other';
  invoiceEligible?: boolean;
  invoiceStatus?: OrderInvoiceStatus | null;
  invoice?: {
    id: string;
    status: OrderInvoiceStatus;
    invoiceNo?: string | null;
    pdfUrl?: string | null;
  } | null;
  /** 后端从统一售后状态机派生；`shipped` 表示换货商品已寄出。 */
  afterSaleStatus?: OrderAfterSaleStatus;
  afterSaleSummary?: {
    id: string;
    status: string;
    type: string;
    requiresReturn: boolean;
    refundAmount?: number | null;
    requiresBuyerShippingPayment?: boolean;
    returnShippingPaymentStatus?: string;
  } | null;
  items: OrderItem[];
};

/** 后端状态计数不为历史 PENDING_PAYMENT 提供新的待付款入口。 */
export type OrderStatusCounts = Record<FulfillmentOrderStatus, number> & { afterSale: number };

export type UpdateReceiverInfoInput = {
  recipientName: string;
  phone: string;
  regionCode: string;
  regionText: string;
  detail: string;
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

export type RepurchaseResult = {
  addedItemCount: number;
  addedQuantity: number;
  skippedItemCount: number;
  skippedQuantity: number;
  priceChangedCount: number;
  cart: Cart;
  items: Array<{
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
  }>;
};
