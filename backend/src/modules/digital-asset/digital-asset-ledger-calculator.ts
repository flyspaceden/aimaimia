export interface OrderAssetAmountInput {
  goodsAmount: number;
  shippingFee?: number | null;
  discountAmount?: number | null;
  vipDiscountAmount?: number | null;
  totalCouponDiscount?: number | null;
}

export interface OrderAssetAllocationItem {
  orderItemId: string;
  skuId: string | null;
  quantity: number;
  unitPrice: number;
  isPrize: boolean;
  createdAt: Date;
}

export interface OrderAssetAllocation {
  orderItemId: string;
  skuId: string | null;
  quantity: number;
  grossAmount: number;
  assetAmount: number;
}

export interface OrderAssetAllocationResult {
  allocations: OrderAssetAllocation[];
  residualOrderItemId: string | null;
}

const moneyValue = (value?: number | null): number =>
  Number.isFinite(value) ? Number(value) : 0;

export function roundMoney(value: number): number {
  const safeValue = moneyValue(value);
  return Math.round((safeValue + Number.EPSILON) * 100) / 100;
}

export function calculateOrderAssetAmount(order: OrderAssetAmountInput): number {
  return Math.max(0, roundMoney(
    moneyValue(order.goodsAmount)
      - moneyValue(order.discountAmount)
      - moneyValue(order.vipDiscountAmount)
      - moneyValue(order.totalCouponDiscount),
  ));
}

export function allocateOrderAssetAmount(input: {
  orderAssetAmount: number;
  items: OrderAssetAllocationItem[];
}): OrderAssetAllocationResult {
  const orderAssetAmount = roundMoney(Math.max(0, moneyValue(input.orderAssetAmount)));
  if (orderAssetAmount <= 0) {
    return { allocations: [], residualOrderItemId: null };
  }

  const items = [...input.items]
    .filter((item) => !item.isPrize)
    .map((item) => ({
      ...item,
      grossAmount: roundMoney(Math.max(0, moneyValue(item.unitPrice) * Math.max(0, item.quantity))),
    }))
    .filter((item) => item.grossAmount > 0)
    .sort((a, b) => {
      const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime();
      if (byCreatedAt !== 0) return byCreatedAt;
      return a.orderItemId.localeCompare(b.orderItemId);
    });

  if (items.length === 0) {
    return { allocations: [], residualOrderItemId: null };
  }

  const totalGross = roundMoney(items.reduce((sum, item) => sum + item.grossAmount, 0));
  if (totalGross <= 0) {
    return { allocations: [], residualOrderItemId: null };
  }

  let allocated = 0;
  const allocations = items.map((item, index): OrderAssetAllocation => {
    const isLast = index === items.length - 1;
    const assetAmount = isLast
      ? roundMoney(orderAssetAmount - allocated)
      : roundMoney(orderAssetAmount * (item.grossAmount / totalGross));
    allocated = roundMoney(allocated + assetAmount);
    return {
      orderItemId: item.orderItemId,
      skuId: item.skuId,
      quantity: item.quantity,
      grossAmount: item.grossAmount,
      assetAmount,
    };
  });

  return {
    allocations,
    residualOrderItemId: allocations[allocations.length - 1]?.orderItemId ?? null,
  };
}

export function calculateRefundProductAmount(input: {
  refundAmount: number;
  returnShippingFee?: number | null;
  shippingPaymentRefundAmount?: number | null;
}): number {
  return Math.max(0, roundMoney(
    moneyValue(input.refundAmount)
      - moneyValue(input.returnShippingFee)
      - moneyValue(input.shippingPaymentRefundAmount),
  ));
}

export function clampReversalAmount(input: {
  requestedAmount: number;
  lineRemainingAmount?: number;
  orderRemainingAmount: number;
}): number {
  const caps = [
    moneyValue(input.requestedAmount),
    moneyValue(input.orderRemainingAmount),
  ];
  if (input.lineRemainingAmount !== undefined) {
    caps.push(moneyValue(input.lineRemainingAmount));
  }

  return Math.max(0, roundMoney(Math.min(...caps)));
}
