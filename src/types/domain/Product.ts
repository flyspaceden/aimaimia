/**
 * 域模型：商品（Product）
 *
 * 用途：
 * - 首页/分类/搜索商品流、商品详情、购物车与订单项引用
 */
export type Product = {
  id: string;
  title: string;
  price: number;
  /** 列表接口返回的默认 SKU ID（首个 ACTIVE SKU） */
  defaultSkuId?: string;
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
};

/** 商品详情（后端 GET /products/:id 返回的完整数据） */
export type ProductDetail = Product & {
  /** 最终生效退货政策：RETURNABLE | NON_RETURNABLE */
  effectiveReturnPolicy?: string | null;
  subtitle?: string;
  description?: string;
  detailRich?: unknown;
  basePrice: number;
  companyName?: string;
  categoryId?: string;
  categoryName?: string;
  attributes?: Record<string, string>;
  aiKeywords?: string[];
  images: Array<{ id: string; url: string; alt?: string }>;
  videos?: Array<{ id: string; url: string }>;
  skus: Array<{
    id: string;
    title: string;
    price: number;
    stock: number;
    maxPerOrder?: number | null;
    skuCode?: string;
  }>;
};
