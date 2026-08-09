import type { ProductType } from './product';

export type CartBundleItem = {
  skuId: string;
  productTitle: string;
  skuTitle: string;
  quantityPerBundle?: number;
  totalQuantity?: number;
  image?: string;
};

export type CartUnavailableReason =
  | 'SKU_INACTIVE'
  | 'PRODUCT_INACTIVE'
  | 'PRIZE_INACTIVE'
  | 'SKU_MISSING'
  | 'PRODUCT_MISSING'
  | 'OUT_OF_STOCK';

export type CartItem = {
  id: string;
  skuId: string;
  quantity: number;
  productType?: ProductType;
  bundleItems?: CartBundleItem[];
  product: {
    id: string;
    title: string;
    type?: ProductType;
    image: string | null;
    price: number;
    categoryId?: string | null;
    companyId?: string | null;
    bundleItems?: CartBundleItem[];
    originalPrice: number | null;
    stock: number;
    maxPerOrder?: number | null;
  };
  sku?: { stock: number; maxPerOrder?: number | null };
  isPrize?: boolean;
  isLocked?: boolean;
  expiresAt?: string | null;
  threshold?: number | null;
  unlockDeficit?: number | null;
  prizeRecordId?: string | null;
  prizeType?: string | null;
  isSelected?: boolean;
  unavailableReason?: CartUnavailableReason | null;
  stockStatus?: 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  selectable?: boolean;
};

export type CartMergeItem = {
  localKey?: string;
  skuId: string;
  quantity: number;
  isPrize?: boolean;
  claimToken?: string;
};

export type Cart = {
  id: string;
  items: CartItem[];
  selectedTotal?: number;
  lockedGiftsInfo?: Array<{
    cartItemId: string;
    threshold: number;
    deficit: number;
    unlocked: boolean;
  }>;
  mergeErrors?: string[];
  mergeResults?: Array<{
    localKey?: string;
    skuId: string;
    isPrize: boolean;
    status: string;
    message?: string;
  }>;
};
