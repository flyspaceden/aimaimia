import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../src/components/feedback';
import { Tag } from '../src/components/ui';
import { AiCardGlow } from '../src/components/ui/AiCardGlow';
import { ProductCard } from '../src/components/cards/ProductCard';
import { CompanyRepo, ProductRepo } from '../src/repos';
import { useCartStore } from '../src/store';
import { useRecentSearches } from '../src/hooks/useRecentSearches';
import { useTheme } from '../src/theme';
import { AiRecommendTheme, AppError } from '../src/types';

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

const normalizeSearchText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[“”"'`]/g, '')
    .replace(/[，。！？,.!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const cleanupVoiceSearchKeyword = (value: string): string => {
  const compact = normalizeSearchText(value).replace(/\s+/g, '');
  if (!compact) return '';

  const extractionPatterns = [
    /^(?:请|麻烦你)?(?:帮我|给我|替我)?(?:找|搜(?:索)?|查|看)(?:一下|一找|一看|一搜)?(.+)$/u,
    /^(?:你)?(?:有没有|哪里有)(.+?)(?:吗|呢|啊|呀|吧|嘛|哦)?$/u,
    /^(?:我)?(?:想买|想要|要买|要|来点|推荐(?:一下)?)(.+)$/u,
  ];

  for (const pattern of extractionPatterns) {
    const match = compact.match(pattern);
    if (match?.[1]) {
      const cleaned = match[1]
        .replace(/^(?:这个|那个|这款|那款)/u, '')
        .replace(/(?:吗|呢|啊|呀|吧|嘛|哦)+$/u, '')
        .replace(/^(?:你|我)(?=[\u4e00-\u9fa5]{2,})/u, '')
        .trim();
      if (cleaned) return cleaned;
    }
  }

  return compact
    .replace(/^(?:这个|那个|这款|那款)/u, '')
    .replace(/(?:吗|呢|啊|呀|吧|嘛|哦)+$/u, '')
    .replace(/^(?:你|我)(?=[\u4e00-\u9fa5]{2,})/u, '')
    .trim();
};

const softenVoiceToken = (value: string) =>
  value.replace(/^(?:一(?!级|号|品|类)|个|些|下)(?=[\u4e00-\u9fa5]{2,})/u, '');

const buildSearchTokens = (value: string, fromVoice: boolean): string[] => {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];

  const tokenSet = new Set<string>();
  const rawTokens = normalized.split(/[\s,，、/]+/).map((token) => token.trim()).filter(Boolean);

  rawTokens.forEach((token) => {
    tokenSet.add(token);

    if (!fromVoice) return;

    const cleaned = cleanupVoiceSearchKeyword(token);
    if (cleaned) tokenSet.add(cleaned);

    const softened = softenVoiceToken(cleaned);
    if (softened) tokenSet.add(softened);
  });

  if (fromVoice) {
    const cleanedPhrase = cleanupVoiceSearchKeyword(value);
    if (cleanedPhrase) {
      tokenSet.add(cleanedPhrase);
      const softenedPhrase = softenVoiceToken(cleanedPhrase);
      if (softenedPhrase) tokenSet.add(softenedPhrase);
    }
  }

  return Array.from(tokenSet).filter(Boolean);
};

export default function SearchScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const {
    q,
    source,
    action,
    tab,
    productId,
    productName,
    categoryId,
    categoryName,
    preferRecommended,
    constraints,
    maxPrice,
    recommendThemes,
    usageScenario: usageScenarioParam,
    originPreference: originPreferenceParam,
    dietaryPreference: dietaryPreferenceParam,
    flavorPreference: flavorPreferenceParam,
    categoryHint: categoryHintParam,
  } = useLocalSearchParams<{
    q?: string;
    source?: string;
    action?: string;
    tab?: string;
    productId?: string;
    productName?: string;
    categoryId?: string;
    categoryName?: string;
    preferRecommended?: string;
    constraints?: string;
    maxPrice?: string;
    recommendThemes?: string;
    usageScenario?: string;
    originPreference?: string;
    dietaryPreference?: string;
    flavorPreference?: string;
    categoryHint?: string;
  }>();
  const { show } = useToast();
  const addItem = useCartStore((s) => s.addItem);
  const cartItemCount = useCartStore((s) => s.items.length);
  const inputRef = useRef<TextInput>(null);
  const handledVoiceActionRef = useRef<string>('');
  const rawQuery = Array.isArray(q) ? q[0] : q;
  const isVoiceSource = (Array.isArray(source) ? source[0] : source) === 'voice';
  const voiceAction = (Array.isArray(action) ? action[0] : action) === 'add-to-cart' ? 'add-to-cart' : undefined;
  const voiceProductId = Array.isArray(productId) ? productId[0] : productId;
  const voiceProductName = Array.isArray(productName) ? productName[0] : productName;
  const initialTab = (Array.isArray(tab) ? tab[0] : tab) === 'company' ? 'company' : 'product';
  const initialCategoryId = Array.isArray(categoryId) ? categoryId[0] : categoryId;
  const initialCategoryName = Array.isArray(categoryName) ? categoryName[0] : categoryName;
  const initialPreferRecommended = (Array.isArray(preferRecommended) ? preferRecommended[0] : preferRecommended) === '1';
  const initialMaxPrice = useMemo(() => {
    const raw = Array.isArray(maxPrice) ? maxPrice[0] : maxPrice;
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }, [maxPrice]);
  const initialConstraints = useMemo(() => {
    const raw = Array.isArray(constraints) ? constraints[0] : constraints;
    if (!raw) return [] as string[];
    return raw.split(',').map((item: string) => item.trim()).filter(Boolean);
  }, [constraints]);
  const initialRecommendThemes = useMemo(() => {
    const raw = Array.isArray(recommendThemes) ? recommendThemes[0] : recommendThemes;
    if (!raw) return [] as AiRecommendTheme[];
    return raw
      .split(',')
      .map((item: string) => item.trim())
      .filter((item: string): item is AiRecommendTheme => item in recommendThemeLabelMap);
  }, [recommendThemes]);
  const initialUsageScenario = (Array.isArray(usageScenarioParam) ? usageScenarioParam[0] : usageScenarioParam) || undefined;
  const initialOriginPreference = (Array.isArray(originPreferenceParam) ? originPreferenceParam[0] : originPreferenceParam) || undefined;
  const initialDietaryPreference = (Array.isArray(dietaryPreferenceParam) ? dietaryPreferenceParam[0] : dietaryPreferenceParam) || undefined;
  const initialFlavorPreference = (Array.isArray(flavorPreferenceParam) ? flavorPreferenceParam[0] : flavorPreferenceParam) || undefined;
  const initialCategoryHint = (Array.isArray(categoryHintParam) ? categoryHintParam[0] : categoryHintParam) || undefined;
  const initialQuery = useMemo(() => {
    if (!rawQuery) return '';
    if (!isVoiceSource) return rawQuery;
    return cleanupVoiceSearchKeyword(rawQuery) || rawQuery;
  }, [rawQuery, isVoiceSource]);
  const [query, setQuery] = useState(initialQuery);
  const [searchTerm, setSearchTerm] = useState(initialQuery);
  const [searchCategoryId, setSearchCategoryId] = useState(initialCategoryId);
  const [searchCategoryName, setSearchCategoryName] = useState(initialCategoryName);
  const [preferRecommendedOnly, setPreferRecommendedOnly] = useState(initialPreferRecommended);
  const [searchConstraints, setSearchConstraints] = useState<string[]>(initialConstraints);
  const [searchMaxPrice, setSearchMaxPrice] = useState<number | undefined>(initialMaxPrice);
  const [searchRecommendThemes, setSearchRecommendThemes] = useState<AiRecommendTheme[]>(initialRecommendThemes);
  const [pendingVoiceAction, setPendingVoiceAction] = useState<'add-to-cart' | undefined>(voiceAction);
  // 语义参数使用可重置的 state，避免手动搜索时旧语义参数仍然生效
  const [searchUsageScenario, setSearchUsageScenario] = useState(initialUsageScenario || '');
  const [searchOriginPreference, setSearchOriginPreference] = useState(initialOriginPreference || '');
  const [searchDietaryPreference, setSearchDietaryPreference] = useState(initialDietaryPreference || '');
  const [searchFlavorPreference, setSearchFlavorPreference] = useState(initialFlavorPreference);
  const [searchCategoryHint, setSearchCategoryHint] = useState(initialCategoryHint);
  const [submitted, setSubmitted] = useState(
    !!(
      initialQuery
      || initialCategoryId
      || initialPreferRecommended
      || initialConstraints.length > 0
      || initialMaxPrice
      || initialRecommendThemes.length > 0
      || initialUsageScenario
      || initialOriginPreference
      || initialDietaryPreference
      || initialFlavorPreference
      || initialCategoryHint
    ),
  );
  const [activeTab, setActiveTab] = useState<'product' | 'company'>(initialTab);
  const { add: addRecent } = useRecentSearches();

  // 从 overlay 带参数进入时，保存到最近搜索
  useEffect(() => {
    if (!rawQuery && !initialCategoryId && !initialPreferRecommended && initialConstraints.length === 0 && !initialMaxPrice && initialRecommendThemes.length === 0 && !initialUsageScenario && !initialOriginPreference && !initialDietaryPreference && !initialFlavorPreference && !initialCategoryHint) return;
    setQuery(initialQuery);
    setSearchTerm(initialQuery);
    setSearchCategoryId(initialCategoryId);
    setSearchCategoryName(initialCategoryName);
    setPreferRecommendedOnly(initialPreferRecommended);
    setSearchConstraints(initialConstraints);
    setSearchMaxPrice(initialMaxPrice);
    setSearchRecommendThemes(initialRecommendThemes);
    setSearchUsageScenario(initialUsageScenario || '');
    setSearchOriginPreference(initialOriginPreference || '');
    setSearchDietaryPreference(initialDietaryPreference || '');
    setSearchFlavorPreference(initialFlavorPreference);
    setSearchCategoryHint(initialCategoryHint);
    handledVoiceActionRef.current = '';
    setPendingVoiceAction(voiceAction);
    setActiveTab(initialTab);
    setSubmitted(true);
    if (initialQuery) {
      addRecent(initialQuery);
    }
  }, [
    rawQuery,
    initialCategoryId,
    initialCategoryName,
    initialConstraints,
    initialPreferRecommended,
    initialMaxPrice,
    initialQuery,
    initialRecommendThemes,
    initialTab,
    initialUsageScenario,
    initialOriginPreference,
    initialDietaryPreference,
    initialFlavorPreference,
    initialCategoryHint,
    voiceAction,
    voiceProductId,
    voiceProductName,
    addRecent,
  ]);

  // 无参数进入时自动聚焦
  useEffect(() => {
    if (!rawQuery && !initialCategoryId && !initialPreferRecommended && initialConstraints.length === 0 && !initialMaxPrice && initialRecommendThemes.length === 0 && !initialUsageScenario && !initialOriginPreference && !initialDietaryPreference && !initialFlavorPreference && !initialCategoryHint) {
      const timer = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(timer);
    }
  }, [rawQuery, initialCategoryId, initialPreferRecommended, initialConstraints, initialMaxPrice, initialRecommendThemes, initialUsageScenario, initialOriginPreference, initialDietaryPreference, initialFlavorPreference, initialCategoryHint]);

  const hasSearchContext = submitted && !!(
    searchTerm.trim().length > 0
    || searchCategoryId
    || preferRecommendedOnly
    || searchConstraints.length > 0
    || searchMaxPrice
    || searchRecommendThemes.length > 0
    || searchUsageScenario
    || searchOriginPreference
    || searchDietaryPreference
    || searchFlavorPreference
    || searchCategoryHint
  );
  const hasTextQuery = submitted && searchTerm.trim().length > 0;

  // 数据查询（提交后才请求，避免每输入一个字都触发后端搜索）
  const { data: productResult, isLoading: productsLoading } = useQuery({
    queryKey: [
      'search-products',
      searchTerm,
      searchCategoryId,
      preferRecommendedOnly,
      searchConstraints.join('|'),
      searchMaxPrice ?? 'none',
      searchRecommendThemes.join('|'),
      searchUsageScenario,
      searchOriginPreference,
      searchDietaryPreference,
      searchFlavorPreference ?? '',
      searchCategoryHint ?? '',
    ],
    queryFn: () => ProductRepo.list({
      page: 1,
      pageSize: 32,
      keyword: searchTerm.trim(),
      categoryId: searchCategoryId,
      preferRecommended: preferRecommendedOnly,
      constraints: searchConstraints,
      maxPrice: searchMaxPrice,
      recommendThemes: searchRecommendThemes,
      usageScenario: searchUsageScenario || undefined,
      originPreference: searchOriginPreference || undefined,
      dietaryPreference: searchDietaryPreference || undefined,
      flavorPreference: searchFlavorPreference,
      categoryHint: searchCategoryHint,
    }),
    staleTime: 60_000,
    enabled: hasSearchContext,
  });
  const { data: companyResult, isLoading: companiesLoading } = useQuery({
    queryKey: ['search-companies', searchTerm],
    queryFn: () => CompanyRepo.list(),
    staleTime: 3 * 60_000,
    enabled: hasTextQuery,
  });

  const products = productResult?.ok ? productResult.data.items : [];
  const companies = companyResult?.ok ? companyResult.data : [];
  const productError = productResult && !productResult.ok ? productResult.error : null;
  const companyError = companyResult && !companyResult.ok ? companyResult.error : null;
  const isLoading = hasSearchContext && (productsLoading || companiesLoading);
  const filteredProducts = products;

  useEffect(() => {
    if (pendingVoiceAction !== 'add-to-cart' || !submitted || productsLoading || !productResult?.ok) {
      return;
    }

    const actionKey = [
      pendingVoiceAction,
      voiceProductId || '',
      searchTerm.trim(),
      searchCategoryId || '',
      searchConstraints.join('|'),
      searchRecommendThemes.join('|'),
      searchMaxPrice ?? '',
      filteredProducts.map((item) => item.id).join('|'),
    ].join('::');

    if (handledVoiceActionRef.current === actionKey) {
      return;
    }
    handledVoiceActionRef.current = actionKey;

    if (filteredProducts.length === 0) {
      setPendingVoiceAction(undefined);
      show({ message: '没找到可加入购物车的商品，请换个说法再试试', type: 'info' });
      return;
    }

    const selectedProduct = voiceProductId
      ? filteredProducts.find((item) => item.id === voiceProductId) ?? null
      : null;

    if (!selectedProduct) {
      setPendingVoiceAction(undefined);
      show({
        message: voiceProductName
          ? `已为你找到${voiceProductName}相关结果，请确认后点击加购`
          : '为你找到相关商品，请确认后点击加购',
        type: 'info',
      });
      return;
    }

    addItem(selectedProduct, 1, selectedProduct.defaultSkuId, selectedProduct.price);
    setPendingVoiceAction(undefined);
    show({ message: `已将${selectedProduct.title}加入购物车`, type: 'success' });
  }, [
    addItem,
    filteredProducts,
    pendingVoiceAction,
    productResult,
    productsLoading,
    searchCategoryId,
    searchConstraints,
    searchMaxPrice,
    searchRecommendThemes,
    searchTerm,
    show,
    submitted,
    voiceProductId,
    voiceProductName,
  ]);

  const filteredCompanies = useMemo(() => {
    if (!hasTextQuery) return [];
    const tokens = buildSearchTokens(searchTerm, isVoiceSource);
    if (tokens.length === 0) return companies;
    return companies.filter((c) => {
      const haystack = normalizeSearchText([c.name, c.mainBusiness, c.location, c.badges.join(' ')].join(' '));
      return tokens.some((t) => haystack.includes(t));
    });
  }, [companies, hasTextQuery, searchTerm, isVoiceSource]);

  // 提交搜索
  const handleSearch = (keyword?: string) => {
    const term = keyword ?? query.trim();
    if (!term) return;
    setPendingVoiceAction(undefined);
    setQuery(term);
    setSearchTerm(term);
    // 任何手动搜索（键盘回车或热词点击）都清除语义参数，避免旧 AI 语义影响新结果
    setSearchUsageScenario('');
    setSearchOriginPreference('');
    setSearchDietaryPreference('');
    setSearchFlavorPreference(undefined);
    setSearchCategoryHint(undefined);
    if (keyword) {
      // 热词点击时额外清除分类/推荐相关参数
      setSearchCategoryId(undefined);
      setSearchCategoryName(undefined);
      setPreferRecommendedOnly(false);
      setSearchConstraints([]);
      setSearchMaxPrice(undefined);
      setSearchRecommendThemes([]);
    }
    setSubmitted(true);
    addRecent(term);
  };

  // AI 搜索摘要
  const aiSummary = useMemo(() => {
    if (!hasSearchContext) return '';
    const pCount = filteredProducts.length;
    const cCount = filteredCompanies.length;
    if (pCount === 0 && cCount === 0) {
      if (searchTerm.trim()) {
        return `未找到与"${searchTerm.trim()}"相关的商品或企业`;
      }
      return '未找到符合当前预算或偏好的商品';
    }
    const parts: string[] = [];
    if (pCount > 0) parts.push(`${pCount}款相关商品`);
    if (cCount > 0) parts.push(`${cCount}家相关企业`);
    const suffix: string[] = [];
    if (searchCategoryName) suffix.push(`分类已对齐到“${searchCategoryName}”`);
    if (preferRecommendedOnly) suffix.push('优先展示推荐结果');
    if (searchConstraints.length > 0) suffix.push(`约束：${searchConstraints.join('、')}`);
    if (searchRecommendThemes.length > 0) {
      suffix.push(`主题：${searchRecommendThemes.map((theme) => recommendThemeLabelMap[theme] || theme).join('、')}`);
    }
    if (searchMaxPrice) suffix.push(`预算：¥${searchMaxPrice} 内`);
    return `为您找到${parts.join('和')}，已按智能匹配排序${suffix.length > 0 ? `，${suffix.join('，')}` : ''}`;
  }, [
    hasSearchContext,
    filteredProducts.length,
    filteredCompanies.length,
    preferRecommendedOnly,
    searchCategoryName,
    searchConstraints,
    searchMaxPrice,
    searchRecommendThemes,
    searchTerm,
  ]);

  // 搜索后状态
  const renderPostSearch = () => {
    const hasResults = filteredProducts.length > 0 || filteredCompanies.length > 0;

    return (
      <View style={{ flex: 1 }}>
        {/* AI 搜索摘要卡 */}
        <Animated.View entering={FadeInDown.duration(300)} style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md }}>
          <AiCardGlow style={{ ...shadow.sm, marginBottom: spacing.md }}>
            <View style={{ padding: spacing.lg, backgroundColor: colors.ai.soft, borderRadius: radius.lg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.ai.start, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>AI</Text>
                </View>
                <Text style={[typography.bodyStrong, { color: colors.ai.start }]}>搜索摘要</Text>
              </View>
              <Text style={[typography.bodySm, { color: colors.text.secondary, lineHeight: 20 }]}>{aiSummary}</Text>
            </View>
          </AiCardGlow>
        </Animated.View>

        {/* Tab 切换 */}
        <View style={[styles.tabBar, { borderBottomColor: colors.divider }]}>
          {(['product', 'company'] as const).map((tab) => {
            const active = activeTab === tab;
            const count = tab === 'product' ? filteredProducts.length : filteredCompanies.length;
            const label = tab === 'product' ? `商品(${count})` : `企业(${count})`;
            return (
              <Pressable
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={[styles.tabItem, active && { borderBottomColor: colors.brand.primary, borderBottomWidth: 2 }]}
              >
                <Text
                  style={[
                    typography.bodyStrong,
                    { color: active ? colors.brand.primary : colors.text.secondary },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* 结果列表 */}
        {!hasResults ? (
          <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
            <EmptyState title="未找到匹配结果" description="换个关键词试试" />
            <View style={{ marginTop: spacing.lg }}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: spacing.md }]}>热门搜索</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {['有机蔬菜', '新鲜水果', '土鸡蛋', '五谷杂粮', '蜂蜜', '茶叶'].map((term) => (
                  <Pressable
                    key={term}
                    onPress={() => handleSearch(term)}
                    style={{
                      backgroundColor: colors.bgSecondary,
                      borderRadius: radius.pill,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      marginRight: spacing.sm,
                      marginBottom: spacing.sm,
                    }}
                  >
                    <Text style={[typography.bodySm, { color: colors.text.secondary }]}>{term}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        ) : activeTab === 'product' ? (
          filteredProducts.length === 0 ? (
            <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
              <EmptyState title="暂无商品结果" description="试试切换到企业标签" />
            </View>
          ) : (
            <FlatList
              key="product-list"
              data={filteredProducts}
              keyExtractor={(item) => item.id}
              numColumns={2}
              initialNumToRender={6}
              maxToRenderPerBatch={8}
              windowSize={10}
              columnWrapperStyle={{ justifyContent: 'space-between', paddingHorizontal: CARD_PADDING }}
              contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing['3xl'] }}
              renderItem={({ item }) => (
                <ProductCard
                  product={item}
                  width={CARD_WIDTH}
                  imageHeight={CARD_WIDTH}
                  onPress={(p) => router.push({ pathname: '/product/[id]', params: { id: p.id } })}
                  onAdd={(p) => {
                    addItem(p, 1, p.defaultSkuId, p.price);
                    show({ message: '已加入购物车', type: 'success' });
                  }}
                />
              )}
              ItemSeparatorComponent={() => <View style={{ height: CARD_GAP }} />}
            />
          )
        ) : filteredCompanies.length === 0 ? (
          <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
            <EmptyState title="暂无企业结果" description="试试切换到商品标签" />
          </View>
        ) : (
          <FlatList
            key="company-list"
            data={filteredCompanies}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
            renderItem={({ item: company }) => (
              <Pressable
                onPress={() => router.push({ pathname: '/company/[id]', params: { id: company.id } })}
                style={[
                  styles.companyRow,
                  shadow.sm,
                  { backgroundColor: colors.surface, borderRadius: radius.lg },
                ]}
              >
                <Image
                  source={{ uri: company.cover }}
                  style={{ width: 72, height: 72, borderRadius: radius.md }}
                  contentFit="cover"
                />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                    {company.name}
                  </Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                    {company.mainBusiness}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>
                      {company.location}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>
                      {company.distanceKm.toFixed(1)} km
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs }}>
                    {company.badges.slice(0, 3).map((badge) => (
                      <Tag key={`${company.id}-${badge}`} label={badge} tone="brand" style={{ marginRight: 6 }} />
                    ))}
                  </View>
                </View>
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          />
        )}
      </View>
    );
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      {/* 搜索栏 */}
      <View style={[styles.searchBar, { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderBottomColor: colors.divider }]}>
        <View
          style={[
            styles.inputWrap,
            {
              backgroundColor: colors.bgSecondary,
              borderRadius: radius.lg,
            },
          ]}
        >
          <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={(text) => {
              setPendingVoiceAction(undefined);
              setQuery(text);
              setSearchCategoryId(undefined);
              setSearchCategoryName(undefined);
              setPreferRecommendedOnly(false);
              setSearchConstraints([]);
              setSearchMaxPrice(undefined);
              setSearchRecommendThemes([]);
              // 用户手动输入时清除语义参数，避免旧 AI 语义影响新的搜索结果
              setSearchUsageScenario('');
              setSearchOriginPreference('');
              setSearchDietaryPreference('');
              setSearchFlavorPreference(undefined);
              setSearchCategoryHint(undefined);
              if (!text.trim()) {
                setSearchTerm('');
                setSubmitted(false);
              }
            }}
            onSubmitEditing={() => handleSearch()}
            placeholder="搜索商品、企业、产地..."
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={[styles.input, typography.bodySm, { color: colors.text.primary }]}
          />
          <Pressable
            onPress={() => show({ message: '语音搜索即将上线', type: 'info' })}
            hitSlop={8}
            style={{ padding: 4 }}
          >
            <MaterialCommunityIcons name="microphone-outline" size={20} color={colors.muted} />
          </Pressable>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ marginLeft: spacing.md }}>
          <Text style={[typography.bodyStrong, { color: colors.text.secondary }]}>取消</Text>
        </Pressable>
      </View>

      {/* 加载态 */}
      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={18} radius={radius.sm} style={{ width: 120 }} />
          <Skeleton height={88} radius={radius.lg} style={{ marginTop: spacing.lg }} />
          <Skeleton height={88} radius={radius.lg} style={{ marginTop: spacing.md }} />
          <Skeleton height={18} radius={radius.sm} style={{ width: 120, marginTop: spacing.lg }} />
          <Skeleton height={140} radius={radius.lg} style={{ marginTop: spacing.md }} />
        </View>
      ) : productError && companyError ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="加载失败"
            description={(productError as AppError)?.displayMessage ?? '请稍后重试'}
          />
        </View>
      ) : hasSearchContext ? (
        renderPostSearch()
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl }}>
          <EmptyState title="输入关键词开始搜索" description="搜索商品、企业或产地" />
        </View>
      )}

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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    marginHorizontal: 8,
    paddingVertical: 0,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
  },
  tabItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginRight: 8,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
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
