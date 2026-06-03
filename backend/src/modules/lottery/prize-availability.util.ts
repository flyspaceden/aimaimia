export type PrizeUnavailableReason =
  | 'PRIZE_INACTIVE'
  | 'SKU_MISSING'
  | 'SKU_INACTIVE'
  | 'PRODUCT_MISSING'
  | 'PRODUCT_INACTIVE';

type StatusCarrier = { id?: string | null; status?: string | null } | null | undefined;

export type PrizeAvailabilityInput = {
  type?: string | null;
  isActive?: boolean | null;
  skuId?: string | null;
  productId?: string | null;
  sku?: (StatusCarrier & {
    id?: string | null;
    product?: StatusCarrier;
  }) | null;
  product?: StatusCarrier;
};

export function getPrizeUnavailableReason(
  prize: PrizeAvailabilityInput | null | undefined,
): PrizeUnavailableReason | null {
  if (!prize || prize.isActive === false) return 'PRIZE_INACTIVE';

  if (prize.type === 'NO_PRIZE') return null;

  const sku = prize.sku;
  if (!prize.skuId || !sku) return 'SKU_MISSING';
  if (sku.status !== 'ACTIVE') return 'SKU_INACTIVE';

  const product = sku.product ?? prize.product;
  if (!product) return 'PRODUCT_MISSING';
  if (product.status !== 'ACTIVE') return 'PRODUCT_INACTIVE';

  return null;
}

export function isPrizeAvailable(prize: PrizeAvailabilityInput | null | undefined): boolean {
  return getPrizeUnavailableReason(prize) === null;
}

export function getUnavailableReasonText(reason: PrizeUnavailableReason): string {
  switch (reason) {
    case 'PRIZE_INACTIVE':
      return '奖品已停发';
    case 'SKU_MISSING':
      return '商品规格不存在';
    case 'SKU_INACTIVE':
      return '商品规格已下架';
    case 'PRODUCT_MISSING':
      return '商品不存在';
    case 'PRODUCT_INACTIVE':
      return '商品已下架';
  }
}
