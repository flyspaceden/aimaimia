// src/utils/navigateByIntent.ts
import type { AiVoiceIntent } from '../types/domain/Ai';
import { OrderRepo } from '../repos/OrderRepo';
import { CompanyRepo } from '../repos/CompanyRepo';

// ── 导出类型 ──────────────────────────────────────────
export type IntentResult = {
  action: 'navigate' | 'feedback' | 'clarify';
  // navigate: 直接跳转
  route?: string;
  params?: Record<string, string>;
  toastText?: string;
  // feedback: 展示反馈浮层
  feedbackText?: string;
  actionLabel?: string;
  actionRoute?: string;
  actionParams?: Record<string, string>;
  // chat 特殊处理
  continueChatContext?: { initialTranscript: string; initialReply: string };
  // clarify: 消歧
  clarifyIntent?: AiVoiceIntent;
  // 登录保护
  needsAuth?: boolean;
};

export type ResolveIntentOptions = {
  isLoggedIn: boolean;
  cartCount: number;
  selectedCartCount: number;
};

// ── 内部辅助 ──────────────────────────────────────────

function normalizeCompanyLookupText(value: string): string {
  return value
    .toLowerCase()
    .replace(/["""'`]/g, '')
    .replace(/[，。！？,.!?\s]/g, '')
    .replace(/(?:官方|自营)/gu, '')
    .replace(/(?:店铺|农场|商家|公司|企业|旗舰店)$/u, '')
    .trim();
}

const PROTECTED_ROUTES: Set<string> = new Set(['settings', 'orders', 'payment', 'checkout']);

function isProtectedRoute(target: string): boolean {
  return PROTECTED_ROUTES.has(target);
}

function resolveSearchIntent(intent: AiVoiceIntent): IntentResult {
  const resolved = intent.resolved;
  const resolvedQuery = resolved?.query ?? intent.search?.query ?? intent.slots?.query;
  const resolvedProductId = resolved?.matchedProductId ?? intent.search?.matchedProductId;
  const resolvedProductName = resolved?.matchedProductName ?? intent.search?.matchedProductName;
  const resolvedCategoryId = resolved?.matchedCategoryId ?? intent.search?.matchedCategoryId;
  const resolvedCategoryName = resolved?.matchedCategoryName ?? intent.search?.matchedCategoryName;
  const resolvedPreferRecommended = resolved?.preferRecommended ?? intent.search?.preferRecommended;
  const resolvedConstraints = resolved?.constraints ?? intent.search?.constraints;
  const resolvedThemes = resolved?.recommendThemes ?? intent.search?.recommendThemes;

  const hasSearchSignal = Boolean(
    resolvedQuery || resolvedProductId || resolvedCategoryId
    || resolvedPreferRecommended || resolvedConstraints?.length || resolvedThemes?.length,
  );

  if (!hasSearchSignal) {
    return {
      action: 'feedback',
      feedbackText: intent.feedback || '我还没确定你想找什么商品，换个更具体的说法试试。',
    };
  }

  const resolvedUsageScenario = resolved?.usageScenario || intent.slots?.usageScenario || intent.slots?.usage;
  const resolvedOriginPreference = resolved?.originPreference || intent.slots?.originPreference;
  const resolvedDietaryPreference = resolved?.dietaryPreference || intent.slots?.dietaryPreference;
  const resolvedFlavorPreference = resolved?.flavorPreference || intent.slots?.flavorPreference;
  const resolvedCategoryHint = resolved?.categoryHint || intent.slots?.categoryHint;

  const searchParams: Record<string, string> = {
    ...(resolvedQuery ? { q: resolvedQuery } : {}),
    source: 'voice',
    ...(intent.search?.action ? { action: intent.search.action } : {}),
    ...(resolvedProductId ? { productId: resolvedProductId } : {}),
    ...(resolvedProductName ? { productName: resolvedProductName } : {}),
    ...(resolvedCategoryId ? { categoryId: resolvedCategoryId } : {}),
    ...(resolvedCategoryName ? { categoryName: resolvedCategoryName } : {}),
    ...(resolvedPreferRecommended ? { preferRecommended: '1' } : {}),
    ...(resolvedConstraints?.length ? { constraints: resolvedConstraints.join(',') } : {}),
    ...(resolvedThemes?.length ? { recommendThemes: resolvedThemes.join(',') } : {}),
    ...(resolvedUsageScenario ? { usageScenario: resolvedUsageScenario } : {}),
    ...(resolvedOriginPreference ? { originPreference: resolvedOriginPreference } : {}),
    ...(resolvedDietaryPreference ? { dietaryPreference: resolvedDietaryPreference } : {}),
    ...(resolvedFlavorPreference ? { flavorPreference: resolvedFlavorPreference } : {}),
    ...(resolvedCategoryHint ? { categoryHint: resolvedCategoryHint } : {}),
  };

  // 匹配到具体商品 → 直接跳商品详情
  if (resolvedProductId) {
    return {
      action: 'navigate',
      route: '/product/[id]',
      params: { id: resolvedProductId },
      toastText: intent.feedback,
    };
  }

  // 有搜索信号 → 直接跳搜索页
  return {
    action: 'navigate',
    route: '/search',
    params: searchParams,
    toastText: intent.feedback,
  };
}

async function resolveCompanyIntent(intent: AiVoiceIntent): Promise<IntentResult> {
  const mode = intent.resolved?.companyMode ?? intent.company?.mode ?? intent.slots?.companyMode ?? 'detail';
  const resolvedCompanyId = intent.resolved?.companyId;
  const resolvedCompanyName = intent.resolved?.companyName;
  const industryHint = intent.resolved?.companyIndustryHint ?? intent.company?.industryHint ?? intent.slots?.companyIndustryHint;
  const location = intent.resolved?.companyLocation ?? intent.company?.location ?? intent.slots?.companyLocation;
  const companyType = intent.resolved?.companyType ?? intent.company?.companyType ?? intent.slots?.companyType;
  const featureTags = intent.resolved?.companyFeatureTags ?? intent.company?.featureTags ?? intent.slots?.companyFeatureTags;
  const rawName = (resolvedCompanyName || intent.company?.name || intent.slots?.companyName || '').trim();

  const searchParams: Record<string, string> = {
    source: 'voice',
    ...(rawName ? { q: rawName } : {}),
    ...(industryHint ? { industryHint } : {}),
    ...(location ? { location } : {}),
    ...(companyType ? { companyType } : {}),
    ...(featureTags?.length ? { featureTags: featureTags.join(',') } : {}),
  };

  if (mode === 'list') {
    return {
      action: 'navigate',
      route: '/company/search',
      params: searchParams,
      toastText: intent.feedback || '先带你看看有哪些农场和企业...',
    };
  }

  if (resolvedCompanyId) {
    return {
      action: 'navigate',
      route: '/company/[id]',
      params: { id: resolvedCompanyId },
      toastText: intent.feedback || `正在为你打开"${resolvedCompanyName || rawName}"...`,
    };
  }

  if (!rawName || !normalizeCompanyLookupText(rawName)) {
    return {
      action: 'navigate',
      route: '/company/search',
      params: searchParams,
      toastText: '先带你看看有哪些农场和企业...',
    };
  }

  if (/^(?:c-|cmp-|company-)/i.test(rawName)) {
    return {
      action: 'navigate',
      route: '/company/[id]',
      params: { id: rawName },
      toastText: intent.feedback || `正在为你打开"${rawName}"...`,
    };
  }

  // 尝试通过 API 匹配企业名称
  const result = await CompanyRepo.list();
  if (!result.ok) {
    return {
      action: 'navigate',
      route: '/company/search',
      params: searchParams,
      toastText: `先为你查找"${rawName}"相关企业...`,
    };
  }

  const normalizedTarget = normalizeCompanyLookupText(rawName);
  const exactMatch = result.data.find(
    (company) => normalizeCompanyLookupText(company.name) === normalizedTarget,
  );
  if (exactMatch) {
    return {
      action: 'navigate',
      route: '/company/[id]',
      params: { id: exactMatch.id },
      toastText: intent.feedback || `正在为你打开"${exactMatch.name}"...`,
    };
  }

  return {
    action: 'navigate',
    route: '/company/search',
    params: searchParams,
    toastText: mode === 'detail'
      ? `先为你查找"${rawName}"相关企业...`
      : (intent.feedback || `先为你查找"${rawName}"相关企业...`),
  };
}

async function resolveTransactionIntent(
  intent: AiVoiceIntent,
  options: ResolveIntentOptions,
): Promise<IntentResult> {
  const action = intent.resolved?.transactionAction ?? intent.transaction?.action ?? intent.slots?.transactionAction;

  // 登录保护
  if (!options.isLoggedIn) {
    const loginFeedback = action === 'track-order'
      ? '请先登录，再为你查询订单物流...'
      : '请先登录，再为你处理订单相关操作...';
    return {
      action: 'feedback',
      feedbackText: loginFeedback,
      needsAuth: true,
    };
  }

  switch (action) {
    case 'track-order': {
      const orderResult = await OrderRepo.list(undefined, { page: 1, pageSize: 20 });
      if (orderResult.ok) {
        const preferredStatuses = ['shipping', 'delivered', 'completed'] as const;
        for (const status of preferredStatuses) {
          const order = orderResult.data.items.find((item) => item.status === status);
          if (order) {
            return {
              action: 'navigate',
              route: '/orders/track',
              params: { orderId: order.id },
              toastText: intent.feedback,
            };
          }
        }
      }
      return {
        action: 'navigate',
        route: '/orders',
        params: {},
        toastText: '暂时没找到可追踪的订单，先带你去订单页看看...',
      };
    }
    case 'pay': {
      const pendingPayResult = await OrderRepo.list('pendingPay', { page: 1, pageSize: 1 });
      const hasPendingPay = pendingPayResult.ok && pendingPayResult.data.items.length > 0;
      return {
        action: 'navigate',
        route: '/orders',
        params: hasPendingPay ? { status: 'pendingPay' } : {},
        toastText: hasPendingPay ? intent.feedback : '暂时没有待付款订单，先带你去订单页看看...',
      };
    }
    case 'refund':
    case 'return':
    case 'exchange':
    case 'after-sale': {
      const latestIssueResult = await OrderRepo.getLatestIssue();
      if (latestIssueResult.ok && latestIssueResult.data?.id) {
        return {
          action: 'navigate',
          route: '/orders/after-sale/[id]',
          params: { id: latestIssueResult.data.id },
          toastText: intent.feedback,
        };
      }
      const afterSaleResult = await OrderRepo.list('afterSale', { page: 1, pageSize: 1 });
      const afterSaleOrderId = afterSaleResult.ok ? afterSaleResult.data.items[0]?.id : null;
      if (afterSaleOrderId) {
        return {
          action: 'navigate',
          route: '/orders/[id]',
          params: { id: afterSaleOrderId },
          toastText: '先带你去相关订单看看售后进度...',
        };
      }
      return {
        action: 'navigate',
        route: '/orders',
        params: { status: 'afterSale' },
        toastText: '先带你去售后订单页看看...',
      };
    }
    default:
      return {
        action: 'navigate',
        route: '/orders',
        params: {},
        toastText: intent.feedback || '正在打开订单列表...',
      };
  }
}

function resolveNavigateIntent(
  intent: AiVoiceIntent,
  options: ResolveIntentOptions,
): IntentResult {
  let feedback = intent.feedback;
  let route: string | null = null;
  const navigateTarget = intent.resolved?.navigateTarget ?? intent.slots?.targetPage;

  switch (navigateTarget) {
    case 'home':
      route = '/(tabs)/home'; break;
    case 'discover':
      route = '/(tabs)/museum'; break;
    case 'me':
      route = '/(tabs)/me'; break;
    case 'settings':
      route = '/settings'; break;
    case 'cart':
      route = '/cart'; break;
    case 'checkout':
      if (options.cartCount === 0) {
        feedback = '购物车还是空的，先去挑点商品吧...';
        route = '/cart';
      } else if (options.selectedCartCount === 0) {
        feedback = '你还没勾选要结算的商品，先去购物车确认一下...';
        route = '/cart';
      } else {
        route = '/checkout';
      }
      break;
    case 'orders':
      route = '/orders'; break;
    case 'search':
      route = '/search'; break;
    case 'ai-chat':
      route = '/ai/chat'; break;
    default:
      feedback = intent.feedback || '我来帮你打开对应页面。';
      route = null;
      break;
  }

  // 登录保护（settings / orders / payment / checkout）
  if (route && navigateTarget && isProtectedRoute(navigateTarget) && !options.isLoggedIn) {
    const loginPrompts: Record<string, string> = {
      settings: '请先登录，再为你打开设置...',
      orders: '请先登录，再为你打开订单页面...',
      payment: '请先登录，才能进行支付操作...',
      checkout: '请先登录，再为你结算...',
    };
    feedback = loginPrompts[navigateTarget] || '请先登录...';
    return {
      action: 'navigate',
      feedbackText: feedback,
      route: route,
      toastText: feedback,
      needsAuth: true,
    };
  }

  if (!route) {
    return { action: 'feedback', feedbackText: feedback };
  }

  return {
    action: 'navigate',
    route,
    toastText: feedback,
  };
}

function resolveRecommendIntent(intent: AiVoiceIntent): IntentResult {
  const recommend = intent.recommend;
  const resolved = intent.resolved;
  return {
    action: 'navigate',
    route: '/ai/recommend',
    toastText: intent.feedback || '正在为你打开 AI 推荐...',
    params: {
      ...(resolved?.query ?? recommend?.query ? { q: resolved?.query ?? recommend?.query ?? '' } : {}),
      source: 'voice',
      ...(resolved?.matchedCategoryId ?? recommend?.matchedCategoryId
        ? { categoryId: resolved?.matchedCategoryId ?? recommend?.matchedCategoryId ?? '' } : {}),
      ...(resolved?.matchedCategoryName ?? recommend?.matchedCategoryName
        ? { categoryName: resolved?.matchedCategoryName ?? recommend?.matchedCategoryName ?? '' } : {}),
      ...((resolved?.preferRecommended ?? recommend?.preferRecommended) ? { preferRecommended: '1' } : {}),
      ...(resolved?.constraints?.length
        ? { constraints: resolved.constraints.join(',') }
        : recommend?.constraints?.length
          ? { constraints: recommend.constraints.join(',') }
          : {}),
      ...(resolved?.budget
        ? { maxPrice: String(resolved.budget) }
        : recommend?.budget
          ? { maxPrice: String(recommend.budget) }
          : {}),
      ...(resolved?.recommendThemes?.length
        ? { recommendThemes: resolved.recommendThemes.join(',') }
        : recommend?.recommendThemes?.length
          ? { recommendThemes: recommend.recommendThemes.join(',') }
          : {}),
    },
  };
}

// ── 主函数 ──────────────────────────────────────────
export async function resolveIntent(
  intent: AiVoiceIntent,
  options: ResolveIntentOptions,
): Promise<IntentResult> {
  const intentType = intent.intent ?? intent.type;

  switch (intentType) {
    case 'search':
      return resolveSearchIntent(intent);

    case 'company':
      return resolveCompanyIntent(intent);

    case 'navigate':
      return resolveNavigateIntent(intent, options);

    case 'transaction':
      return resolveTransactionIntent(intent, options);

    case 'recommend':
      return resolveRecommendIntent(intent);

    case 'clarify':
      return {
        action: 'clarify',
        feedbackText: intent.feedback || '我还不太确定你的意思。',
        clarifyIntent: intent,
      };

    case 'chat':
    default:
      return {
        action: 'feedback',
        feedbackText: intent.feedback || '我在呢，有什么可以帮你？',
        continueChatContext: {
          initialTranscript: intent.transcript,
          initialReply: intent.feedback || '我在呢，有什么可以帮你？',
        },
      };
  }
}
