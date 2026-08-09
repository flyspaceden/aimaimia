import type { Company, CompanyProduct, Product, ProductDetail } from '@/types';

export type CatalogTab = 'products' | 'companies';

export function formatCatalogPrice(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function resolveProductStock(product: Pick<Product, 'type' | 'stock' | 'bundleAvailableStock'>): number | undefined {
  return product.type === 'BUNDLE'
    ? product.bundleAvailableStock ?? undefined
    : product.stock;
}

export function catalogStockText(stock: number | undefined): string | undefined {
  if (stock === undefined) return undefined;
  if (stock <= 0) return '暂时缺货';
  if (stock <= 10) return `仅剩 ${stock} 件`;
  return '现货';
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
