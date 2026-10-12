import { describe, expect, it, vi } from 'vitest';
import { aiReply, candidateToIntent, resolveAiAction } from '../intent';
import { isAiVoiceIntent } from '../repo';

vi.mock('@/platform/voice', () => ({
  prepareVoiceIntent: vi.fn(),
  uploadVoiceIntent: vi.fn(),
}));

describe('miniapp AI voice contract', () => {
  it('accepts a complete server intent and rejects malformed responses', () => {
    expect(isAiVoiceIntent({ type: 'search', transcript: '苹果', feedback: '为你搜索' })).toBe(true);
    expect(isAiVoiceIntent({ type: 'search', transcript: '苹果' })).toBe(false);
    expect(isAiVoiceIntent({ type: 'unknown', transcript: '苹果', feedback: 'x' })).toBe(false);
    expect(isAiVoiceIntent({
      type: 'clarify', transcript: '苹果', feedback: '请选择',
      clarify: { candidates: [{ id: '1', label: '搜索', type: 'search', feedback: '好', search: { query: 123 } }] },
    })).toBe(false);
    expect(isAiVoiceIntent({
      type: 'search', transcript: '苹果', feedback: '好',
      chatResponse: { reply: '找到了', suggestedActions: [{ type: 'external', label: '打开网页' }] },
    })).toBe(false);
  });

  it('routes a matched product to its detail without executing add-to-cart', () => {
    expect(resolveAiAction({
      type: 'search', transcript: '把苹果加入购物车', feedback: '找到商品',
      search: { query: '苹果', action: 'add-to-cart', matchedProductId: 'product-1' },
    })).toEqual({
      label: '确认规格后加入购物车',
      url: '/packages/commerce/catalog-product/index?id=product-1',
      mode: 'navigate',
    });
  });

  it('keeps protected transaction destinations behind login', () => {
    expect(resolveAiAction({
      type: 'transaction', transcript: '查物流', feedback: '选择订单',
      transaction: { action: 'track-order', status: 'shipping' },
    })).toMatchObject({ requiresAuth: true, url: '/packages/orders/order-list/index?status=SHIPPED' });
  });

  it('routes structured company requests to the dedicated company search page', () => {
    const action = resolveAiAction({
      type: 'company', transcript: '看看山东的有机农场', feedback: '为你找企业',
      company: { mode: 'list', industryHint: '有机种植', location: '山东', companyType: 'farm', featureTags: ['有机认证'] },
    });
    expect(action?.url).toContain('/packages/commerce/company-search/index?');
    expect(action?.url).toContain('industryHint=%E6%9C%89%E6%9C%BA%E7%A7%8D%E6%A4%8D');
    expect(action?.url).toContain('location=%E5%B1%B1%E4%B8%9C');
    expect(action?.url).toContain('companyType=farm');
  });

  it('does not reopen the hidden multi-turn chat route', () => {
    expect(resolveAiAction({
      type: 'navigate', transcript: '打开AI聊天', feedback: '暂不支持',
      resolved: { navigateTarget: 'ai-chat' },
    })).toBeNull();
  });

  it('turns a server clarification choice into a normal actionable intent', () => {
    const intent = candidateToIntent({
      id: 'candidate-1', label: '搜索苹果', type: 'search', feedback: '为你搜索',
      search: { query: '苹果' },
    }, '苹果');
    expect(intent.type).toBe('search');
    expect(resolveAiAction(intent)?.url).toBe('/packages/commerce/catalog-search/index?q=%E8%8B%B9%E6%9E%9C&source=voice');
  });

  it('keeps all recommendation semantics when opening the AI recommendation page', () => {
    const action = resolveAiAction({
      type: 'recommend', transcript: '一百元买山东低糖水果凑满减', feedback: '为你搭配',
      recommend: {
        query: '水果',
        matchedCategoryId: 'fruit-1',
        matchedCategoryName: '水果',
        preferRecommended: true,
        constraints: ['low-sugar'],
        budget: 100,
        recommendThemes: ['discount', 'seasonal'],
        slots: {
          promotionIntent: 'threshold-optimization',
          originPreference: '山东',
          dietaryPreference: '低糖',
        },
      },
    });
    expect(action?.label).toBe('查看 AI 推荐');
    expect(action?.url).toContain('/packages/ai/recommend/index?');
    expect(action?.url).toContain('q=%E6%B0%B4%E6%9E%9C');
    expect(action?.url).toContain('maxPrice=100');
    expect(action?.url).toContain('recommendThemes=discount%2Cseasonal');
    expect(action?.url).toContain('promotionIntent=threshold-optimization');
    expect(action?.url).toContain('originPreference=%E5%B1%B1%E4%B8%9C');
  });

  it('accepts the complete server recommendation contract', () => {
    expect(isAiVoiceIntent({
      type: 'recommend', transcript: '今晚吃什么', feedback: '为你推荐',
      recommend: {
        preferRecommended: true,
        budget: 88,
        recommendThemes: ['tasty'],
        slots: { usageScenario: '晚餐', bundleIntent: 'meal-kit' },
      },
      resolved: { usageScenario: '晚餐', budget: 88, recommendThemes: ['tasty'] },
    })).toBe(true);
    expect(isAiVoiceIntent({
      type: 'recommend', transcript: '今晚吃什么', feedback: '为你推荐',
      recommend: { recommendThemes: ['unsupported'] },
    })).toBe(false);
  });
});


