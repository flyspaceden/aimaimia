import { Button, Image, Text, View } from '@tarojs/components';
import Taro, { usePullDownRefresh, useRouter } from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { FunctionalIcon } from '@/components/functional-icon';
import { CatalogProductCard } from '@/components/catalog-product-card';
import { formatCatalogPrice, resolveCatalogQuickAddAction } from '@/components/catalog-utils';
import { queryClient } from '@/query/client';
import { CartRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import type { Product } from '@/types';
import { AiRecommendRepo } from '../recommend-repo';
import type {
  AiBundleIntent,
  AiPromotionIntent,
  AiRecommendTheme,
} from '../types';
import './index.scss';

const themeLabels: Record<AiRecommendTheme, string> = {
  hot: '爆款', discount: '折扣', tasty: '好吃', seasonal: '当季', recent: '最近热门',
};
const constraintLabels: Record<string, string> = {
  organic: '有机', 'low-sugar': '低糖', seasonal: '当季', traceable: '可溯源',
  'cold-chain': '冷链', 'geo-certified': '地理标志', healthy: '健康', fresh: '新鲜',
};
const PAGE_PATH = '/packages/ai/recommend/index';

function routeText(value: unknown, maxLength = 128): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function routeCsv(value: unknown, maxItems = 8): string[] {
  const normalized = routeText(value, 256);
  if (!normalized) return [];
  return Array.from(new Set(normalized.split(',').map((item) => item.trim().slice(0, 32)).filter(Boolean))).slice(0, maxItems);
}

function routeBudget(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1_000_000) : undefined;
}

