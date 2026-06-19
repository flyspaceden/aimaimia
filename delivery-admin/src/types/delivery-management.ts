export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PagedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type DeliveryStats = {
  users: number;
  units: number;
  merchants: number;
  pendingMerchantApplications: number;
  activeOrders: number;
  totalOrderAmountCents: number;
  abnormalPayments: number;
  pendingSettlements: number;
  totalSettledAmountCents: number;
  openConversations: number;
};

export type DeliveryUserSummary = {
  id: string;
  phone: string | null;
  nickname: string | null;
  currentUnitId: string | null;
  status: string;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  currentUnit?: {
    id: string;
    name: string;
  } | null;
};

export type DeliveryUserDetail = DeliveryUserSummary & {
  currentUnit?: DeliveryUnitSummary | null;
};

export type DeliveryUnitSummary = {
  id: string;
  userId: string;
  name: string;
  contactName: string;
  contactPhone: string;
  provinceName: string;
  cityName: string;
  districtName: string;
  detailAddress: string;
  extraFields: JsonValue | null;
  status: string;
  remark: string | null;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    phone: string | null;
    nickname: string | null;
  } | null;
};

export type DeliveryUnitDetail = DeliveryUnitSummary & {
  user?: DeliveryUserSummary | null;
};

export type DeliverySellerStaff = {
  id: string;
  merchantId: string;
  phone: string | null;
  username: string | null;
  realName: string | null;
  role: string;
  permissionCodes: string[];
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryMerchantSummary = {
  id: string;
  name: string;
  shortName: string | null;
  description: string | null;
  contactName: string;
  contactPhone: string;
  servicePhone: string | null;
  status: string;
  logoUrl: string | null;
  addressJson: JsonValue | null;
  defaultMarkupBps: number | null;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryMerchantDetail = DeliveryMerchantSummary & {
  staff: DeliverySellerStaff[];
};

export type DeliveryMerchantApplicationSummary = {
  id: string;
  companyName: string;
  contactName: string;
  contactPhone: string;
  email: string | null;
  note: string | null;
  licenseFileUrl: string | null;
  status: string;
  rejectReason: string | null;
  reviewedAt: string | null;
  reviewedByAdminId: string | null;
  merchantId: string | null;
  createdAt: string;
  updatedAt: string;
  merchant?: {
    id: string;
    name: string;
  } | null;
  reviewedByAdmin?: {
    id: string;
    username: string;
    realName?: string | null;
  } | null;
};

export type DeliveryMerchantApplicationDetail = DeliveryMerchantApplicationSummary & {
  merchant?: DeliveryMerchantSummary | null;
};

export type DeliveryProductSku = {
  id: string;
  title: string;
  skuCode: string | null;
  imageUrl: string | null;
  supplyPriceCents: number;
  basePriceCents: number;
  fixedFinalPriceCents: number | null;
  stock: number;
  minOrderQuantity: number;
  orderStepQuantity: number;
  weightGram: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryProduct = {
  id: string;
  merchantId: string;
  categoryId: string | null;
  productUnitId: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  detailRich: JsonValue | null;
  media: JsonValue | null;
  attributes: JsonValue | null;
  searchKeywords: string[];
  unitName: string;
  status: string;
  auditStatus: string;
  auditNote: string | null;
  submissionCount: number;
  minOrderQuantity: number;
  orderStepQuantity: number;
  createdAt: string;
  updatedAt: string;
  merchant?: {
    id: string;
    name: string;
    status: string;
    defaultMarkupBps: number | null;
  } | null;
  category?: {
    id: string;
    name: string;
    status: string;
  } | null;
  productUnit?: {
    id: string;
    name: string;
  } | null;
  skus: DeliveryProductSku[];
};

export type DeliveryPriceRule = {
  id: string;
  scope: string;
  ruleType: string;
  merchantId: string | null;
  productId: string | null;
  skuId: string | null;
  minQuantity: number;
  maxQuantity: number | null;
  fixedPriceCents: number | null;
  markupBps: number | null;
  priority: number;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryOrderSubOrderSummary = {
  id: string;
  merchantId: string;
  status: string;
  supplyAmountCents: number;
  shippingFeeShareCents: number;
  totalAmountCents: number;
  deliveredAt?: string | null;
  completedAt?: string | null;
};

export type DeliveryOrderSummary = {
  id: string;
  userId: string;
  unitId: string;
  checkoutSessionId: string | null;
  status: string;
  unitSnapshot: JsonValue;
  addressSnapshot: JsonValue;
  itemsSnapshot: JsonValue;
  pricingSnapshot: JsonValue | null;
  note: string | null;
  goodsAmountCents: number;
  shippingFeeCents: number;
  totalAmountCents: number;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  autoReceiveAt: string | null;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    phone: string | null;
    nickname: string | null;
  } | null;
  unit?: {
    id: string;
    name: string;
  } | null;
  subOrders: DeliveryOrderSubOrderSummary[];
};

export type DeliveryPayment = {
  id: string;
  orderId: string | null;
  checkoutSessionId: string | null;
  channel: string;
  scene: string;
  amountCents: number;
  currency: string;
  status: string;
  merchantOrderNo: string;
  providerTxnId: string | null;
  requestPayload: JsonValue | null;
  rawNotifyPayload: JsonValue | null;
  exceptionSummary: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryShipment = {
  id: string;
  orderId: string;
  subOrderId: string;
  merchantId: string;
  status: string;
  carrierCode: string;
  carrierName: string;
  trackingNo: string | null;
  waybillNo: string | null;
  waybillUrl: string | null;
  sfOrderId: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryOrderDetail = DeliveryOrderSummary & {
  unit?: DeliveryUnitSummary | null;
  user?: DeliveryUserSummary | null;
  subOrders: Array<{
    id: string;
    orderId: string;
    merchantId: string;
    status: string;
    supplyAmountCents: number;
    shippingFeeShareCents: number;
    totalAmountCents: number;
    note: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    completedAt: string | null;
    canceledAt: string | null;
    cancelReason: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  payments: DeliveryPayment[];
  shipments: DeliveryShipment[];
};

export type DeliveryAbnormalPayment = DeliveryPayment & {
  order?: {
    id: string;
    status: string;
  } | null;
};

export type DeliveryShippingRecord = {
  id: string;
  orderId: string;
  subOrderId: string;
  merchantId: string;
  carrierCode: string;
  carrierName: string;
  status: string;
  trackingNo: string | null;
  waybillNo: string | null;
  waybillUrl: string | null;
  sfOrderId: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  estimatedUserShippingFeeCents: number | null;
  actualCarrierCostCents: number | null;
  carrierRecordNo: string | null;
};

export type DeliveryManifestColumn = {
  key: string;
  label: string;
  sortOrder: number;
  visible: boolean;
  fixed?: boolean;
};

export type DeliveryManifestTemplate = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  currentConfig: {
    columns: DeliveryManifestColumn[];
  };
  latestVersion: {
    id: string;
    versionNo: number;
    status: string;
    config: JsonValue;
  } | null;
  versions: Array<{
    id: string;
    versionNo: number;
    status: string;
    createdAt: string;
  }>;
};

export type DeliverySettlement = {
  id: string;
  merchantId: string;
  subOrderId: string | null;
  status: string;
  settlementMonth: string | null;
  supplyAmountCents: number;
  settledAmountCents: number;
  expectedAmountCents: number;
  exportFileUrl: string | null;
  note: string | null;
  markedSettledByAdminId: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
  merchant?: {
    id: string;
    name: string;
  } | null;
  subOrder?: {
    id: string;
    orderId: string;
    status: string;
    totalAmountCents: number;
    shippingFeeShareCents: number;
    deliveredAt: string | null;
    completedAt: string | null;
  } | null;
};

export type DeliveryConversation = {
  id: string;
  source: string;
  status: string;
  userId: string | null;
  unitId: string | null;
  orderId: string | null;
  subOrderId: string | null;
  merchantId: string | null;
  assignedAdminId: string | null;
  assignedStaffId: string | null;
  subject: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    phone: string | null;
    nickname: string | null;
  } | null;
  unit?: {
    id: string;
    name: string;
  } | null;
  order?: {
    id: string;
    status: string;
  } | null;
  subOrder?: {
    id: string;
    status: string;
  } | null;
};

export type DeliveryAuditLog = {
  id: string;
  actorType: string;
  actorId: string | null;
  module: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string | null;
  before: JsonValue | null;
  after: JsonValue | null;
  diff: JsonValue | null;
  ip: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryConfigItem = {
  id: string;
  scope: string;
  key: string;
  value: JsonValue;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryUnitFieldConfig = {
  fieldKey: string;
  label: string;
  fieldType: string;
  sortOrder: number;
  placeholder: string | null;
  options: JsonValue;
  isVisible: boolean;
  isRequired: boolean;
  showInApp: boolean;
  showInAdmin: boolean;
  includeInPdf: boolean;
  includeInExcel: boolean;
  includeInExport: boolean;
  isFixed: boolean;
};
