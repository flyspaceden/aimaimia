import { Result } from '../../types';
import {
  buildDeliveryPath,
  centsToYuan,
  deliveryApiClient,
  mapDeliveryResult,
} from './DeliveryAuthRepo';

export type DeliveryCatalogCategory = {
  id: string;
  name: string;
  status: string;
  level?: number;
  parentId?: string | null;
  sortOrder?: number;
};

export type DeliveryCatalogMerchant = {
  id: string;
  name: string;
  status?: string;
};

export type DeliveryCatalogSku = {
  id: string;
  title: string;
  imageUrl: string | null;
  stock: number;
  minOrderQuantity: number;
  orderStepQuantity: number;
  finalPrice: number;
};

export type DeliveryCatalogProduct = {
  id: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  detailRich?: unknown;
  media?: unknown;
  attributes?: Record<string, unknown> | null;
  unitName: string;
  unit: string;
  minOrderQuantity: number;
  orderStepQuantity: number;
  merchant: DeliveryCatalogMerchant;
  category: DeliveryCatalogCategory | null;
  imageUrl: string;
  image: string;
  defaultSkuId?: string;
  price: number;
  priceFrom: boolean;
  stock: number;
  skus: DeliveryCatalogSku[];
};

type DeliveryCatalogCategoryResponse = {
  id: string;
  name: string;
  status: string;
  level?: number;
  parentId?: string | null;
  sortOrder?: number;
};

type DeliveryCatalogProductResponse = {
  id: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  detailRich?: unknown;
  media?: unknown;
  attributes?: Record<string, unknown> | null;
  unitName: string;
  minOrderQuantity: number;
  orderStepQuantity: number;
  merchant: DeliveryCatalogMerchant;
  category: DeliveryCatalogCategoryResponse | null;
  minFinalPriceCents: number | null;
  skus: Array<{
    id: string;
    title: string;
    imageUrl: string | null;
    stock: number;
    minOrderQuantity: number;
    orderStepQuantity: number;
    finalPriceCents: number;
  }>;
};

type DeliveryCatalogListResponse = {
  items: DeliveryCatalogProductResponse[];
};

type DeliveryCategoryListResponse = {
  items: DeliveryCatalogCategoryResponse[];
};

const resolveDeliveryProductImage = (product: DeliveryCatalogProductResponse): string => {
  const firstSkuImage = product.skus.find((sku) => !!sku.imageUrl)?.imageUrl;
  if (firstSkuImage) {
    return firstSkuImage;
  }
  if (Array.isArray(product.media)) {
    const firstMedia = product.media[0];
    if (typeof firstMedia === 'string') {
      return firstMedia;
    }
    if (firstMedia && typeof firstMedia === 'object' && 'url' in firstMedia && typeof firstMedia.url === 'string') {
      return firstMedia.url;
    }
  }
  return '';
};

export const mapDeliveryCatalogProduct = (
  product: DeliveryCatalogProductResponse,
): DeliveryCatalogProduct => {
  const skus = product.skus.map((sku) => ({
    id: sku.id,
    title: sku.title,
    imageUrl: sku.imageUrl,
    stock: sku.stock,
    minOrderQuantity: sku.minOrderQuantity,
    orderStepQuantity: sku.orderStepQuantity,
    finalPrice: centsToYuan(sku.finalPriceCents),
  }));
  const priceSet = new Set(skus.map((sku) => sku.finalPrice));
  const imageUrl = resolveDeliveryProductImage(product);

  return {
    id: product.id,
    title: product.title,
    subtitle: product.subtitle ?? null,
    description: product.description ?? null,
    detailRich: product.detailRich,
    media: product.media,
    attributes: product.attributes ?? null,
    unitName: product.unitName,
    unit: product.unitName,
    minOrderQuantity: product.minOrderQuantity,
    orderStepQuantity: product.orderStepQuantity,
    merchant: {
      id: product.merchant.id,
      name: product.merchant.name,
      status: product.merchant.status,
    },
    category: product.category
      ? {
          id: product.category.id,
          name: product.category.name,
          status: product.category.status,
          level: product.category.level,
          parentId: product.category.parentId,
          sortOrder: product.category.sortOrder,
        }
      : null,
    imageUrl,
    image: imageUrl,
    defaultSkuId: skus[0]?.id,
    price: centsToYuan(product.minFinalPriceCents ?? product.skus[0]?.finalPriceCents ?? 0),
    priceFrom: priceSet.size > 1,
    stock: skus.reduce((sum, sku) => sum + sku.stock, 0),
    skus,
  };
};

export const deliveryProductPaths = {
  categories: () => buildDeliveryPath('categories'),
  list: () => buildDeliveryPath('products'),
  detail: (id: string) => buildDeliveryPath(`products/${id}`),
};

export const DeliveryProductRepo = {
  listCategories: (): Promise<Result<{ items: DeliveryCatalogCategory[] }>> =>
    deliveryApiClient
      .get<DeliveryCategoryListResponse>(deliveryProductPaths.categories())
      .then((result) =>
        mapDeliveryResult(result, (payload) => ({
          items: payload.items.map((item) => ({
            id: item.id,
            name: item.name,
            status: item.status,
            level: item.level,
            parentId: item.parentId,
            sortOrder: item.sortOrder,
          })),
        })),
      ),

  listProducts: (params?: {
    categoryId?: string;
    keyword?: string;
    quantity?: number;
  }): Promise<Result<{ items: DeliveryCatalogProduct[] }>> =>
    deliveryApiClient
      .get<DeliveryCatalogListResponse>(deliveryProductPaths.list(), params)
      .then((result) =>
        mapDeliveryResult(result, (payload) => ({
          items: payload.items.map(mapDeliveryCatalogProduct),
        })),
      ),

  getById: (id: string, params?: { quantity?: number }): Promise<Result<DeliveryCatalogProduct>> =>
    deliveryApiClient
      .get<DeliveryCatalogProductResponse>(deliveryProductPaths.detail(id), params)
      .then((result) => mapDeliveryResult(result, mapDeliveryCatalogProduct)),
};
