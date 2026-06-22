import type { ProductType } from './Product';
import type { BundleSnapshotItem } from './BundleSnapshot';

/** 服务端购物车项（含商品快照 + 奖品/赠品字段） */
export interface ServerCartItem {
  id: string;
  skuId: string;
  quantity: number;
  productType?: ProductType;
  bundleItems?: BundleSnapshotItem[];
  /** SKU 关联的商品信息 */
  product: {
    id: string;
    title: string;
    image: string | null;
    price: number;
    categoryId?: string | null;
    companyId?: string | null;
    /** 奖品项的 SKU 原价（用于划线展示），普通商品项为 null */
    originalPrice: number | null;
    /** @deprecated compatibility mirror of sku.stock; use item.sku.stock for SKU-level stock */
    stock: number;
    maxPerOrder?: number | null;
  };
  sku?: {
    stock: number;
    maxPerOrder?: number | null;
  };
  /** 是否为抽奖奖品 */
  isPrize?: boolean;
  /** 是否为门槛赠品（锁定中） */
  isLocked?: boolean;
  /** 奖品/赠品过期时间 */
  expiresAt?: string;
  /** 赠品解锁门槛（非奖品已选商品总额达此值解锁） */
  threshold?: number;
  /** 关联的中奖记录 ID */
  prizeRecordId?: string;
  /** 奖品类型 */
  prizeType?: string;
  /** 服务端选中状态 */
  isSelected?: boolean;
  /** 下架/停发原因；存在时只能删除，不能勾选或结算 */
  unavailableReason?:
    | 'SKU_INACTIVE'
    | 'PRODUCT_INACTIVE'
    | 'PRIZE_INACTIVE'
    | 'SKU_MISSING'
    | 'PRODUCT_MISSING'
    | 'OUT_OF_STOCK'
    | null;
  stockStatus?: 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  selectable?: boolean;
}

export type CartMergeResultStatus =
  | 'MERGED'
  | 'REJECTED_ALREADY_DRAWN_TODAY'
  | 'REJECTED_TOKEN_INVALID'
  | 'REJECTED_TOKEN_EXPIRED'
  | 'REJECTED_TOKEN_USED'
  | 'REJECTED_PRIZE_INACTIVE'
  | 'REJECTED_CLAIM_PROCESSING'
  | 'REJECTED_ITEM_INVALID'
  | 'FAILED';

export interface CartMergeResultItem {
  localKey?: string;
  skuId: string;
  isPrize: boolean;
  status: CartMergeResultStatus;
  message?: string;
}

/** 服务端购物车 */
export interface ServerCart {
  id: string;
  items: ServerCartItem[];
  /** 合并时部分项失败的错误信息（仅 POST /cart/merge 返回） */
  mergeErrors?: string[];
  /** 合并结果（结构化状态，供前端精确处理匿名奖品） */
  mergeResults?: CartMergeResultItem[];
}
