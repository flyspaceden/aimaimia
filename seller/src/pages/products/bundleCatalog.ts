export const BUNDLE_CATALOG_PAGE_SIZE = 50;

export type BundleCatalogProductType = 'SIMPLE' | 'BUNDLE';

export function buildBundleCatalogQuery(keyword?: string, productType?: BundleCatalogProductType) {
  const query: {
    page: number;
    pageSize: number;
    status: 'ACTIVE';
    productType?: BundleCatalogProductType;
    keyword?: string;
  } = {
    page: 1,
    pageSize: BUNDLE_CATALOG_PAGE_SIZE,
    status: 'ACTIVE',
  };

  if (productType) {
    query.productType = productType;
  }

  const normalizedKeyword = keyword?.trim();
  if (normalizedKeyword) {
    query.keyword = normalizedKeyword;
  }

  return query;
}
