import { Button, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { MemberFeedback } from '../MemberFeedback';
import { MemberWalletRepo } from '../repos';
import { formatDateTime, formatMoney, walletLedgerPresentation } from '../utils';
import type { WalletLedgerEntry } from '../types';
import '../member.scss';

type Filter = 'all' | 'income' | 'frozen' | 'deduct' | 'withdraw';
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'income', label: '已到账' },
  { key: 'frozen', label: '冻结中' },
  { key: 'deduct', label: '消费抵扣' },
  { key: 'withdraw', label: '提现' },
];

function matchFilter(entry: WalletLedgerEntry, filter: Filter): boolean {
  if (filter === 'all') return true;
  const presentation = walletLedgerPresentation(entry);
  if (filter === 'income') return presentation.tone === 'income';
  if (filter === 'frozen') return presentation.tone === 'frozen';
  if (filter === 'deduct') return entry.entryType === 'DEDUCT';
  return entry.entryType === 'WITHDRAW' || entry.refType === 'WITHDRAW';
}

export default function WalletPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const [filter, setFilter] = useState<Filter>('all');
  const walletQuery = useQuery({
    queryKey: ['member', 'wallet'],
    queryFn: MemberWalletRepo.getWallet,
    enabled: hydrated && loggedIn,
  });
  const ledgerQuery = useInfiniteQuery({
    queryKey: ['member', 'wallet-ledger'],
    queryFn: async ({ pageParam }) => {
      const result = await MemberWalletRepo.getLedger(pageParam, 20);
      if (!result.ok) throw result.error;
      return result.data;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: hydrated && loggedIn,
  });
  useDidShow(() => {
    if (!useAuthStore.getState().accessToken) return;
    void walletQuery.refetch();
    void ledgerQuery.refetch();
  });

  const wallet = walletQuery.data?.ok ? walletQuery.data.data : undefined;
  const entries = useMemo(
    () => (ledgerQuery.data?.pages.flatMap((page) => page.items) || []).filter((item) => matchFilter(item, filter)),
    [ledgerQuery.data, filter],
  );
  const reload = () => { void walletQuery.refetch(); void ledgerQuery.refetch(); };

  if (!hydrated) return <View className='aim-page member-page'><MemberFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page member-page'><MemberFeedback kind='login' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/member/wallet/index')}` })} /></View>;
  if (walletQuery.isLoading || ledgerQuery.isLoading) return <View className='aim-page member-page'><MemberFeedback kind='loading' /></View>;
  if (!walletQuery.data?.ok || ledgerQuery.isError) return <View className='aim-page member-page'><MemberFeedback kind='error' description={walletQuery.data && !walletQuery.data.ok ? walletQuery.data.error.displayMessage : '钱包流水加载失败'} onAction={reload} /></View>;

  return <View className='aim-page member-page wallet-page'>
    <View className='wallet-hero'>
      <View className='wallet-hero__rings' />
      <Text className='wallet-hero__eyebrow'>统一钱包余额</Text>
      <Text className='wallet-hero__amount'>{formatMoney(wallet?.balance || 0)}</Text>
      <Text className='wallet-hero__hint'>消费积分、奖励与返还统一汇总，不展示内部资金来源</Text>
      <Button className='wallet-hero__button' onClick={() => Taro.navigateTo({ url: '/packages/member/wechat-withdraw/index' })}>提现到微信零钱</Button>
    </View>

    <View className='member-link-grid'>
      <View className='member-link-card aim-card' onClick={() => Taro.navigateTo({ url: '/packages/member/coupons/index' })}><Text className='member-link-card__mark member-link-card__mark--red'>券</Text><View><Text className='member-link-card__title'>优惠券</Text><Text className='member-link-card__meta'>独立优惠体系</Text></View></View>
      <View className='member-link-card aim-card' onClick={() => Taro.navigateTo({ url: '/packages/member/digital-assets/index' })}><Text className='member-link-card__mark member-link-card__mark--blue'>资</Text><View><Text className='member-link-card__title'>数字资产</Text><Text className='member-link-card__meta'>累计消费资产</Text></View></View>
    </View>

    <View className='member-section-head'><Text>钱包流水</Text><Text>实时记录</Text></View>
    <ScrollView className='member-filter-scroll' scrollX enhanced showScrollbar={false}>
      <View className='member-filter-row'>{FILTERS.map((item) => <View key={item.key} className={filter === item.key ? 'member-filter member-filter--active' : 'member-filter'} onClick={() => setFilter(item.key)}><Text>{item.label}</Text></View>)}</View>
    </ScrollView>
    <View className='member-ledger-list aim-card'>
      {entries.length ? entries.map((entry) => {
        const item = walletLedgerPresentation(entry);
        return <View className='member-ledger-row' key={entry.id}>
          <View className={`member-ledger-row__mark member-ledger-row__mark--${item.tone}`}>{item.tone === 'income' ? '+' : item.tone === 'expense' ? '−' : '·'}</View>
          <View className='member-ledger-row__main'><Text className='member-ledger-row__title'>{item.title}</Text><Text className='member-ledger-row__meta'>{item.description} · {formatDateTime(entry.createdAt)}</Text></View>
          <Text className={`member-ledger-row__amount member-ledger-row__amount--${item.tone}`}>{item.amount > 0 ? '+' : ''}{formatMoney(item.amount)}</Text>
        </View>;
      }) : <MemberFeedback kind='empty' title='暂无相关流水' description='当前筛选下没有记录' />}
    </View>
    {ledgerQuery.hasNextPage ? <Button className='member-load-more' loading={ledgerQuery.isFetchingNextPage} onClick={() => ledgerQuery.fetchNextPage()}>{ledgerQuery.isFetchingNextPage ? '加载中...' : '加载更多'}</Button> : entries.length ? <Text className='member-list-end'>已显示全部记录</Text> : null}
  </View>;
}
