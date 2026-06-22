import type { Product, ProductBundleItem, ProductType } from '../types/domain/Product';
import type { BundleSnapshotItem } from '../types/domain/BundleSnapshot';
import type { ServerCartItem } from '../types/domain/ServerCart';

type RawBundleItem = Partial<BundleSnapshotItem & ProductBundleItem> & {
  quantity?: number;
  sku?: {
    title?: string | null;
    product?: {
      title?: string | null;
      image?: string | null;
      media?: Array<{ url?: string | null }> | null;
    } | null;
  } | null;
};

const asPositiveNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
};

export const normalizeCartBundleItems = (items: unknown): BundleSnapshotItem[] | undefined => {
  if (!Array.isArray(items)) {
    return undefined;
  }

  const normalized = items
    .map((item): BundleSnapshotItem | null => {
      const raw = item as RawBundleItem;
      if (!raw.skuId) {
        return null;
      }

      const quantityPerBundle =
        asPositiveNumber(raw.quantityPerBundle) ?? asPositiveNumber(raw.quantity);
      const totalQuantity = asPositiveNumber(raw.totalQuantity);
      const productTitle = raw.productTitle || raw.sku?.product?.title || '';
      const skuTitle = raw.skuTitle || raw.sku?.title || '默认规格';
      const image = raw.image || raw.sku?.product?.image || raw.sku?.product?.media?.[0]?.url || '';

      return {
        skuId: raw.skuId,
        productTitle,
        skuTitle,
        ...(quantityPerBundle ? { quantityPerBundle } : {}),
        ...(totalQuantity ? { totalQuantity } : {}),
        ...(image ? { image } : {}),
      };
    })
    .filter((item): item is BundleSnapshotItem => item !== null);

  return normalized.length > 0 ? normalized : undefined;
};

export const mapServerCartItemToLocal = (si: ServerCartItem) => {
  const product = si.product as ServerCartItem['product'] & {
    type?: ProductType | null;
    bundleItems?: unknown;
  };
  const productType = si.productType ?? product.type ?? 'SIMPLE';

  return {
    id: si.id,
    productId: si.product.id,
    skuId: si.skuId,
    productType,
    bundleItems: normalizeCartBundleItems(si.bundleItems ?? product.bundleItems),
    categoryId: si.product.categoryId ?? undefined,
    companyId: si.product.companyId ?? undefined,
    title: si.product.title,
    price: si.product.price,
    image: si.product.image || '',
    quantity: si.quantity,
    isPrize: si.isPrize,
    isLocked: si.isLocked,
    expiresAt: si.expiresAt,
    threshold: si.threshold,
    prizeRecordId: si.prizeRecordId,
    prizeType: si.prizeType,
    originalPrice: si.product.originalPrice,
    maxPerOrder: si.product.maxPerOrder ?? null,
    unavailableReason: si.unavailableReason ?? null,
    stock: si.sku?.stock ?? si.product.stock,
  };
};

export const buildOptimisticCartItem = ({
  product,
  quantity,
  skuId,
  skuPrice,
}: {
  product: Product & { maxPerOrder?: number | null };
  quantity: number;
  skuId?: string;
  skuPrice?: number;
}) => ({
  productId: product.id,
  skuId,
  productType: product.type,
  bundleItems: normalizeCartBundleItems(product.bundleItems),
  categoryId: product.categoryId,
  companyId: product.companyId,
  title: product.title,
  price: skuPrice ?? product.price,
  image: product.image,
  quantity: Math.max(1, quantity),
  maxPerOrder: product.maxPerOrder ?? null,
});
