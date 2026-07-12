import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from '../captain/captain.constants';
import {
  ProfitSafetyCandidate,
  ProfitSafetyViolationError,
  ProfitSafetyValidator,
} from './profit-safety-validator';

function candidate(overrides: Partial<ProfitSafetyCandidate> = {}): ProfitSafetyCandidate {
  return {
    markupRate: 1.35,
    vipDiscountRate: 0.95,
    vip: {
      rewardProfitRate: 0.2,
      directReferralProfitRate: 0.1,
      industryFundProfitRate: 0.1,
    },
    normal: {
      rewardProfitRate: 0.3,
      directReferralProfitRate: 0.05,
      industryFundProfitRate: 0.1,
    },
    captainConfig: {
      ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
      enabled: true,
      scope: {
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.scope,
        productIds: ['product-in-scope'],
      },
      perOrderCommission: { directProfitRate: 0.04 },
      monthlyRewards: {
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.monthlyRewards,
        baseManagementProfitRate: 0.02,
        growthBonusProfitRate: 0.01,
        cultivationBonusProfitRate: 0.01,
        performanceBonusProfitRate: 0.02,
      },
      unitEconomics: { fulfillmentCostRate: 0.04 },
      caps: {
        maxTotalIncentiveProfitRate: 0.1,
        targetNetProfitRate: 0.05,
        coldChainRiskReserveRate: 0.01,
      },
    },
    skus: [
      {
        id: 'sku-safe',
        productId: 'product-in-scope',
        companyId: 'company-1',
        categoryId: 'category-1',
        price: 200,
        cost: 100,
        active: true,
        ordinary: true,
        vipDiscountEligible: true,
      },
    ],
    ...overrides,
  };
}

