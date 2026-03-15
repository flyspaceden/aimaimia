import {
  computeSemanticScore,
  determineDegradeLevel,
  SEMANTIC_WEIGHTS,
  type SemanticSlots,
  type ProductSemanticFields,
} from './semantic-score';

// 辅助函数：创建空商品语义字段
function emptyProduct(): ProductSemanticFields {
  return {
    categoryName: undefined,
    categoryPath: undefined,
    usageScenarios: [],
    originRegion: null,
    dietaryTags: [],
    flavorTags: [],
    seasonalMonths: [],
  };
}

describe('computeSemanticScore', () => {
  it('空槽位 + 空商品 → 0 分', () => {
    const result = computeSemanticScore({}, emptyProduct());
    expect(result.score).toBe(0);
    expect(result.matchedDimensions).toBe(0);
  });

  it('categoryHint 匹配 category name → +20', () => {
    const slots: SemanticSlots = { categoryHint: '海鲜' };
    const product = { ...emptyProduct(), categoryName: '水产海鲜' };
    const result = computeSemanticScore(slots, product);
    expect(result.score).toBe(SEMANTIC_WEIGHTS.categoryHint);
    expect(result.matchedDimensions).toBe(1);
  });

  it('categoryHint 匹配 category path → +20', () => {
    const slots: SemanticSlots = { categoryHint: '水果' };
    const product = { ...emptyProduct(), categoryName: '苹果', categoryPath: '食品/水果/苹果' };
    const result = computeSemanticScore(slots, product);
    expect(result.score).toBe(SEMANTIC_WEIGHTS.categoryHint);
  });

  it('categoryHint 不匹配 → 0', () => {
    const slots: SemanticSlots = { categoryHint: '电器' };
    const product = { ...emptyProduct(), categoryName: '水产海鲜' };
    const result = computeSemanticScore(slots, product);
    expect(result.score).toBe(0);
  });

  it('usageScenario 匹配 → +20', () => {
    const slots: SemanticSlots = { usageScenario: '做饭' };
    const product = { ...emptyProduct(), usageScenarios: ['做饭', '送礼'] };
    const result = computeSemanticScore(slots, product);
    expect(result.score).toBe(SEMANTIC_WEIGHTS.usageScenario);
    expect(result.matchedDimensions).toBe(1);
  });

  it('usageScenario 部分匹配（包含关系）→ +20', () => {
    const slots: SemanticSlots = { usageScenario: '晚餐做饭' };
    const product = { ...emptyProduct(), usageScenarios: ['做饭'] };
    const result = computeSemanticScore(slots, product);
    expect(result.score).toBe(SEMANTIC_WEIGHTS.usageScenario);
  });

  it('originPreference 前缀匹配 → +15', () => {
    const slots: SemanticSlots = { originPreference: '山东' };
    const product = { ...emptyProduct(), originRegion: '山东青岛' };
    const result = computeSemanticScore(slots, product);
    expect(result.score).toBe(SEMANTIC_WEIGHTS.originPreference);
    expect(result.matchedDimensions).toBe(1);
  });

  it('constraints 与 dietaryTags 交集 → 每项 +10', () => {
    const slots: SemanticSlots = { constraints: ['organic', 'low-sugar'] };
    const product = { ...emptyProduct(), dietaryTags: ['organic', '低糖', 'low-sugar'] };
    const result = computeSemanticScore(slots, product);
    expect(result.score).toBe(2 * SEMANTIC_WEIGHTS.constraintPerItem);
    expect(result.matchedDimensions).toBe(1);
  });

  it('dietaryPreference 匹配 → +10', () => {
    const slots: SemanticSlots = { dietaryPreference: '素食' };
    const product = { ...emptyProduct(), dietaryTags: ['素食', '有机'] };
    const result = computeSemanticScore(slots, product);
    expect(result.score).toBe(SEMANTIC_WEIGHTS.dietaryPreference);
  });

  it('当季月份匹配 → +10', () => {
    const currentMonth = new Date().getMonth() + 1;
    const product = { ...emptyProduct(), seasonalMonths: [currentMonth] };
    const result = computeSemanticScore({}, product);
    expect(result.score).toBe(SEMANTIC_WEIGHTS.seasonalMonth);
    expect(result.matchedDimensions).toBe(1);
  });

  it('非当季月份 → 0', () => {
    const currentMonth = new Date().getMonth() + 1;
    const offSeason = currentMonth === 12 ? 1 : currentMonth + 1;
    const product = { ...emptyProduct(), seasonalMonths: [offSeason] };
    const result = computeSemanticScore({}, product);
    expect(result.score).toBe(0);
  });

  it('flavorPreference 匹配 → +8', () => {
    const slots: SemanticSlots = { flavorPreference: '甜' };
    const product = { ...emptyProduct(), flavorTags: ['甜', '脆'] };
    const result = computeSemanticScore(slots, product);
    expect(result.score).toBe(SEMANTIC_WEIGHTS.flavorPreference);
  });

  it('多维度同时匹配 → 累加', () => {
    const currentMonth = new Date().getMonth() + 1;
    const slots: SemanticSlots = {
      categoryHint: '海鲜',
      usageScenario: '做饭',
      originPreference: '山东',
      flavorPreference: '鲜',
    };
    const product: ProductSemanticFields = {
      categoryName: '水产海鲜',
      categoryPath: undefined,
      usageScenarios: ['做饭', '火锅'],
      originRegion: '山东青岛',
      dietaryTags: [],
      flavorTags: ['鲜', '嫩'],
      seasonalMonths: [currentMonth],
    };
    const result = computeSemanticScore(slots, product);
    const expected =
      SEMANTIC_WEIGHTS.categoryHint +
      SEMANTIC_WEIGHTS.usageScenario +
      SEMANTIC_WEIGHTS.originPreference +
      SEMANTIC_WEIGHTS.flavorPreference +
      SEMANTIC_WEIGHTS.seasonalMonth;
    expect(result.score).toBe(expected); // 20+20+15+8+10 = 73
    expect(result.matchedDimensions).toBe(5);
  });

  it('空字段商品不扣分 → 0', () => {
    const slots: SemanticSlots = {
      categoryHint: '海鲜',
      usageScenario: '做饭',
      originPreference: '山东',
    };
    const result = computeSemanticScore(slots, emptyProduct());
    expect(result.score).toBe(0);
    expect(result.matchedDimensions).toBe(0);
  });
});

describe('determineDegradeLevel', () => {
  it('有 categoryHint + 至少 1 维匹配 → Level A', () => {
    expect(determineDegradeLevel({ categoryHint: '海鲜' }, 1)).toBe('A');
  });

  it('无 categoryHint + 至少 2 维匹配 → Level A', () => {
    expect(determineDegradeLevel({ usageScenario: '做饭' }, 2)).toBe('A');
  });

  it('无 categoryHint + 1 维匹配 → Level B（不够 A）', () => {
    expect(determineDegradeLevel({ usageScenario: '做饭' }, 1)).toBe('B');
  });

  it('有 categoryHint + 0 维匹配 → Level B', () => {
    expect(determineDegradeLevel({ categoryHint: '海鲜' }, 0)).toBe('B');
  });

  it('有场景槽位但无匹配 → Level B', () => {
    expect(determineDegradeLevel({ dietaryPreference: '素食' }, 0)).toBe('B');
  });

  it('有 promotionIntent → Level B', () => {
    expect(determineDegradeLevel({ promotionIntent: 'threshold-optimization' }, 0)).toBe('B');
  });

  it('完全空槽位 + 0 匹配 → Level C', () => {
    expect(determineDegradeLevel({}, 0)).toBe('C');
  });
});
