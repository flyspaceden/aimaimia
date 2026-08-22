import { BadRequestException, Injectable } from '@nestjs/common';
import { ProductAuditStatus, ProductStatus, ProductType, SkuStatus } from '@prisma/client';

export type BundleItemInput = { skuId: string; quantity: number; sortOrder?: number };
export type NormalizedBundleItem = { skuId: string; quantity: number; sortOrder: number };
export type BundleAvailabilityInput = {
  stock: number;
  quantity: number;
  skuStatus?: SkuStatus | `${SkuStatus}` | string | null;
  productStatus?: ProductStatus | `${ProductStatus}` | string | null;
  productAuditStatus?: ProductAuditStatus | `${ProductAuditStatus}` | string | null;
};
export type BundleSnapshotItem = {
  skuId: string;
  productId: string;
  productTitle: string;
  skuTitle: string;
  quantityPerBundle: number;
  bundleQuantity: number;
  totalQuantity: number;
  unitPriceAtCheckout: number;
  image: string;
  weightGram: number;
};
export type InventoryMovement = {
  skuId: string;
  quantity: number;
  companyId: string;
  label: string;
};

export type ValidateSellerBundleItemsOptions = {
  allowDraft?: boolean;
};

export type ValidatedSellerBundleItem = NormalizedBundleItem & {
  sku: {
    id: string;
    title: string;
    weightGram: number;
    status: SkuStatus;
    product: {
      id: string;
      title: string;
      companyId: string;
      status: ProductStatus;
      auditStatus: ProductAuditStatus;
      type: ProductType;
    };
  };
};

type ProductBundleValidationTx = {
  productSKU: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      title?: string | null;
      weightGram: number;
      status: SkuStatus | `${SkuStatus}`;
      product: {
        id: string;
        title?: string | null;
        companyId: string;
        status: ProductStatus | `${ProductStatus}`;
        auditStatus: ProductAuditStatus | `${ProductAuditStatus}`;
        type: ProductType | `${ProductType}`;
      };
    }>>;
  };
};

@Injectable()
export class ProductBundleService {
  private componentLabel(sku: {
    id: string;
    title?: string | null;
    product: { title?: string | null };
  }) {
    const productTitle = sku.product.title?.trim() || '未命名商品';
    const skuTitle = sku.title?.trim() || '默认规格';
    return `${productTitle} / ${skuTitle}`;
  }

  mergeBundleItems(items: BundleItemInput[]): NormalizedBundleItem[] {
    const merged = new Map<string, NormalizedBundleItem>();

    items.forEach((item, index) => {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new BadRequestException('组合商品组件数量必须大于 0');
      }

      const existing = merged.get(item.skuId);
      if (existing) {
        existing.quantity += item.quantity;
        return;
      }

      merged.set(item.skuId, {
        skuId: item.skuId,
        quantity: item.quantity,
        sortOrder: item.sortOrder ?? index,
      });
    });