describe('ProfitSafetyValidator', () => {
  const validator = new ProfitSafetyValidator();

  it('evaluates all four buyer/inviter scenarios in stable order', () => {
    const summary = validator.evaluate(candidate());

    expect(summary.scenarios.map((scenario) => scenario.key)).toEqual([
      'VIP_BUYER_VIP_INVITER',
      'VIP_BUYER_NORMAL_INVITER',
      'NORMAL_BUYER_VIP_INVITER',
      'NORMAL_BUYER_NORMAL_INVITER',
    ]);
    expect(summary.safe).toBe(true);
    expect(summary.scenarios.find((item) => item.key === 'NORMAL_BUYER_VIP_INVITER'))
      .toMatchObject({
        treeProfitRate: 0.3,
        industryFundProfitRate: 0.1,
        directReferralProfitRate: 0.1,
        captainProfitRate: 0.1,
        externalProfitRate: 0.6,
      });
  });

  it('uses discounted revenue as the denominator for the mandatory VIP margin', () => {
    const summary = validator.evaluate(candidate({
      skus: [{
        id: 'sku-markup',
        productId: 'product-in-scope',
        companyId: 'company-1',
        categoryId: 'category-1',
        price: 135,
        cost: 100,
        active: true,
        ordinary: true,
        vipDiscountEligible: true,
      }],
    }));
    const vipScenario = summary.scenarios[0];
    const normalScenario = summary.scenarios.find(
      (scenario) => scenario.key === 'NORMAL_BUYER_NORMAL_INVITER',
    )!;

    expect(vipScenario.limitingGrossMarginRate).toBeCloseTo(
      (135 * 0.95 - 100) / (135 * 0.95),
      8,
    );
    expect(normalScenario.limitingGrossMarginRate).toBeCloseTo(
      (1.35 - 1) / 1.35,
      8,
    );
  });

  it('uses the lower automatic-markup baseline even when the current SKU price has more margin', () => {
    const input = candidate({
      captainConfig: {
        ...candidate().captainConfig,
        unitEconomics: { fulfillmentCostRate: 0.06 },
        caps: {
          ...candidate().captainConfig.caps,
          targetNetProfitRate: 0.05,
          coldChainRiskReserveRate: 0.01,
        },
      } as any,
      skus: [{
        ...candidate().skus[0],
        price: 200,
        cost: 100,
      }],
    });

    const summary = new ProfitSafetyValidator().evaluate(input);
    const vipScenario = summary.scenarios.find(
      (scenario) => scenario.key === 'VIP_BUYER_VIP_INVITER',
    )!;
    const automaticMargin = (1.35 * 0.95 - 1) / (1.35 * 0.95);

    expect(vipScenario.limitingGrossMarginRate).toBeCloseTo(automaticMargin, 8);
    expect(vipScenario.platformRetainedRevenueRate).toBeCloseTo(automaticMargin * 0.5, 8);
    expect(vipScenario.platformRetainedRevenueRate).toBeLessThan(0.12);
    expect(summary.safe).toBe(false);
  });

  it.each([
    ['missing cost', null],
    ['zero margin', 135],
    ['negative margin', 140],
  ])('rejects an active ordinary SKU with %s', (_label, cost) => {
    const input = candidate({
      skus: [{
        ...candidate().skus[0],
        id: 'sku-invalid',
        price: 135,
        cost,
      }],
    });

    expect(() => validator.assertSafe(input)).toThrow('CAPTAIN_PROFIT_SAFETY_VIOLATION');
  });

  it('does not charge captain rates to a SKU outside captain scope', () => {
    const summary = validator.evaluate(candidate({
      skus: [{
        ...candidate().skus[0],
        id: 'sku-outside',
        productId: 'product-outside',
      }],
    }));

    expect(summary.scenarios.every((scenario) => scenario.captainProfitRate === 0)).toBe(true);
  });

  it('sets captain rates to zero when the captain program is disabled', () => {
    const input = candidate();
    input.captainConfig = { ...input.captainConfig, enabled: false } as any;

    const summary = validator.evaluate(input);

    expect(summary.scenarios.every((scenario) => scenario.captainProfitRate === 0)).toBe(true);
    expect(summary.captainConfigState).toBe('DISABLED');
  });

  it('treats an unsaved captain configuration as the disabled zero-reward default', () => {
    const input = candidate();
    input.captainConfig = undefined as any;

    const summary = validator.evaluate(input);

    expect(summary.safe).toBe(true);
    expect(summary.captainConfigState).toBe('DISABLED');
    expect(summary.captainMaximumProfitRate).toBe(0);
    expect(summary.scenarios.every((scenario) => scenario.captainProfitRate === 0)).toBe(true);
  });

  it('rejects an enabled V2 captain configuration', () => {
    const input = candidate();
    input.captainConfig = {
      schemaVersion: 2,
      enabled: true,
      programCode: 'SEAFOOD_PREPACKAGED',
    } as any;

    expect(() => validator.assertSafe(input)).toThrow('CAPTAIN_PROFIT_SAFETY_VIOLATION');
  });

  it.each([
    ['string V2 schema', { schemaVersion: '2', enabled: true }],
    ['unknown schema', { schemaVersion: 4, enabled: true }],
    ['incomplete V3', { schemaVersion: 3, enabled: true }],
  ])('fails closed with the unified safety error for %s', (_label, captainConfig) => {
    const input = candidate({ captainConfig: captainConfig as any });

    try {
      validator.assertSafe(input);
      throw new Error('expected safety violation');
    } catch (error) {
      expect(error).toBeInstanceOf(ProfitSafetyViolationError);
      expect((error as ProfitSafetyViolationError).code)
        .toBe('CAPTAIN_PROFIT_SAFETY_VIOLATION');
      expect((error as ProfitSafetyViolationError).summary.errors)
        .toContain('INVALID_CAPTAIN_CONFIG');
      expect((error as ProfitSafetyViolationError).toResponse()).toEqual(
        expect.objectContaining({
          evaluatedSkuCount: expect.any(Number),
          captainMaximumProfitRate: expect.any(Number),
          captainConfiguredCap: expect.any(Number),
          errors: expect.any(Array),
        }),
      );
    }
  });

  it('reports limiting SKUs and shortfall when platform retained revenue is insufficient', () => {
    const input = candidate();
    input.skus[0] = {
      ...input.skus[0],
      productTitle: '阿拉斯加鳕鱼段',
      skuTitle: '500g 冷冻装',
    };
    input.captainConfig = {
      ...input.captainConfig,
      unitEconomics: { fulfillmentCostRate: 0.12 },
      caps: {
        ...input.captainConfig.caps,
        targetNetProfitRate: 0.09,
        coldChainRiskReserveRate: 0.02,
      },
    } as any;

    const summary = validator.evaluate(input);

    expect(summary.safe).toBe(false);
    expect(summary.limitingSkus).toContainEqual(expect.objectContaining({
      skuId: 'sku-safe',
      productTitle: '阿拉斯加鳕鱼段',
      skuTitle: '500g 冷冻装',
    }));
    expect(summary.shortfall).toBeGreaterThan(0);
    expect(() => validator.assertSafe(input)).toThrow('CAPTAIN_PROFIT_SAFETY_VIOLATION');
  });

  it('ignores inactive and non-ordinary SKUs', () => {
    const summary = validator.evaluate(candidate({
      skus: [
        { ...candidate().skus[0], id: 'inactive', active: false, cost: null },
        { ...candidate().skus[0], id: 'prize', ordinary: false, cost: null },
      ],
    }));

    expect(summary.safe).toBe(true);
    expect(summary.evaluatedSkuCount).toBe(0);
  });

  it('chooses the SKU with the lowest retained revenue when all SKUs have zero shortfall', () => {
    const summary = validator.evaluate(candidate({
      captainConfig: {
        ...candidate().captainConfig,
        unitEconomics: { fulfillmentCostRate: 0.01 },
        caps: {
          ...candidate().captainConfig.caps,
          targetNetProfitRate: 0.01,
          coldChainRiskReserveRate: 0.01,
        },
      } as any,
      skus: [
        {
          ...candidate().skus[0],
          id: 'a-outside-scope',
          productId: 'product-outside',
          price: 200,
          cost: 100,
        },
        {
          ...candidate().skus[0],
          id: 'z-inside-scope',
          productId: 'product-in-scope',
          price: 135,
          cost: 100,
        },
      ],
    }));

    const vipScenario = summary.scenarios.find(
      (scenario) => scenario.key === 'VIP_BUYER_VIP_INVITER',
    );
    expect(summary.safe).toBe(true);
    expect(vipScenario).toMatchObject({
      limitingSkuId: 'z-inside-scope',
      captainProfitRate: 0.1,
      externalProfitRate: 0.5,
    });
  });
});
