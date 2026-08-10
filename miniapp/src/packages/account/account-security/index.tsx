import { Button, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AccountFeedback } from '@/components/account-feedback';
import { maskPhone } from '@/components/account-utils';
import { changePassword, ensureWechatMiniProgramSession, logoutMiniapp } from '@/platform/auth';
import { UserRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import './index.scss';

export default function AccountSecurityPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const hasWechatSession = useAuthStore((state) => state.loginMethod === 'wechat-miniapp');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const profileQuery = useQuery({ queryKey: ['account', 'profile'], queryFn: UserRepo.profile, enabled: hydrated && loggedIn });
  const profile = profileQuery.data?.ok ? profileQuery.data.data : undefined;
  const mutation = useMutation({
    mutationFn: () => changePassword({ oldPassword, newPassword }),
    onSuccess: (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || result.error.message || '修改失败', icon: 'none' }); return; }
      setOldPassword(''); setNewPassword(''); setConfirmPassword('');
      Taro.showToast({ title: '密码已修改，其他设备已退出', icon: 'success', duration: 2400 });
    },
    onError: () => Taro.showToast({ title: '网络开小差了，请重试', icon: 'none' }),
  });
  const submit = () => {
    if (!oldPassword) { Taro.showToast({ title: '请输入旧密码', icon: 'none' }); return; }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/.test(newPassword)) { Taro.showToast({ title: '新密码需包含大小写字母和数字', icon: 'none' }); return; }
    if (newPassword !== confirmPassword) { Taro.showToast({ title: '两次新密码不一致', icon: 'none' }); return; }
    if (!mutation.isPending) mutation.mutate();
  };
  const logout = async () => {
    const modal = await Taro.showModal({ title: '退出登录', content: '仅退出当前小程序设备，不会注销账号。', confirmText: '退出', confirmColor: '#A04B42' });
    if (!modal.confirm) return;
    await logoutMiniapp();
    await Taro.switchTab({ url: '/pages/home/index' });
  };

  if (!hydrated) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><AccountFeedback kind='empty' title='请先登录' description='登录后才能管理账号安全' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/account/account-security/index')}` })} /></View>;
  if (profileQuery.isLoading) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (!profile) return <View className='aim-page'><AccountFeedback kind='error' title='账号信息加载失败' description={profileQuery.data && !profileQuery.data.ok ? profileQuery.data.error.displayMessage : '请稍后重试'} onAction={() => profileQuery.refetch()} /></View>;

  return <View className='aim-page security-page'>
    <View className='security-heading'><Text>登录身份</Text><Text>爱买买账号通用</Text></View>
    <View className='security-card aim-card'><View className={profile.phone ? 'security-row' : 'security-row security-row--action'} onClick={() => { if (!profile.phone) void Taro.navigateTo({ url: '/packages/account/account-bind-phone/index' }); }}><Text>手机号</Text><Text>{profile.phone ? maskPhone(profile.phone) : '未绑定，去绑定 ›'}</Text></View><View className='security-row'><Text>微信</Text><Text>{profile.wechatBound ? profile.wechatNickname || '已绑定' : '未绑定'}</Text></View><View className='security-row' onClick={() => { if (!hasWechatSession) void ensureWechatMiniProgramSession('/packages/account/account-security/index'); }}><Text>当前小程序会话</Text><Text>{hasWechatSession ? '微信身份已验证' : '手机号会话，点击验证微信 ›'}</Text></View></View>
    <View className='security-heading'><Text>修改密码</Text><Text>修改后其他设备会退出</Text></View>
    <View className='security-card aim-card'><Input className='security-input' password value={oldPassword} maxlength={128} placeholder='旧密码' onInput={(event) => setOldPassword(event.detail.value)} /><Input className='security-input' password value={newPassword} maxlength={128} placeholder='新密码（含大小写字母和数字）' onInput={(event) => setNewPassword(event.detail.value)} /><Input className='security-input' password value={confirmPassword} maxlength={128} placeholder='再次输入新密码' onInput={(event) => setConfirmPassword(event.detail.value)} /><Button className='security-primary' disabled={mutation.isPending} loading={mutation.isPending} onClick={submit}>{mutation.isPending ? '提交中...' : '确认修改密码'}</Button></View>
    <View className='security-heading'><Text>危险操作</Text><Text>请谨慎处理</Text></View>
    <View className='security-card aim-card'><View className='security-danger' onClick={() => Taro.navigateTo({ url: '/packages/account/account-deletion/index' })}><View><Text>注销账号</Text><Text>立即生效且不可恢复</Text></View><Text>›</Text></View></View>
    <Button className='security-logout' onClick={logout}>退出当前设备</Button>
  </View>;
}
