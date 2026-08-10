import { Button, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { useAuthStore } from '@/store/auth';
import { CommunityRepo } from '../repo';
import './index.scss';

const normalizeCode = (value?: string) => {
  const code = value?.trim().toUpperCase() || '';
  return /^[A-Z0-9]{3,40}$/.test(code) ? code : '';
};

export default function CaptainLandingPage() {
  const router = useRouter();
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const queryClient = useQueryClient();
  const code = normalizeCode(typeof router.params.code === 'string' ? router.params.code : undefined);
  const returnUrl = `/packages/community/captain-landing/index?code=${encodeURIComponent(code)}`;
  const landingQuery = useQuery({ queryKey: ['community', 'captain', 'landing', code], queryFn: () => CommunityRepo.captainLanding(code), enabled: Boolean(code), staleTime: 0 });
  const mutation = useMutation({
    mutationFn: () => CommunityRepo.bindCaptain(code),
    onSuccess: async (result) => {
      if (!result.ok) { await Taro.showToast({ title: result.error.displayMessage || '绑定失败', icon: 'none' }); return; }
      await queryClient.invalidateQueries({ queryKey: ['community', 'captain', 'profile', authRevision] });
    },
  });
  useEffect(() => {
    mutation.reset();
    // mutation 对象不应让同一账号代际重复 reset。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRevision]);

  if (!code) return <View className='aim-page'><CatalogFeedback kind='error' title='团长邀请无效' description='请让团长重新分享小程序卡片' /></View>;
  if (landingQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!landingQuery.data?.ok) return <View className='aim-page'><CatalogFeedback kind='error' title='团长邀请加载失败' description={landingQuery.data?.error.displayMessage || '请稍后重试'} onRetry={() => landingQuery.refetch()} /></View>;
  const landing = landingQuery.data.data;
  if (!landing.valid || !landing.enabled) return <View className='aim-page'><CatalogFeedback kind='error' title='团长码不可用' description={landing.reason || (landing.enabled ? '该团长码已失效' : '团长经营暂未开放')} /></View>;
  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='captain-landing'>
    <View className='captain-landing__orbit'><Text>团</Text></View><Text className='captain-landing__eyebrow'>{landing.programName || '团长经营计划'}</Text><Text className='captain-landing__title'>一起发现源头好物</Text><Text className='captain-landing__copy'>登录后可确认绑定这次团长关系。已有关系不会被小程序自行覆盖。</Text><Button className='captain-landing__primary' onClick={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}` })}>微信登录并继续</Button><Button className='captain-landing__ghost' onClick={() => Taro.switchTab({ url: '/pages/home/index' })}>先逛逛</Button>
  </View>;
  if (mutation.data?.ok) return <View className='captain-landing'><View className='captain-landing__orbit captain-landing__orbit--done'><Text>✓</Text></View><Text className='captain-landing__eyebrow'>关系已确认</Text><Text className='captain-landing__title'>团长关系已建立</Text><Text className='captain-landing__copy'>后续符合规则的订单与奖励会自动计入当前关系。</Text><Button className='captain-landing__primary' onClick={() => Taro.switchTab({ url: '/pages/home/index' })}>开始逛逛</Button></View>;
  return <View className='captain-landing'>
    <View className='captain-landing__orbit'><Text>团</Text></View><Text className='captain-landing__eyebrow'>{landing.programName || '团长经营计划'}</Text><Text className='captain-landing__title'>确认团长关系</Text><Text className='captain-landing__code'>{landing.code}</Text><Text className='captain-landing__copy'>小程序不展示分享人姓名等身份信息。点击确认后，平台会核验当前账号是否符合绑定条件。</Text><Button className='captain-landing__primary' loading={mutation.isPending} disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? '确认中...' : '确认绑定'}</Button><Button className='captain-landing__ghost' onClick={() => Taro.switchTab({ url: '/pages/home/index' })}>暂不绑定</Button>
  </View>;
}
