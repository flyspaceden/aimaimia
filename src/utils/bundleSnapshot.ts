import type { ProductType } from '../types/domain/Product';
import type { BundleSnapshotItem } from '../types/domain/BundleSnapshot';

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const isBundleProductType = (productType?: ProductType): boolean => productType === 'BUNDLE';

export const formatBundleQuantityLabel = (item: Pick<BundleSnapshotItem, 'quantityPerBundle' | 'totalQuantity'>): string => {
  if (isPositiveNumber(item.totalQuantity)) {
    return `x${item.totalQuantity}`;
  }
  if (isPositiveNumber(item.quantityPerBundle)) {
    return `x${item.quantityPerBundle}`;
  }
  return 'x1';
};
