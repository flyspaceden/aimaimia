import { Button, Text, View } from '@tarojs/components';
import Taro, { useShareAppMessage } from '@tarojs/taro';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { MiniProgramCodePanel } from '@/components/mini-program-code';
import { useAuthStore } from '@/store/auth';
import { captainLedgerStatusLabel, captainOrderStatusLabel, CommunityRepo } from '../repo';
import { formatDate, formatMoney } from '../utils';
import './index.scss';

const PAGE_SIZE = 8;
const LEDGER_LABELS: Record<string, string> = {
  DIRECT_ORDER: '逐单利润奖励',
  MANAGEMENT_ALLOWANCE: '管理津贴',
  GROWTH_BONUS: '增长奖励',
  CULTIVATION_BONUS: '成交辅导奖',
  PERFORMANCE_BONUS: '绩效奖励',
  ADJUSTMENT: '账户调整',
};

export default function CaptainCenterPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const profileQuery = useQuery({
    queryKey: ['community', 'captain', 'profile', authRevision],
    queryFn: CommunityRepo.captainMe,
    enabled: hydrated && loggedIn,
    staleTime: 0,
  });
  const profile = profileQuery.data?.ok ? profileQuery.data.data : undefined;
  const isCaptain = Boolean(profile?.isCaptain && profile.profile);
  const ledgerQuery = useInfiniteQuery({
    queryKey: ['community', 'captain', 'ledgers', authRevision],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => CommunityRepo.captainLedgers(pageParam, PAGE_SIZE),
    getNextPageParam: (last) => last.ok && last.data.page * last.data.pageSize < last.data.total ? last.data.page + 1 : undefined,
    enabled: hydrated && loggedIn && isCaptain,
    staleTime: 0,
  });
  const orderQuery = useInfiniteQuery({
    queryKey: ['community', 'captain', 'orders', authRevision],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => CommunityRepo.captainOrders(pageParam, PAGE_SIZE),
    getNextPageParam: (last) => last.ok && last.data.page * last.data.pageSize < last.data.total ? last.data.page + 1 : undefined,
    enabled: hydrated && loggedIn && isCaptain,
    staleTime: 0,
  });
  const ledgers = useMemo(() => ledgerQuery.data?.pages.flatMap((page) => page.ok ? page.data.items : []) || [], [ledgerQuery.data]);
  const orders = useMemo(() => orderQuery.data?.pages.flatMap((page) => page.ok ? page.data.items : []) || [], [orderQuery.data]);
  const code = profile?.profile?.captainCode || '';
  const sharePath = `/packages/community/captain-landing/index?code=${encodeURIComponent(code)}`;

  useShareAppMessage(() => ({ title: '和我一起发现 AI爱买买好物', path: code ? sharePath : '/pages/home/index' }));

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后才能查看团长经营账户' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/community/captain-center/index')}` })} /></View>;
  if (profileQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!profileQuery.data?.ok || !profile) return <View className='aim-page'><CatalogFeedback kind='error' title='团长资料加载失败' description={profileQuery.data && !profileQuery.data.ok ? profileQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => profileQuery.refetch()} /></View>;
  if (!isCaptain) return <View className='aim-page captain-empty'>
    <View className='captain-empty__seal'>团</View><Text className='captain-empty__title'>尚未开通团长</Text><Text className='captain-empty__copy'>提交真实经营资料后，平台会结合资料与历史成交情况审核。</Text><Button className='captain-primary' onClick={() => Taro.navigateTo({ url: '/packages/community/captain-application/index' })}>申请成为团长</Button>
  </View>;

  const account = profile.account;
  const metric = profile.metric;
  return <View className='captain-page'>
    <View className='captain-hero'>
      <View className='captain-hero__top'><Text className='captain-hero__eyebrow'>团长经营账簿</Text><Text className={metric?.qualified ? 'captain-hero__status captain-hero__status--ok' : 'captain-hero__status'}>{metric?.qualified ? '本月达标' : '经营中'}</Text></View>
      <Text className='captain-hero__balance'>¥{formatMoney(Number(account?.balance || 0) + Number(account?.frozen || 0))}</Text><Text className='captain-hero__caption'>奖励总额（可用 + 冻结）</Text>
      <View className='captain-hero__split'><View><Text>¥{formatMoney(account?.balance)}</Text><Text>可用</Text></View><View><Text>¥{formatMoney(account?.frozen)}</Text><Text>冻结</Text></View><View><Text>¥{formatMoney(account?.withdrawn)}</Text><Text>已提现</Text></View></View>
    </View>

    <View className='captain-code aim-card'><View className='captain-code__seal'>长</View><View className='captain-code__copy'><Text>我的团长码</Text><Text>{code}</Text><Text>好友通过小程序卡片进入后，平台会自动核验绑定关系。</Text></View></View>
    <View className='captain-actions'><Button onClick={() => Taro.setClipboardData({ data: code })}>复制团长码</Button><Button openType='share'>分享给好友</Button></View>
    <MiniProgramCodePanel kind='CAPTAIN' enabled={Boolean(code)} />

    <View className='captain-section-head'><Text>本月经营</Text><Text>{metric?.month || '当前月'}</Text></View>
    <View className='captain-stats aim-card'><View><Text>¥{formatMoney(metric?.personalGmv)}</Text><Text>个人成交额</Text></View><View><Text>{metric?.directEffectiveBuyers || 0}</Text><Text>直接有效买家</Text></View><View><Text>{metric?.newEffectiveMembers || 0}</Text><Text>新增有效会员</Text></View><View><Text>{(Number(metric?.refundRate || 0) * 100).toFixed(1)}%</Text><Text>退款率</Text></View></View>

    <View className='captain-section-head'><Text>订单进度</Text><Text>实时更新</Text></View>
    {orderQuery.isLoading ? <CatalogFeedback kind='loading' /> : orderQuery.data?.pages.some((page) => !page.ok) ? <CatalogFeedback kind='error' title='订单进度加载失败' onRetry={() => orderQuery.refetch()} /> : !orders.length ? <CatalogFeedback kind='empty' title='暂无团长订单' /> : <View className='captain-list aim-card'>{orders.map((order) => <View className='captain-row' key={order.id}><View><Text>{order.buyer?.profile?.nickname || order.buyer?.buyerNo || '买家订单'}</Text><Text>{formatDate(order.createdAt)} · {captainOrderStatusLabel(order.status)}</Text></View><Text>基数 ¥{formatMoney(order.profitBaseAmount ?? order.commissionBase)}</Text></View>)}</View>}
    {orderQuery.hasNextPage ? <Button className='captain-more' loading={orderQuery.isFetchingNextPage} onClick={() => orderQuery.fetchNextPage()}>加载更多订单</Button> : null}

    <View className='captain-section-head'><Text>奖励明细</Text><Text>可用与冻结分开记录</Text></View>
    {ledgerQuery.isLoading ? <CatalogFeedback kind='loading' /> : ledgerQuery.data?.pages.some((page) => !page.ok) ? <CatalogFeedback kind='error' title='奖励明细加载失败' onRetry={() => ledgerQuery.refetch()} /> : !ledgers.length ? <CatalogFeedback kind='empty' title='暂无经营奖励流水' /> : <View className='captain-list aim-card'>{ledgers.map((ledger) => <View className='captain-row' key={ledger.id}><View><Text>{LEDGER_LABELS[ledger.type] || '经营奖励'}</Text><Text>{formatDate(ledger.createdAt)} · {captainLedgerStatusLabel(ledger.status)}</Text></View><Text className={ledger.amount < 0 ? 'captain-row__negative' : 'captain-row__positive'}>{ledger.amount > 0 ? '+' : ''}¥{formatMoney(ledger.amount)}</Text></View>)}</View>}
    {ledgerQuery.hasNextPage ? <Button className='captain-more' loading={ledgerQuery.isFetchingNextPage} onClick={() => ledgerQuery.fetchNextPage()}>加载更多明细</Button> : null}
  </View>;
}
