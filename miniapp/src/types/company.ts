import type { ProductBundleItem, ProductType } from './product';
import type { PageQuery, PageResult } from './pagination';

export type CompanyInspectionReport = {
  id: string;
  title: string;
  fileUrl: string;
  issuer?: string;
  issuedAt?: string;
  createdAt?: string;
};

export type Company = {
  id: string;
  name: string;
  cover: string;
  mainBusiness: string;
  location: string;
  coordinates?: { lat: number; lng: number };
  distanceKm: number;
  badges: string[];
  latestTestedAt?: string;
  groupTargetSize?: number;
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
  supplyModes?: string[];
  serviceAreas?: string[];
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
    defaultSkuId?: string | null;
  }>;
  isFollowed?: boolean;
};

export type CompanyProduct = {
  id: string;
  title: string;
  price: number;
  priceFrom?: boolean;
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
  stock?: number;
  maxPerOrder?: number | null;
};

export type CompanyProductsQuery = PageQuery & { category?: string };
export type CompanyProductsResult = PageResult<CompanyProduct> & { categories: string[] };
export type DiscoveryFilter = { tagId: string; label: string; icon: string };
