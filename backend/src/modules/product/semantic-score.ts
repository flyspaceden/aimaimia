// backend/src/modules/product/semantic-score.ts

/**
 * 语义匹配评分 — 根据槽位与商品字段的交集计算加分
 * 只加分不扣分，空字段商品不被惩罚
 */

/** 评分权重常量（可调整） */
export const SEMANTIC_WEIGHTS = {
  categoryHint: 20,
  usageScenario: 20,
  originPreference: 15,
  constraintPerItem: 10,
  dietaryPreference: 10,
  seasonalMonth: 10,
  flavorPreference: 8,
} as const;

export interface SemanticSlots {
  categoryHint?: string;
  usageScenario?: string;
  originPreference?: string;
  constraints?: string[];
  dietaryPreference?: string;
  flavorPreference?: string;
  promotionIntent?: string;
}

export interface ProductSemanticFields {
  categoryName?: string;
  categoryPath?: string;
  usageScenarios: string[];
  originRegion?: string | null;
  dietaryTags: string[];
  flavorTags: string[];
  seasonalMonths: number[];
}

/**
 * 计算语义匹配分
 * @returns { score: number, matchedDimensions: number }
 */
export function computeSemanticScore(
  slots: SemanticSlots,
  product: ProductSemanticFields,
): { score: number; matchedDimensions: number } {
  let score = 0;
  let matchedDimensions = 0;

  // categoryHint → category.name/path
  if (slots.categoryHint && product.categoryName) {
    const hint = slots.categoryHint.toLowerCase();
    const name = product.categoryName.toLowerCase();
    const path = (product.categoryPath || '').toLowerCase();
    if (name.includes(hint) || path.includes(hint)) {
      score += SEMANTIC_WEIGHTS.categoryHint;
      matchedDimensions++;
    }
  }

  // usageScenario → usageScenarios[]
  if (slots.usageScenario && product.usageScenarios.length > 0) {
    const scenario = slots.usageScenario.toLowerCase();
    if (product.usageScenarios.some((s) => s.includes(scenario) || scenario.includes(s))) {
      score += SEMANTIC_WEIGHTS.usageScenario;
      matchedDimensions++;
    }
  }

  // originPreference → originRegion
  if (slots.originPreference && product.originRegion) {
    const pref = slots.originPreference.toLowerCase();
    const region = product.originRegion.toLowerCase();
    if (region.includes(pref) || pref.includes(region)) {
      score += SEMANTIC_WEIGHTS.originPreference;
      matchedDimensions++;
    }
  }

  // constraints → dietaryTags（交集，每命中一项 +10）
  if (slots.constraints?.length && product.dietaryTags.length > 0) {
    const hits = slots.constraints.filter((c) =>
      product.dietaryTags.some((t) => t.includes(c) || c.includes(t)),
    );
    if (hits.length > 0) {
      score += hits.length * SEMANTIC_WEIGHTS.constraintPerItem;
      matchedDimensions++;
    }
  }

  // dietaryPreference → dietaryTags
  if (slots.dietaryPreference && product.dietaryTags.length > 0) {
    const pref = slots.dietaryPreference.toLowerCase();
    if (product.dietaryTags.some((t) => t.includes(pref) || pref.includes(t))) {
      score += SEMANTIC_WEIGHTS.dietaryPreference;
      matchedDimensions++;
    }
  }

  // seasonalMonths → 当前月
  if (product.seasonalMonths.length > 0) {
    const currentMonth = new Date().getMonth() + 1;
    if (product.seasonalMonths.includes(currentMonth)) {
      score += SEMANTIC_WEIGHTS.seasonalMonth;
      matchedDimensions++;
    }
  }

  // flavorPreference → flavorTags
  if (slots.flavorPreference && product.flavorTags.length > 0) {
    const pref = slots.flavorPreference.toLowerCase();
    if (product.flavorTags.some((t) => t.includes(pref) || pref.includes(t))) {
      score += SEMANTIC_WEIGHTS.flavorPreference;
      matchedDimensions++;
    }
  }

  return { score, matchedDimensions };
}

/**
 * 判断搜索降级层级
 */
export function determineDegradeLevel(
  slots: SemanticSlots,
  matchedDimensions: number,
): 'A' | 'B' | 'C' {
  const hasCategoryHint = !!slots.categoryHint;
  const hasScenarioSlots = !!(
    slots.usageScenario ||
    slots.dietaryPreference ||
    slots.originPreference
  );
  const hasBudgetOrPromo = !!(slots.promotionIntent);

  // Level A: 多维匹配
  if (hasCategoryHint && matchedDimensions >= 1) return 'A';
  if (!hasCategoryHint && matchedDimensions >= 2) return 'A';

  // Level B: 宽泛搜索或推荐兜底
  if (hasCategoryHint) return 'B';
  if (hasScenarioSlots || hasBudgetOrPromo) return 'B';

  // Level C: Chat 兜底
  return 'C';
}
