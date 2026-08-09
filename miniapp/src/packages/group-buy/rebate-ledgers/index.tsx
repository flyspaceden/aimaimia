import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { useAuthStore } from '@/store/auth';
import { GroupBuyAuthGate } from '../_components/group-buy-shared';
import { MiniGroupBuyRepo } from '../repo';
import { formatGroupBuyDate, formatGroupBuyMoney, groupBuyLedgerPresentation, groupBuyLedgerStatusLabel } from '../utils';
import './index.scss';

export default function GroupBuyRebateLedgersPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const accountQuery = useQuery({ queryKey: ['group-buy', 'rebate', 'account'], queryFn: MiniGroupBuyRepo.getRebateAccount, enabled: hydrated && loggedIn });
  const ledgerQuery = useInfiniteQuery({
    queryKey: ['group-buy', 'rebate', 'ledgers'],
    queryFn: async ({ pageParam }) => {
      const result = await MiniGroupBuyRepo.listRebateLedgers(pageParam, 20);
      if (!result.ok) throw result.error;
      return result.data;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: hydrated && loggedIn,
  });
  const account = accountQuery.data?.ok ? accountQuery.data.data : undefined;
  const ledgers = useMemo(() => ledgerQuery.data?.pages.flatMap((page) => page.items) || [], [ledgerQuery.data]);
  const reload = () => { void accountQuery.refetch(); void ledgerQuery.refetch(); };
  useDidShow(() => { if (useAuthStore.getState().accessToken) reload(); });

  if (!hydrated) return <View className='group-buy-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <GroupBuyAuthGate returnUrl='/packages/group-buy/rebate-ledgers/index' description='登录后才能查看团购返还账户和流水' />;
  if (accountQuery.isLoading || ledgerQuery.isLoading) return <View className='group-buy-page'><CatalogFeedback kind='loading' /></View>;
  if (!accountQuery.data?.ok || ledgerQuery.isError) return <View className='group-buy-page'><CatalogFeedback kind='error' title='返还流水加载失败' description={accountQuery.data && !accountQuery.data.ok ? accountQuery.data.error.displayMessage : '请稍后重试'} onRetry={reload} /></View>;

  return <View className='group-buy-page'>
    <View className='group-buy-rebate__hero'>
      <Text className='group-buy-rebate__label'>团购返还可用余额</Text>
      <Text className='group-buy-rebate__amount'>¥{formatGroupBuyMoney(account?.available || 0)}</Text>
      <Text className='group-buy-rebate__hint'>这里仅展示团购返还明细。提现仍进入统一钱包，由后端按统一余额和规则处理。</Text>
      <View className='group-buy-rebate__stats'><View><Text>¥{formatGroupBuyMoney(account?.reserved || 0)}</Text><Text>冻结中</Text></View><View><Text>¥{formatGroupBuyMoney(account?.withdrawn || 0)}</Text><Text>历史提现</Text></View><View><Text>¥{formatGroupBuyMoney(account?.deducted || 0)}</Text><Text>历史抵扣</Text></View></View>
      <Button className='group-buy-current__copy group-buy-primary' onClick={() => Taro.navigateTo({ url: '/packages/member/wallet/index' })}>前往统一钱包</Button>
    </View>

    <View className='group-buy-section-head'><Text>返还流水</Text><Text>只读 · 服务端记录</Text></View>
    {!ledgers.length ? <CatalogFeedback kind='empty' title='暂无团购返还流水' description='好友付款、确认收货或返还状态变化后会在这里记录' /> : <View className='group-buy-ledger-list aim-card'>{ledgers.map((ledger) => {
      const item = groupBuyLedgerPresentation(ledger);
      return <View className='group-buy-ledger' key={ledger.id}><Text className={`group-buy-ledger__mark group-buy-ledger__mark--${item.tone}`}>{item.tone === 'income' ? '+' : item.tone === 'expense' ? '−' : item.tone === 'pending' ? '时' : '·'}</Text><View className='group-buy-ledger__copy'><Text className='group-buy-ledger__title'>{item.title}</Text><Text className='group-buy-ledger__meta'>{formatGroupBuyDate(ledger.createdAt)} · {groupBuyLedgerStatusLabel(ledger.status)}</Text></View><Text className={`group-buy-ledger__amount group-buy-ledger__amount--${item.tone}`}>{item.amount > 0 ? '+' : item.amount < 0 ? '−' : ''}{formatGroupBuyMoney(Math.abs(item.amount))}</Text></View>;
    })}</View>}
    {ledgerQuery.hasNextPage ? <Button className='group-buy-secondary' loading={ledgerQuery.isFetchingNextPage} onClick={() => ledgerQuery.fetchNextPage()}>{ledgerQuery.isFetchingNextPage ? '加载中...' : '加载更多'}</Button> : ledgers.length ? <Text className='group-buy-rebate__end'>已显示全部服务端记录</Text> : null}
  </View>;
}
