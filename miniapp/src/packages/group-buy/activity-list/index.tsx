import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { normalizeMiniProgramScanPath } from '@/packages/community/utils';
import { useAuthStore } from '@/store/auth';
import { GroupBuyActivityCard } from '../_components/group-buy-shared';
import { MiniGroupBuyRepo } from '../repo';
import { extractGroupBuyCodeFromScan } from '../utils';
import './index.scss';

export default function GroupBuyActivityListPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const activitiesQuery = useQuery({ queryKey: ['group-buy', 'activities'], queryFn: MiniGroupBuyRepo.listActivities, staleTime: 20_000 });
  const currentQuery = useQuery({ queryKey: ['group-buy', 'current'], queryFn: MiniGroupBuyRepo.getCurrent, enabled: hydrated && loggedIn, staleTime: 0 });
  const activities = activitiesQuery.data?.ok ? activitiesQuery.data.data.items : [];
  const current = currentQuery.data?.ok ? currentQuery.data.data.current : null;

  useDidShow(() => {
    void activitiesQuery.refetch();
    if (useAuthStore.getState().accessToken) void currentQuery.refetch();
  });

  const scan = async () => {
    try {
      const result = await Taro.scanCode({});
      if (result.scanType === 'WX_CODE') {
        const miniProgramPath = normalizeMiniProgramScanPath(result.path);
        if (!miniProgramPath) { Taro.showToast({ title: '无效的 AI爱买买小程序码', icon: 'none' }); return; }
        await Taro.navigateTo({ url: miniProgramPath });
        return;
      }
      const code = extractGroupBuyCodeFromScan(result.result);
      if (!code) { Taro.showToast({ title: '未识别到有效团购码', icon: 'none' }); return; }
      await Taro.navigateTo({ url: `/packages/group-buy/activity-detail/index?shareCode=${encodeURIComponent(code)}` });
    } catch (error) {
      const message = error && typeof error === 'object' && 'errMsg' in error ? String((error as { errMsg?: unknown }).errMsg || '') : '';
      if (!message.toLowerCase().includes('cancel')) Taro.showToast({ title: '扫码失败，请重试', icon: 'none' });
    }
  };

  if (!hydrated || activitiesQuery.isLoading || (loggedIn && currentQuery.isLoading)) return <View className='group-buy-page'><CatalogFeedback kind='loading' /></View>;
  if (!activitiesQuery.data?.ok) return <View className='group-buy-page'><CatalogFeedback kind='error' title='团购商品加载失败' description={activitiesQuery.data && !activitiesQuery.data.ok ? activitiesQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => activitiesQuery.refetch()} /></View>;
  if (loggedIn && currentQuery.data && !currentQuery.data.ok) return <View className='group-buy-page'><CatalogFeedback kind='error' title='当前团购加载失败' description={currentQuery.data.error.displayMessage || '请稍后重试'} onRetry={() => currentQuery.refetch()} /></View>;

  return <View className='group-buy-page'>
    <View className='group-buy-hero'>
      <Text className='group-buy-hero__eyebrow'>AI爱买买 · 指定商品活动</Text>
      <Text className='group-buy-hero__title'>精选团购</Text>
      <Text className='group-buy-hero__copy'>现金购买指定商品，付款成功后生成专属推荐码。团购不退换，仅收货后 24 小时质量问题补发。</Text>
      <View className='group-buy-hero__actions'>
        <Button className='group-buy-hero__primary' onClick={scan}>扫码参加</Button>
        {loggedIn ? <Button className='group-buy-hero__secondary' onClick={() => Taro.navigateTo({ url: '/packages/group-buy/rebate-ledgers/index' })}>返还流水</Button> : null}
      </View>
    </View>

    {current ? <View className='group-buy-current-teaser'>
      <View className='group-buy-current-teaser__top'><View><Text className='group-buy-current-teaser__title'>{current.activity.title}</Text><Text className='group-buy-current-teaser__copy'>{current.status === 'QUALIFICATION_PENDING' ? '付款结果确认中' : '本次团购分享进行中'}</Text></View><Text className='group-buy-current-teaser__badge'>我的团购</Text></View>
      <Button className='group-buy-current-teaser__button' onClick={() => Taro.navigateTo({ url: '/packages/group-buy/current/index' })}>查看推荐码与进度</Button>
    </View> : null}

    <View className='group-buy-section-head'><Text>当前团购商品</Text><Text>{activities.length} 款</Text></View>
    {!activities.length ? <CatalogFeedback kind='empty' title='暂无团购商品' description='活动上架后会在这里显示' /> : <View className='group-buy-list'>{activities.map((activity) => <GroupBuyActivityCard activity={activity} key={activity.id} />)}</View>}
  </View>;
}
