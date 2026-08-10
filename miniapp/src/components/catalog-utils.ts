import type { Company, CompanyProduct, Product, ProductDetail } from '@/types';

export type CatalogTab = 'products' | 'companies';

export function formatCatalogPrice(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function resolveProductStock(product: Pick<Product, 'type' | 'stock' | 'bundleAvailableStock'>): number | undefined {
  return product.type === 'BUNDLE'
    ? product.bundleAvailableStock ?? product.stock
    : product.stock;
}

export function catalogStockText(stock: number | undefined): string | undefined {
  if (stock === undefined) return undefined;
  if (stock <= 0) return '暂时缺货';
  if (stock <= 10) return `仅剩 ${stock} 件`;
  return '现货';
}

/** App 商品卡只提示低库存/售罄，正常库存不额外显示“现货”。 */
export function catalogCardStockText(stock: number | undefined, threshold = 10): string | undefined {
  if (stock === undefined || (threshold <= 0 && stock > 0) || stock > threshold) return undefined;
  if (stock <= 0) return '已售完';
  return `仅剩 ${stock} 件`;
}

export function buildProductUnitLabel(unit?: string | null): string | undefined {
  const value = unit?.trim();
  return value ? `单位 ${value}` : undefined;
}

export function buildProductWeightLabel(weightGram?: number | null): string | undefined {
  if (typeof weightGram !== 'number' || !Number.isFinite(weightGram) || weightGram <= 0) return undefined;
  return `包装重量 ${Number.isInteger(weightGram) ? weightGram : weightGram.toFixed(1)}克`;
}

/**
 * App 端以 certifications 为企业真实资质来源；badges 仅是历史展示字段的兼容回退。
 */
export function displayCompanyCertifications(company: Pick<Company, 'certifications' | 'badges'>): string[] {
  const normalize = (values: readonly string[] | undefined) => Array.from(new Set(
    (values ?? []).map((value) => value.trim()).filter(Boolean),
  ));
  const certifications = normalize(company.certifications);
  return certifications.length ? certifications : normalize(company.badges);
}

export type CatalogQuickAddAction =
  | { kind: 'add'; label: '加入购物车' }
  | { kind: 'detail'; label: '选择规格' | '查看商品' };

/** 商品卡片的快捷操作必须先按列表数据作体验分流，实际库存仍由后端购物车接口最终裁决。 */
export function resolveCatalogQuickAddAction(product: Pick<Product, 'defaultSkuId' | 'type' | 'stock' | 'bundleAvailableStock'>): CatalogQuickAddAction {
  if (!product.defaultSkuId) return { kind: 'detail', label: '选择规格' };
  const stock = resolveProductStock(product);
  if (stock !== undefined && stock <= 0) return { kind: 'detail', label: '查看商品' };
  return { kind: 'add', label: '加入购物车' };
}

export function productHeadlinePrice(detail: ProductDetail, skuId?: string): {
  value: number;
  from: boolean;
} {
  const selected = skuId ? detail.skus.find((sku) => sku.id === skuId) : undefined;
  if (selected) return { value: selected.price, from: false };
  if (detail.skus.length > 1) {
    const prices = detail.skus.map((sku) => sku.price);
    return { value: Math.min(...prices), from: Math.max(...prices) > Math.min(...prices) };
  }
  return { value: detail.skus[0]?.price ?? detail.price, from: false };
}

export function defaultSelectedSkuId(detail: ProductDetail): string | undefined {
  if (detail.skus.length === 1) return detail.skus[0].id;
  return undefined;
}

export function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s，。！？,.!?]+/g, '')
    .trim();
}

export function filterCompanies(companies: Company[], keyword: string): Company[] {
  const needle = normalizeSearch(keyword);
  if (!needle) return companies;
  return companies.filter((company) => normalizeSearch([
    company.name,
    company.shortName,
    company.mainBusiness,
    company.location,
    ...(company.badges ?? []),
    ...(company.certifications ?? []),
    ...(company.productKeywords ?? []),
  ].filter(Boolean).join(' ')).includes(needle));
}

export function paginateCatalog<T>(items: T[], page: number, pageSize: number): {
  items: T[];
  hasMore: boolean;
} {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.floor(pageSize));
  const visible = items.slice(0, safePage * safeSize);
  return { items: visible, hasMore: visible.length < items.length };
}

export function companyProductToProduct(item: CompanyProduct, company: Company): Product {
  return {
    ...item,
    type: item.type ?? 'SIMPLE',
    companyId: company.id,
    companyName: company.name,
  };
}
