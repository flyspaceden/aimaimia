import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { BenefitsFeedback } from '../BenefitsFeedback';
import { BenefitsRepo } from '../repos';
import type { QueueRewardStatus } from '../types';
import { benefitsLoginUrl, formatDate, formatMoney, queueOrderStatusLabel } from '../utils';
import './index.scss';

type Position = QueueRewardStatus['activePositions'][number];

export default function QueueRewardPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const statusQuery = useQuery({ queryKey: ['benefits', 'queue-reward'], queryFn: () => BenefitsRepo.getQueueStatus(undefined, 20), enabled: hydrated && loggedIn });
  const [positions, setPositions] = useState<Position[]>([]);
  const [nextSequence, setNextSequence] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    if (!statusQuery.data?.ok) return;
    setPositions(statusQuery.data.data.activePositions);
    setNextSequence(statusQuery.data.data.positionPage.nextSequence);
    setHasMore(statusQuery.data.data.positionPage.hasMore);
  }, [statusQuery.data]);
  const moreMutation = useMutation({
    mutationFn: (cursor: string) => BenefitsRepo.getQueueStatus(cursor, 20),
    onSuccess: (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '加载失败', icon: 'none' }); return; }
      setPositions((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...result.data.activePositions.filter((item) => !seen.has(item.id))];
      });
      setNextSequence(result.data.positionPage.nextSequence);
      setHasMore(result.data.positionPage.hasMore);
    },
  });

  if (!hydrated) return <View className='aim-page benefits-page'><BenefitsFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page benefits-page'><BenefitsFeedback kind='login' description='登录后查看你的订单队列位置和奖励进度' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: benefitsLoginUrl('/packages/benefits/queue-reward/index') })} /></View>;
  if (statusQuery.isLoading) return <View className='aim-page benefits-page'><BenefitsFeedback kind='loading' /></View>;
  if (!statusQuery.data?.ok) return <View className='aim-page benefits-page'><BenefitsFeedback kind='error' title='队列状态加载失败' description={statusQuery.data && !statusQuery.data.ok ? statusQuery.data.error.displayMessage : undefined} onAction={() => statusQuery.refetch()} /></View>;
  const status = statusQuery.data.data;

  return <View className='aim-page benefits-page'>
    <View className='benefits-hero'><View className='benefits-hero__orbit' /><Text className='benefits-hero__eyebrow'>ORDER QUEUE</Text><Text className='benefits-hero__title'>全平台订单队列奖励</Text><Text className='benefits-hero__description'>位置、观测进度和可用奖励均以服务端的当前状态为准。</Text><View className='benefits-stat-row'><View><Text>可用奖励</Text><Text>¥{formatMoney(status.wallet.available)}</Text></View><View><Text>活跃位置</Text><Text>{status.totalActivePositions}</Text></View><View><Text>队列规模</Text><Text>{status.queueSize}</Text></View></View></View>
    {!status.enabled ? <View className='benefits-payment-state'>当前队列奖励功能未开启，页面仅展示服务端返回的历史状态。</View> : null}
    <View className='benefits-card aim-card'><Text className='benefits-card__title'>当前规则</Text><Text className='benefits-card__description'>每个拆分单位 ¥{formatMoney(status.splitUnitAmount)}，每单最多 {status.maxPositionsPerOrder} 个位置；{status.distributionMode === 'AVERAGE' ? '平均分配' : '普通随机分配'}。</Text></View>
    <View className='benefits-section-head'><Text>我的队列位置</Text><Text>{positions.length}/{status.positionPage.total}</Text></View>
    {positions.length ? <View className='queue-list'>{positions.map((position) => {
      const ratio = position.targetObservedUnitCount > 0 ? Math.max(0, Math.min(1, position.observedUnitCount / position.targetObservedUnitCount)) : 0;
      return <View className='queue-position aim-card' key={position.id}><View className='queue-position__head'><Text>{position.orderNo} · 单元 {position.unitIndex + 1}</Text><Text>前方 {position.ahead}</Text></View><View className='queue-position__progress'><Text>已观测 {position.observedUnitCount}</Text><Text>目标 {position.targetObservedUnitCount}</Text></View><View className='queue-position__bar'><View className='queue-position__fill' style={{ width: `${ratio * 100}%` }} /></View><Text className='queue-position__amount'>已获得 ¥{formatMoney(position.receivedAmount)} · 上限 ¥{formatMoney(position.sharedCapAmount)}</Text></View>;
    })}</View> : <BenefitsFeedback kind='empty' title='暂无活跃位置' description='有效订单是否参与以服务端规则为准' />}
    {hasMore && nextSequence ? <Button className='benefits-load-more' loading={moreMutation.isPending} disabled={moreMutation.isPending} onClick={() => moreMutation.mutate(nextSequence)}>加载更多位置</Button> : null}
    {status.recentRewards.length ? <><View className='benefits-section-head'><Text>最近可用奖励</Text><Text>服务端流水</Text></View><View className='aim-card'>{status.recentRewards.map((reward) => <View className='growth-rule' key={reward.id}><View><Text className='growth-rule__name'>{reward.sourceOrderNo}</Text><Text className='growth-rule__timing'>{formatDate(reward.releasedAt || reward.createdAt)}</Text></View><Text className='growth-rule__reward'>+¥{formatMoney(reward.amount)}</Text></View>)}</View></> : null}
    {status.recentOrders.length ? <><View className='benefits-section-head'><Text>最近参与订单</Text><Text>不含个人商品明细</Text></View><View className='aim-card'>{status.recentOrders.map((order) => <View className='growth-rule' key={order.orderId}><View><Text className='growth-rule__name'>{order.orderNo}</Text><Text className='growth-rule__timing'>{formatDate(order.createdAt)} · {queueOrderStatusLabel(order.status)}</Text></View><Text className='growth-rule__reward'>¥{formatMoney(order.availableReceivedAmount)}</Text></View>)}</View></> : null}
    <Text className='benefits-note'>奖励返回、售后期与作废状态由服务端统一处理，本页不做本地估算。</Text>
  </View>;
}
