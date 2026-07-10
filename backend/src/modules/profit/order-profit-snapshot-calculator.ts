import {
  allocateCentsByLargestRemainder,
  checkedSafeIntegerSum,
  isNonNegativeIntegerCents,
} from './money-allocation';
import {
  ProfitCalculationErrorCode,
  ProfitCalculationInput,
  ProfitCalculationResult,
  ProfitItemBreakdown,
} from './profit.types';

type DiscountField =
  | 'vipDiscountCents'
  | 'rewardDeductionCents'
  | 'groupBuyRebateDeductionCents'
  | 'couponDiscountCents';

interface WorkingItem extends ProfitItemBreakdown {
  costMissing: boolean;
}

export class OrderProfitSnapshotCalculator {
  calculate(input: ProfitCalculationInput): ProfitCalculationResult {
    const amounts = {
      grossGoodsAmountCents: input.grossGoodsAmountCents,
      vipDiscountCents: input.vipDiscountCents ?? 0,
      rewardDeductionCents: input.rewardDeductionCents ?? 0,
      groupBuyRebateDeductionCents: input.groupBuyRebateDeductionCents ?? 0,
      couponDiscountCents: input.couponDiscountCents ?? 0,
      otherGoodsDiscountCents: input.otherGoodsDiscountCents ?? 0,
    };
    const amountValues = Object.values(amounts);

    if (amountValues.some((value) => !isNonNegativeIntegerCents(value))) {
      return this.reconciliationResult(
        amounts,
        [],
        'ORDER_PROFIT_CONSERVATION_FAILED',
        { reason: 'INVALID_ORDER_AMOUNT' },
      );
    }

    const ids = input.items.map((item) => item.id);
    const duplicateIds = ids.filter((id, index) => !id || ids.indexOf(id) !== index);
    if (duplicateIds.length > 0) {
      return this.reconciliationResult(
        amounts,
        [],
        'ORDER_PROFIT_CONSERVATION_FAILED',
        { reason: 'INVALID_ORDER_ITEM_ID', orderItemIds: [...new Set(duplicateIds)] },
      );
    }

    const invalidPrizeDiscount = input.items.some(
      (item) => item.isPrize && (item.explicitDiscountCents ?? 0) !== 0,
    );
    const nonPrizeItems = input.items
      .filter((item) => !item.isPrize)
      .sort((a, b) => a.id.localeCompare(b.id));
    const invalidItem = nonPrizeItems.some((item) => {
      const gross = item.unitPriceCents * item.quantity;
      return !isNonNegativeIntegerCents(item.unitPriceCents)
        || !Number.isSafeInteger(item.quantity)
        || item.quantity <= 0
        || !isNonNegativeIntegerCents(item.explicitDiscountCents ?? 0)
        || !Number.isSafeInteger(gross);
    });

    if (invalidPrizeDiscount || invalidItem) {
      return this.reconciliationResult(
        amounts,
        [],
        'ORDER_PROFIT_CONSERVATION_FAILED',
        { reason: invalidPrizeDiscount ? 'PRIZE_DISCOUNT_NOT_ALLOWED' : 'INVALID_ORDER_ITEM_AMOUNT' },
      );
    }

    const workingItems: WorkingItem[] = nonPrizeItems.map((item) => {
      const validUnitCost = Number.isSafeInteger(item.unitCostCents)
        && Number(item.unitCostCents) > 0;
      const unitCostCents = validUnitCost ? Number(item.unitCostCents) : 0;
      const grossGoodsAmountCents = item.unitPriceCents * item.quantity;
      const productCostCents = validUnitCost
        && Number.isSafeInteger(unitCostCents * item.quantity)
        ? unitCostCents * item.quantity
        : 0;

      return {
        orderItemId: item.id,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        unitCostCents,
        grossGoodsAmountCents,
        explicitDiscountCents: Math.min(item.explicitDiscountCents ?? 0, grossGoodsAmountCents),
        vipDiscountCents: 0,
        rewardDeductionCents: 0,
        groupBuyRebateDeductionCents: 0,
        couponDiscountCents: 0,
        totalDiscountCents: 0,
        netGoodsRevenueCents: grossGoodsAmountCents,
        productCostCents,
        grossProfitCents: grossGoodsAmountCents - productCostCents,
        distributableProfitShareCents: 0,
        captainEligible: item.captainEligible,
        costMissing: !validUnitCost
          || !Number.isSafeInteger(Number(item.unitCostCents) * item.quantity),
      };
    });

    const calculatedGross = checkedSafeIntegerSum(
      workingItems.map((item) => item.grossGoodsAmountCents),
    );
    const declaredExplicitDiscount = checkedSafeIntegerSum(
      nonPrizeItems.map((item) => item.explicitDiscountCents ?? 0),
    );
    const explicitDiscountAllocated = checkedSafeIntegerSum(
      workingItems.map((item) => item.explicitDiscountCents),
    );
    const totalDiscountCents = checkedSafeIntegerSum([
      amounts.otherGoodsDiscountCents,
      amounts.vipDiscountCents,
      amounts.rewardDeductionCents,
      amounts.groupBuyRebateDeductionCents,
      amounts.couponDiscountCents,
    ]);
    const aggregateOverflow = calculatedGross === null
      || declaredExplicitDiscount === null
      || explicitDiscountAllocated === null
      || totalDiscountCents === null;
    const explicitDiscountConserved = !aggregateOverflow
      && declaredExplicitDiscount === explicitDiscountAllocated
      && amounts.otherGoodsDiscountCents === declaredExplicitDiscount;

    for (const item of workingItems) {
      this.refreshItemTotals(item);
    }

    let discountAllocationFailed = false;
    const orderedDiscounts: Array<{ field: DiscountField; amount: number }> = [
      { field: 'vipDiscountCents', amount: amounts.vipDiscountCents },
      { field: 'rewardDeductionCents', amount: amounts.rewardDeductionCents },
      { field: 'groupBuyRebateDeductionCents', amount: amounts.groupBuyRebateDeductionCents },
      { field: 'couponDiscountCents', amount: amounts.couponDiscountCents },
    ];

    for (const discount of orderedDiscounts) {
      let allocation;
      try {
        allocation = allocateCentsByLargestRemainder(
          discount.amount,
          workingItems.map((item) => ({
            id: item.orderItemId,
            weightCents: item.netGoodsRevenueCents,
            capacityCents: item.netGoodsRevenueCents,
          })),
        );
      } catch (error) {
        return this.reconciliationResult(
          amounts,
          workingItems,
          'ORDER_PROFIT_CONSERVATION_FAILED',
          { reason: 'UNSAFE_DISCOUNT_ALLOCATION' },
        );
      }

      if (allocation.unallocatedCents !== 0) discountAllocationFailed = true;
      for (const item of workingItems) {
        item[discount.field] = allocation.allocations[item.orderItemId] ?? 0;
        this.refreshItemTotals(item);
      }
    }

    const allocatedDiscountCents = checkedSafeIntegerSum(
      workingItems.map((item) => item.totalDiscountCents),
    );
    const netGoodsRevenueCents = checkedSafeIntegerSum(
      workingItems.map((item) => item.netGoodsRevenueCents),
    );
    const productCostCents = checkedSafeIntegerSum(
      workingItems.map((item) => item.productCostCents),
    );
    const conservationFailed = aggregateOverflow
      || allocatedDiscountCents === null
      || netGoodsRevenueCents === null
      || productCostCents === null
      || calculatedGross !== amounts.grossGoodsAmountCents
      || !explicitDiscountConserved
      || discountAllocationFailed
      || allocatedDiscountCents !== totalDiscountCents
      || netGoodsRevenueCents !== amounts.grossGoodsAmountCents - (totalDiscountCents ?? 0)
      || workingItems.some((item) => item.netGoodsRevenueCents < 0);

    if (conservationFailed) {
      return this.reconciliationResult(
        amounts,
        workingItems,
        'ORDER_PROFIT_CONSERVATION_FAILED',
        {
          reason: 'ORDER_OR_ITEM_TOTAL_MISMATCH',
          calculatedGrossGoodsAmountCents: calculatedGross,
          allocatedDiscountCents,
          expectedDiscountCents: totalDiscountCents,
        },
      );
    }

    const missingCostItemIds = workingItems
      .filter((item) => item.costMissing)
      .map((item) => item.orderItemId);
    if (missingCostItemIds.length > 0) {
      return this.reconciliationResult(
        amounts,
        workingItems,
        'ORDER_PROFIT_COST_MISSING',
        { orderItemIds: missingCostItemIds },
      );
    }

    const orderMarginCents = checkedSafeIntegerSum(
      workingItems.map((item) => item.grossProfitCents),
    );
    if (orderMarginCents === null) {
      return this.reconciliationResult(
        amounts,
        workingItems,
        'ORDER_PROFIT_CONSERVATION_FAILED',
        { reason: 'UNSAFE_PROFIT_AGGREGATE' },
      );
    }
    const distributableProfitCents = Math.max(0, orderMarginCents);
    let profitAllocation;
    try {
      profitAllocation = allocateCentsByLargestRemainder(
        distributableProfitCents,
        workingItems.map((item) => {
          const positiveMargin = Math.max(0, item.grossProfitCents);
          return {
            id: item.orderItemId,
            weightCents: positiveMargin,
            capacityCents: positiveMargin,
          };
        }),
      );
    } catch (error) {
      return this.reconciliationResult(
        amounts,
        workingItems,
        'ORDER_PROFIT_CONSERVATION_FAILED',
        { reason: 'UNSAFE_PROFIT_ALLOCATION' },
      );
    }

    for (const item of workingItems) {
      item.distributableProfitShareCents = profitAllocation.allocations[item.orderItemId] ?? 0;
    }
    const allocatedProfitCents = checkedSafeIntegerSum(
      workingItems.map((item) => item.distributableProfitShareCents),
    );
    const captainEligibleProfitCents = checkedSafeIntegerSum(
      workingItems
        .filter((item) => item.captainEligible)
        .map((item) => item.distributableProfitShareCents),
    );

    if (
      profitAllocation.unallocatedCents !== 0
      || allocatedProfitCents === null
      || captainEligibleProfitCents === null
      || allocatedProfitCents !== distributableProfitCents
      || captainEligibleProfitCents < 0
      || captainEligibleProfitCents > distributableProfitCents
    ) {
      return this.reconciliationResult(
        amounts,
        workingItems,
        'ORDER_PROFIT_CONSERVATION_FAILED',
        { reason: 'PROFIT_SHARE_MISMATCH' },
      );
    }

    return {
      status: 'READY',
      ...amounts,
      totalDiscountCents: totalDiscountCents as number,
      netGoodsRevenueCents: netGoodsRevenueCents as number,
      productCostCents: productCostCents as number,
      distributableProfitCents,
      captainEligibleProfitCents: captainEligibleProfitCents as number,
      itemBreakdown: this.publicBreakdown(workingItems),
    };
  }

