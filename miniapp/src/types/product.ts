import type { PageQuery } from './pagination';

export type ProductType = 'SIMPLE' | 'BUNDLE';

export type ProductBundleItem = {
  skuId: string;
  productId: string;
  productTitle: string;
  skuTitle: string;
  quantity: number;
  image?: string;
  stock?: number;
  weightGram?: number;
};

export type Product = {
  id: string;
  title: string;
  price: number;
  type: ProductType;
  bundleItems?: ProductBundleItem[];
  bundleAvailableStock?: number | null;
  bundleTotalWeightGram?: number | null;
  defaultSkuId?: string | null;
  unit: string;
  origin: string;
  image: string;
  tags: string[];
  strikePrice?: number;
  categoryId?: string;
  categoryName?: string;
  companyId?: string;
  companyName?: string;
  rating?: number;
  monthlySales?: number;
  stock?: number;
  maxPerOrder?: number | null;
  priceFrom?: boolean;
};

export type ProductDetail = Product & {
  effectiveReturnPolicy?: string | null;
  subtitle?: string;
  description?: string;
  detailRich?: unknown;
  basePrice: number;
  /** Prisma Json；必须过滤后展示，不能假设所有值都是字符串。 */
  attributes?: Record<string, unknown>;
  aiKeywords?: string[];
  images: Array<{ id: string; url: string; alt?: string }>;
  videos?: Array<{ id: string; url: string }>;
  skus: Array<{
    id: string;
    title: string;
    price: number;
    stock: number;
    weightGram?: number | null;
    maxPerOrder?: number | null;
    skuCode?: string;
  }>;
};

export type Category = {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
  path: string;
  icon?: string;
};

export type ProductListQuery = PageQuery & {
  categoryId?: string;
  keyword?: string;
  preferRecommended?: boolean;
  constraints?: string[];
  maxPrice?: number;
  recommendThemes?: Array<'hot' | 'discount' | 'tasty' | 'seasonal' | 'recent'>;
  usageScenario?: string;
  originPreference?: string;
  dietaryPreference?: string;
  flavorPreference?: string;
  categoryHint?: string;
};

export type RecommendationItem = {
  id: string;
  product: Product;
  reason: string;
};
