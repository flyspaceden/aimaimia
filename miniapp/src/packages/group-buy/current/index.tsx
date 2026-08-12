import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter, useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { queryClient } from '@/query/client';
import { useAuthStore } from '@/store/auth';
import { GroupBuyAuthGate, GroupBuyClock, GroupBuyProgress } from '../_components/group-buy-shared';
import { MiniGroupBuyRepo } from '../repo';
import { buildGroupBuySharePath, groupBuyProgress, isGroupBuyActivityExpired, resolveGroupBuyEntryCode } from '../utils';
import './index.scss';

const STATUS_COPY = {
  QUALIFICATION_PENDING: ['付款确认中', '支付结果确认后会立即生成本次团购推荐码。'],
  SHARING: ['本次分享进行中', '分享给微信好友，好友购买同款商品后会锁定推荐名额。'],
  COMPLETED: ['本次分享已完成', '全部推荐名额已完成，到账记录可在返还流水查看。'],
  TERMINATED: ['本次分享已结束', '已到账返还保留，未完成名额不再接受新订单。'],
  QUALIFICATION_ABANDONED: ['本次资格已放弃', '本次资格已关闭，可以重新选择团购商品。'],
  QUALIFICATION_INVALID: ['本次资格未生效', '支付未完成或资格未满足，没有生成推荐码。'],
  EXPIRED: ['本次分享已过期', '活动有效期已结束，推荐码不再接受新订单。'],
} as const;

