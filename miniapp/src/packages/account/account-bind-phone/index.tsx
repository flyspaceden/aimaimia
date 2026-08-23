import { Button, Input, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AccountFeedback } from '@/components/account-feedback';
import { isMainlandPhone, isSmsCode } from '@/components/account-utils';
import { queryClient } from '@/query/client';
import { UserRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import './index.scss';

export default function AccountBindPhonePage() {
  const router = useRouter();
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const profileQuery = useQuery({
    queryKey: ['account', 'profile'],
    queryFn: UserRepo.profile,
    enabled: hydrated && loggedIn,
  });
  const profile = profileQuery.data?.ok ? profileQuery.data.data : undefined;

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const bindMutation = useMutation({
    mutationFn: () => UserRepo.bindPhone(phone.trim(), code.trim()),
    onSuccess: async (result) => {
      if (!result.ok || !result.data.ok) {
        Taro.showToast({ title: !result.ok ? result.error.displayMessage || '绑定失败' : '绑定失败', icon: 'none' });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['account', 'profile'] });
      Taro.showToast({ title: '绑定成功', icon: 'success' });
      setTimeout(() => { void Taro.navigateBack(); }, 420);
    },
    onError: () => Taro.showToast({ title: '网络开小差了，请重试', icon: 'none' }),
  });
  const sendCode = async () => {
    if (sending || countdown > 0) return;
    if (!isMainlandPhone(phone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }
    setSending(true);
    const result = await UserRepo.sendBindPhoneCode(phone.trim());
    setSending(false);
    if (!result.ok || !result.data.ok) {
      Taro.showToast({ title: !result.ok ? result.error.displayMessage || '验证码发送失败' : '验证码发送失败', icon: 'none' });
      return;
    }
    setCountdown(60);
    Taro.showToast({ title: '验证码已发送', icon: 'success' });
  };
  const submit = () => {
    if (!isMainlandPhone(phone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }
    if (!isSmsCode(code)) {
      Taro.showToast({ title: '请输入 6 位短信验证码', icon: 'none' });
      return;
    }
    if (!bindMutation.isPending) bindMutation.mutate();
  };

  if (!hydrated) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><AccountFeedback kind='empty' title='请先登录' description='登录后才能为当前账号绑定手机号' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/account/account-bind-phone/index')}` })} /></View>;
  if (profileQuery.isLoading) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (!profile) return <View className='aim-page'><AccountFeedback kind='error' title='账号信息加载失败' description={profileQuery.data && !profileQuery.data.ok ? profileQuery.data.error.displayMessage : '请稍后重试'} onAction={() => profileQuery.refetch()} /></View>;
  if (profile.phone) return <View className='aim-page bind-phone-finished'><View className='bind-phone-finished__mark'>✓</View><Text className='bind-phone-finished__title'>手机号已绑定</Text><Text className='bind-phone-finished__copy'>当前账号无需重复绑定；暂不支持在这里换绑或解绑。</Text><Button onClick={() => router.params.fromLogin === '1' ? Taro.switchTab({ url: '/pages/me/index' }) : Taro.navigateBack()}>返回账号与安全</Button></View>;

  return <View className='aim-page bind-phone-page'>
    <View className='bind-phone-intro aim-card'><View className='bind-phone-intro__mark'>机</View><View><Text>为账号绑定手机号</Text><Text>绑定后可直接使用该手机号登录此账号</Text></View></View>
    <View className='bind-phone-card aim-card'>
      <View className='bind-phone-field'><Text>手机号</Text><Input type='number' maxlength={11} value={phone} placeholder='请输入本人手机号' onInput={(event) => setPhone(event.detail.value.replace(/\D/g, '').slice(0, 11))} /></View>
      <View className='bind-phone-field'><Text>验证码</Text><View className='bind-phone-code'><Input type='number' maxlength={6} value={code} placeholder='6 位短信验证码' onInput={(event) => setCode(event.detail.value.replace(/\D/g, '').slice(0, 6))} /><Button disabled={sending || countdown > 0 || !isMainlandPhone(phone)} onClick={() => { void sendCode(); }}>{sending ? '发送中' : countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}</Button></View></View>
    </View>
    <Button className='bind-phone-submit' loading={bindMutation.isPending} disabled={bindMutation.isPending || !isMainlandPhone(phone) || !isSmsCode(code)} onClick={submit}>{bindMutation.isPending ? '提交中...' : '确认绑定'}</Button>
    <Text className='bind-phone-note'>一个账号只能绑定一个手机号，绑定后暂不支持换绑或解绑。请确认手机号属于本人后再提交。</Text>
  </View>;
}
