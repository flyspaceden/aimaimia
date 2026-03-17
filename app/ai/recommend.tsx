import React, { useMemo } from 'react';
import { Dimensions, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { ProductCard } from '../../src/components/cards';
import { AiBadge, AiCardGlow, AiDivider, Tag } from '../../src/components/ui';
import { AiOrb } from '../../src/components/effects';
import { AiFeatureRepo } from '../../src/repos';
import { useCartStore, useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AiRecommendTheme, AppError, Product } from '../../src/types';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_GAP = 12;
const CARD_PADDING = 20;
const CARD_WIDTH = (SCREEN_WIDTH - CARD_PADDING * 2 - CARD_GAP) / 2;

const recommendThemeLabelMap: Record<AiRecommendTheme, string> = {
  hot: '爆款',
  discount: '折扣',
  tasty: '好吃',
  seasonal: '当季',
  recent: '最近热门',
};

const constraintLabelMap: Record<string, string> = {
  organic: '有机',
  'low-sugar': '低糖',
  seasonal: '当季',
  traceable: '可溯源',
  'cold-chain': '冷链',
  'geo-certified': '地理标志',
  healthy: '健康',
  fresh: '新鲜',
};

const normalizeSingleParam = (value?: string | string[]) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const parseCsvParam = (value?: string | string[]) => {
  const normalized = normalizeSingleParam(value);
  if (!normalized) return [] as string[];
  return normalized.split(',').map((item) => item.trim()).filter(Boolean);
};

const buildRecommendSummary = (input: {
  query?: string;
  categoryName?: string;
  budget?: number;
  constraints: string[];
  recommendThemes: AiRecommendTheme[];
}) => {
  const target = input.query || input.categoryName || '推荐商品';
  const localizedConstraints = input.constraints
    .map((item) => constraintLabelMap[item] || item)
    .filter(Boolean);
  const localizedThemes = input.recommendThemes
    .map((item) => recommendThemeLabelMap[item] || item)
    .filter(Boolean);
  const descriptors = [...localizedThemes, ...localizedConstraints];

  if (input.budget && descriptors.length > 0) {
    return `按 ¥${input.budget} 预算，为你挑选${descriptors.join('、')}${target === '推荐商品' ? '' : ` ${target}`}`;
  }
  if (input.budget) {
    return `按 ¥${input.budget} 预算，为你挑选更合适的${target}`;
  }
  if (descriptors.length > 0) {
    return `围绕${descriptors.join('、')}偏好，为你推荐${target}`;
  }
  return `为你整理了一组更值得先看的${target}`;
};

const buildAiReason = (input: {
  budget?: number;
  constraints: string[];
  recommendThemes: AiRecommendTheme[];
  preferRecommended: boolean;
}) => {
  const reasons = [
    ...input.recommendThemes.map((item) => recommendThemeLabelMap[item] || item),
    ...input.constraints.map((item) => constraintLabelMap[item] || item),
  ];

  if (input.budget) {
    reasons.push(`预算 ¥${input.budget}`);
  }
  if (input.preferRecommended) {
    reasons.push('AI优选');
  }

  return reasons.slice(0, 3).join(' · ');
};

type RecommendPlanTone = 'brand' | 'accent' | 'analysis';

type RecommendPlan = {
  id: string;
  title: string;
  description: string;
  tone: RecommendPlanTone;
  totalPrice: number;
  products: Product[];
  highlights: string[];
};

const normalizeProductSearchText = (product: Product) =>
  [
    product.title,
    product.origin,
    product.categoryName ?? '',
    product.tags.join(' '),
  ]
    .join(' ')
    .toLowerCase();

const getThemeScore = (theme: AiRecommendTheme, product: Product, haystack: string) => {
  switch (theme) {
    case 'hot':
      return (product.monthlySales ?? 0) * 0.2 + (haystack.includes('爆款') || haystack.includes('热销') ? 12 : 0);
    case 'discount':
      return product.strikePrice && product.strikePrice > product.price
        ? ((product.strikePrice - product.price) / product.strikePrice) * 40
        : 0;
    case 'tasty':
      return (product.rating ?? 4.5) * 4 + (haystack.includes('鲜') || haystack.includes('甜') ? 8 : 0);
    case 'seasonal':
      return haystack.includes('当季') || haystack.includes('应季') ? 18 : 4;
    case 'recent':
      return product.id.endsWith('6') || product.id.endsWith('5') ? 12 : 5;
    default:
      return 0;
  }
};

const getConstraintScore = (constraint: string, haystack: string) => {
  const aliases = {
    organic: ['有机'],
    'low-sugar': ['低糖', '蓝莓'],
    seasonal: ['当季', '鲜采', '应季'],
    traceable: ['溯源'],
    'cold-chain': ['冷链'],
    'geo-certified': ['地理标志'],
    healthy: ['有机', '低糖', '富硒', '胚芽'],
    fresh: ['鲜', '冷链'],
  }[constraint] ?? [constraint];

  return aliases.some((alias) => haystack.includes(alias.toLowerCase())) ? 16 : 0;
};

const scoreProduct = (
  product: Product,
  input: {
    constraints: string[];
    recommendThemes: AiRecommendTheme[];
    preferRecommended: boolean;
    budget?: number;
  },
) => {
  const haystack = normalizeProductSearchText(product);
  let score = (product.rating ?? 4.5) * 10;

  if (input.preferRecommended) {
    score += 10;
    if (haystack.includes('有机') || haystack.includes('溯源') || haystack.includes('地理标志')) score += 12;
  }

  input.constraints.forEach((constraint) => {
    score += getConstraintScore(constraint, haystack);
  });
  input.recommendThemes.forEach((theme) => {
    score += getThemeScore(theme, product, haystack);
  });

  if (input.budget) {
    if (product.price <= input.budget) {
      score += 8;
      score += Math.max(0, (input.budget - product.price) / input.budget) * 6;
    } else {
      score -= 20;
    }
  }

  return score;
};

const pickPlanHighlights = (
  products: Product[],
  input: {
    budget?: number;
    constraints: string[];
    recommendThemes: AiRecommendTheme[];
    preferRecommended: boolean;
  },
) => {
  const tags = new Set<string>();
  products.forEach((product) => {
    product.tags.forEach((tag) => tags.add(tag));
  });

  const highlights = [
    ...(input.budget ? [`合计 ¥${products.reduce((sum, item) => sum + item.price, 0).toFixed(1)}`] : []),
    ...(input.recommendThemes.length > 0 ? input.recommendThemes.map((theme) => recommendThemeLabelMap[theme]) : []),
    ...(input.constraints.length > 0 ? input.constraints.map((item) => constraintLabelMap[item] || item) : []),
    ...Array.from(tags).slice(0, 2),
  ];

  if (input.preferRecommended) {
    highlights.push('AI优选');
  }

  return Array.from(new Set(highlights)).slice(0, 4);
};

const buildPlanDescription = (
  title: string,
  products: Product[],
  budget?: number,
) => {
  const names = products.map((item) => item.title.replace(/·.+$/u, '')).slice(0, 3).join('、');
  if (budget) {
    return `${title}优先控制预算，把 ${names} 组合在一起，避免超支。`;
  }
  return `${title}优先把 ${names} 放在同一组，方便你直接比较和下单。`;
};

const buildRecommendPlans = (
  products: Product[],
  input: {
    constraints: string[];
    recommendThemes: AiRecommendTheme[];
    preferRecommended: boolean;
    budget?: number;
  },
): RecommendPlan[] => {
  if (products.length === 0) return [];

  const scoredProducts = [...products]
    .map((product) => ({
      product,
      score: scoreProduct(product, input),
      valueScore: scoreProduct(product, input) / Math.max(product.price, 1),
    }))
    .sort((a, b) => b.score - a.score);

  const targetBudget = input.budget;
  const dedupe = new Set<string>();
  const plans: RecommendPlan[] = [];

  const createPlan = (
    id: string,
    title: string,
    tone: RecommendPlanTone,
    items: Product[],
  ) => {
    const filtered = items.filter(Boolean).slice(0, 3);
    if (filtered.length === 0) return;
    const signature = filtered.map((item) => item.id).sort().join('|');
    if (!signature || dedupe.has(signature)) return;
    dedupe.add(signature);
    plans.push({
      id,
      title,
      tone,
      products: filtered,
      totalPrice: filtered.reduce((sum, item) => sum + item.price, 0),
      description: buildPlanDescription(title, filtered, targetBudget),
      highlights: pickPlanHighlights(filtered, input),
    });
  };

  const topProducts = scoredProducts.map((item) => item.product);
  createPlan('steady', targetBudget ? '预算内稳妥组合' : '今日优选组合', 'brand', topProducts.slice(0, 3));

  if (targetBudget) {
    const budgetCombo: Product[] = [];
    let used = 0;
    scoredProducts.forEach(({ product }) => {
      if (budgetCombo.length >= 3) return;
      if (used + product.price <= targetBudget || budgetCombo.length === 0) {
        budgetCombo.push(product);
        used += product.price;
      }
    });
    createPlan('budget', '控预算组合', 'accent', budgetCombo);

    const valueCombo: Product[] = [];
    let valueUsed = 0;
    [...scoredProducts]
      .sort((a, b) => b.valueScore - a.valueScore)
      .forEach(({ product }) => {
        if (valueCombo.length >= 3) return;
        if (valueUsed + product.price <= targetBudget || valueCombo.length === 0) {
          valueCombo.push(product);
          valueUsed += product.price;
        }
      });
    createPlan('value', '性价比组合', 'analysis', valueCombo);
  } else {
    const ratedCombo = [...products]
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, 3);
    createPlan('quality', '口碑优先组合', 'accent', ratedCombo);

    const valueCombo = [...products]
      .sort((a, b) => a.price - b.price || (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, 3);
    createPlan('value', '轻量尝鲜组合', 'analysis', valueCombo);
  }

  return plans.slice(0, 3);
};

export default function AiRecommendScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const addItem = useCartStore((state) => state.addItem);
  const cartItemCount = useCartStore((state) => state.items.length);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const params = useLocalSearchParams<{
    q?: string;
    source?: string;
    categoryId?: string;
    categoryName?: string;
    preferRecommended?: string;
    constraints?: string;
    maxPrice?: string;
    recommendThemes?: string;
    usageScenario?: string;
    promotionIntent?: string;
    bundleIntent?: string;
    originPreference?: string;
    dietaryPreference?: string;
    flavorPreference?: string;
    categoryHint?: string;
  }>();

  const query = normalizeSingleParam(params.q)?.trim() || '';
  const source = normalizeSingleParam(params.source);
  const categoryId = normalizeSingleParam(params.categoryId);
  const categoryName = normalizeSingleParam(params.categoryName);
  const constraints = useMemo(() => parseCsvParam(params.constraints), [params.constraints]);
  const recommendThemes = useMemo(
    () => parseCsvParam(params.recommendThemes).filter(
      (item): item is AiRecommendTheme => item in recommendThemeLabelMap,
    ),
    [params.recommendThemes],
  );
  const budget = useMemo(() => {
    const raw = normalizeSingleParam(params.maxPrice);
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }, [params.maxPrice]);
  const preferRecommended = (normalizeSingleParam(params.preferRecommended) === '1')
    || recommendThemes.length > 0
    || (!query && !categoryId && !budget && constraints.length === 0);
  const isVoiceSource = source === 'voice';
  // 语义槽参数（来自语音意图解析）
  const usageScenario = normalizeSingleParam(params.usageScenario) || undefined;
  const promotionIntent = normalizeSingleParam(params.promotionIntent) as 'threshold-optimization' | 'best-deal' | undefined;
  const bundleIntent = normalizeSingleParam(params.bundleIntent) as 'meal-kit' | 'complement' | undefined;
  const originPreference = normalizeSingleParam(params.originPreference) || undefined;
  const dietaryPreference = normalizeSingleParam(params.dietaryPreference) || undefined;
  const flavorPreference = normalizeSingleParam(params.flavorPreference) || undefined;
  const categoryHint = normalizeSingleParam(params.categoryHint) || undefined;
  const localSummary = useMemo(
    () => buildRecommendSummary({ query, categoryName, budget, constraints, recommendThemes }),
    [budget, categoryName, constraints, query, recommendThemes],
  );
  const localAiReason = useMemo(
    () => buildAiReason({ budget, constraints, recommendThemes, preferRecommended }),
    [budget, constraints, preferRecommended, recommendThemes],
  );
  const localTags = useMemo(() => {
    const localizedConstraints = constraints.map((item) => constraintLabelMap[item] || item);
    const localizedThemes = recommendThemes.map((item) => recommendThemeLabelMap[item] || item);
    const tags = [
      ...(query ? [query] : []),
      ...(categoryName ? [categoryName] : []),
      ...(budget ? [`预算 ¥${budget}`] : []),
      ...localizedThemes,
      ...localizedConstraints,
      ...(preferRecommended ? ['AI优选'] : []),
    ];
    return Array.from(new Set(tags)).slice(0, 6);
  }, [budget, categoryName, constraints, preferRecommended, query, recommendThemes]);

  const {
    data: recommendPlanData,
    isLoading: recommendPlanLoading,
    isFetching: recommendPlanFetching,
    refetch: refetchRecommendPlan,
  } = useQuery({
    queryKey: [
      'ai-recommend-plan',
      query,
      categoryId,
      budget ?? 'none',
      constraints.join('|'),
      recommendThemes.join('|'),
      preferRecommended ? '1' : '0',
      usageScenario ?? '',
      promotionIntent ?? '',
      bundleIntent ?? '',
      originPreference ?? '',
      dietaryPreference ?? '',
      flavorPreference ?? '',
      categoryHint ?? '',
    ],
    queryFn: () => AiFeatureRepo.getRecommendPlan({
      query: query || undefined,
      categoryId: categoryId || undefined,
      categoryName: categoryName || undefined,
      preferRecommended,
      constraints,
      maxPrice: budget,
      recommendThemes,
      usageScenario,
      promotionIntent,
      bundleIntent,
      originPreference,
      dietaryPreference,
      flavorPreference,
      categoryHint,
    }),
  });

  const {
    data: insightData,
    isLoading: insightsLoading,
    isFetching: insightsFetching,
    refetch: refetchInsights,
  } = useQuery({
    queryKey: ['ai-recommend-insights', isLoggedIn],
    queryFn: () => AiFeatureRepo.getRecommendInsights(),
    enabled: isLoggedIn,
  });

  const recommendPlanError = recommendPlanData && !recommendPlanData.ok ? recommendPlanData.error : null;
  const products = recommendPlanData?.ok ? recommendPlanData.data.products : [];
  const recommendPlans = recommendPlanData?.ok
    ? recommendPlanData.data.plans
    : buildRecommendPlans(products, { budget, constraints, recommendThemes, preferRecommended });
  const summary = recommendPlanData?.ok ? recommendPlanData.data.summary : localSummary;
  const aiReason = recommendPlanData?.ok ? recommendPlanData.data.aiReason : localAiReason;
  const activeTags = recommendPlanData?.ok && recommendPlanData.data.tags.length > 0
    ? recommendPlanData.data.tags
    : localTags;
  const insightsError = insightData && !insightData.ok ? insightData.error : null;
  const insights = insightData?.ok ? insightData.data : [];
  const topTags = useMemo(() => {
    const tags = insights.flatMap((item) => item.tags);
    return Array.from(new Set(tags)).slice(0, 6);
  }, [insights]);

  const handleRefresh = async () => {
    await Promise.allSettled([
      refetchRecommendPlan(),
      isLoggedIn ? refetchInsights() : Promise.resolve(null),
    ]);
  };

  const handleAdd = (product: Product) => {
    addItem(product, 1, product.defaultSkuId);
    show({ message: `已将${product.title}加入购物车`, type: 'success' });
  };

  const searchRoute = {
    pathname: '/search' as const,
    params: {
      q: query || undefined,
      source: isVoiceSource ? 'voice' : 'ai-recommend',
      categoryId: categoryId || undefined,
      categoryName: categoryName || undefined,
      preferRecommended: preferRecommended ? '1' : undefined,
      constraints: constraints.length > 0 ? constraints.join(',') : undefined,
      maxPrice: budget ? String(budget) : undefined,
      recommendThemes: recommendThemes.length > 0 ? recommendThemes.join(',') : undefined,
    },
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="AI 推荐" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={recommendPlanFetching || insightsFetching} onRefresh={handleRefresh} />}
      >
        <Animated.View entering={FadeInDown.duration(300)} style={styles.headerRow}>
          <AiOrb size="mini" />
          <Text style={[typography.body, { color: colors.text.secondary, marginLeft: 8 }]}>
            {isVoiceSource ? '已按你的语音偏好完成推荐筛选' : '根据你的偏好，为你精选'}
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(80)}>
          <View style={[styles.summaryBar, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg, borderColor: colors.border }]}>
            <View style={styles.summaryHeader}>
              <AiBadge variant="recommend" />
              <Text style={[typography.caption, { color: colors.text.secondary, flex: 1, marginLeft: spacing.sm }]}>
                {summary}
              </Text>
              <Pressable onPress={() => router.push(searchRoute)}>
                <Text style={[typography.captionSm, { color: colors.ai.start }]}>查看全部</Text>
              </Pressable>
            </View>
            {activeTags.length > 0 ? (
              <View style={styles.tagRow}>
                {activeTags.map((tag) => (
                  <Tag key={tag} label={tag} tone="accent" style={{ marginRight: 6, marginBottom: 6 }} />
                ))}
              </View>
            ) : null}
          </View>
        </Animated.View>

        <View style={{ marginTop: spacing.lg }}>
          <View style={styles.sectionHeader}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>推荐商品</Text>
            {aiReason ? (
              <Text style={[typography.captionSm, { color: colors.ai.start }]}>
                {aiReason}
              </Text>
            ) : null}
          </View>
          <AiDivider style={{ marginTop: spacing.xs, marginBottom: spacing.sm }} />

          {recommendPlanLoading ? (
            <View style={styles.grid}>
              <Skeleton height={250} radius={radius.lg} style={{ width: CARD_WIDTH, marginBottom: CARD_GAP }} />
              <Skeleton height={250} radius={radius.lg} style={{ width: CARD_WIDTH, marginBottom: CARD_GAP }} />
              <Skeleton height={250} radius={radius.lg} style={{ width: CARD_WIDTH, marginBottom: CARD_GAP }} />
              <Skeleton height={250} radius={radius.lg} style={{ width: CARD_WIDTH, marginBottom: CARD_GAP }} />
            </View>
          ) : recommendPlanError ? (
            <ErrorState
              title="推荐商品加载失败"
              description={(recommendPlanError as AppError).displayMessage ?? '请稍后重试'}
              onAction={refetchRecommendPlan}
            />
          ) : products.length === 0 ? (
            <EmptyState
              title="暂时没有匹配结果"
              description="你可以放宽预算或条件，看看更多推荐商品。"
            />
          ) : (
            <View style={styles.grid}>
              {products.map((product, index) => (
                <Animated.View
                  key={product.id}
                  entering={FadeInDown.duration(300).delay(120 + index * 40)}
                  style={{ marginBottom: CARD_GAP }}
                >
                  <ProductCard
                    product={product}
                    width={CARD_WIDTH}
                    onPress={(item) => router.push({ pathname: '/product/[id]', params: { id: item.id } })}
                    onAdd={handleAdd}
                    aiRecommend
                    aiReason={aiReason || undefined}
                    monthlySales={product.monthlySales}
                  />
                </Animated.View>
              ))}
            </View>
          )}
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <View style={styles.sectionHeader}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>组合导购</Text>
            {budget ? (
              <Text style={[typography.captionSm, { color: colors.ai.start }]}>
                预算上限 ¥{budget}
              </Text>
            ) : (
              <Text style={[typography.captionSm, { color: colors.text.secondary }]}>
                自动按偏好整理
              </Text>
            )}
          </View>
          <AiDivider style={{ marginTop: spacing.xs, marginBottom: spacing.sm }} />

          {recommendPlanLoading ? (
            <View>
              <Skeleton height={140} radius={radius.lg} style={{ marginBottom: spacing.md }} />
              <Skeleton height={140} radius={radius.lg} />
            </View>
          ) : recommendPlans.length > 0 ? (
            <View>
              {recommendPlans.map((plan, index) => (
                <Animated.View
                  key={plan.id}
                  entering={FadeInDown.duration(300).delay(110 + index * 40)}
                >
                  <View
                    style={[
                      styles.planCard,
                      shadow.md,
                      {
                        backgroundColor: colors.surface,
                        borderRadius: radius.lg,
                        borderColor: plan.tone === 'brand' ? colors.brand.primarySoft : colors.border,
                      },
                    ]}
                  >
                    <View style={styles.planHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{plan.title}</Text>
                        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                          {plan.description}
                        </Text>
                      </View>
                      <View style={[styles.planPricePill, { borderRadius: radius.pill, backgroundColor: colors.ai.soft }]}>
                        <Text style={[typography.captionSm, { color: colors.ai.start }]}>¥{plan.totalPrice.toFixed(1)}</Text>
                      </View>
                    </View>

                    {budget ? (
                      <View style={styles.progressRow}>
                        <Text style={[typography.captionSm, { color: colors.ai.start }]}>
                          预算占用 {Math.min(100, Math.round((plan.totalPrice / budget) * 100))}%
                        </Text>
                        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                          <LinearGradient
                            colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={[styles.progressFill, { width: `${Math.min(100, Math.round((plan.totalPrice / budget) * 100))}%` }]}
                          />
                        </View>
                      </View>
                    ) : null}

                    <View style={styles.planHighlightRow}>
                      {plan.highlights.map((item) => (
                        <Tag key={`${plan.id}-${item}`} label={item} tone="accent" style={{ marginRight: 6, marginBottom: 6 }} />
                      ))}
                    </View>

                    <View style={styles.planProductList}>
                      {plan.products.map((product) => (
                        <Pressable
                          key={`${plan.id}-${product.id}`}
                          onPress={() => router.push({ pathname: '/product/[id]', params: { id: product.id } })}
                          style={[styles.planProductRow, { borderColor: colors.border }]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                              {product.title}
                            </Text>
                            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]} numberOfLines={1}>
                              {product.origin}
                            </Text>
                          </View>
                          <View style={styles.planProductMeta}>
                            <Text style={[typography.captionSm, { color: colors.ai.start }]}>¥{product.price}</Text>
                            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </Animated.View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <View style={styles.sectionHeader}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>推荐洞察</Text>
            <AiBadge variant="analysis" style={{ marginLeft: 8 }} />
          </View>
          <AiDivider style={{ marginTop: spacing.xs, marginBottom: spacing.sm }} />

          {!isLoggedIn ? (
            <View style={[styles.noteCard, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>
                当前已按语音条件完成推荐筛选。登录后，这里还会叠加你的浏览、收藏和互动画像。
              </Text>
            </View>
          ) : insightsLoading ? (
            <View>
              <Skeleton height={96} radius={radius.lg} style={{ marginBottom: spacing.md }} />
              <Skeleton height={96} radius={radius.lg} />
            </View>
          ) : insightsError ? (
            <ErrorState
              title="推荐洞察加载失败"
              description={(insightsError as AppError).displayMessage ?? '请稍后重试'}
              onAction={refetchInsights}
            />
          ) : insights.length === 0 ? (
            <EmptyState title="暂无推荐画像" description="稍后再试或完善偏好" />
          ) : (
            <View>
              {topTags.length > 0 ? (
                <View style={styles.tagRow}>
                  {topTags.map((tag) => (
                    <Tag key={tag} label={tag} tone="brand" style={{ marginRight: 6, marginBottom: 6 }} />
                  ))}
                </View>
              ) : null}
              {insights.map((item, index) => (
                <Animated.View
                  key={item.id}
                  entering={FadeInDown.duration(300).delay(180 + index * 50)}
                >
                  <AiCardGlow
                    style={[shadow.md, { marginTop: 12, borderRadius: radius.lg }]}
                  >
                    <View style={[styles.reasonContent, { backgroundColor: colors.ai.soft }]}>
                      <View style={styles.reasonHeader}>
                        <Text style={[typography.bodyStrong, { color: colors.text.primary, flex: 1 }]}>{item.title}</Text>
                        <MaterialCommunityIcons name="chart-line" size={18} color={colors.ai.start} />
                      </View>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                        {item.description}
                      </Text>
                      <View style={styles.progressRow}>
                        <Text style={[typography.captionSm, { color: colors.ai.start }]}>
                          权重 {Math.round(item.weight * 100)}%
                        </Text>
                        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                          <LinearGradient
                            colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={[styles.progressFill, { width: `${Math.round(item.weight * 100)}%` }]}
                          />
                        </View>
                      </View>
                      <View style={styles.tagRow}>
                        {item.tags.map((tag) => (
                          <Tag key={`${item.id}-${tag}`} label={tag} tone="accent" style={{ marginRight: 6, marginBottom: 6 }} />
                        ))}
                      </View>
                    </View>
                  </AiCardGlow>
                </Animated.View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* 购物车悬浮按钮 */}
      <Pressable
        onPress={() => router.push('/cart')}
        style={[
          styles.cartFab,
          shadow.md,
          { backgroundColor: colors.brand.primary, borderRadius: radius.full },
        ]}
      >
        <MaterialCommunityIcons name="cart-outline" size={22} color="#fff" />
        {cartItemCount > 0 && (
          <View style={[styles.cartBadge, { backgroundColor: colors.danger }]}>
            <Text style={[typography.captionSm, { color: '#fff', fontSize: 10, fontWeight: '700' }]}>
              {cartItemCount > 99 ? '99+' : cartItemCount}
            </Text>
          </View>
        )}
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  summaryBar: {
    borderWidth: 1,
    padding: 14,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  planCard: {
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  planPricePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  planHighlightRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  planProductList: {
    marginTop: 6,
  },
  planProductRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  planProductMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  reasonContent: {
    padding: 14,
    borderRadius: 10,
  },
  reasonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressRow: {
    marginTop: 10,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    marginTop: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  noteCard: {
    padding: 14,
  },
  cartFab: {
    position: 'absolute',
    bottom: 90,
    left: 20,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
});
