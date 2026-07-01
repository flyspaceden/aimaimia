export type DeliveryPickupCartItem = {
  cartItemId: string;
  quantity: number;
};

export type DeliveryPickupPlanItem = {
  cartItemId: string;
  batchNo: number;
  quantity: number;
};

export type DeliveryPickupPlanValidationResult =
  | { ok: true }
  | { ok: false; message: string };

const isPositiveInteger = (value: number) => Number.isInteger(value) && value > 0;

export function buildDefaultDeliveryPickupPlan(
  items: DeliveryPickupCartItem[],
  plannedPickupCount: number,
): DeliveryPickupPlanItem[] {
  const batchCount = isPositiveInteger(plannedPickupCount) ? plannedPickupCount : 1;

  return items.flatMap((item) => {
    if (!item.cartItemId || !isPositiveInteger(item.quantity)) {
      return [];
    }

    const base = Math.floor(item.quantity / batchCount);
    const remainder = item.quantity % batchCount;

    return Array.from({ length: batchCount }, (_, index) => ({
      cartItemId: item.cartItemId,
      batchNo: index + 1,
      quantity: base + (index < remainder ? 1 : 0),
    })).filter((planItem) => planItem.quantity > 0);
  });
}

export function validateDeliveryPickupPlan(
  items: DeliveryPickupCartItem[],
  plan: DeliveryPickupPlanItem[],
): DeliveryPickupPlanValidationResult {
  const expectedTotals = new Map<string, number>();
  for (const item of items) {
    if (!item.cartItemId || !isPositiveInteger(item.quantity)) {
      return { ok: false, message: '商品数量必须是正整数' };
    }
    expectedTotals.set(item.cartItemId, (expectedTotals.get(item.cartItemId) ?? 0) + item.quantity);
  }

  const plannedTotals = new Map<string, number>();
  for (const planItem of plan) {
    if (!expectedTotals.has(planItem.cartItemId)) {
      return { ok: false, message: '提货计划包含未知商品' };
    }
    if (!isPositiveInteger(planItem.batchNo) || !isPositiveInteger(planItem.quantity)) {
      return { ok: false, message: '提货批次和数量必须是正整数' };
    }
    plannedTotals.set(
      planItem.cartItemId,
      (plannedTotals.get(planItem.cartItemId) ?? 0) + planItem.quantity,
    );
  }

  for (const [cartItemId, expectedQuantity] of expectedTotals.entries()) {
    if ((plannedTotals.get(cartItemId) ?? 0) !== expectedQuantity) {
      return { ok: false, message: '提货计划数量必须与购物车数量一致' };
    }
  }

  return { ok: true };
}
