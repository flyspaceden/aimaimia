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
  plannedPickupCount = 1,
): DeliveryPickupPlanValidationResult {
  const expectedTotals = new Map<string, number>();
  let totalQuantity = 0;
  for (const item of items) {
    if (!item.cartItemId || !isPositiveInteger(item.quantity)) {
      return { ok: false, message: '商品数量必须是正整数' };
    }
    totalQuantity += item.quantity;
    expectedTotals.set(item.cartItemId, (expectedTotals.get(item.cartItemId) ?? 0) + item.quantity);
  }

  const batchCount = isPositiveInteger(plannedPickupCount) ? plannedPickupCount : 1;
  if (batchCount > totalQuantity) {
    return { ok: false, message: '配送批次不能超过所选商品总数量' };
  }

  const plannedTotals = new Map<string, number>();
  const usedBatchNos = new Set<number>();
  for (const planItem of plan) {
    if (!expectedTotals.has(planItem.cartItemId)) {
      return { ok: false, message: '配送计划包含未知商品' };
    }
    if (!isPositiveInteger(planItem.batchNo) || !isPositiveInteger(planItem.quantity)) {
      return { ok: false, message: '配送批次和数量必须是正整数' };
    }
    if (planItem.batchNo > batchCount) {
      return { ok: false, message: '配送批次编号超出计划范围' };
    }
    usedBatchNos.add(planItem.batchNo);
    plannedTotals.set(
      planItem.cartItemId,
      (plannedTotals.get(planItem.cartItemId) ?? 0) + planItem.quantity,
    );
  }

  for (const [cartItemId, expectedQuantity] of expectedTotals.entries()) {
    if ((plannedTotals.get(cartItemId) ?? 0) !== expectedQuantity) {
      return { ok: false, message: '配送计划数量必须与购物车数量一致' };
    }
  }

  if (batchCount > 1) {
    for (let batchNo = 1; batchNo <= batchCount; batchNo += 1) {
      if (!usedBatchNos.has(batchNo)) {
        return { ok: false, message: '配送计划必须覆盖每个计划批次' };
      }
    }
  }

  return { ok: true };
}
