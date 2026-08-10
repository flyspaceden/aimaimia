import { Button, Image, Text, View } from '@tarojs/components';
import Taro, { useRouter, useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { MiniProgramCodePanel } from '@/components/mini-program-code';
import { useAuthStore } from '@/store/auth';
import { GroupBuyClock, GroupBuyItems } from '../_components/group-buy-shared';
import { MiniGroupBuyRepo } from '../repo';
import {
  availableGroupBuyStock,
  buildGroupBuySharePath,
  formatGroupBuyMoney,
  isGroupBuyActivityExpired,
  resolveGroupBuyEntryCode,
} from '../utils';
import './index.scss';

const RULES = [
  '团购商品仅支持微信现金支付，不可使用平台红包、消费积分或团购返还余额抵扣。',
  '付款成功后立即生成专属团购推荐码；只有通过该码购买同款商品的其他用户才计入。',
  '好友付款后返还先冻结，好友确认收货后释放；未达到人数不产生对应返还。',
  '团购商品不支持取消、退款、退货或换货；收货后 24 小时质量问题可联系客服补发。',
  'VIP 用户购买团购后累计消费资产，普通用户不累计消费资产。',
];

export default function GroupBuyActivityDetailPage() {
  const router = useRouter();
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const activityId = typeof router.params.activityId === 'string' ? router.params.activityId : '';
  const shareCode = resolveGroupBuyEntryCode({
    shareCode: typeof router.params.shareCode === 'string' ? router.params.shareCode : undefined,
    code: typeof router.params.code === 'string' ? router.params.code : undefined,
    scene: typeof router.params.scene === 'string' ? router.params.scene : undefined,
  });
  const landingQuery = useQuery({ queryKey: ['group-buy', 'landing', shareCode], queryFn: () => MiniGroupBuyRepo.getLanding(shareCode!), enabled: Boolean(shareCode), staleTime: 0 });
  const activityQuery = useQuery({ queryKey: ['group-buy', 'activity', activityId], queryFn: () => MiniGroupBuyRepo.getActivity(activityId), enabled: Boolean(activityId && !shareCode), staleTime: 0 });
  const currentQuery = useQuery({ queryKey: ['group-buy', 'current'], queryFn: MiniGroupBuyRepo.getCurrent, enabled: hydrated && loggedIn, staleTime: 0 });
  const landing = landingQuery.data?.ok ? landingQuery.data.data : undefined;
  const activity = shareCode ? landing?.activity : activityQuery.data?.ok ? activityQuery.data.data : undefined;
  const currentState = currentQuery.data?.ok ? currentQuery.data.data : undefined;
  const sharePath = activity
    ? shareCode
      ? buildGroupBuySharePath(shareCode, activity.id)
      : `/packages/group-buy/activity-detail/index?activityId=${encodeURIComponent(activity.id)}`
    : '/packages/group-buy/activity-list/index';

  useShareAppMessage(() => ({ title: activity ? `${activity.title}｜爱买买精选团购` : '爱买买精选团购', path: sharePath }));
  useShareTimeline(() => ({ title: activity ? `${activity.title}｜爱买买精选团购` : '爱买买精选团购', query: activity ? `activityId=${encodeURIComponent(activity.id)}${shareCode ? `&shareCode=${encodeURIComponent(shareCode)}` : ''}` : '' }));

  const goCheckout = async () => {
    if (!activity) return;
    const returnUrl = `/packages/group-buy/activity-detail/index?activityId=${encodeURIComponent(activity.id)}${shareCode ? `&shareCode=${encodeURIComponent(shareCode)}` : ''}`;
    if (!loggedIn) { await Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}` }); return; }
    if (currentState?.occupiesSlot) {
      const modal = await Taro.showModal({ title: '当前已有团购', content: '同一时间只能保留一个团购资格。请先查看并处理当前团购。', confirmText: '查看团购', confirmColor: '#2E7D32' });
      if (modal.confirm) await Taro.navigateTo({ url: '/packages/group-buy/current/index' });
      return;
    }
    await Taro.navigateTo({ url: `/packages/group-buy/checkout/index?activityId=${encodeURIComponent(activity.id)}${shareCode ? `&shareCode=${encodeURIComponent(shareCode)}` : ''}` });
  };

  const loading = !hydrated || (shareCode ? landingQuery.isLoading : activityQuery.isLoading) || (loggedIn && currentQuery.isLoading);
  if (loading) return <View className='group-buy-page'><CatalogFeedback kind='loading' /></View>;
  if (!shareCode && !activityId) return <View className='group-buy-page'><CatalogFeedback kind='error' title='缺少团购信息' description='请返回团购列表重新选择' onRetry={() => Taro.redirectTo({ url: '/packages/group-buy/activity-list/index' })} /></View>;
  if (shareCode && (!landingQuery.data?.ok || !landing?.valid || !landing.activity)) return <View className='group-buy-page'><CatalogFeedback kind='error' title='团购推荐码不可用' description={landingQuery.data?.ok ? landing?.reason || '该推荐码已失效或名额已满' : landingQuery.data && !landingQuery.data.ok ? landingQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => Taro.redirectTo({ url: '/packages/group-buy/activity-list/index' })} /></View>;
  if (!shareCode && (!activityQuery.data?.ok || !activity)) return <View className='group-buy-page'><CatalogFeedback kind='error' title='团购商品加载失败' description={activityQuery.data && !activityQuery.data.ok ? activityQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => activityQuery.refetch()} /></View>;
  if (loggedIn && currentQuery.data && !currentQuery.data.ok) return <View className='group-buy-page'><CatalogFeedback kind='error' title='团购状态加载失败' description={currentQuery.data.error.displayMessage} onRetry={() => currentQuery.refetch()} /></View>;
  if (!activity) return null;

  const stock = availableGroupBuyStock(activity);
  const ended = isGroupBuyActivityExpired(activity);
  const unavailable = ended || activity.status !== 'ACTIVE' || stock <= 0;
  const cta = ended ? '活动已结束' : activity.status === 'PAUSED' ? '活动已暂停' : stock <= 0 ? '暂无库存' : '去付款';
  const ownsShareCode = Boolean(
    currentState?.current?.activity.id === activity.id
    && currentState.current.status === 'SHARING'
    && currentState.current.code?.status === 'ACTIVE',
  );

  return <View className='group-buy-detail'>
    <View className='group-buy-detail__cover'>
      {activity.product.imageUrl ? <Image className='group-buy-detail__cover-image' src={activity.product.imageUrl} mode='aspectFill' /> : <View className='group-buy-detail__cover-fallback'>团</View>}
      <View className='group-buy-detail__cover-shade' />
      <View className='group-buy-detail__cover-copy'><Text>{activity.title}</Text><Text>{activity.itemSummary || `${activity.product.title} · ${activity.sku.title}`}</Text></View>
    </View>
    <View className='group-buy-detail__content'>
      <View className='group-buy-card group-buy-detail__price-card aim-card'>
        <View className='group-buy-detail__price-row'><Text className='group-buy-detail__price'>¥{formatGroupBuyMoney(activity.price)}</Text><Text className='group-buy-detail__shipping'>{activity.freeShipping ? '本活动包邮' : '按配置收取运费'}</Text></View>
        <GroupBuyClock endAt={activity.endAt} />
        <Text className='group-buy-muted'>现金购买指定商品 · 可购 {stock} 份</Text>
      </View>
      {shareCode && landing?.inviter ? <View className='group-buy-inviter'><Text className='group-buy-inviter__mark'>邀</Text><Text className='group-buy-inviter__copy'>来自 {landing.inviter.nickname || landing.inviter.buyerNo || '分享用户'} 的团购分享。付款时会自动核验推荐码与活动。</Text></View> : null}
      {ownsShareCode ? <MiniProgramCodePanel kind='GROUP_BUY' /> : null}
      <View className='group-buy-card aim-card'><View className='group-buy-card__heading'><Text>包含商品</Text><Text>{activity.items?.length || 1} 项</Text></View><GroupBuyItems activity={activity} /></View>
      {activity.description?.trim() ? <View className='group-buy-card aim-card'><View className='group-buy-card__heading'><Text>商品详情</Text><Text>活动配置</Text></View><Text className='group-buy-muted group-buy-detail__description'>{activity.description.trim()}</Text></View> : null}
      <View className='group-buy-card aim-card'><View className='group-buy-card__heading'><Text>活动规则</Text><Text>付款前请阅读</Text></View><View className='group-buy-rules'>{RULES.map((rule, index) => <View className='group-buy-rule' key={rule}><Text className='group-buy-rule__index'>{index + 1}</Text><Text className='group-buy-rule__copy'>{rule}</Text></View>)}</View></View>
    </View>
    <View className='group-buy-detail__bar'><View className='group-buy-detail__bar-price'><Text>¥{formatGroupBuyMoney(activity.price)}</Text><Text>运费将在结算页确认</Text></View><Button className='group-buy-detail__pay' disabled={unavailable} onClick={goCheckout}>{cta}</Button></View>
  </View>;
}
