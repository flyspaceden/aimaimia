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
  user: {
    nickname?: string;
    avatarUrl?: string;
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
    companyId: string;
    companyName: string;
    shortName?: string;
    role: string;
    status?: string;
  }>;
}

// ============================================================
// 商品
// ============================================================

export interface Product {
  id: string;
  companyId: string;
  title: string;
  subtitle?: string;
  description?: string;
  basePrice: number;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  auditStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  auditNote?: string;
  origin?: { text?: string };
  attributes?: Record<string, string>;
  aiKeywords?: string[];
  categoryId?: string;
  category?: { id: string; name: string; path?: string };
  skus: ProductSKU[];
  media: ProductMedia[];
  tags: Array<{ tag: { id: string; name: string } }>;
  createdAt: string;
  updatedAt: string;
}

export interface ProductSKU {
  id: string;
  title: string;
  price: number;
  cost?: number;
  stock: number;
  weightGram?: number;
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

export interface Order {
  id: string;
  status: string;
  bizType?: 'NORMAL_GOODS' | 'VIP_PACKAGE';
  totalAmount: number;
  goodsAmount?: number;
  shippingFee?: number;
  createdDate: string; // YYYY-MM-DD（非 createdAt 时间戳）
  buyerAlias: string; // 匿名编号
  regionText: string | null; // 省市区
  items: OrderItem[];
  shipment?: Shipment | null;
  /** 发票状态（只读，仅订单详情返回） */
  invoiceStatus?: 'REQUESTED' | 'ISSUED' | 'FAILED' | 'CANCELED' | null;
}

export interface OrderItem {
  id: string;
  title: string;
  unitPrice: number;
  quantity: number;
  isPrize?: boolean;
  prizeType?: string;
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
// 退款
// ============================================================

export interface Refund {
  id: string;
  status: string;
  amount: number;
  reason: string;
  merchantRefundNo?: string;
  createdAt: string;
  order: {
    id: string;
    status: string;
    totalAmount: number;
    goodsAmount?: number;
    shippingFee?: number;
    createdDate: string;
    buyerAlias: string;
    regionText: string | null;
    items: Array<{ id: string; title?: string; unitPrice: number; quantity: number }>;
  };
}

// ============================================================
// 换货理由类型
// ============================================================

export type ReplacementReasonType = 'QUALITY_ISSUE' | 'WRONG_ITEM' | 'DAMAGED' | 'NOT_AS_DESCRIBED' | 'SIZE_ISSUE' | 'EXPIRED' | 'OTHER';

// ============================================================
// 面单 & 虚拟号
// ============================================================

/** 面单生成响应 */
export interface WaybillResult {
  ok: boolean;
  waybillNo: string;
  waybillPrintUrl: string;
  carrierCode: string;
  carrierName: string;
}

/** 虚拟号响应 */
export interface VirtualCallResult {
  virtualNumber: string;
  expireAt: string;
  remainingCalls: number;
}

// ============================================================
// 企业 & 员工
// ============================================================

export interface Company {
  id: string;
  name: string;
  shortName?: string;
  description?: string;
  status: string;
  servicePhone?: string;
  serviceWeChat?: string;
  contact?: Record<string, unknown>;
  address?: Record<string, unknown>;
  profile?: { richContent?: unknown; highlights?: unknown };
  documents?: CompanyDocument[];
}

// ============================================================
// AI 搜索资料
// ============================================================

export interface AiSearchProfile {
  companyType: string | null;
}

/** AI 搜索资料 — 枚举常量（与后端 seller-company.dto.ts 保持一致） */
export const COMPANY_TYPE_OPTIONS = [
  { value: 'farm', label: '农场' },
  { value: 'company', label: '公司' },
  { value: 'cooperative', label: '合作社' },
  { value: 'base', label: '基地' },
  { value: 'factory', label: '工厂' },
  { value: 'store', label: '店铺' },
];

export interface CompanyDocument {
  id: string;
  type: string;
  title: string;
  fileUrl: string;
  issuer?: string;
  expiresAt?: string;
  verifyStatus: string;
  createdAt: string;
}

export interface CompanyStaff {
  id: string;
  userId: string;
  companyId: string;
  role: 'OWNER' | 'MANAGER' | 'OPERATOR';
  status: string;
  joinedAt: string;
  user: {
    profile?: { nickname?: string; avatarUrl?: string };
  };
}

// ============================================================
// 数据看板
// ============================================================

export interface SellerOverview {
  today: {
    orderCount: number;
    revenue: number;
    pendingShipCount: number;
    pendingReplacementCount: number;
  };
  month: {
    orderCount: number;
    revenue: number;
    replacementRate: number;
  };
  total: {
    productCount: number;
    totalRevenue: number;
  };
}

export interface SalesTrendItem {
  date: string;
  orderCount: number;
  revenue: number;
}

export interface ProductRankItem {
  productId: string;
  title: string;
  totalSold: number;
  totalRevenue: number;
}

export interface OrderStatItem {
  status: string;
  count: number;
}
