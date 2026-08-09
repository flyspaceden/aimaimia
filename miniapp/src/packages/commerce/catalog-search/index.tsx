import { Button, Input, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CatalogCompanyCard } from '@/components/catalog-company-card';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { CatalogProductCard } from '@/components/catalog-product-card';
import { filterCompanies, paginateCatalog, type CatalogTab } from '@/components/catalog-utils';
import { addRecentSearch, clearRecentSearches, loadRecentSearches } from '@/components/recent-searches';
import { CompanyRepo, ProductRepo } from '@/repos';
import type { Company, Product } from '@/types';
import './index.scss';

const PAGE_SIZE = 12;
const hotKeywords = ['时令水果', '产地鲜选', '绿色蔬菜', '米面粮油'];
const openProduct = (product: Product) => Taro.navigateTo({ url: `/packages/commerce/catalog-product/index?id=${encodeURIComponent(product.id)}` });
const openCompany = (company: Company) => Taro.navigateTo({ url: `/packages/commerce/catalog-company/index?id=${encodeURIComponent(company.id)}` });

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

export default function CatalogSearchPage() {
  const router = useRouter();
  const initial = typeof router.params.q === 'string' ? router.params.q : '';
  const categoryId = routeText(router.params.categoryId, 64);
  const constraints = useMemo(() => routeCsv(router.params.constraints), [router.params.constraints]);
  const recommendThemes = useMemo(
    () => routeCsv(router.params.recommendThemes).filter(
      (item): item is 'hot' | 'discount' | 'tasty' | 'seasonal' | 'recent' => ['hot', 'discount', 'tasty', 'seasonal', 'recent'].includes(item),
    ),
    [router.params.recommendThemes],
  );
  const rawMaxPrice = Number(router.params.maxPrice);
  const maxPrice = Number.isFinite(rawMaxPrice) && rawMaxPrice > 0 ? Math.min(rawMaxPrice, 1_000_000) : undefined;
  const preferRecommended = router.params.preferRecommended === '1' || recommendThemes.length > 0;
  const usageScenario = routeText(router.params.usageScenario);
  const originPreference = routeText(router.params.originPreference);
  const dietaryPreference = routeText(router.params.dietaryPreference);
  const flavorPreference = routeText(router.params.flavorPreference);
  const categoryHint = routeText(router.params.categoryHint);
  const hasSemanticFilter = Boolean(categoryId || preferRecommended || constraints.length || maxPrice || usageScenario || originPreference || dietaryPreference || flavorPreference || categoryHint);
  const [input, setInput] = useState(initial);
  const [keyword, setKeyword] = useState(initial);
  const [submitted, setSubmitted] = useState(Boolean(initial) || hasSemanticFilter);
  const [tab, setTab] = useState<CatalogTab>('products');
  const [companyPage, setCompanyPage] = useState(1);
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches);

  const productsQuery = useInfiniteQuery({
    queryKey: ['catalog', 'search-products', keyword, categoryId || '', preferRecommended, constraints.join('|'), maxPrice || 0, recommendThemes.join('|'), usageScenario || '', originPreference || '', dietaryPreference || '', flavorPreference || '', categoryHint || ''],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => ProductRepo.list({
      page: pageParam,
      pageSize: PAGE_SIZE,
      keyword: keyword || undefined,
      categoryId,
      preferRecommended,
      constraints,
      maxPrice,
      recommendThemes,
      usageScenario,
      originPreference,
      dietaryPreference,
      flavorPreference,
      categoryHint,
    }),
    getNextPageParam: (last) => last.ok ? last.data.nextPage : undefined,
    enabled: submitted && (Boolean(keyword) || hasSemanticFilter),
    staleTime: 60_000,
  });
  const companiesQuery = useQuery({
    queryKey: ['catalog', 'search-companies'],
    queryFn: () => CompanyRepo.list(),
    enabled: submitted && Boolean(keyword),
    staleTime: 3 * 60_000,
  });
  const products = useMemo(() => productsQuery.data?.pages.flatMap((page) => page.ok ? page.data.items : []) ?? [], [productsQuery.data]);
  const filteredCompanies = companiesQuery.data?.ok ? filterCompanies(companiesQuery.data.data, keyword) : [];
  const companySlice = paginateCatalog(filteredCompanies, companyPage, 8);
  const productError = productsQuery.data?.pages.find((page) => !page.ok);

  const submit = (value = input) => {
    const normalized = value.trim();
    if (!normalized) { Taro.showToast({ title: '请输入搜索内容', icon: 'none' }); return; }
    setInput(normalized); setKeyword(normalized); setSubmitted(true); setCompanyPage(1);
    setRecentSearches(addRecentSearch(normalized));
  };

  return (
    <View className='aim-page catalog-search-page'>
      <View className='catalog-search-bar aim-card'>
        <Text className='catalog-search-bar__icon'>⌕</Text>
        <Input className='catalog-search-bar__input' value={input} focus={!initial} confirmType='search' placeholder='搜索商品、品类或企业' onInput={(event) => setInput(event.detail.value)} onConfirm={() => submit()} />
        {input ? <Text className='catalog-search-bar__clear' onClick={() => { setInput(''); setKeyword(''); setSubmitted(false); }}>×</Text> : null}
        <Button className='catalog-search-bar__button' onClick={() => submit()}>搜索</Button>
      </View>

      {!submitted ? (
        <View className='catalog-search-empty'>
          <View className='catalog-search-empty__mark'>AI</View>
          <Text className='catalog-search-empty__title'>搜一搜，找到更适合你的农产好物</Text>
          <Text className='catalog-search-empty__caption'>你可以搜商品名、品类、产地或企业</Text>
          {recentSearches.length ? <View className='catalog-search-recent'><View className='catalog-search-recent__head'><Text>最近搜索</Text><Text onClick={() => { clearRecentSearches(); setRecentSearches([]); }}>清空</Text></View><View className='catalog-search-hot catalog-search-hot--recent'>{recentSearches.map((item) => <Text className='catalog-search-hot__item' key={item} onClick={() => submit(item)}>{item}</Text>)}</View></View> : null}
          <View className='catalog-search-hot'>{hotKeywords.map((item) => <Text className='catalog-search-hot__item' key={item} onClick={() => submit(item)}>{item}</Text>)}</View>
        </View>
      ) : (
        <>
          <View className='catalog-search-summary'><Text className='catalog-search-summary__ai'>AI 匹配</Text><Text>{keyword ? `正在查找与“${keyword}”相关的结果` : '正在按你的推荐条件查找结果'}</Text></View>
          <View className='catalog-search-tabs'>
            <View className={tab === 'products' ? 'catalog-search-tab catalog-search-tab--active' : 'catalog-search-tab'} onClick={() => setTab('products')}>商品 {products.length ? `(${products.length}${productsQuery.hasNextPage ? '+' : ''})` : ''}</View>
            {keyword ? <View className={tab === 'companies' ? 'catalog-search-tab catalog-search-tab--active' : 'catalog-search-tab'} onClick={() => setTab('companies')}>企业 {filteredCompanies.length ? `(${filteredCompanies.length})` : ''}</View> : null}
          </View>
          {tab === 'products' ? (
            <>
              {productsQuery.isLoading ? <CatalogFeedback kind='loading' /> : null}
              {productError && !productError.ok ? <CatalogFeedback kind='error' description={productError.error.displayMessage || '搜索失败'} onRetry={() => productsQuery.refetch()} /> : null}
              {!productsQuery.isLoading && !productError && !products.length ? <CatalogFeedback kind='empty' title='没找到相关商品' description='试试更短的关键词或搜索品类' /> : null}
              <View className='catalog-search-products'>{products.map((product) => <CatalogProductCard product={product} key={product.id} compact onClick={openProduct} />)}</View>
              {productsQuery.hasNextPage ? <Button className='catalog-search-more' loading={productsQuery.isFetchingNextPage} onClick={() => productsQuery.fetchNextPage()}>加载更多</Button> : null}
            </>
          ) : (
            <>
              {companiesQuery.isLoading ? <CatalogFeedback kind='loading' /> : null}
              {companiesQuery.data && !companiesQuery.data.ok ? <CatalogFeedback kind='error' description={companiesQuery.data.error.displayMessage || '搜索失败'} onRetry={() => companiesQuery.refetch()} /> : null}
              {!companiesQuery.isLoading && companiesQuery.data?.ok && !companySlice.items.length ? <CatalogFeedback kind='empty' title='没找到相关企业' description='试试企业名、主营业务或产地' /> : null}
              <View className='catalog-search-companies'>{companySlice.items.map((company) => <CatalogCompanyCard company={company} key={company.id} onClick={openCompany} />)}</View>
              {companySlice.hasMore ? <Button className='catalog-search-more' onClick={() => setCompanyPage((page) => page + 1)}>加载更多</Button> : null}
            </>
          )}
        </>
      )}
    </View>
  );
}
