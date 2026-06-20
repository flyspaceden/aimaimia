import { DeliveryPriceRuleScope, DeliveryPriceRuleType } from '../../../generated/delivery-client';
import { DeliveryPricingService } from './delivery-pricing.service';

describe('DeliveryPricingService', () => {
  let service: DeliveryPricingService;

  beforeEach(() => {
    service = new DeliveryPricingService();
  });

  it('applies delivery pricing priority in the required order', () => {
    const baseInput = {
      basePriceCents: 1000,
      quantity: 6,
      merchantDefaultMarkupBps: 2000,
      rules: [
        {
          id: 'platform-rule',
          scope: DeliveryPriceRuleScope.PLATFORM,
          ruleType: DeliveryPriceRuleType.MARKUP_RATE,
          markupBps: 5000,
          minQuantity: 1,
          maxQuantity: null,
          priority: 1,
          isActive: true,
        },
        {
          id: 'merchant-rule',
          scope: DeliveryPriceRuleScope.MERCHANT,
          ruleType: DeliveryPriceRuleType.MARKUP_RATE,
          markupBps: 4000,
          minQuantity: 5,
          maxQuantity: null,
          priority: 1,
          isActive: true,
        },
        {
          id: 'product-rule',
          scope: DeliveryPriceRuleScope.PRODUCT,
          ruleType: DeliveryPriceRuleType.MARKUP_RATE,
          markupBps: 3000,
          minQuantity: 5,
          maxQuantity: null,
          priority: 1,
          isActive: true,
        },
        {
          id: 'sku-markup-rule',
          scope: DeliveryPriceRuleScope.SKU,
          ruleType: DeliveryPriceRuleType.MARKUP_RATE,
          markupBps: 2500,
          minQuantity: 5,
          maxQuantity: null,
          priority: 1,
          isActive: true,
        },
        {
          id: 'sku-fixed-rule',
          scope: DeliveryPriceRuleScope.SKU,
          ruleType: DeliveryPriceRuleType.FIXED_PRICE,
          fixedPriceCents: 1888,
          minQuantity: 1,
          maxQuantity: null,
          priority: 1,
          isActive: true,
        },
      ],
    };

    expect(service.resolvePrice(baseInput)).toMatchObject({
      finalPriceCents: 1888,
      matchedSource: 'SKU_FIXED_PRICE',
      matchedRuleId: 'sku-fixed-rule',
    });

    expect(
      service.resolvePrice({
        ...baseInput,
        rules: baseInput.rules.filter((rule) => rule.id !== 'sku-fixed-rule'),
      }),
    ).toMatchObject({
      finalPriceCents: 1250,
      matchedSource: 'SKU_TIER_MARKUP',
      matchedRuleId: 'sku-markup-rule',
    });

    expect(
      service.resolvePrice({
        ...baseInput,
        rules: baseInput.rules.filter(
          (rule) => !['sku-fixed-rule', 'sku-markup-rule'].includes(rule.id),
        ),
      }),
    ).toMatchObject({
      finalPriceCents: 1300,
      matchedSource: 'PRODUCT_TIER_MARKUP',
      matchedRuleId: 'product-rule',
    });

    expect(
      service.resolvePrice({
        ...baseInput,
        rules: baseInput.rules.filter(
          (rule) => !['sku-fixed-rule', 'sku-markup-rule', 'product-rule'].includes(rule.id),
        ),
      }),
    ).toMatchObject({
      finalPriceCents: 1400,
      matchedSource: 'MERCHANT_TIER_MARKUP',
      matchedRuleId: 'merchant-rule',
    });

    expect(
      service.resolvePrice({
        ...baseInput,
        rules: baseInput.rules.filter(
          (rule) =>
            !['sku-fixed-rule', 'sku-markup-rule', 'product-rule', 'merchant-rule'].includes(
              rule.id,
            ),
        ),
      }),
    ).toMatchObject({
      finalPriceCents: 1200,
      matchedSource: 'MERCHANT_DEFAULT_MARKUP',
      matchedRuleId: null,
    });

    expect(
      service.resolvePrice({
        ...baseInput,
        merchantDefaultMarkupBps: null,
        rules: baseInput.rules.filter(
          (rule) =>
            !['sku-fixed-rule', 'sku-markup-rule', 'product-rule', 'merchant-rule'].includes(
              rule.id,
            ),
        ),
      }),
    ).toMatchObject({
      finalPriceCents: 1500,
      matchedSource: 'PLATFORM_DEFAULT_MARKUP',
      matchedRuleId: 'platform-rule',
    });
  });

  it('ignores inactive and out-of-range rules when resolving the final price', () => {
    expect(
      service.resolvePrice({
        basePriceCents: 1000,
        quantity: 3,
        merchantDefaultMarkupBps: null,
        rules: [
          {
            id: 'inactive-rule',
            scope: DeliveryPriceRuleScope.SKU,
            ruleType: DeliveryPriceRuleType.FIXED_PRICE,
            fixedPriceCents: 1,
            minQuantity: 1,
            maxQuantity: null,
            priority: 1,
            isActive: false,
          },
          {
            id: 'out-of-range-rule',
            scope: DeliveryPriceRuleScope.PLATFORM,
            ruleType: DeliveryPriceRuleType.MARKUP_RATE,
            markupBps: 9000,
            minQuantity: 10,
            maxQuantity: null,
            priority: 1,
            isActive: true,
          },
        ],
      }),
    ).toMatchObject({
      finalPriceCents: 1000,
      matchedSource: 'BASE_PRICE',
      matchedRuleId: null,
    });
  });
});