  private refreshItemTotals(item: WorkingItem): void {
    item.totalDiscountCents = item.explicitDiscountCents
      + item.vipDiscountCents
      + item.rewardDeductionCents
      + item.groupBuyRebateDeductionCents
      + item.couponDiscountCents;
    item.netGoodsRevenueCents = Math.max(
      0,
      item.grossGoodsAmountCents - item.totalDiscountCents,
    );
    item.grossProfitCents = item.netGoodsRevenueCents - item.productCostCents;
  }

  private reconciliationResult(
    amounts: Pick<
      ProfitCalculationResult,
      | 'grossGoodsAmountCents'
      | 'vipDiscountCents'
      | 'rewardDeductionCents'
      | 'groupBuyRebateDeductionCents'
      | 'couponDiscountCents'
      | 'otherGoodsDiscountCents'
    >,
    items: WorkingItem[],
    errorCode: ProfitCalculationErrorCode,
    errorMeta: Record<string, unknown>,
  ): ProfitCalculationResult {
    for (const item of items) {
      item.distributableProfitShareCents = 0;
    }
    const totalDiscountCents = checkedSafeIntegerSum([
      amounts.otherGoodsDiscountCents,
      amounts.vipDiscountCents,
      amounts.rewardDeductionCents,
      amounts.groupBuyRebateDeductionCents,
      amounts.couponDiscountCents,
    ]) ?? 0;

    return {
      status: 'RECONCILIATION_REQUIRED',
      ...amounts,
      totalDiscountCents,
      netGoodsRevenueCents: checkedSafeIntegerSum(
        items.map((item) => item.netGoodsRevenueCents),
      ) ?? 0,
      productCostCents: checkedSafeIntegerSum(
        items.map((item) => item.productCostCents),
      ) ?? 0,
      distributableProfitCents: 0,
      captainEligibleProfitCents: 0,
      itemBreakdown: this.publicBreakdown(items),
      errorCode,
      errorMeta,
    };
  }

  private publicBreakdown(items: WorkingItem[]): ProfitItemBreakdown[] {
    return items.map(({ costMissing: _costMissing, ...item }) => item);
  }
}
