import { Button, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { AccountFeedback } from '@/components/account-feedback';
import { ProfileAvatar } from '@/components/profile-avatar';
import { formatInterests, maskPhone, parseInterests, validateProfileDraft } from '@/components/account-utils';
import { UserRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import './index.scss';

type ProfileDraft = { name: string; location: string; interestsText: string };
const emptyDraft: ProfileDraft = { name: '', location: '', interestsText: '' };

export default function AccountProfilePage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: ['account', 'profile'], queryFn: UserRepo.profile, enabled: hydrated && loggedIn, staleTime: 60_000 });
  const profile = profileQuery.data?.ok ? profileQuery.data.data : undefined;
  const profileId = profile?.id;
  const profileName = profile?.name || '';
  const profileLocation = profile?.location || '';
  const profileInterestsText = formatInterests(profile?.interests ?? []);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);

  useEffect(() => {
    if (!profileId) return;
    setDraft({ name: profileName, location: profileLocation, interestsText: profileInterestsText });
  }, [profileId, profileInterestsText, profileLocation, profileName]);

  const interests = useMemo(() => parseInterests(draft.interestsText), [draft.interestsText]);
  const isDirty = Boolean(profile && (draft.name !== profileName || draft.location !== profileLocation || draft.interestsText !== profileInterestsText));
  const saveMutation = useMutation({
    mutationFn: () => UserRepo.updateProfile({ name: draft.name.trim(), location: draft.location.trim(), interests }),
    onSuccess: (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '保存失败', icon: 'none' }); return; }
      queryClient.setQueryData(['account', 'profile'], result);
      setDraft({ name: result.data.name, location: result.data.location, interestsText: formatInterests(result.data.interests) });
      Taro.showToast({ title: '资料已更新', icon: 'success' });
    },
    onError: () => Taro.showToast({ title: '网络开小差了，请重试', icon: 'none' }),
  });
  const save = () => {
    const error = profile ? validateProfileDraft({ ...profile, ...draft }) : '资料还未加载';
    if (error) { Taro.showToast({ title: error, icon: 'none' }); return; }
    if (!isDirty || saveMutation.isPending) return;
    saveMutation.mutate();
  };

  if (!hydrated) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><AccountFeedback kind='empty' title='请先登录' description='登录后才能查看和编辑个人资料' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/account/account-profile/index')}` })} /></View>;
  if (profileQuery.isLoading) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (!profileQuery.data || !profileQuery.data.ok) return <View className='aim-page'><AccountFeedback kind='error' title='资料加载失败' description={profileQuery.data && !profileQuery.data.ok ? profileQuery.data.error.displayMessage : '请稍后重试'} onAction={() => profileQuery.refetch()} /></View>;

  return <View className='aim-page account-profile-page'>
    <View className='account-profile-identity aim-card'>
      <View onClick={() => Taro.navigateTo({ url: '/packages/account/account-appearance/index' })}><ProfileAvatar uri={profile!.avatar} name={profile!.name} frameType={profile!.avatarFrame?.type} /></View>
      <View className='account-profile-identity__copy'><Text className='account-profile-identity__name'>{profile!.name}</Text><Text className='account-profile-identity__meta'>{maskPhone(profile!.phone)} · {profile!.wechatBound ? '微信已绑定' : '微信未绑定'}</Text>{profile!.buyerNo ? <View className='account-profile-identity__number' onClick={() => Taro.setClipboardData({ data: profile!.buyerNo! })}><Text>{profile!.buyerNo}</Text><Text>复制</Text></View> : null}</View>
    </View>

    <View className='account-profile-appearance aim-card' onClick={() => Taro.navigateTo({ url: '/packages/account/account-appearance/index' })}><View><Text>头像与装扮</Text><Text>选择默认头像、上传图片或设置 VIP 头像框</Text></View><Text>›</Text></View>

    <View className='account-profile-heading'><Text>偏好与信息</Text><Text>修改后 App 同步更新</Text></View>
    <View className='account-profile-form aim-card'>
      <View className='account-profile-field'><Text className='account-profile-field__label'>昵称</Text><Input className='account-profile-field__input' maxlength={12} value={draft.name} placeholder='请输入昵称' onInput={(event) => setDraft((value) => ({ ...value, name: event.detail.value }))} /><Text className='account-profile-field__count'>{draft.name.length}/12</Text></View>
      <View className='account-profile-field'><Text className='account-profile-field__label'>所在地</Text><Input className='account-profile-field__input' maxlength={20} value={draft.location} placeholder='例如：上海' onInput={(event) => setDraft((value) => ({ ...value, location: event.detail.value }))} /><Text className='account-profile-field__count'>{draft.location.length}/20</Text></View>
      <View className='account-profile-field'><Text className='account-profile-field__label'>兴趣标签</Text><Input className='account-profile-field__input' maxlength={80} value={draft.interestsText} placeholder='用逗号分隔，例如：有机蔬菜、蓝莓' onInput={(event) => setDraft((value) => ({ ...value, interestsText: event.detail.value }))} /><Text className='account-profile-field__tip'>最多保存 6 个标签</Text>{interests.length ? <View className='account-profile-tags'>{interests.map((interest) => <Text className='account-profile-tag' key={interest}>{interest}</Text>)}</View> : null}</View>
      <Button className={isDirty ? 'account-profile-save' : 'account-profile-save account-profile-save--disabled'} disabled={!isDirty || saveMutation.isPending} loading={saveMutation.isPending} onClick={save}>{saveMutation.isPending ? '保存中...' : '保存修改'}</Button>
    </View>
  </View>;
}