describe('voice actions preserve semantics and truthful feedback', () => {
  it('keeps category, budget, dietary and origin conditions through the search route', () => {
    const action = resolveAiAction({
      type: 'search', transcript: '找山东低糖水果，五十元以内', feedback: '为你搜索',
      search: { query: '水果', matchedCategoryId: 'fruit', constraints: ['low-sugar', 'organic'],
        recommendThemes: ['seasonal'], maxPrice: 50, slots: { originPreference: '山东', dietaryPreference: '低糖' } },
    });
    const url = new URL(action!.url!, 'https://test.invalid');
    expect(url.pathname).toBe('/packages/commerce/catalog-search/index');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: '水果', categoryId: 'fruit', constraints: 'low-sugar,organic', maxPrice: '50',
      recommendThemes: 'seasonal', originPreference: '山东', dietaryPreference: '低糖',
    });
  });

  it('uses resolved-only semantics and does not invent a keyword for a category-only request', () => {
    const action = resolveAiAction({ type: 'search', transcript: '便宜的水果', feedback: '为你搜索',
      search: { query: '' }, resolved: { matchedCategoryId: 'fruit', budget: 30, constraints: ['organic'] } });
    const url = new URL(action!.url!, 'https://test.invalid');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.get('categoryId')).toBe('fruit');
    expect(url.searchParams.get('maxPrice')).toBe('30');
  });

  it('opens the registered settings page with its existing login protection', () => {
    expect(resolveAiAction({ type: 'navigate', transcript: '打开设置', feedback: '打开设置',
      resolved: { navigateTarget: 'settings' } })).toEqual({
      label: '打开设置', url: '/packages/settings/index/index', mode: 'navigate', requiresAuth: true,
    });
  });

  it('does not claim that the miniapp performed an add-to-cart mutation', () => {
    const intent = { type: 'search' as const, transcript: '把苹果加入购物车', feedback: '已将苹果加入购物车',
      search: { query: '苹果', action: 'add-to-cart' as const, matchedProductId: 'apple' } };
    expect(aiReply(intent)).toBe('已找到苹果，请确认规格后加入购物车');
    expect(resolveAiAction(intent)?.label).toBe('确认规格后加入购物车');
  });

  it('opens the unpaid-shipping list rather than the shipped list', () => {
    expect(resolveAiAction({ type: 'transaction', transcript: '查待发货订单', feedback: '查看订单',
      transaction: { action: 'view-order', status: 'pendingShip' } }))
      .toMatchObject({ url: '/packages/orders/order-list/index?status=PAID', requiresAuth: true });
  });
});
