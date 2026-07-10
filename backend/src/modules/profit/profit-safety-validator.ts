import { Injectable } from '@nestjs/common';
import type {
  CaptainSeafoodConfig,
  CaptainSeafoodConfigV3,
} from '../captain/captain.types';

export type ProfitSafetyScenarioKey =
  | 'VIP_BUYER_VIP_INVITER'
  | 'VIP_BUYER_NORMAL_INVITER'
  | 'NORMAL_BUYER_VIP_INVITER'
  | 'NORMAL_BUYER_NORMAL_INVITER';

export interface ProfitSafetyPathRates {
  rewardProfitRate: number;
  directReferralProfitRate: number;
  industryFundProfitRate: number;
}

export interface ProfitSafetySku {
  id: string;
  productId: string;
  companyId: string;
  categoryId: string | null;
  price: number;
  cost: number | null;
  active: boolean;
  ordinary: boolean;
  vipDiscountEligible: boolean;
}

export interface ProfitSafetyCandidate {
  markupRate: number;
  vipDiscountRate: number;
  vip: ProfitSafetyPathRates;
  normal: ProfitSafetyPathRates;
  captainConfig: CaptainSeafoodConfig;
  skus: ProfitSafetySku[];
}

export interface ProfitSafetyLimitingSku {
  skuId: string;
  productId: string;
  scenarioKey: ProfitSafetyScenarioKey;
  price: number;
  cost: number | null;
  automaticPrice: number | null;
  grossMarginRate: number;
  platformRetainedRevenueRate: number;
  platformRequiredRevenueRate: number;
  shortfall: number;
  reason: string;
}

export interface ProfitSafetyScenario {
  key: ProfitSafetyScenarioKey;
  buyerPath: 'VIP' | 'NORMAL';
  inviterPath: 'VIP' | 'NORMAL';
  treeProfitRate: number;
  industryFundProfitRate: number;
  directReferralProfitRate: number;
  captainProfitRate: number;
  externalProfitRate: number;
  platformRequiredRevenueRate: number;
  limitingSkuId: string | null;
  limitingGrossMarginRate: number;
  platformRetainedRevenueRate: number;
  shortfall: number;
  safe: boolean;
}

export interface ProfitSafetySummary {
  safe: boolean;
  scenarios: ProfitSafetyScenario[];
  limitingSkus: ProfitSafetyLimitingSku[];
  shortfall: number;
  evaluatedSkuCount: number;
  platformRequiredRevenueRate: number;
  captainMaximumProfitRate: number;
  captainConfiguredCap: number;
  errors: string[];
}

export class ProfitSafetyViolationError extends Error {
  readonly code = 'CAPTAIN_PROFIT_SAFETY_VIOLATION';

  constructor(readonly summary: ProfitSafetySummary) {
    super('CAPTAIN_PROFIT_SAFETY_VIOLATION');
    this.name = 'ProfitSafetyViolationError';
  }

  toResponse() {
    return {
      code: this.code,
      message: '当前配置会突破平台利润安全底线',
      scenarios: this.summary.scenarios,
      limitingSkus: this.summary.limitingSkus,
      shortfall: this.summary.shortfall,
    };
  }
}

interface ScenarioDefinition {
  key: ProfitSafetyScenarioKey;
  buyerPath: 'VIP' | 'NORMAL';
  inviterPath: 'VIP' | 'NORMAL';
}

const SCENARIOS: ScenarioDefinition[] = [
  { key: 'VIP_BUYER_VIP_INVITER', buyerPath: 'VIP', inviterPath: 'VIP' },
  { key: 'VIP_BUYER_NORMAL_INVITER', buyerPath: 'VIP', inviterPath: 'NORMAL' },
  { key: 'NORMAL_BUYER_VIP_INVITER', buyerPath: 'NORMAL', inviterPath: 'VIP' },
  { key: 'NORMAL_BUYER_NORMAL_INVITER', buyerPath: 'NORMAL', inviterPath: 'NORMAL' },
];