function buildQuery(params: Array<[string, string | number | undefined]>): string {
  return params
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

export default function AiRecommendPage() {
  const router = useRouter();
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const queryText = routeText(router.params.q, 64);
  const source = routeText(router.params.source, 16);
  const categoryId = routeText(router.params.categoryId, 64);
  const categoryName = routeText(router.params.categoryName, 64);
  const constraints = useMemo(() => routeCsv(router.params.constraints), [router.params.constraints]);
  const recommendThemes = useMemo(
    () => routeCsv(router.params.recommendThemes).filter(
      (item): item is AiRecommendTheme => item in themeLabels,
    ),
    [router.params.recommendThemes],
  );
  const maxPrice = routeBudget(router.params.maxPrice);
  const usageScenario = routeText(router.params.usageScenario);
  const promotionIntent = routeText(router.params.promotionIntent, 64) as AiPromotionIntent | undefined;
  const bundleIntent = routeText(router.params.bundleIntent, 64) as AiBundleIntent | undefined;
  const originPreference = routeText(router.params.originPreference);
  const dietaryPreference = routeText(router.params.dietaryPreference);
  const flavorPreference = routeText(router.params.flavorPreference);
  const categoryHint = routeText(router.params.categoryHint);
  const preferRecommended = router.params.preferRecommended === '1'
    || recommendThemes.length > 0
    || (!queryText && !categoryId && !maxPrice && constraints.length === 0);

  const planQuery = useQuery({
    queryKey: [
      'ai', 'recommend-plan', queryText || '', categoryId || '', categoryName || '', maxPrice || 0,
      constraints.join('|'), recommendThemes.join('|'), usageScenario || '', promotionIntent || '',
      bundleIntent || '', originPreference || '', dietaryPreference || '', flavorPreference || '', categoryHint || '',
    ],
    queryFn: () => AiRecommendRepo.getPlan({
      query: queryText, categoryId, categoryName, preferRecommended, constraints, maxPrice,
      recommendThemes, usageScenario, promotionIntent, bundleIntent, originPreference,
      dietaryPreference, flavorPreference, categoryHint,
    }),
  });
  const insightsQuery = useQuery({
    queryKey: ['ai', 'recommend-insights', authRevision],
    queryFn: AiRecommendRepo.getInsights,
    enabled: loggedIn,
  });
  const cartQuery = useQuery({
    queryKey: ['commerce', 'cart'],
    queryFn: CartRepo.get,
    enabled: loggedIn,
    staleTime: 10_000,
  });
  const addMutation = useMutation({
    mutationFn: (product: Product) => CartRepo.addItem(product.defaultSkuId!, 1),
    onSuccess: async (result, product) => {
      if (!result.ok) {
        Taro.showToast({ title: result.error.displayMessage || '加入购物车失败', icon: 'none' });
        return;
      }
      queryClient.setQueryData(['commerce', 'cart'], result);
      await queryClient.invalidateQueries({ queryKey: ['commerce', 'cart'] });
      Taro.showToast({ title: `${product.title}已加入购物车`, icon: 'success' });
    },
    onError: () => Taro.showToast({ title: '网络开小差了，请重试', icon: 'none' }),
  });

  const plan = planQuery.data?.ok ? planQuery.data.data : undefined;
  const insights = insightsQuery.data?.ok ? insightsQuery.data.data : [];
  const cartCount = cartQuery.data?.ok
    ? cartQuery.data.data.items.reduce((sum, item) => sum + item.quantity, 0)
    : 0;
  const fallbackTags = [
    ...(queryText ? [queryText] : []),
    ...(categoryName ? [categoryName] : []),
    ...(maxPrice ? [`预算 ¥${formatCatalogPrice(maxPrice)}`] : []),
    ...recommendThemes.map((item) => themeLabels[item]),
    ...constraints.map((item) => constraintLabels[item] || item),
    ...(preferRecommended ? ['AI优选'] : []),
  ];
  const activeTags = plan?.tags.length ? plan.tags : Array.from(new Set(fallbackTags)).slice(0, 6);
  const searchQuery = buildQuery([
    ['q', queryText || categoryName || categoryHint],
    ['categoryId', categoryId],
    ['preferRecommended', preferRecommended ? 1 : undefined],
    ['constraints', constraints.length ? constraints.join(',') : undefined],
    ['maxPrice', maxPrice],
    ['recommendThemes', recommendThemes.length ? recommendThemes.join(',') : undefined],
    ['usageScenario', usageScenario], ['originPreference', originPreference],
    ['dietaryPreference', dietaryPreference], ['flavorPreference', flavorPreference],
    ['categoryHint', categoryHint],
  ]);
  const currentQuery = buildQuery([
    ['q', queryText], ['source', source], ['categoryId', categoryId], ['categoryName', categoryName],
    ['preferRecommended', preferRecommended ? 1 : undefined],
    ['constraints', constraints.length ? constraints.join(',') : undefined], ['maxPrice', maxPrice],
    ['recommendThemes', recommendThemes.length ? recommendThemes.join(',') : undefined],
    ['usageScenario', usageScenario], ['promotionIntent', promotionIntent], ['bundleIntent', bundleIntent],
    ['originPreference', originPreference], ['dietaryPreference', dietaryPreference],
    ['flavorPreference', flavorPreference], ['categoryHint', categoryHint],
  ]);
  const returnUrl = `${PAGE_PATH}${currentQuery ? `?${currentQuery}` : ''}`;

  const openProduct = (product: Product) => Taro.navigateTo({
    url: `/packages/commerce/catalog-product/index?id=${encodeURIComponent(product.id)}`,
  });
  const addProduct = (product: Product) => {
    if (!loggedIn) {
      void Taro.navigateTo({
        url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}`,
      });
      return;
    }
    const action = resolveCatalogQuickAddAction(product);
    if (action.kind === 'detail') {
      void openProduct(product);
      Taro.showToast({ title: action.label === '查看商品' ? '商品暂时缺货' : '请选择商品规格', icon: 'none' });
      return;
    }
    addMutation.mutate(product);
  };

  const refresh = async () => {
    await Promise.allSettled([
      planQuery.refetch(),
      loggedIn ? insightsQuery.refetch() : Promise.resolve(null),
      loggedIn ? cartQuery.refetch() : Promise.resolve(null),
    ]);
  };
  usePullDownRefresh(() => { void refresh().finally(() => Taro.stopPullDownRefresh()); });

  return (
    <View className='aim-page ai-recommend-page'>
      <View className='ai-recommend-intro'>
        <View className='ai-recommend-orb'><Text>AI</Text></View>
        <Text>{source === 'voice' ? '已按你的语音偏好完成推荐筛选' : '根据你的偏好，为你精选'}</Text>
      </View>

      <View className='ai-recommend-summary aim-card'>
        <View className='ai-recommend-summary__head'>
          <Text className='ai-recommend-badge'>AI 推荐</Text>
          <Text className='ai-recommend-summary__copy'>{plan?.summary || '正在为你整理更值得先看的商品'}</Text>
          <Text className='ai-recommend-summary__link' onClick={() => Taro.navigateTo({ url: `/packages/commerce/catalog-search/index${searchQuery ? `?${searchQuery}` : ''}` })}>查看全部</Text>
        </View>
        {activeTags.length ? <View className='ai-recommend-tags'>{activeTags.map((tag) => <Text className='ai-recommend-tag' key={tag}>{tag}</Text>)}</View> : null}
      </View>

      <View className='ai-recommend-section'>
        <View className='ai-recommend-section__head'><Text className='ai-recommend-section__title'>推荐商品</Text>{plan?.aiReason ? <Text className='ai-recommend-section__meta'>{plan.aiReason}</Text> : null}</View>
        <View className='ai-recommend-divider' />
        {planQuery.isLoading ? <CatalogFeedback kind='loading' /> : null}
        {planQuery.data && !planQuery.data.ok ? <CatalogFeedback kind='error' title='推荐商品加载失败' description={planQuery.data.error.displayMessage} onRetry={() => planQuery.refetch()} /> : null}
        {plan && !plan.products.length ? <CatalogFeedback kind='empty' title='暂时没有匹配结果' description='你可以放宽预算或条件，看看更多推荐商品。' /> : null}
        {plan?.products.length ? <View className='ai-recommend-grid'>{plan.products.map((product) => (
          <View className='ai-recommend-product' key={product.id}>
            <CatalogProductCard product={product} onClick={openProduct} aiRecommend aiReason={plan.aiReason} />
            <Button className='ai-recommend-product__add' loading={addMutation.isPending && addMutation.variables?.id === product.id} onClick={() => addProduct(product)}>{resolveCatalogQuickAddAction(product).label}</Button>
          </View>
        ))}</View> : null}
      </View>

      <View className='ai-recommend-section'>
        <View className='ai-recommend-section__head'><Text className='ai-recommend-section__title'>组合导购</Text><Text className='ai-recommend-section__meta'>{maxPrice ? `预算上限 ¥${formatCatalogPrice(maxPrice)}` : '自动按偏好整理'}</Text></View>
        <View className='ai-recommend-divider' />
        {plan?.plans.map((item) => (
          <View className={`ai-recommend-plan aim-card ai-recommend-plan--${item.tone}`} key={item.id}>
            <View className='ai-recommend-plan__head'><View className='ai-recommend-plan__copy'><Text className='ai-recommend-plan__title'>{item.title}</Text><Text className='ai-recommend-plan__description'>{item.description}</Text></View><Text className='ai-recommend-plan__price'>¥{formatCatalogPrice(item.totalPrice)}</Text></View>
            {maxPrice ? <View className='ai-recommend-progress'><View className='ai-recommend-progress__label'><Text>预算占用</Text><Text>{Math.min(100, Math.round((item.totalPrice / maxPrice) * 100))}%</Text></View><View className='ai-recommend-progress__track'><View className='ai-recommend-progress__fill' style={{ width: `${Math.min(100, Math.round((item.totalPrice / maxPrice) * 100))}%` }} /></View></View> : null}
            <View className='ai-recommend-tags'>{item.highlights.map((highlight) => <Text className='ai-recommend-tag' key={`${item.id}-${highlight}`}>{highlight}</Text>)}</View>
            <View className='ai-recommend-plan__products'>{item.products.map((product) => <View className='ai-recommend-plan-product' key={`${item.id}-${product.id}`} onClick={() => openProduct(product)}><Image src={product.image} mode='aspectFill' /><View><Text className='ai-recommend-plan-product__title'>{product.title}</Text><Text className='ai-recommend-plan-product__origin'>{product.origin || '优选产地'}</Text></View><Text className='ai-recommend-plan-product__price'>¥{formatCatalogPrice(product.price)} ›</Text></View>)}</View>
          </View>
        ))}
      </View>

      <View className='ai-recommend-section'>
        <View className='ai-recommend-section__head'><Text className='ai-recommend-section__title'>推荐洞察</Text><Text className='ai-recommend-badge ai-recommend-badge--analysis'>AI 分析</Text></View>
        <View className='ai-recommend-divider' />
        {!loggedIn ? <View className='ai-recommend-note aim-card'><Text>当前已按语音条件完成推荐筛选。登录后，这里还会叠加你的浏览、收藏和互动画像。</Text><Button onClick={() => Taro.navigateTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}` })}>登录查看</Button></View> : null}
        {loggedIn && insightsQuery.isLoading ? <CatalogFeedback kind='loading' /> : null}
        {loggedIn && insightsQuery.data && !insightsQuery.data.ok ? <CatalogFeedback kind='error' title='推荐洞察加载失败' description={insightsQuery.data.error.displayMessage} onRetry={() => insightsQuery.refetch()} /> : null}
        {loggedIn && insights.map((insight) => <View className='ai-recommend-insight aim-card' key={insight.id}><View className='ai-recommend-insight__head'><Text>{insight.title}</Text><Text>{Math.round(insight.weight * 100)}%</Text></View><Text className='ai-recommend-insight__description'>{insight.description}</Text><View className='ai-recommend-tags'>{insight.tags.map((tag) => <Text className='ai-recommend-tag' key={`${insight.id}-${tag}`}>{tag}</Text>)}</View></View>)}
      </View>

      <View className='ai-recommend-cart' onClick={() => Taro.navigateTo({ url: '/packages/commerce/cart/index' })}><FunctionalIcon name='cart' className='ai-recommend-cart__icon' />{cartCount ? <Text className='ai-recommend-cart__badge'>{cartCount > 99 ? '99+' : cartCount}</Text> : null}</View>
    </View>
  );
}
