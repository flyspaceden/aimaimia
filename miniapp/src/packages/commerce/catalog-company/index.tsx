import { Button, Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter, useShareAppMessage } from '@tarojs/taro';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { CatalogProductCard } from '@/components/catalog-product-card';
import { companyProductToProduct } from '@/components/catalog-utils';
import { openSecureDocument } from '@/platform/document';
import { CompanyRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import type { Product } from '@/types';
import { CommunityRepo } from '../../community/repo';
import './index.scss';

type CompanyTab = 'products' | 'profile';
const openProduct = (product: Product) => Taro.navigateTo({ url: `/packages/commerce/catalog-product/index?id=${encodeURIComponent(product.id)}` });

export default function CatalogCompanyPage() {
  const router = useRouter();
  const id = typeof router.params.id === 'string' ? router.params.id : '';
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<CompanyTab>('products');
  const [category, setCategory] = useState<string>();
  const companyQuery = useQuery({ queryKey: ['catalog', 'company', authRevision, id], queryFn: () => CompanyRepo.getById(id), enabled: hydrated && Boolean(id), staleTime: loggedIn ? 0 : 5 * 60_000 });
  const productsQuery = useInfiniteQuery({
    queryKey: ['catalog', 'company-products', id, category ?? 'all'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => CompanyRepo.listProducts(id, { page: pageParam, pageSize: 10, category }),
    getNextPageParam: (last) => last.ok ? last.data.nextPage : undefined,
    enabled: Boolean(id),
    staleTime: 60_000,
  });
  const company = companyQuery.data?.ok ? companyQuery.data.data : undefined;
  const products = useMemo(() => company ? productsQuery.data?.pages.flatMap((page) => page.ok ? page.data.items.map((item) => companyProductToProduct(item, company)) : []) ?? [] : [], [company, productsQuery.data]);
  const categories = productsQuery.data?.pages[0]?.ok ? productsQuery.data.pages[0].data.categories : [];
  const productError = productsQuery.data?.pages.find((page) => !page.ok);
  const followMutation = useMutation({
    mutationFn: () => CommunityRepo.toggleFollow(id),
    onSuccess: async (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '关注操作失败', icon: 'none' }); return; }
      await Promise.all([
        companyQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['community', 'following', authRevision] }),
      ]);
    },
  });
  useDidShow(() => { if (id && useAuthStore.getState().hydrated) void companyQuery.refetch(); });
  useShareAppMessage(() => ({
    title: company ? `${company.name} - 爱买买企业专页` : '爱买买企业专页',
    path: `/packages/commerce/catalog-company/index?id=${encodeURIComponent(id)}`,
    imageUrl: company?.cover,
  }));

  const toggleFollow = () => {
    if (!loggedIn) {
      const returnUrl = `/packages/commerce/catalog-company/index?id=${encodeURIComponent(id)}`;
      void Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}` });
      return;
    }
    if (!followMutation.isPending) followMutation.mutate();
  };
  const callCompany = () => {
    if (!company?.servicePhone) return;
    void Taro.makePhoneCall({ phoneNumber: company.servicePhone });
  };

  if (!hydrated || companyQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!id || !companyQuery.data || !companyQuery.data.ok) return <View className='aim-page'><CatalogFeedback kind='error' title='企业加载失败' description={companyQuery.data && !companyQuery.data.ok ? companyQuery.data.error.displayMessage : '企业信息不完整'} onRetry={() => companyQuery.refetch()} /></View>;

  return (
    <View className='catalog-company-page'>
      <View className='catalog-company-hero'>
        <Image className='catalog-company-hero__image' src={company!.cover} mode='aspectFill' />
        <View className='catalog-company-hero__shade' />
        <View className='catalog-company-hero__content'>
          <Text className='catalog-company-hero__kicker'>企业优选 · 真实产地</Text>
          <Text className='catalog-company-hero__name'>{company!.name}</Text>
          <Text className='catalog-company-hero__business'>{company!.mainBusiness}</Text>
          <View className='catalog-company-hero__meta'><Text>{company!.location}</Text>{company!.distanceKm > 0 ? <Text>{company!.distanceKm.toFixed(1)} km</Text> : null}</View>
          <View className='catalog-company-hero__actions'>
            <Button loading={followMutation.isPending} disabled={followMutation.isPending} onClick={toggleFollow}>{company!.isFollowed ? '取消关注' : '+ 关注'}</Button>
            {company!.servicePhone ? <Button onClick={callCompany}>电话咨询</Button> : null}
            <Button openType='share'>分享企业</Button>
          </View>
        </View>
      </View>
      <View className='catalog-company-summary'>
        {(company!.badges ?? []).slice(0, 4).map((badge) => <Text className='catalog-company-summary__badge' key={badge}>{badge}</Text>)}
        {company!.latestTestedAt ? <Text className='catalog-company-summary__tested'>最新检测 {company!.latestTestedAt.slice(0, 10)}</Text> : null}
      </View>
      <View className='catalog-company-tabs'>
        <View className={tab === 'products' ? 'catalog-company-tab catalog-company-tab--active' : 'catalog-company-tab'} onClick={() => setTab('products')}>商品</View>
        <View className={tab === 'profile' ? 'catalog-company-tab catalog-company-tab--active' : 'catalog-company-tab'} onClick={() => setTab('profile')}>企业档案</View>
      </View>

      {tab === 'products' ? <View className='catalog-company-body'>
        {categories.length ? <ScrollView className='catalog-company-filter-scroll' scrollX enhanced showScrollbar={false}><View className='catalog-company-filters'><Text className={!category ? 'catalog-company-filter catalog-company-filter--active' : 'catalog-company-filter'} onClick={() => setCategory(undefined)}>全部</Text>{categories.map((item) => <Text key={item} className={category === item ? 'catalog-company-filter catalog-company-filter--active' : 'catalog-company-filter'} onClick={() => setCategory(item)}>{item}</Text>)}</View></ScrollView> : null}
        {productsQuery.isLoading ? <CatalogFeedback kind='loading' /> : null}
        {productError && !productError.ok ? <CatalogFeedback kind='error' description={productError.error.displayMessage || '商品加载失败'} onRetry={() => productsQuery.refetch()} /> : null}
        {!productsQuery.isLoading && !productError && !products.length ? <CatalogFeedback kind='empty' title='暂无可售商品' description='可以先看看企业档案' /> : null}
        <View className='catalog-company-products'>{products.map((product) => <CatalogProductCard product={product} key={product.id} onClick={openProduct} />)}</View>
        {productsQuery.hasNextPage ? <Button className='catalog-company-more' loading={productsQuery.isFetchingNextPage} onClick={() => productsQuery.fetchNextPage()}>加载更多商品</Button> : null}
      </View> : <View className='catalog-company-body catalog-company-profile'>
        {company!.description ? <View className='catalog-company-panel aim-card'><Text className='catalog-company-panel__title'>企业介绍</Text><Text className='catalog-company-panel__description'>{company!.description}</Text></View> : null}
        <View className='catalog-company-panel aim-card'>
          <Text className='catalog-company-panel__title'>企业信息</Text>
          <View className='catalog-company-info'><Text>主营业务</Text><Text>{company!.mainBusiness || '—'}</Text></View>
          <View className='catalog-company-info'><Text>所在地区</Text><Text>{company!.address?.text || company!.location || '—'}</Text></View>
          {company!.companyType ? <View className='catalog-company-info'><Text>企业类型</Text><Text>{company!.companyType}</Text></View> : null}
          {company!.supplyModes?.length ? <View className='catalog-company-info'><Text>供应方式</Text><Text>{company!.supplyModes.join('、')}</Text></View> : null}
          {company!.serviceAreas?.length ? <View className='catalog-company-info'><Text>服务区域</Text><Text>{company!.serviceAreas.join('、')}</Text></View> : null}
        </View>
        {Object.keys(company!.highlights ?? {}).length ? <View className='catalog-company-panel aim-card'><Text className='catalog-company-panel__title'>企业亮点</Text><View className='catalog-company-highlights'>{Object.entries(company!.highlights ?? {}).map(([label, value]) => <View className='catalog-company-highlight' key={label}><Text className='catalog-company-highlight__value'>{value}</Text><Text className='catalog-company-highlight__label'>{label}</Text></View>)}</View></View> : null}
        {(company!.certifications?.length || company!.inspectionReports?.length) ? <View className='catalog-company-panel aim-card'><Text className='catalog-company-panel__title'>资质与检测</Text><View className='catalog-company-certifications'>{(company!.certifications ?? []).map((item) => <Text className='catalog-company-certification' key={item}>{item}</Text>)}</View>{(company!.inspectionReports ?? []).map((report) => <View className={report.fileUrl ? 'catalog-company-report catalog-company-report--openable' : 'catalog-company-report'} key={report.id} onClick={() => { if (report.fileUrl) void openSecureDocument(report.fileUrl); }}><View><Text className='catalog-company-report__title'>{report.title}</Text><Text className='catalog-company-report__meta'>{report.issuer || '平台检测'} {report.issuedAt?.slice(0, 10) || ''}</Text></View><Text className='catalog-company-report__status'>{report.fileUrl ? '查看报告 ›' : '暂无文件'}</Text></View>)}</View> : null}
      </View>}
    </View>
  );
}
