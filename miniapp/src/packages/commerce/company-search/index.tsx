import { Button, Input, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CatalogCompanyCard } from '@/components/catalog-company-card';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { addRecentSearch } from '@/components/recent-searches';
import { CompanyRepo } from '@/repos';
import type { Company } from '@/types';
import { cleanupCompanyVoiceQuery, searchCompanies } from './search-utils';
import './index.scss';

const suggestions = ['农场', '蜂蜜', '有机种植', '蓝莓', '茶叶', '直供基地'];
const relativeLocations = /^(?:附近|周边|本地|这里|这边|身边)$/u;

function routeText(value: unknown, maxLength = 128): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function routeCsv(value: unknown): string[] {
  const raw = routeText(value, 256);
  return raw ? Array.from(new Set(raw.split(',').map((item) => item.trim().slice(0, 32)).filter(Boolean))).slice(0, 8) : [];
}

export default function CompanySearchPage() {
  const router = useRouter();
  const fromVoice = router.params.source === 'voice';
  const rawInitial = routeText(router.params.q, 128) || '';
  const initial = fromVoice ? cleanupCompanyVoiceQuery(rawInitial) || rawInitial : rawInitial;
  const industryHint = routeText(router.params.industryHint);
  const rawLocation = routeText(router.params.location);
  const location = rawLocation && !relativeLocations.test(rawLocation) ? rawLocation : undefined;
  const companyType = routeText(router.params.companyType, 64);
  const featureTags = useMemo(() => routeCsv(router.params.featureTags), [router.params.featureTags]);
  const hasFilters = Boolean(industryHint || location || companyType || featureTags.length);
  const [input, setInput] = useState(initial);
  const [query, setQuery] = useState(initial);
  const [submitted, setSubmitted] = useState(Boolean(initial) || hasFilters);
  const companiesQuery = useQuery({ queryKey: ['catalog', 'company-search'], queryFn: () => CompanyRepo.list(), staleTime: 3 * 60_000 });
  const filtered = useMemo(() => searchCompanies(
    companiesQuery.data?.ok ? companiesQuery.data.data : [],
    { query, submitted, industryHint, location, companyType, featureTags, fromVoice },
  ), [companiesQuery.data, companyType, featureTags, fromVoice, industryHint, location, query, submitted]);
  const hint = query || [location, industryHint, companyType, ...featureTags].filter(Boolean).join(' ');
  const summary = !submitted && !hasFilters
    ? `为你找到 ${filtered.length} 家可浏览企业，支持按企业名、主营业务、产地位置搜索。`
    : filtered.length
      ? `为你找到 ${filtered.length} 家与“${hint}”相关的企业，已按名称、主营品类、地区、类型和特征综合排序。`
      : `未找到与“${hint}”相关的企业，试试换个企业名、主营业务或地区关键词。`;
  const submit = (value = input) => {
    const normalized = value.trim().slice(0, 128);
    if (!normalized && !hasFilters) {
      Taro.showToast({ title: '请输入企业或主营业务', icon: 'none' });
      return;
    }
    setInput(normalized); setQuery(normalized); setSubmitted(true);
    if (normalized) addRecentSearch(normalized);
  };
  const openCompany = (company: Company) => Taro.navigateTo({ url: `/packages/commerce/catalog-company/index?id=${encodeURIComponent(company.id)}` });

  return <View className='aim-page company-search-page'>
    <View className='company-search-bar aim-card'><Text className='company-search-bar__mark'>企</Text><Input value={input} focus={!initial && !hasFilters} confirmType='search' maxlength={128} placeholder='搜索企业、农场、主营业务...' onInput={(event) => { const value = event.detail.value; setInput(value); if (!value.trim() && !hasFilters) { setQuery(''); setSubmitted(false); } }} onConfirm={() => submit()} /><Button onClick={() => submit()}>搜索</Button></View>
    <View className='company-search-summary aim-card'><View className='company-search-summary__head'><Text>AI</Text><Text>企业搜索摘要</Text></View><Text className='company-search-summary__copy'>{summary}</Text></View>
    {companiesQuery.isLoading ? <CatalogFeedback kind='loading' /> : null}
    {companiesQuery.data && !companiesQuery.data.ok ? <CatalogFeedback kind='error' title='企业加载失败' description={companiesQuery.data.error.displayMessage} onRetry={() => companiesQuery.refetch()} /> : null}
    {!companiesQuery.isLoading && companiesQuery.data?.ok && !filtered.length ? <View><CatalogFeedback kind='empty' title='暂无企业结果' description='换个企业名、主营业务或位置试试' /><Text className='company-search-suggestions__title'>试试这些搜索</Text><View className='company-search-suggestions'>{suggestions.map((item) => <Text key={item} onClick={() => submit(item)}>{item}</Text>)}</View></View> : null}
    <View className='company-search-list'>{filtered.map((company) => <CatalogCompanyCard key={company.id} company={company} onClick={openCompany} />)}</View>
  </View>;
}