export default function GroupBuyCurrentPage() {
  const router = useRouter();
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const currentQuery = useQuery({ queryKey: ['group-buy', 'current'], queryFn: MiniGroupBuyRepo.getCurrent, enabled: hydrated && loggedIn, staleTime: 0, refetchInterval: 15_000 });
  const currentState = currentQuery.data?.ok ? currentQuery.data.data : undefined;
  const current = currentState?.current;
  const code = current?.code?.status === 'ACTIVE' ? current.code.code : '';
  const sharePath = current && code ? buildGroupBuySharePath(code, current.activity.id) : '/packages/group-buy/activity-list/index';
  const progress = current ? groupBuyProgress(current) : undefined;
  const slotsFull = Boolean(progress && progress.remaining === 0);
  const canShare = Boolean(current?.status === 'SHARING' && code && !slotsFull && current.activity.status === 'ACTIVE' && !isGroupBuyActivityExpired(current.activity));
  const inboundShareCode = resolveGroupBuyEntryCode({
    shareCode: typeof router.params.shareCode === 'string' ? router.params.shareCode : undefined,
    code: typeof router.params.code === 'string' ? router.params.code : undefined,
    scene: typeof router.params.scene === 'string' ? router.params.scene : undefined,
  });
  const inboundActivityId = typeof router.params.activityId === 'string' ? router.params.activityId : '';

  useShareAppMessage(() => ({ title: current ? `${current.activity.title}｜邀请你参加 AI爱买买团购` : 'AI爱买买精选团购', path: sharePath }));
  useShareTimeline(() => ({ title: current ? `${current.activity.title}｜AI爱买买精选团购` : 'AI爱买买精选团购', query: current && code ? `activityId=${encodeURIComponent(current.activity.id)}&shareCode=${encodeURIComponent(code)}` : '' }));
  useDidShow(() => { if (useAuthStore.getState().accessToken) void currentQuery.refetch(); });
  useEffect(() => {
    if (!inboundShareCode) return;
    void Taro.redirectTo({
      url: `/packages/group-buy/activity-detail/index?${inboundActivityId ? `activityId=${encodeURIComponent(inboundActivityId)}&` : ''}shareCode=${encodeURIComponent(inboundShareCode)}`,
    });
  }, [inboundActivityId, inboundShareCode]);

  const endMutation = useMutation({
    mutationFn: async ({ mode, instanceId }: { mode: 'terminate' | 'abandon'; instanceId: string }) => mode === 'terminate' ? MiniGroupBuyRepo.terminateCurrent() : MiniGroupBuyRepo.abandonCurrent(instanceId),
    onSuccess: async (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '处理失败', icon: 'none' }); return; }
      await queryClient.invalidateQueries({ queryKey: ['group-buy', 'current'] });
      await currentQuery.refetch();
      Taro.showToast({ title: '本次团购已处理', icon: 'success' });
    },
    onError: () => Taro.showToast({ title: '网络开小差了，请重试', icon: 'none' }),
  });

  const confirmEnd = async () => {
    if (!current || endMutation.isPending) return;
    const abandon = current.status === 'QUALIFICATION_PENDING';
    const modal = await Taro.showModal({
      title: abandon ? '放弃本次资格' : '结束本次分享',
      content: abandon ? '放弃后将关闭当前待确认资格；如支付结果仍不确定，请先到待支付订单确认。' : '结束后推荐码立即停止接受新订单，已到账返还保留，未完成推荐不再产生返还。',
      confirmText: abandon ? '确认放弃' : '确认结束',
      confirmColor: '#A04B42',
    });
    if (modal.confirm) endMutation.mutate({ mode: abandon ? 'abandon' : 'terminate', instanceId: current.id });
  };

  if (inboundShareCode) return <View className='group-buy-page'><CatalogFeedback kind='loading' /></View>;
  if (!hydrated) return <View className='group-buy-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <GroupBuyAuthGate returnUrl='/packages/group-buy/current/index' description='登录后才能查看团购推荐码和实时进度' />;
  if (currentQuery.isLoading) return <View className='group-buy-page'><CatalogFeedback kind='loading' /></View>;
  if (!currentQuery.data?.ok) return <View className='group-buy-page'><CatalogFeedback kind='error' title='当前团购加载失败' description={currentQuery.data && !currentQuery.data.ok ? currentQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => currentQuery.refetch()} /></View>;
  if (!current) return <View className='group-buy-page'><CatalogFeedback kind='empty' title='暂无进行中的团购' description='购买团购商品并支付成功后，会在这里生成专属推荐码' actionLabel='查看团购商品' onRetry={() => Taro.redirectTo({ url: '/packages/group-buy/activity-list/index' })} /></View>;

  const copy = STATUS_COPY[current.status];
  return <View className='group-buy-page'>
    <View className='group-buy-current__hero'>
      <Text className='group-buy-current__status'>{copy[0]}</Text>
      <Text className='group-buy-current__title'>{current.activity.title}</Text>
      <Text className='group-buy-current__description'>{slotsFull && current.status === 'SHARING' ? '推荐名额已全部锁定，正在等待好友确认收货。' : copy[1]}</Text>
      <GroupBuyClock endAt={current.activity.endAt} onExpire={() => currentQuery.refetch()} />
      <View className='group-buy-current__code-panel'><Text className='group-buy-current__code-label'>团购推荐码</Text><Text className='group-buy-current__code'>{code || (current.status === 'QUALIFICATION_PENDING' ? '生成中' : '不可用')}</Text><Text className='group-buy-current__code-hint'>推荐码仅限当前活动使用，付款时会自动核验活动和剩余名额。</Text></View>
      <View className='group-buy-current__share-row'><Button className='group-buy-current__copy' disabled={!canShare} onClick={() => code && Taro.setClipboardData({ data: code })}>复制推荐码</Button><Button className='group-buy-current__share' disabled={!canShare} openType='share'>分享给好友</Button></View>
    </View>

    <View className='group-buy-card aim-card'><View className='group-buy-card__heading'><Text>推荐进度</Text><Text>实时更新</Text></View><GroupBuyProgress current={current} /><Text className='group-buy-notice'>好友付款后先锁定名额并冻结返还，确认收货后才释放到账。分享按钮不会提示“分享成功”，购买和返还结果以页面记录为准。</Text></View>

    <View className='group-buy-card aim-card'><View className='group-buy-card__heading'><Text>账户与订单</Text><Text>只读入口</Text></View><View className='group-buy-current__nav'><View onClick={() => Taro.navigateTo({ url: '/packages/group-buy/rebate-ledgers/index' })}><Text>返还流水</Text><Text>查看冻结、释放和失效记录</Text></View><View onClick={() => Taro.navigateTo({ url: '/packages/orders/order-list/index' })}><Text>团购订单</Text><Text>在订单中心查看履约状态</Text></View></View></View>

    {current.status === 'SHARING' || current.status === 'QUALIFICATION_PENDING' ? <Button className='group-buy-danger' loading={endMutation.isPending} disabled={endMutation.isPending} onClick={confirmEnd}>{current.status === 'QUALIFICATION_PENDING' ? '放弃本次资格' : '结束本次分享'}</Button> : null}
    {!currentState?.occupiesSlot ? <Button className='group-buy-secondary' onClick={() => Taro.redirectTo({ url: '/packages/group-buy/activity-list/index' })}>查看新的团购商品</Button> : null}
  </View>;
}
