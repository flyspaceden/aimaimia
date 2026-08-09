import type {
  AiClarifyCandidate,
  AiPageAction,
  AiVoiceIntent,
} from './types';

const protectedAction = (label: string, url: string): AiPageAction => ({
  label,
  url,
  mode: 'navigate',
  requiresAuth: true,
});

function searchUrl(query?: string): string {
  const normalized = query?.trim();
  return normalized
    ? `/packages/commerce/catalog-search/index?q=${encodeURIComponent(normalized)}`
    : '/packages/commerce/catalog-search/index';
}

function recommendUrl(intent: AiVoiceIntent): string {
  const recommend = intent.recommend;
  const slots = recommend?.slots;
  const resolved = intent.resolved;
  const params: Array<[string, string | number | boolean | string[] | undefined]> = [
    ['q', recommend?.query || resolved?.query],
    ['source', 'voice'],
    ['categoryId', recommend?.matchedCategoryId || resolved?.matchedCategoryId],
    ['categoryName', recommend?.matchedCategoryName || resolved?.matchedCategoryName],
    ['preferRecommended', recommend?.preferRecommended ?? slots?.preferRecommended ?? resolved?.preferRecommended],
    ['constraints', recommend?.constraints || slots?.constraints || resolved?.constraints],
    ['maxPrice', recommend?.budget ?? slots?.budget ?? resolved?.budget],
    ['recommendThemes', recommend?.recommendThemes || slots?.recommendThemes || resolved?.recommendThemes],
    ['usageScenario', slots?.usageScenario || resolved?.usageScenario],
    ['promotionIntent', slots?.promotionIntent || resolved?.promotionIntent],
    ['bundleIntent', slots?.bundleIntent || resolved?.bundleIntent],
    ['originPreference', slots?.originPreference || resolved?.originPreference],
    ['dietaryPreference', slots?.dietaryPreference || resolved?.dietaryPreference],
    ['flavorPreference', slots?.flavorPreference || resolved?.flavorPreference],
    ['categoryHint', slots?.categoryHint || resolved?.categoryHint],
  ];
  const query = params
    .filter(([, value]) => value !== undefined && value !== false && value !== '' && (!Array.isArray(value) || value.length > 0))
    .map(([key, value]) => {
      const normalized = Array.isArray(value) ? value.join(',') : value === true ? '1' : String(value);
      return `${encodeURIComponent(key)}=${encodeURIComponent(normalized)}`;
    })
    .join('&');
  return `/packages/ai/recommend/index${query ? `?${query}` : ''}`;
}

function transactionAction(intent: AiVoiceIntent): AiPageAction {
  const action = intent.transaction?.action || intent.resolved?.transactionAction;
  const status = intent.transaction?.status || intent.resolved?.transactionStatus;
  if (action === 'pay' || status === 'pendingPay') {
    return protectedAction('查看待支付订单', '/packages/commerce/checkout-pending/index');
  }
  if (action === 'refund' || action === 'return' || action === 'exchange' || action === 'after-sale' || status === 'afterSale') {
    return protectedAction('查看售后订单', '/packages/orders/order-list/index?status=afterSale');
  }
  if (status === 'pendingShip') {
    return protectedAction('查看待发货订单', '/packages/orders/order-list/index?status=PAID');
  }
  if (action === 'track-order' || status === 'shipping') {
    return protectedAction('选择订单查看物流', '/packages/orders/order-list/index?status=SHIPPED');
  }
  return protectedAction('查看我的订单', '/packages/orders/order-list/index');
}

export function resolveAiAction(intent: AiVoiceIntent): AiPageAction | null {
  switch (intent.type) {
    case 'search': {
      const productId = intent.search?.matchedProductId || intent.resolved?.matchedProductId;
      if (productId) {
        return {
          label: intent.search?.action === 'add-to-cart' ? '确认规格后加入购物车' : '查看匹配商品',
          url: `/packages/commerce/catalog-product/index?id=${encodeURIComponent(productId)}`,
          mode: 'navigate',
        };
      }
      const query = intent.search?.query || intent.resolved?.query || intent.transcript;
      return { label: '查看搜索结果', url: searchUrl(query), mode: 'navigate' };
    }
    case 'company': {
      if (intent.resolved?.companyId) {
        return {
          label: '查看企业',
          url: `/packages/commerce/catalog-company/index?id=${encodeURIComponent(intent.resolved.companyId)}`,
          mode: 'navigate',
        };
      }
      const company = intent.company;
      const resolved = intent.resolved;
      const mode = resolved?.companyMode || company?.mode;
      const industryHint = resolved?.companyIndustryHint || company?.industryHint;
      const location = resolved?.companyLocation || company?.location;
      const companyType = resolved?.companyType || company?.companyType;
      const featureTags = resolved?.companyFeatureTags || company?.featureTags;
      const rawName = company?.name || resolved?.companyName;
      const query = mode === 'list' && (industryHint || location || companyType || featureTags?.length)
        ? undefined
        : rawName || intent.transcript;
      const params = [
        ['q', query], ['source', 'voice'], ['industryHint', industryHint], ['location', location],
        ['companyType', companyType], ['featureTags', featureTags?.join(',')],
      ].filter(([, value]) => value);
      const suffix = params.map(([key, value]) => `${encodeURIComponent(key!)}=${encodeURIComponent(value!)}`).join('&');
      return { label: '搜索相关企业', url: `/packages/commerce/company-search/index${suffix ? `?${suffix}` : ''}`, mode: 'navigate' };
    }
    case 'navigate': {
      const target = intent.resolved?.navigateTarget;
      if (target === 'home') return { label: '回到首页', url: '/pages/home/index', mode: 'switchTab' };
      if (target === 'discover') return { label: '打开发现', url: '/pages/products/index', mode: 'switchTab' };
      if (target === 'me' || target === 'settings') return { label: '打开我的', url: '/pages/me/index', mode: 'switchTab' };
      if (target === 'cart') return protectedAction('打开购物车', '/packages/commerce/cart/index');
      if (target === 'checkout') return protectedAction('继续结算', '/packages/commerce/checkout/index');
      if (target === 'orders') return protectedAction('查看我的订单', '/packages/orders/order-list/index');
      if (target === 'search') return { label: '打开搜索', url: searchUrl(intent.resolved?.query), mode: 'navigate' };
      return null;
    }
    case 'transaction':
      return transactionAction(intent);
    case 'recommend': {
      return { label: '查看 AI 推荐', url: recommendUrl(intent), mode: 'navigate' };
    }
    case 'chat':
    case 'clarify':
      return null;
    default:
      return null;
  }
}

export function candidateToIntent(candidate: AiClarifyCandidate, transcript: string): AiVoiceIntent {
  return {
    ...candidate,
    type: candidate.type,
    transcript,
    feedback: candidate.feedback,
  };
}

export function aiReply(intent: AiVoiceIntent): string {
  return intent.chatResponse?.reply?.trim() || intent.feedback.trim();
}
