import { Button, Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import type { GroupBuyActivity, GroupBuyCurrentInstance } from '../types';
import {
  availableGroupBuyStock,
  formatGroupBuyMoney,
  groupBuyItems,
  groupBuyProgress,
  groupBuyRemainingText,
  isGroupBuyActivityExpired,
} from '../utils';
import './group-buy-shared.scss';

export function GroupBuyAuthGate({ returnUrl, description }: { returnUrl: string; description: string }) {
  return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description={description} actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}` })} /></View>;
}

export function GroupBuyClock({ endAt, onExpire }: { endAt?: string | null; onExpire?: () => void }) {
  const [, tick] = useState(0);
  const onExpireRef = useRef(onExpire);
  const notifiedEndAt = useRef<string | null>();
  onExpireRef.current = onExpire;
  const expired = !endAt || new Date(endAt).getTime() <= Date.now();
  useEffect(() => {
    if (!endAt || expired) return undefined;
    const timer = setInterval(() => tick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, [endAt, expired]);
  useEffect(() => {
    if (!expired || !endAt || notifiedEndAt.current === endAt) return;
    notifiedEndAt.current = endAt;
    onExpireRef.current?.();
  }, [endAt, expired]);
  return <Text className={expired ? 'group-buy-clock group-buy-clock--ended' : 'group-buy-clock'}>{groupBuyRemainingText(endAt)}</Text>;
}

export function GroupBuyActivityCard({ activity, shareCode }: { activity: GroupBuyActivity; shareCode?: string }) {
  const stock = availableGroupBuyStock(activity);
  const unavailable = isGroupBuyActivityExpired(activity) || stock <= 0;
  const detailUrl = `/packages/group-buy/activity-detail/index?activityId=${encodeURIComponent(activity.id)}${shareCode ? `&shareCode=${encodeURIComponent(shareCode)}` : ''}`;
  return <View className='group-buy-product aim-card' onClick={() => Taro.navigateTo({ url: detailUrl })}>
    <View className='group-buy-product__visual'>
      {activity.product.imageUrl ? <Image className='group-buy-product__image' src={activity.product.imageUrl} mode='aspectFill' lazyLoad /> : <View className='group-buy-product__placeholder'>团</View>}
      <View className='group-buy-product__badge'>{activity.freeShipping ? '包邮' : '按配置运费'}</View>
    </View>
    <View className='group-buy-product__body'>
      <Text className='group-buy-product__title'>{activity.title}</Text>
      <Text className='group-buy-product__summary'>{activity.itemSummary || `${activity.product.title} · ${activity.sku.title}`}</Text>
      <GroupBuyClock endAt={activity.endAt} />
      <View className='group-buy-product__footer'>
        <View><Text className='group-buy-product__price'>¥{formatGroupBuyMoney(activity.price)}</Text><Text className='group-buy-product__stock'>{unavailable ? '暂不可购' : `可购 ${stock} 份`}</Text></View>
        <Button className='group-buy-product__button' disabled={unavailable}>查看详情</Button>
      </View>
    </View>
  </View>;
}

export function GroupBuyItems({ activity }: { activity: GroupBuyActivity }) {
  const items = groupBuyItems(activity);
  return <View className='group-buy-items'>{items.map((item) => <View className='group-buy-item' key={`${item.productId}:${item.skuId}`}>
    {item.imageUrl ? <Image className='group-buy-item__image' src={item.imageUrl} mode='aspectFill' lazyLoad /> : <View className='group-buy-item__placeholder'>农</View>}
    <View className='group-buy-item__copy'><Text className='group-buy-item__title'>{item.productTitle}</Text><Text className='group-buy-item__meta'>{item.skuTitle}　×{item.quantity}</Text></View>
  </View>)}</View>;
}

export function GroupBuyProgress({ current }: { current: GroupBuyCurrentInstance }) {
  const progress = groupBuyProgress(current);
  const states = useMemo(() => Array.from({ length: progress.target }, (_, index) => {
    const sequence = index + 1;
    const referral = current.referrals.find((item) => item.effectiveSequence === sequence || item.candidateSequence === sequence);
    return referral?.status === 'VALID' ? 'valid' : referral?.status === 'CANDIDATE' ? 'pending' : 'empty';
  }), [current.referrals, progress.target]);
  return <View className='group-buy-progress'>
    <View className='group-buy-progress__summary'><View><Text>{progress.locked}/{progress.target}</Text><Text>已锁名额</Text></View><View><Text>{progress.valid}/{progress.target}</Text><Text>已确认有效</Text></View><View><Text>{current.candidateCount || progress.remaining}</Text><Text>{current.candidateCount ? '待确认订单' : '剩余名额'}</Text></View></View>
    <View className='group-buy-progress__rail'>{states.map((state, index) => <View className='group-buy-progress__step' key={`${index}-${state}`}><View className={`group-buy-progress__dot group-buy-progress__dot--${state}`}>{state === 'valid' ? '✓' : state === 'pending' ? '时' : index + 1}</View><Text>{state === 'valid' ? '已有效' : state === 'pending' ? '待确认' : `第 ${index + 1} 位`}</Text></View>)}</View>
  </View>;
}
