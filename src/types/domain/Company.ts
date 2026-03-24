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
  badges: string[];
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
  topProducts?: Array<{
    id: string;
    title: string;
    price: number;
    image: string;
    defaultSkuId?: string;
  }>;
  isFollowed?: boolean;
};

export type CompanyProduct = {
  id: string;
  title: string;
  price: number;
  image: string;
  defaultSkuId: string;
  tags: string[];
  unit: string;
  origin: string;
  categoryName: string;
};

export type CompanyProductsResponse = {
  items: CompanyProduct[];
  total: number;
  page: number;
  pageSize: number;
  nextPage?: number;
  categories: string[];
};
