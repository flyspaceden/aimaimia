import { Button, ScrollView, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { MemberFeedback } from '../MemberFeedback';
import { MemberDigitalAssetRepo } from '../repos';
import {
  ASSET_FILTER_QUERY,
  digitalLedgerAmount,
  digitalLedgerBalance,
  digitalLedgerTitle,
  formatDateTime,
  type AssetLedgerFilter,
} from '../utils';
import '../member.scss';

const FILTERS: Array<{ key: AssetLedgerFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'seed', label: '种子资产' },
  { key: 'consumption', label: '消费资产' },
  { key: 'frozen', label: '冻结资产' },
  { key: 'spend', label: '累计消费' },
  { key: 'refund', label: '扣回' },
  { key: 'adjustment', label: '调整' },
];

export default function ConsumptionRecordsPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const [filter, setFilter] = useState<AssetLedgerFilter>('all');
  const query = useInfiniteQuery({
    queryKey: ['member', 'digital-asset-ledgers', filter],
    queryFn: async ({ pageParam }) => {
      const result = await MemberDigitalAssetRepo.getLedgers({ page: pageParam, pageSize: 20, ...ASSET_FILTER_QUERY[filter] });
      if (!result.ok) throw result.error;
      return result.data;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: hydrated && loggedIn,
  });
  const records = query.data?.pages.flatMap((page) => page.items) || [];

  if (!hydrated) return <View className='aim-page member-page'><MemberFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page member-page'><MemberFeedback kind='login' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/member/consumption-records/index')}` })} /></View>;

  return <View className='aim-page member-page records-page'>
    <View className='records-intro'><Text>资产流水</Text><Text>查看每条资产变动、余额与当前状态</Text></View>
    <ScrollView className='member-filter-scroll' scrollX enhanced showScrollbar={false}><View className='member-filter-row'>{FILTERS.map((item) => <View key={item.key} className={filter === item.key ? 'member-filter member-filter--asset-active' : 'member-filter'} onClick={() => setFilter(item.key)}><Text>{item.label}</Text></View>)}</View></ScrollView>
    {query.isLoading ? <MemberFeedback kind='loading' /> : query.isError ? <MemberFeedback kind='error' title='资产流水加载失败' onAction={() => query.refetch()} /> : records.length ? <View className='asset-ledger-list'>{records.map((item) => <View className={`asset-ledger-card asset-ledger-card--${item.subjectType.toLowerCase()}`} key={item.id}><View className='asset-ledger-card__accent' /><View className='asset-ledger-card__main'><Text className='asset-ledger-card__title'>{digitalLedgerTitle(item)}</Text><Text className='asset-ledger-card__description'>{item.description || item.releaseHint || '资产变动记录'}</Text><Text className='asset-ledger-card__time'>{formatDateTime(item.createdAt)}</Text></View><View className='asset-ledger-card__value'><Text>{digitalLedgerAmount(item)}</Text><Text>{digitalLedgerBalance(item)}</Text></View></View>)}</View> : <MemberFeedback kind='empty' title='暂无资产流水' description='当前筛选条件下没有记录' />}
    {query.hasNextPage ? <Button className='member-load-more' loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>{query.isFetchingNextPage ? '加载中...' : '加载更多'}</Button> : records.length ? <Text className='member-list-end'>已显示全部记录</Text> : null}
  </View>;
}
