import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { useAuthStore } from '@/store/auth';
import { BenefitsFeedback } from '../BenefitsFeedback';
import { BenefitsRepo } from '../repos';
import { benefitsLoginUrl, createOperationKey, exchangeStatusLabel, formatDate } from '../utils';
import './index.scss';

const exchangeLabels: Record<string, string> = { COUPON: '平台红包', SHIPPING_COUPON: '运费权益', LOTTERY_CHANCE: '抽奖次数', VIP_DISCOUNT_COUPON: 'VIP 优惠', DECORATION: '装饰权益' };

export default function GrowthPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const keys = useRef<Record<string, string>>({});
  const summaryQuery = useQuery({ queryKey: ['benefits', 'growth'], queryFn: BenefitsRepo.getGrowth, enabled: hydrated && loggedIn });
  const guideQuery = useQuery({ queryKey: ['benefits', 'growth-guide'], queryFn: BenefitsRepo.getGrowthGuide, enabled: hydrated && loggedIn });
  const itemsQuery = useQuery({ queryKey: ['benefits', 'growth-exchange-items'], queryFn: BenefitsRepo.getExchangeItems, enabled: hydrated && loggedIn });
  const recordsQuery = useQuery({ queryKey: ['benefits', 'growth-exchange-records'], queryFn: BenefitsRepo.getExchangeRecords, enabled: hydrated && loggedIn });
  const exchangeMutation = useMutation({
    mutationFn: ({ itemId, key }: { itemId: string; key: string }) => BenefitsRepo.exchangeItem(itemId, key),
    onSuccess: async (result, variables) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '兑换失败', icon: 'none' }); return; }
      delete keys.current[variables.itemId];
      Taro.showToast({ title: result.data.status === 'SUCCESS' ? '兑换成功' : '兑换处理中', icon: 'success' });
      await Promise.all([summaryQuery.refetch(), itemsQuery.refetch(), recordsQuery.refetch()]);
    },
  });

  const exchange = async (itemId: string, name: string, pointsCost: number) => {
    const modal = await Taro.showModal({ title: '确认兑换', content: `使用 ${pointsCost} 积分兑换「${name}」？`, confirmColor: '#2E7D32' });
    if (!modal.confirm) return;
    const key = keys.current[itemId] || createOperationKey('mini-growth');
    keys.current[itemId] = key;
    exchangeMutation.mutate({ itemId, key });
  };

  const reload = () => { void summaryQuery.refetch(); void guideQuery.refetch(); void itemsQuery.refetch(); void recordsQuery.refetch(); };
  if (!hydrated) return <View className='aim-page benefits-page'><BenefitsFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page benefits-page'><BenefitsFeedback kind='login' description='登录后查看积分、成长值和可兑换权益' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: benefitsLoginUrl('/packages/benefits/growth/index') })} /></View>;
  if (summaryQuery.isLoading || guideQuery.isLoading || itemsQuery.isLoading || recordsQuery.isLoading) return <View className='aim-page benefits-page'><BenefitsFeedback kind='loading' /></View>;
  if (!summaryQuery.data?.ok || !guideQuery.data?.ok || !itemsQuery.data?.ok || !recordsQuery.data?.ok) return <View className='aim-page benefits-page'><BenefitsFeedback kind='error' title='成长数据加载失败' onAction={reload} /></View>;
  const summary = summaryQuery.data.data;
  const guide = guideQuery.data.data;
  const items = itemsQuery.data.data;
  const records = recordsQuery.data.data;
  const ratio = Math.max(0, Math.min(1, summary.levelProgress.ratio));

  return <View className='aim-page benefits-page'>
    <View className='benefits-hero'><View className='benefits-hero__orbit' /><Text className='benefits-hero__eyebrow'>GROWTH FIELD</Text><Text className='benefits-hero__title'>{summary.level?.titleLabel || summary.level?.name || '新芽会员'}</Text><Text className='benefits-hero__description'>{summary.nextLevel ? `再成长 ${Math.max(0, (summary.levelProgress.required || 0) - summary.levelProgress.current)} 即可向 ${summary.nextLevel.name} 进阶` : '已达到当前最高成长等级'}</Text><View className='growth-progress'><View className='growth-progress__fill' style={{ width: `${ratio * 100}%` }} /></View><View className='benefits-stat-row'><View><Text>可用积分</Text><Text>{summary.pointsBalance}</Text></View><View><Text>成长值</Text><Text>{summary.growthValue}</Text></View><View><Text>已使用积分</Text><Text>{summary.pointsTotalSpent}</Text></View></View></View>
    <View className='benefits-section-head'><Text>积分兑换</Text><Text>积分与成长值分开计算</Text></View>
    {items.length ? <View className='growth-list'>{items.map((item) => <View className='growth-exchange aim-card' key={item.id}><View className='growth-exchange__body'><Text className='growth-exchange__name'>{item.name}</Text><Text className='growth-exchange__meta'>{exchangeLabels[item.type] || '权益'} · {item.pointsCost} 积分{item.requiredLevelCode ? ` · ${item.requiredLevelCode}` : ''}</Text>{item.description ? <Text className='growth-exchange__meta'>{item.description}</Text> : null}</View><Button className='growth-exchange__button' disabled={!item.canExchange || exchangeMutation.isPending} loading={exchangeMutation.isPending && exchangeMutation.variables?.itemId === item.id} onClick={() => { void exchange(item.id, item.name, item.pointsCost); }}>{item.canExchange ? '兑换' : '不可兑换'}</Button></View>)}</View> : <BenefitsFeedback kind='empty' title='暂无可兑换权益' />}
    <View className='benefits-section-head'><Text>成长指南</Text><Text>当前账户可用规则</Text></View>
    <View className='aim-card'>{[...guide.inviteRules, ...guide.earningRules].map((rule) => <View className='growth-rule' key={rule.code}><View><Text className='growth-rule__name'>{rule.name}</Text><Text className='growth-rule__timing'>{rule.grantTiming}</Text></View><Text className='growth-rule__reward'>+{rule.pointsReward} 积分 · +{rule.growthReward} 成长</Text></View>)}</View>
    {records.length ? <><View className='benefits-section-head'><Text>最近兑换</Text><Text>服务端记录</Text></View><View className='aim-card'>{records.slice(0, 5).map((record) => <View className='growth-rule' key={record.id}><View><Text className='growth-rule__name'>{record.pointsCost} 积分</Text><Text className='growth-rule__timing'>{formatDate(record.createdAt)}</Text></View><Text className='growth-rule__reward'>{exchangeStatusLabel(record.status)}</Text></View>)}</View></> : null}
    <View className='benefits-card aim-card'><Text className='benefits-card__title'>积分与成长值</Text><Text className='benefits-card__description'>{guide.pointsNote}</Text><Text className='benefits-card__description'>{guide.growthNote}</Text></View>
  </View>;
}