@Injectable()
export class ProfitSafetyValidator {
  evaluate(candidate: ProfitSafetyCandidate): ProfitSafetySummary {
    const errors: string[] = [];
    const captain = candidate.captainConfig;
    if (captain.schemaVersion === 2 && captain.enabled) {
      errors.push('CAPTAIN_CONFIG_V2_NOT_ACTIVE');
    }

    const captainV3 = captain.schemaVersion === 3
      ? captain as CaptainSeafoodConfigV3
      : null;
    const captainMaximumProfitRate = captainV3?.enabled
      ? this.sumRates([
        captainV3.perOrderCommission.directProfitRate,
        captainV3.monthlyRewards.baseManagementProfitRate,
        captainV3.monthlyRewards.growthBonusProfitRate,
        captainV3.monthlyRewards.cultivationBonusProfitRate,
        captainV3.monthlyRewards.performanceBonusProfitRate,
      ], errors, 'INVALID_CAPTAIN_RATE')
      : 0;
    const captainConfiguredCap = captainV3
      ? this.nonNegativeRate(captainV3.caps.maxTotalIncentiveProfitRate, errors, 'INVALID_CAPTAIN_CAP')
      : 0;
    if (captainV3?.enabled && captainMaximumProfitRate > captainConfiguredCap + 1e-12) {
      errors.push('CAPTAIN_RATE_EXCEEDS_CONFIGURED_CAP');
    }

    const platformRequiredRevenueRate = captainV3
      ? this.sumRates([
        captainV3.unitEconomics.fulfillmentCostRate,
        captainV3.caps.coldChainRiskReserveRate,
        captainV3.caps.targetNetProfitRate,
      ], errors, 'INVALID_PLATFORM_REQUIRED_RATE')
      : 0;
    const activeSkus = candidate.skus.filter((sku) => sku.active && sku.ordinary);

    const scenarioResults = SCENARIOS.map((definition) => this.evaluateScenario(
      candidate,
      definition,
      activeSkus,
      captainV3,
      captainMaximumProfitRate,
      captainConfiguredCap,
      platformRequiredRevenueRate,
      errors,
    ));
    const limitingSkus = scenarioResults
      .flatMap((result) => result.limitingSku ? [result.limitingSku] : [])
      .filter((sku, index, all) => all.findIndex((item) =>
        item.skuId === sku.skuId && item.scenarioKey === sku.scenarioKey) === index)
      .sort((a, b) => b.shortfall - a.shortfall || a.skuId.localeCompare(b.skuId));
    const scenarios = scenarioResults.map(({ limitingSku: _limitingSku, ...scenario }) => scenario);
    const shortfall = Math.max(0, ...scenarios.map((scenario) => scenario.shortfall));

    return {
      safe: errors.length === 0 && scenarios.every((scenario) => scenario.safe),
      scenarios,
      limitingSkus,
      shortfall,
      evaluatedSkuCount: activeSkus.length,
      platformRequiredRevenueRate,
      captainMaximumProfitRate,
      captainConfiguredCap,
      errors: [...new Set(errors)],
    };
  }

  assertSafe(candidate: ProfitSafetyCandidate): ProfitSafetySummary {
    const summary = this.evaluate(candidate);
    if (!summary.safe) throw new ProfitSafetyViolationError(summary);
    return summary;
  }

