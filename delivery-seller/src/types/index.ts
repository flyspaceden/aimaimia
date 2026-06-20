// ============================================================
// 通用 API 类型
// ============================================================

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

/** 通用列表查询参数 */
export interface QueryParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  [key: string]: string | number | undefined;
}

// ============================================================
// 卖家认证
// ============================================================

export interface SellerProfile {
  staffId: string;
  userId: string;
  role: 'OWNER' | 'MANAGER' | 'OPERATOR';
  permissionCodes: string[];
  user: {
    nickname?: string;
    avatarUrl?: string;
    phone?: string;
    phoneMasked?: string;
  };
  company: {
    id: string;
    name: string;
    shortName?: string;
    status: string;
  };
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  seller: {
    staffId: string;
    companyId: string;
    companyName: string;
    role: string;
  };
}

export interface SelectCompanyResponse {
  needSelectCompany: true;
  tempToken: string;
  companies: Array<{
    staffId: string;
    companyId: string;
    companyName: string;
    shortName?: string;
    realName?: string;
    role: string;
    status?: string;
  }>;
}

// ============================================================
// 商品
// ============================================================

export interface Product {
  id: string;
  merchantId: string;
  categoryId?: string | null;
  productUnitId?: string | null;
  title: string;
  subtitle?: string;
  description?: string;
  unitName?: string;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  auditStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  auditNote?: string;
  submissionCount?: number;
  detailRich?: unknown;
  origin?: { text?: string };
  attributes?: Record<string, unknown>;
  aiKeywords?: string[];
  searchKeywords?: string[];
  category?: { id: string; name: string; path?: string };
  productUnit?: { id: string; name: string } | null;
  skus: ProductSKU[];
  media: ProductMedia[];
  tags?: Array<{ tag?: { id: string; name: string }; tagId?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface ProductSKU {
  id: string;
  title: string;
  cost?: number;
  supplyPriceCents?: number;
  stock: number;
  maxPerOrder?: number;
  imageUrl?: string | null;
  minOrderQuantity?: number;
  orderStepQuantity?: number;
  isActive?: boolean;
  skuCode?: string | null;
  weightGram: number;
  status: string;
}

export interface ProductMedia {
  id: string;
  type: string;
  url: string;
  sortOrder: number;
}

// ============================================================
// 订单
// ============================================================

export type OrderStatus =
  | 'PENDING_SHIPMENT'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELED';

export interface Order {
  id: string;
  orderId: string;
  status: OrderStatus;
  createdAt?: string;
  updatedAt?: string;
  paidAt?: string | null;
  createdDate: string; // YYYY-MM-DD（非 createdAt 时间戳）
  buyerAlias: string;
  buyerNo?: string | null;
  regionText: string | null; // 省市区
  shippingAddress?: {
    recipientName: string;
    phone: string;
    regionText: string;
    detailAddress: string;
  };
  items: OrderItem[];
  shipment?: Shipment | null;
}

export interface OrderItem {
  id: string;
  title: string;
  skuTitle?: string;
  unitName?: string;
  quantity: number;
  imageUrl?: string; // 商品首图
}

// ============================================================
// 物流
// ============================================================

export interface Shipment {
  id: string;
  status: string;
  carrierCode?: string;
  carrierName?: string;
  trackingNo?: string;
  waybillNo?: string;
  waybillPrintUrl?: string;
  shippedAt?: string;
  createdAt?: string;
  trackingEvents?: TrackingEvent[];
}

export interface TrackingEvent {
  status: string;
  description: string;
  occurredAt: string;
}

// ============================================================
// 面单 & 虚拟号
// ============================================================

/** 面单生成响应 */
// 企业 & 员工
// ============================================================

export interface Company {
  id: string;
  name: string;
  contactName: string;
  contactPhone: string;
  servicePhone?: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  updatedAt: string;
}

export interface CompanyStaff {
  id: string;
  merchantId: string;
  username: string;
  phone?: string | null;
  realName?: string | null;
  role: 'OWNER' | 'MANAGER' | 'OPERATOR';
  permissionCodes: string[];
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCompanyPayload {
  name?: string;
  contactName?: string;
  contactPhone?: string;
  servicePhone?: string;
}

export interface CreateCompanyStaffPayload {
  username: string;
  phone?: string;
  realName?: string;
  role: 'OWNER' | 'MANAGER' | 'OPERATOR';
  permissionCodes?: string[];
}

export interface UpdateCompanyStaffPayload {
  realName?: string;
  role?: 'OWNER' | 'MANAGER' | 'OPERATOR';
  status?: 'ACTIVE' | 'DISABLED';
  permissionCodes?: string[];
}
