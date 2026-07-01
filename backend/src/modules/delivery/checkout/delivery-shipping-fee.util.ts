import { DeliveryShippingCalcType } from '../../../generated/delivery-client';

export type DeliveryShippingRuleForEstimate = {
  id: string;
  merchantId: string | null;
  calcType: DeliveryShippingCalcType;
  firstWeightGram: number;
  firstWeightPriceCents: number;
  additionalWeightGram: number | null;
  additionalWeightPriceCents: number | null;
  freeShippingThresholdCents: number | null;
  minShippingFeeCents: number;
  sortOrder: number;
};

export type DeliveryShippingMetricItem = {
  quantity: number;
  weightGram: number;
  lineAmountCents: number;
};

export function resolveDeliveryShippingFee(
  merchantId: string,
  items: DeliveryShippingMetricItem[],
  goodsAmountCents: number,
  shippingRules: DeliveryShippingRuleForEstimate[],
) {
  const merchantRule =
    shippingRules.find((rule) => rule.merchantId === merchantId) ??
    shippingRules.find((rule) => rule.merchantId === null);

  if (!merchantRule) {
    return {
      ruleId: null,
      calcType: null,
      metricValue: 0,
      shippingFeeCents: 0,
      fallbackReason: 'NO_DELIVERY_SHIPPING_RULE',
    };
  }

  const metricValue = resolveDeliveryShippingMetric(
    merchantRule.calcType,
    items,
    goodsAmountCents,
  );

  if (
    merchantRule.freeShippingThresholdCents !== null &&
    goodsAmountCents >= merchantRule.freeShippingThresholdCents
  ) {
    return {
      ruleId: merchantRule.id,
      calcType: merchantRule.calcType,
      metricValue,
      shippingFeeCents: 0,
      freeShippingThresholdCents: merchantRule.freeShippingThresholdCents,
    };
  }

  const firstUnit = Math.max(merchantRule.firstWeightGram, 1);
  const additionalUnit = Math.max(merchantRule.additionalWeightGram ?? firstUnit, 1);
  const additionalPrice = merchantRule.additionalWeightPriceCents ?? 0;
  let shippingFeeCents = merchantRule.firstWeightPriceCents;

  if (metricValue > firstUnit) {
    const additionalSteps = Math.ceil((metricValue - firstUnit) / additionalUnit);
    shippingFeeCents += additionalSteps * additionalPrice;
  }

  shippingFeeCents = Math.max(shippingFeeCents, merchantRule.minShippingFeeCents);

  return {
    ruleId: merchantRule.id,
    calcType: merchantRule.calcType,
    metricValue,
    shippingFeeCents,
    firstWeightGram: merchantRule.firstWeightGram,
    firstWeightPriceCents: merchantRule.firstWeightPriceCents,
    additionalWeightGram: merchantRule.additionalWeightGram,
    additionalWeightPriceCents: merchantRule.additionalWeightPriceCents,
    minShippingFeeCents: merchantRule.minShippingFeeCents,
    freeShippingThresholdCents: merchantRule.freeShippingThresholdCents,
  };
}

export function resolveDeliveryCheckoutShippingFee(
  items: Array<
    DeliveryShippingMetricItem & {
      merchantId: string;
    }
  >,
  goodsAmountCents: number,
  shippingRules: DeliveryShippingRuleForEstimate[],
) {
  const platformRule =
    shippingRules.find((rule) => rule.merchantId === null) ?? shippingRules[0] ?? null;

  if (!platformRule) {
    return {
      ruleId: null,
      calcType: null,
      metricValue: 0,
      shippingFeeCents: 0,
      fallbackReason: 'NO_DELIVERY_SHIPPING_RULE',
    };
  }

  return resolveDeliveryShippingFee(
    platformRule.merchantId ?? items[0]?.merchantId ?? '',
    items,
    goodsAmountCents,
    [platformRule],
  );
}

function resolveDeliveryShippingMetric(
  calcType: DeliveryShippingCalcType,
  items: DeliveryShippingMetricItem[],
  goodsAmountCents: number,
) {
  switch (calcType) {
    case DeliveryShippingCalcType.COUNT:
      return items.reduce((sum, item) => sum + item.quantity, 0);
    case DeliveryShippingCalcType.AMOUNT:
      return goodsAmountCents;
    case DeliveryShippingCalcType.WEIGHT:
    default:
      return items.reduce((sum, item) => sum + item.weightGram * item.quantity, 0);
  }
}