  private evaluateScenario(
    candidate: ProfitSafetyCandidate,
    definition: ScenarioDefinition,
    skus: ProfitSafetySku[],
    captain: CaptainSeafoodConfigV3 | null,
    captainMaximumProfitRate: number,
    captainConfiguredCap: number,
    platformRequiredRevenueRate: number,
    sharedErrors: string[],
  ): ProfitSafetyScenario & { limitingSku: ProfitSafetyLimitingSku | null } {
    const buyerRates = definition.buyerPath === 'VIP' ? candidate.vip : candidate.normal;
    const inviterRates = definition.inviterPath === 'VIP' ? candidate.vip : candidate.normal;
    const treeProfitRate = this.nonNegativeRate(
      buyerRates.rewardProfitRate,
      sharedErrors,
      `INVALID_${definition.buyerPath}_TREE_RATE`,
    );
    const industryFundProfitRate = this.nonNegativeRate(
      buyerRates.industryFundProfitRate,
      sharedErrors,
      `INVALID_${definition.buyerPath}_INDUSTRY_RATE`,
    );
    const directReferralProfitRate = this.nonNegativeRate(
      inviterRates.directReferralProfitRate,
      sharedErrors,
      `INVALID_${definition.inviterPath}_DIRECT_RATE`,
    );
    let limitingSku: ProfitSafetyLimitingSku | null = null;
    let scenarioSafe = true;

    for (const sku of skus) {
      const captainProfitRate = captain?.enabled && this.matchesCaptainScope(sku, captain)
        ? captainMaximumProfitRate
        : 0;
      const externalProfitRate = this.roundRate(treeProfitRate
        + industryFundProfitRate
        + directReferralProfitRate
        + captainProfitRate);
      const price = Number(sku.price);
      const cost = sku.cost === null ? Number.NaN : Number(sku.cost);
      const validEconomics = Number.isFinite(price) && price > 0 && Number.isFinite(cost) && cost > 0;
      const vipMultiplier = definition.buyerPath === 'VIP' && sku.vipDiscountEligible
        ? candidate.vipDiscountRate
        : 1;
      const margin = validEconomics ? (price * vipMultiplier - cost) / price : -1;
      const retained = margin * Math.max(0, 1 - externalProfitRate);
      const rateOverflow = externalProfitRate > 1 + 1e-12;
      const captainCapOverflow = captainProfitRate > captainConfiguredCap + 1e-12;
      const shortfall = Math.max(
        0,
        platformRequiredRevenueRate - retained,
        externalProfitRate - 1,
        captainProfitRate - captainConfiguredCap,
      );
      const skuSafe = validEconomics
        && margin > 0
        && !rateOverflow
        && !captainCapOverflow
        && retained + 1e-12 >= platformRequiredRevenueRate;
      if (!skuSafe) scenarioSafe = false;

      if (!limitingSku || shortfall > limitingSku.shortfall) {
        limitingSku = {
          skuId: sku.id,
          productId: sku.productId,
          scenarioKey: definition.key,
          price,
          cost: sku.cost,
          automaticPrice: Number.isFinite(cost) && cost > 0 && Number.isFinite(candidate.markupRate)
            ? cost * candidate.markupRate
            : null,
          grossMarginRate: margin,
          platformRetainedRevenueRate: retained,
          platformRequiredRevenueRate,
          shortfall,
          reason: !validEconomics
            ? 'SKU_COST_OR_PRICE_MISSING'
            : margin <= 0
              ? 'SKU_NON_POSITIVE_MARGIN'
              : rateOverflow
                ? 'EXTERNAL_PROFIT_RATE_EXCEEDS_100_PERCENT'
                : captainCapOverflow
                  ? 'CAPTAIN_RATE_EXCEEDS_CONFIGURED_CAP'
                  : shortfall > 0
                    ? 'PLATFORM_RETAINED_REVENUE_INSUFFICIENT'
                    : 'SAFE',
        };
      }
    }

    const captainProfitRate = limitingSku && captain?.enabled
      && this.matchesCaptainScope(
        skus.find((sku) => sku.id === limitingSku!.skuId)!,
        captain,
      )
      ? captainMaximumProfitRate
      : 0;
    const externalProfitRate = this.roundRate(treeProfitRate
      + industryFundProfitRate
      + directReferralProfitRate
      + captainProfitRate);

    return {
      key: definition.key,
      buyerPath: definition.buyerPath,
      inviterPath: definition.inviterPath,
      treeProfitRate,
      industryFundProfitRate,
      directReferralProfitRate,
      captainProfitRate,
      externalProfitRate,
      platformRequiredRevenueRate,
      limitingSkuId: limitingSku?.skuId ?? null,
      limitingGrossMarginRate: limitingSku?.grossMarginRate ?? 1,
      platformRetainedRevenueRate: limitingSku?.platformRetainedRevenueRate ?? 1,
      shortfall: limitingSku?.shortfall ?? 0,
      safe: scenarioSafe,
      limitingSku: limitingSku && !scenarioSafe ? limitingSku : null,
    };
  }

  private matchesCaptainScope(sku: ProfitSafetySku, config: CaptainSeafoodConfigV3): boolean {
    const scope = config.scope;
    if (scope.excludedProductIds.includes(sku.productId)) return false;
    const hasIncludes = scope.productIds.length > 0
      || scope.categoryIds.length > 0
      || scope.companyIds.length > 0;
    if (!hasIncludes) return false;
    return scope.productIds.includes(sku.productId)
      || (sku.categoryId !== null && scope.categoryIds.includes(sku.categoryId))
      || scope.companyIds.includes(sku.companyId);
  }

  private nonNegativeRate(value: unknown, errors: string[], code: string): number {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0) {
      errors.push(code);
      return 0;
    }
    return rate;
  }

  private sumRates(values: unknown[], errors: string[], code: string): number {
    return this.roundRate(values.reduce<number>(
      (sum, value) => sum + this.nonNegativeRate(value, errors, code),
      0,
    ));
  }

  private roundRate(value: number): number {
    return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
  }
}
