import { Button, Image, Map, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CatalogCompanyCard } from '@/components/catalog-company-card';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { CatalogProductCard } from '@/components/catalog-product-card';
import { paginateCatalog, type CatalogTab } from '@/components/catalog-utils';
import { PageHeader } from '@/components/PageHeader';
import { SeafoodImage } from '@/components/SeafoodImage';
import { CartRepo, CompanyRepo, ProductRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import type { Company, Product } from '@/types';
import { buildCompanyMapData, findCompanyByMarkerId } from './map-utils';
import './index.scss';

const PAGE_SIZE = 10;
// 微信 Image 未声明支持 ICO；复用随包发布的 PNG，避免解码差异和额外下载域名依赖。
const MAP_MARKER_ICON = '/assets/seafood/icon-order-fish.png';
const openProduct = (product: Product) => Taro.navigateTo({ url: `/packages/commerce/catalog-product/index?id=${encodeURIComponent(product.id)}` });
const openCompany = (company: Company) => Taro.navigateTo({ url: `/packages/commerce/catalog-company/index?id=${encodeURIComponent(company.id)}` });

type CatalogViewMode = 'list' | 'map';

export default function ProductsPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const [tab, setTab] = useState<CatalogTab>('products');
  const [viewMode, setViewMode] = useState<CatalogViewMode>('list');
  const [categoryId, setCategoryId] = useState<string>();
  const [companyTag, setCompanyTag] = useState<string>();
  const [companyPage, setCompanyPage] = useState(1);
  const [selectedMapCompanyId, setSelectedMapCompanyId] = useState<string>();
  const [mapUnavailable, setMapUnavailable] = useState(false);

  useDidShow(() => {
    const preferred = Taro.getStorageSync<string>('catalog-preferred-tab');
    if (preferred === 'products' || preferred === 'companies') setTab(preferred);
    Taro.removeStorageSync('catalog-preferred-tab');
    if (useAuthStore.getState().accessToken) void cartQuery.refetch();
  });

  const cartQuery = useQuery({
    queryKey: ['commerce', 'cart', authRevision],
    queryFn: CartRepo.get,
    enabled: hydrated && loggedIn,
    staleTime: 15_000,
  });
  const categoriesQuery = useQuery({ queryKey: ['catalog', 'categories'], queryFn: ProductRepo.listCategories, staleTime: 5 * 60_000 });
  const filtersQuery = useQuery({ queryKey: ['catalog', 'company-filters'], queryFn: CompanyRepo.getDiscoveryFilters, staleTime: 10 * 60_000 });
  const productsQuery = useInfiniteQuery({
    queryKey: ['catalog', 'products', categoryId ?? 'all'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => ProductRepo.list({ page: pageParam, pageSize: PAGE_SIZE, categoryId }),
    getNextPageParam: (last) => last.ok ? last.data.nextPage : undefined,
    staleTime: 60_000,
  });
  const companiesQuery = useQuery({
    queryKey: ['catalog', 'companies', companyTag ?? 'all'],
    queryFn: () => CompanyRepo.list(companyTag === 'nearby' ? undefined : companyTag),
    staleTime: 3 * 60_000,
  });

  const categories = categoriesQuery.data?.ok ? categoriesQuery.data.data.filter((item) => item.level === 1) : [];
  const companyFilters = filtersQuery.data?.ok ? filtersQuery.data.data : [];
  const products = useMemo(() => productsQuery.data?.pages.flatMap((page) => page.ok ? page.data.items : []) ?? [], [productsQuery.data]);
  const curatedProducts = products.slice(0, 6);
  const cartCount = cartQuery.data?.ok
    ? cartQuery.data.data.items.reduce((total, item) => total + item.quantity, 0)
    : 0;
  const allCompanies = useMemo(() => {
    const values = companiesQuery.data?.ok ? companiesQuery.data.data : [];
    return companyTag === 'nearby'
      ? [...values].sort((left, right) => (left.distanceKm ?? 0) - (right.distanceKm ?? 0))
      : values;
  }, [companiesQuery.data, companyTag]);
  const companySlice = paginateCatalog(allCompanies, companyPage, 6);
  const productError = productsQuery.data?.pages.find((page) => !page.ok);
  const companyMapData = useMemo(
    () => buildCompanyMapData(allCompanies, MAP_MARKER_ICON, selectedMapCompanyId),
    [allCompanies, selectedMapCompanyId],
  );
  const selectedMapCompany = companyMapData.entries.find(
    ({ company }) => company.id === selectedMapCompanyId,
  )?.company;
  const companiesWithoutCoordinates = Math.max(0, allCompanies.length - companyMapData.entries.length);

  const chooseTab = (next: CatalogTab) => {
    setTab(next);
    if (next === 'products') {
      setViewMode('list');
      setSelectedMapCompanyId(undefined);
    } else {
      setCompanyPage(1);
    }
  };

  const chooseCompanyView = (next: CatalogViewMode) => {
    setViewMode(next);
    setSelectedMapCompanyId(undefined);
    if (next === 'map') setMapUnavailable(false);
  };

  return (
    <View className='aim-page products-page'>
      <PageHeader title='发现' eyebrow='好物 · 好企业'>
        <View
          className='products-cart aim-card'
          onClick={() => loggedIn
            ? Taro.navigateTo({ url: '/packages/commerce/cart/index' })
            : Taro.navigateTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/commerce/cart/index')}` })}
        >
          <Text>购</Text>
          {cartCount > 0 ? <Text>{cartCount > 99 ? '99+' : cartCount}</Text> : null}
        </View>
      </PageHeader>
      <View className='products-search aim-card' hoverClass='products-search--pressed' onClick={() => Taro.navigateTo({ url: '/packages/commerce/catalog-search/index' })}>
        <SeafoodImage className='products-search__character' name='icon-order-puffer' /><View className='products-search__divider' /><Text className='products-search__text'>搜索商品、品类、企业...</Text><Text className='products-search__ai'>AI</Text>
      </View>
      <View className='products-tabs'>
        <View className={tab === 'products' ? 'products-tab products-tab--active' : 'products-tab'} onClick={() => chooseTab('products')}><Text>商品</Text></View>
        <View className={tab === 'companies' ? 'products-tab products-tab--active' : 'products-tab'} onClick={() => chooseTab('companies')}><Text>企业</Text></View>
      </View>

      {tab === 'companies' ? (
        <View className='products-view-row'>
          <Text className='products-view-row__label'>企业视图</Text>
          <View className='products-view-switch aim-card'>
            <View className={viewMode === 'list' ? 'products-view-option products-view-option--active' : 'products-view-option'} onClick={() => chooseCompanyView('list')}><Text>列表</Text></View>
            <View className={viewMode === 'map' ? 'products-view-option products-view-option--active' : 'products-view-option'} onClick={() => chooseCompanyView('map')}><Text>地图</Text></View>
          </View>
        </View>
      ) : null}

      {tab === 'products' ? (
        <>
          <ScrollView className='products-filters-scroll' scrollX enhanced showScrollbar={false}>
            <View className='products-filters'>
              <View className={!categoryId ? 'products-filter products-filter--active' : 'products-filter'} onClick={() => setCategoryId(undefined)}>全部</View>
              {categories.map((category) => <View key={category.id} className={categoryId === category.id ? 'products-filter products-filter--active' : 'products-filter'} onClick={() => setCategoryId(category.id)}>{category.icon ? `${category.icon} ` : ''}{category.name}</View>)}
            </View>
          </ScrollView>
          {productsQuery.isLoading ? <CatalogFeedback kind='loading' /> : null}
          {productError && !productError.ok ? <CatalogFeedback kind='error' description={productError.error.displayMessage || '商品加载失败'} onRetry={() => productsQuery.refetch()} /> : null}
          {!productsQuery.isLoading && !productError && products.length === 0 ? <CatalogFeedback kind='empty' title='暂无相关商品' description='换个分类看看吧' /> : null}
          {curatedProducts.length ? (
            <View className='products-curated'>
              <View className='products-curated__head'><Text className='products-curated__badge'>AI 精选</Text><Text>为你推荐</Text></View>
              <View className='products-curated__divider' />
              <ScrollView className='products-curated__scroll' scrollX enhanced showScrollbar={false}>
                <View className='products-curated__row'>
                  {curatedProducts.map((product) => <View className='products-curated__cell' key={`curated-${product.id}`}><CatalogProductCard product={product} onClick={openProduct} /></View>)}
                </View>
              </ScrollView>
            </View>
          ) : null}
          {products.length ? <Text className='products-hot-title'>热门商品</Text> : null}
          <View className='product-grid'>{products.map((product) => <CatalogProductCard product={product} key={product.id} onClick={openProduct} />)}</View>
          {productsQuery.hasNextPage ? <Button className='products-load-more' loading={productsQuery.isFetchingNextPage} onClick={() => productsQuery.fetchNextPage()}>{productsQuery.isFetchingNextPage ? '加载中...' : '加载更多商品'}</Button> : products.length ? <Text className='products-end'>已为你展示全部商品</Text> : null}
        </>
      ) : (
        <>
          <ScrollView className='products-filters-scroll' scrollX enhanced showScrollbar={false}>
            <View className='products-filters'>
              <View className={!companyTag ? 'products-filter products-filter--active' : 'products-filter'} onClick={() => { setCompanyTag(undefined); setCompanyPage(1); }}>全部</View>
              {companyFilters.map((filter) => <View key={filter.tagId} className={companyTag === filter.tagId ? 'products-filter products-filter--active' : 'products-filter'} onClick={() => { setCompanyTag(filter.tagId); setCompanyPage(1); }}>{filter.icon} {filter.label}</View>)}
              <View className={companyTag === 'nearby' ? 'products-filter products-filter--active' : 'products-filter'} onClick={() => { setCompanyTag('nearby'); setCompanyPage(1); }}>📍 附近</View>
            </View>
          </ScrollView>
          {companiesQuery.isLoading ? <CatalogFeedback kind='loading' /> : null}
          {companiesQuery.data && !companiesQuery.data.ok ? <CatalogFeedback kind='error' description={companiesQuery.data.error.displayMessage || '企业加载失败'} onRetry={() => companiesQuery.refetch()} /> : null}
          {!companiesQuery.isLoading && companiesQuery.data?.ok && viewMode === 'list' ? (
            <>
              {companySlice.items.length === 0 ? <CatalogFeedback kind='empty' title='暂无相关企业' description='换个标签看看吧' /> : null}
              <View className='company-list'>{companySlice.items.map((company) => <CatalogCompanyCard company={company} key={company.id} onClick={openCompany} />)}</View>
              {companySlice.hasMore ? <Button className='products-load-more' onClick={() => setCompanyPage((page) => page + 1)}>加载更多企业</Button> : companySlice.items.length ? <Text className='products-end'>已为你展示全部企业</Text> : null}
            </>
          ) : null}
          {!companiesQuery.isLoading && companiesQuery.data?.ok && viewMode === 'map' ? (
            <View className='products-map-section'>
              <View className='products-map-notice'>
                <Text className='products-map-notice__title'>企业公开点位</Text>
                <Text className='products-map-notice__text'>仅展示企业填写的坐标，不读取你的实时位置</Text>
              </View>
              {companyMapData.center && !mapUnavailable ? (
                <>
                  <Map
                    className='products-map'
                    latitude={companyMapData.center.latitude}
                    longitude={companyMapData.center.longitude}
                    scale={companyMapData.entries.length === 1 ? 13 : 9}
                    markers={companyMapData.markers}
                    includePoints={companyMapData.includePoints}
                    showLocation={false}
                    enableZoom
                    enableScroll
                    enableRotate={false}
                    enablePoi={false}
                    onMarkerTap={(event) => {
                      const company = findCompanyByMarkerId(companyMapData.entries, event.detail.markerId);
                      setSelectedMapCompanyId(company?.id);
                    }}
                    onError={() => setMapUnavailable(true)}
                  />
                  <Text className='products-map-summary'>
                    已展示 {companyMapData.entries.length} 家企业点位
                    {companiesWithoutCoordinates > 0 ? `，另有 ${companiesWithoutCoordinates} 家可在列表查看` : ''}
                  </Text>
                </>
              ) : (
                <CatalogFeedback
                  kind='empty'
                  title={mapUnavailable ? '当前设备地图暂不可用' : '暂无可展示的企业点位'}
                  description='坐标缺失时不会自动补齐，可切换列表继续查看企业'
                  actionLabel='查看企业列表'
                  onRetry={() => chooseCompanyView('list')}
                />
              )}
              {selectedMapCompany ? (
                <View className='products-map-card aim-card'>
                  {selectedMapCompany.cover ? <Image className='products-map-card__cover' src={selectedMapCompany.cover} mode='aspectFill' lazyLoad /> : <View className='products-map-card__cover products-map-card__cover--empty'><Text>企</Text></View>}
                  <View className='products-map-card__body'>
                    <Text className='products-map-card__name'>{selectedMapCompany.name}</Text>
                    <Text className='products-map-card__business'>{selectedMapCompany.mainBusiness || '企业信息'}</Text>
                    <Text className='products-map-card__location'>{selectedMapCompany.location || '企业未公开详细地址'}</Text>
                  </View>
                  {selectedMapCompany.topProducts?.length ? (
                    <ScrollView className='products-map-card__products' scrollX enhanced showScrollbar={false}>
                      <View className='products-map-card__product-row'>
                        {selectedMapCompany.topProducts.slice(0, 4).map((product) => <Image className='products-map-card__product' key={product.id} src={product.image} mode='aspectFill' onClick={() => Taro.navigateTo({ url: `/packages/commerce/catalog-product/index?id=${encodeURIComponent(product.id)}` })} />)}
                      </View>
                    </ScrollView>
                  ) : null}
                  <Button className='products-map-card__enter' onClick={() => openCompany(selectedMapCompany)}>进店</Button>
                </View>
              ) : companyMapData.center && !mapUnavailable ? <Text className='products-map-tip'>点击地图上的企业点位查看详情</Text> : null}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