    return Array.from(merged.values());
  }

  private isSellableAvailabilityInput(item: BundleAvailabilityInput): boolean {
    if (item.skuStatus !== undefined && item.skuStatus !== null && item.skuStatus !== SkuStatus.ACTIVE) {
      return false;
    }
    if (
      item.productStatus !== undefined &&
      item.productStatus !== null &&
      item.productStatus !== ProductStatus.ACTIVE
    ) {
      return false;
    }
    if (
      item.productAuditStatus !== undefined &&
      item.productAuditStatus !== null &&
      item.productAuditStatus !== ProductAuditStatus.APPROVED
    ) {
      return false;
    }
    return true;
  }

  calculateAvailability(items: BundleAvailabilityInput[]): number {
    if (items.length === 0) return 0;

    return Math.max(0, items.reduce((minAvailability, item) => {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new BadRequestException('组合商品组件数量必须大于 0');
      }

      const stock = this.isSellableAvailabilityInput(item) ? item.stock : 0;
      const availability = Math.floor(stock / item.quantity);
      return Math.min(minAvailability, availability);
    }, Number.POSITIVE_INFINITY));
  }

  calculateTotalWeightGram(items: Array<{ weightGram: number; quantity: number }>): number {
    return items.reduce((total, item) => {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new BadRequestException('组合商品组件数量必须大于 0');
      }
      if (!Number.isInteger(item.weightGram) || item.weightGram <= 0) {
        throw new BadRequestException('组合商品组件重量必须大于 0');
      }

      return total + item.weightGram * item.quantity;
    }, 0);
  }

  buildInventoryMovements(snapshotItem: {
    skuId: string;
    quantity: number;
    companyId: string;
    productSnapshot?: {
      bundleItems?: Array<Pick<BundleSnapshotItem, 'skuId'> & Partial<BundleSnapshotItem>>;
    } | null;
  }): InventoryMovement[] {
    if (!Number.isInteger(snapshotItem.quantity) || snapshotItem.quantity <= 0) {
      throw new BadRequestException('组合商品订单快照父商品数量必须大于 0');
    }

    const bundleItems = snapshotItem.productSnapshot?.bundleItems ?? [];
    if (bundleItems.length === 0) {
      throw new BadRequestException('组合商品订单快照缺少组件信息');
    }

    return bundleItems.map((item) => {
      const quantityPerBundle = item.quantityPerBundle;
      if (item.totalQuantity !== undefined && (!Number.isInteger(item.totalQuantity) || item.totalQuantity <= 0)) {
        throw new BadRequestException('组合商品订单快照组件总数量必须大于 0');
      }
      if (
        item.totalQuantity === undefined &&
        (!Number.isInteger(quantityPerBundle) || (quantityPerBundle ?? 0) <= 0)
      ) {
        throw new BadRequestException('组合商品订单快照缺少有效组件数量');
      }

      return {
        skuId: item.skuId,
        quantity: item.totalQuantity ?? (quantityPerBundle as number) * snapshotItem.quantity,
        companyId: snapshotItem.companyId,
        label: `Bundle component: ${item.skuTitle || item.productTitle || item.skuId}`,
      };
    });
  }

  async validateSellerBundleItems(
    tx: ProductBundleValidationTx,
    companyId: string,
    items: BundleItemInput[],
    options: ValidateSellerBundleItemsOptions = {},
  ): Promise<ValidatedSellerBundleItem[]> {
    const normalizedItems = this.mergeBundleItems(items);
    const skuIds = normalizedItems.map((item) => item.skuId);

    const skuRows = await tx.productSKU.findMany({
      where: { id: { in: skuIds } },
      select: {
        id: true,
        title: true,
        weightGram: true,
        status: true,
        product: {
          select: {
            id: true,
            title: true,
            companyId: true,
            status: true,
            auditStatus: true,
            type: true,
          },
        },
      },
    });

    const skuById = new Map(skuRows.map((sku) => [sku.id, sku]));

    return normalizedItems.map((item) => {
      const sku = skuById.get(item.skuId);
      if (!sku) {
        throw new BadRequestException(`组合商品组件 SKU 不存在: ${item.skuId}`);
      }
      if (sku.product.companyId !== companyId) {
        throw new BadRequestException('组合商品仅支持同商户商品');
      }
      if (sku.status !== SkuStatus.ACTIVE) {
        throw new BadRequestException(`组合内容中「${this.componentLabel(sku)}」规格已下架，请移除后重新选择`);
      }
      if (!options.allowDraft && sku.product.status !== ProductStatus.ACTIVE) {
        throw new BadRequestException(`组合内容中「${this.componentLabel(sku)}」尚未启用，请先上架该商品后再用于组合商品`);
      }
      if (!options.allowDraft && sku.product.auditStatus !== ProductAuditStatus.APPROVED) {
        throw new BadRequestException(`组合内容中「${this.componentLabel(sku)}」尚未审核通过，请先等待该商品审核通过后再用于组合商品`);
      }
      if (sku.product.type === ProductType.BUNDLE) {
        throw new BadRequestException(`组合内容中「${this.componentLabel(sku)}」是组合商品，不能作为另一个组合商品的组件`);
      }
      if (!Number.isInteger(sku.weightGram) || sku.weightGram <= 0) {
        throw new BadRequestException(`组合内容中「${this.componentLabel(sku)}」缺少有效重量，请先补全重量`);
      }

      return {
        ...item,
        sku: {
          id: sku.id,
          title: sku.title ?? '',
          weightGram: sku.weightGram,
          status: sku.status as SkuStatus,
          product: {
            id: sku.product.id,
            title: sku.product.title ?? '',
            companyId: sku.product.companyId,
            status: sku.product.status as ProductStatus,
            auditStatus: sku.product.auditStatus as ProductAuditStatus,
            type: sku.product.type as ProductType,
          },
        },
      };
    });
  }
}
