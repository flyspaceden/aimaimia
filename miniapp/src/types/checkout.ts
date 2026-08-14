import type {
  CheckoutFulfillmentSummary,
  FulfillmentInput,
  FulfillmentMode,
} from './fulfillment';

export type PaymentScene = 'APP' | 'MINI_PROGRAM';
export type CheckoutSessionStatus = 'ACTIVE' | 'PAID' | 'COMPLETED' | 'EXPIRED' | 'FAILED';

export type CheckoutItemInput = {
  skuId: string;
  quantity: number;
  cartItemId?: string;
};

/**
 * 小程序结算请求不暴露 paymentChannel/openId。
 * expectedTotal 是用户刚在服务端 preview 看到的应付金额，只用于后端乐观一致性校验；
 * 它不是客户端自定义成交金额，后端仍会独立重算。
 * Coupon 与 Reward 是两套独立系统：couponInstanceIds 与 deductionAmount 可同时存在。
 */
export type MiniProgramCheckoutInput = {
  items: CheckoutItemInput[];
  checkoutSource?: 'CART' | 'BUY_NOW';
  addressId?: string;
  fulfillment?: FulfillmentInput;
  expectedTotal: number;
  couponInstanceIds?: string[];
  deductionAmount?: number;
  idempotencyKey?: string;
  buyerNote?: string;
};

export type MiniProgramVipCheckoutInput = {
  packageId: string;
  giftOptionId: string;
  addressId?: string;
  fulfillment?: FulfillmentInput;
  /** VIP 套餐页展示价，仅作为后端重算时的价格漂移防线。 */
  expectedTotal: number;
  idempotencyKey?: string;
  buyerNote?: string;
};

export type CheckoutPreviewInput = {
  items: CheckoutItemInput[];
  checkoutSource?: 'CART' | 'BUY_NOW';
  addressId?: string;
  fulfillment?: FulfillmentInput;
  couponInstanceIds?: string[];
};

export type CheckoutPreview = {
  fulfillmentMode?: FulfillmentMode;
  fulfillment?: CheckoutFulfillmentSummary;
  groups: Array<{
    companyId: string;
    companyName: string;
    items: Array<{
      skuId: string;
      title: string;
      image: string;
      unitPrice: number;
      quantity: number;
    }>;
    goodsAmount: number;
    shippingFee: number;
    discountAmount: number;
  }>;
  pointsBalance: number;
  pointsRatio: number;
  maxDeductible: number;
  summary: {
    totalGoodsAmount: number;
    totalShippingFee: number;
    totalDiscount: number;
    vipDiscount: number;
    totalPayable: number;
    freeShippingThreshold?: number;
    amountToFreeShipping?: number;
  };
  excludedItems?: Array<{
    cartItemId?: string;
    skuId: string;
    reason: string;
    isPrize?: boolean;
    prizeRecordId?: string | null;
  }>;
};

export type CheckoutEligibleRequest = {
  /** 仅用于候选券预览；创建 CheckoutSession 时后端会重新计算并锁券。 */
  previewOrderAmount: number;
  categoryIds: string[];
  companyIds: string[];
};

export type CheckoutEligibleCoupon = {
  id: string;
  campaignName: string;
  discountType: 'FIXED' | 'PERCENT';
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  estimatedDiscount: number;
  eligible: boolean;
  ineligibleReason: string | null;
  stackable: boolean;
  stackGroup: string | null;
  expiresAt: string;
};

export type MiniProgramPaymentParams = {
  channel: 'wechat';
  scene: 'mini_program';
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: `prepay_id=${string}`;
  signType: 'RSA';
  paySign: string;
  prepayId: string;
};

export type CheckoutSession = {
  sessionId: string;
  merchantOrderNo: string;
  expectedTotal: number;
  goodsAmount: number;
  shippingFee: number;
  discountAmount: number;
  groupBuyRebateDeductionAmount?: number;
  vipDiscountAmount?: number;
  totalCouponDiscount?: number;
  couponInstanceIds?: string[];
  paymentScene: 'MINI_PROGRAM';
  paymentParams: MiniProgramPaymentParams;
  fulfillmentMode?: FulfillmentMode;
  excludedItems?: CheckoutPreview['excludedItems'];
};

export type CheckoutStatusResult = {
  status: CheckoutSessionStatus;
  orderIds: string[];
  expectedTotal: number;
  confirmedBy?: string;
};

export type MiniProgramResumeResult = {
  sessionId: string;
  merchantOrderNo: string;
  expectedTotal: number;
  paymentScene: 'MINI_PROGRAM';
  paymentParams: MiniProgramPaymentParams;
};

export type PendingCheckout = {
  sessionId: string;
  merchantOrderNo: string | null;
  expectedTotal: number;
  goodsAmount: number;
  shippingFee: number;
  expiresAt: string;
  itemCount: number;
  /** 后端 pending API 明确排除 VIP_PACKAGE。 */
  bizType: 'NORMAL_GOODS' | 'GROUP_BUY';
  paymentScene: PaymentScene;
  canResumeInCurrentScene: boolean;
  preview: { firstItemImage: string; firstItemTitle: string; extraCount: number };
  items: Array<{
    image: string;
    title: string;
    skuTitle: string;
    quantity: number;
    unitPrice: number;
  }>;
};

/** 服务端按当前登录用户返回的小程序 VIP 未完成结算摘要。 */
export type PendingVipCheckout = {
  sessionId: string;
  merchantOrderNo: string | null;
  expectedTotal: number;
  expiresAt: string;
  bizType: 'VIP_PACKAGE';
  paymentScene: 'MINI_PROGRAM';
};

export type CrossSceneCheckoutResult = {
  status: CheckoutSessionStatus;
  orderIds: string[];
  recheckoutRequired: boolean;
  canResume?: boolean;
  targetScene: PaymentScene;
};
