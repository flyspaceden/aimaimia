import type { ProductBundleItem, ProductType } from './Product';

/**
 * 域模型：企业（Company）
 *
 * 用途：
 * - 数字展览馆：企业列表/企业详情/地图点位
 *
 * 后端接入建议：
 * - 需支持按城市/距离/认证关键词检索（见搜索页逻辑与 `说明文档/后端接口清单.md#21-企业`）
 */
export type Company = {
  id: string;
  name: string;
  cover: string;
  mainBusiness: string;
  location: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  distanceKm: number;
  badges: string[]; // @deprecated — 已合并到 certifications，保留向后兼容
  latestTestedAt?: string;
  groupTargetSize?: number;
  /** 后端新增字段 — 企业详情展示 */
  description?: string;
  shortName?: string;
  servicePhone?: string;
  serviceWeChat?: string;
  address?: {
    text?: string;
    province?: string;
    city?: string;
    district?: string;
    postalCode?: string;
    detail?: string;
  };
  highlights?: Record<string, string>;
  companyType?: string;
  industryTags?: string[];
  productKeywords?: string[];
  productFeatures?: string[];
  certifications?: string[];
  inspectionReports?: CompanyInspectionReport[];
  topProducts?: Array<{
    id: string;
    title: string;
    price: number;
    image: string;
    type?: ProductType;
    bundleItems?: ProductBundleItem[];
    bundleAvailableStock?: number | null;
    bundleTotalWeightGram?: number | null;
    defaultSkuId?: string;
  }>;
  isFollowed?: boolean;
};

export type CompanyInspectionReport = {
  id: string;
  title: string;
  fileUrl: string;
  issuer?: string;
  issuedAt?: string;
  createdAt?: string;
};

export type CompanyProduct = {
  id: string;
  title: string;
  price: number;
  image: string;
  type?: ProductType;
  bundleItems?: ProductBundleItem[];
  bundleAvailableStock?: number | null;
  bundleTotalWeightGram?: number | null;
  defaultSkuId: string;
  tags: string[];
  unit: string;
  origin: string;
  categoryName: string;
  /** 商品总剩余库存（所有 ACTIVE SKU 库存之和） */
  stock?: number;
  /** 单笔限购：仅当所有 ACTIVE SKU 都设了 maxPerOrder 时返回 min，否则 null */
  maxPerOrder?: number | null;
};

export type CompanyProductsResponse = {
  items: CompanyProduct[];
  total: number;
  page: number;
  pageSize: number;
  nextPage?: number;
  categories: string[];
};
