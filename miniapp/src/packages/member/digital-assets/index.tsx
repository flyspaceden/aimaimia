import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { MemberFeedback } from '../MemberFeedback';
import { MemberDigitalAssetRepo } from '../repos';
import { digitalLedgerAmount, digitalLedgerBalance, digitalLedgerTitle, formatAsset, formatDateTime, formatMoney } from '../utils';
import '../member.scss';

export default function DigitalAssetsPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const query = useQuery({ queryKey: ['member', 'digital-assets', 'summary'], queryFn: MemberDigitalAssetRepo.getSummary, enabled: hydrated && loggedIn });
  useDidShow(() => { if (useAuthStore.getState().accessToken) void query.refetch(); });
  if (!hydrated) return <View className='aim-page member-page'><MemberFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page member-page'><MemberFeedback kind='login' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/member/digital-assets/index')}` })} /></View>;
  if (query.isLoading) return <View className='aim-page member-page'><MemberFeedback kind='loading' /></View>;
  if (!query.data?.ok) return <View className='aim-page member-page'><MemberFeedback kind='error' title='数字资产加载失败' description={query.data?.error.displayMessage} onAction={() => query.refetch()} /></View>;
  const summary = query.data.data;

  return <View className='aim-page member-page digital-page'>
    <View className={summary.isVip ? 'digital-hero digital-hero--vip' : 'digital-hero'}>
      <View className='digital-hero__field digital-hero__field--one' /><View className='digital-hero__field digital-hero__field--two' />
      <Text className='digital-hero__eyebrow'>{summary.isVip ? '数字资产总额' : '累计消费金额'}</Text>
      <Text className='digital-hero__amount'>{summary.isVip ? formatAsset(summary.totalAssetBalance) : formatMoney(summary.cumulativeSpendAmount)}</Text>
      {summary.isVip ? <><View className='digital-hero__summary'><Text>累计消费</Text><Text>{formatMoney(summary.cumulativeSpendAmount)}</Text></View><View className='digital-asset-grid'><View><Text>种子资产</Text><Text>{formatAsset(summary.seedAssetBalance)}</Text></View><View><Text>消费资产</Text><Text>{formatAsset(summary.creditAssetBalance)}</Text></View><View><Text>冻结资产</Text><Text>{formatAsset(summary.frozenCreditAssetBalance)}</Text></View></View>{summary.assetRank ? <Text className='digital-hero__rank'>当前排名 第 {summary.assetRank} 名</Text> : null}</> : <><Text className='digital-hero__prompt'>开通 VIP 后激活种子资产与消费资产</Text><Button className='digital-hero__button' onClick={() => Taro.switchTab({ url: '/pages/me/index' })}>前往我的开通 VIP</Button></>}
    </View>
    <View className='digital-boundary aim-card'><Text>账本边界</Text><Text>数字资产根据累计消费独立记账，不是钱包余额，也不是优惠券，不能从此页面提现。</Text></View>
    <View className='member-section-head'><Text>最近资产流水</Text><Text>服务端最近 5 条</Text></View>
    {summary.recentRecords.length ? <View className='asset-ledger-list'>{summary.recentRecords.map((item) => <View className={`asset-ledger-card asset-ledger-card--${item.subjectType.toLowerCase()}`} key={item.id}><View className='asset-ledger-card__accent' /><View className='asset-ledger-card__main'><Text className='asset-ledger-card__title'>{digitalLedgerTitle(item)}</Text><Text className='asset-ledger-card__description'>{item.description || item.releaseHint || '服务端资产记录'}</Text><Text className='asset-ledger-card__time'>{formatDateTime(item.createdAt)}</Text></View><View className='asset-ledger-card__value'><Text>{digitalLedgerAmount(item)}</Text><Text>{digitalLedgerBalance(item)}</Text></View></View>)}</View> : <MemberFeedback kind='empty' title='暂无数字资产流水' description='累计消费记录会由服务端记入此处' />}
    <Button className='member-secondary-button' onClick={() => Taro.navigateTo({ url: '/packages/member/consumption-records/index' })}>查看全部消费与资产记录</Button>
  </View>;
}
