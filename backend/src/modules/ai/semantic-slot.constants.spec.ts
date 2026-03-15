import { isFlashResultGood, HIGH_VALUE_SLOTS } from './semantic-slot.constants';

describe('HIGH_VALUE_SLOTS', () => {
  it('包含 9 个槽位', () => {
    expect(HIGH_VALUE_SLOTS).toHaveLength(9);
  });

  it('包含所有预期槽位', () => {
    expect(HIGH_VALUE_SLOTS).toContain('usageScenario');
    expect(HIGH_VALUE_SLOTS).toContain('promotionIntent');
    expect(HIGH_VALUE_SLOTS).toContain('bundleIntent');
    expect(HIGH_VALUE_SLOTS).toContain('originPreference');
    expect(HIGH_VALUE_SLOTS).toContain('freshness');
    expect(HIGH_VALUE_SLOTS).toContain('dietaryPreference');
    expect(HIGH_VALUE_SLOTS).toContain('flavorPreference');
    expect(HIGH_VALUE_SLOTS).toContain('budget');
    expect(HIGH_VALUE_SLOTS).toContain('audience');
  });
});

describe('isFlashResultGood', () => {
  it('confidence < 0.7 → false（不管槽位多丰富）', () => {
    expect(isFlashResultGood(0.6, {
      categoryHint: '海鲜',
      usageScenario: '做饭',
      constraints: ['fresh'],
    })).toBe(false);
  });

  it('confidence = 0.7 + categoryHint 单独 → false（关键规则）', () => {
    expect(isFlashResultGood(0.7, { categoryHint: '水果' })).toBe(false);
  });

  it('confidence = 0.7 + categoryHint + 宽泛类目名 → false', () => {
    expect(isFlashResultGood(0.8, { categoryHint: '食品' })).toBe(false);
  });

  it('categoryHint + 高价值槽位 → true', () => {
    expect(isFlashResultGood(0.8, {
      categoryHint: '海鲜',
      usageScenario: '做饭',
    })).toBe(true);
  });

  it('categoryHint + constraints → true', () => {
    expect(isFlashResultGood(0.7, {
      categoryHint: '海鲜',
      constraints: ['fresh'],
    })).toBe(true);
  });

  it('无 categoryHint + 高价值槽位 → true', () => {
    expect(isFlashResultGood(0.8, {
      usageScenario: '晚餐做饭',
    })).toBe(true);
  });

  it('无 categoryHint + constraints → true', () => {
    expect(isFlashResultGood(0.7, {
      constraints: ['organic', 'low-sugar'],
    })).toBe(true);
  });

  it('空 constraints 数组不算 → false', () => {
    expect(isFlashResultGood(0.8, {
      constraints: [],
    })).toBe(false);
  });

  it('只有 query → false（贫瘠）', () => {
    expect(isFlashResultGood(0.9, {
      query: '鸡蛋',
    })).toBe(false);
  });

  it('全空槽位 → false', () => {
    expect(isFlashResultGood(0.9, {})).toBe(false);
  });

  it('null/undefined 槽位值不算 → false', () => {
    expect(isFlashResultGood(0.8, {
      usageScenario: null,
      categoryHint: undefined,
    })).toBe(false);
  });

  it('空字符串槽位值不算 → false', () => {
    expect(isFlashResultGood(0.8, {
      usageScenario: '',
      originPreference: '',
    })).toBe(false);
  });

  // 真实场景测试
  it('"找点新鲜海鲜" → categoryHint + constraints → true', () => {
    expect(isFlashResultGood(0.85, {
      categoryHint: '海鲜',
      constraints: ['fresh'],
    })).toBe(true);
  });

  it('"今晚做饭买什么" → 只有 usageScenario → true', () => {
    expect(isFlashResultGood(0.75, {
      usageScenario: '晚餐做饭',
    })).toBe(true);
  });

  it('"帮我凑个满减" → 只有 promotionIntent → true', () => {
    expect(isFlashResultGood(0.7, {
      promotionIntent: 'threshold-optimization',
    })).toBe(true);
  });

  it('"有没有本地特产" → categoryHint + originPreference → true', () => {
    expect(isFlashResultGood(0.8, {
      categoryHint: '特产',
      originPreference: '本地',
    })).toBe(true);
  });
});
