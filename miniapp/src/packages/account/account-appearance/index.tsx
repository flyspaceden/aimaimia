import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AccountFeedback } from '@/components/account-feedback';
import { PRESET_AVATARS, ProfileAvatar, presetAvatarId } from '@/components/profile-avatar';
import { UserRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import { BenefitsRepo } from '../../benefits/repos';
import './index.scss';

type FrameId = 'default' | 'vip';

export default function AccountAppearancePage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const userId = useAuthStore((state) => state.userId || '');
  const authRevision = useAuthStore((state) => state.revision);
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: ['account', 'profile', authRevision], queryFn: UserRepo.profile, enabled: hydrated && loggedIn, staleTime: 0 });
  const memberQuery = useQuery({ queryKey: ['benefits', 'member', authRevision], queryFn: BenefitsRepo.getMember, enabled: hydrated && loggedIn, staleTime: 0 });
  const profile = profileQuery.data?.ok ? profileQuery.data.data : undefined;
  const profileId = profile?.id;
  const profileAvatar = profile?.avatar;
  const profileFrameType = profile?.avatarFrame?.type;
  const isVip = memberQuery.data?.ok && memberQuery.data.data.tier === 'VIP';
  const [avatar, setAvatar] = useState('preset://sprout');
  const [frame, setFrame] = useState<FrameId>('default');
  const [uploading, setUploading] = useState(false);
  const mounted = useRef(true);
  const uploadGeneration = useRef(0);

  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    uploadGeneration.current += 1;
    setAvatar('preset://sprout');
    setFrame('default');
    setUploading(false);
  }, [authRevision, userId]);
  useEffect(() => {
    if (!profileId) return;
    setAvatar(profileAvatar || 'preset://sprout');
    setFrame(profileFrameType === 'vip' ? 'vip' : 'default');
  }, [profileAvatar, profileFrameType, profileId]);

  const upload = async (filePath: string) => {
    if (uploading) return;
    const generation = uploadGeneration.current + 1;
    uploadGeneration.current = generation;
    const revisionAtStart = authRevision;
    const userIdAtStart = userId;
    setUploading(true);
    try {
      const result = await UserRepo.uploadAvatar(filePath);
      const current = useAuthStore.getState();
      if (!mounted.current || uploadGeneration.current !== generation
        || current.revision !== revisionAtStart || current.userId !== userIdAtStart) return;
      if (!result.ok) {
        await Taro.showToast({ title: result.error.displayMessage || '头像上传失败', icon: 'none' });
        return;
      }
      setAvatar(result.data.url);
      await Taro.showToast({ title: '已选择，请保存', icon: 'none' });
    } finally {
      const current = useAuthStore.getState();
      if (mounted.current && uploadGeneration.current === generation
        && current.revision === revisionAtStart && current.userId === userIdAtStart) {
        setUploading(false);
      }
    }
  };
  const chooseMedia = async (sourceType: Array<'album' | 'camera'>) => {
    if (uploading) return;
    try {
      const selected = await Taro.chooseMedia({ count: 1, mediaType: ['image'], sourceType, sizeType: ['compressed'] });
      const filePath = selected.tempFiles?.[0]?.tempFilePath;
      if (filePath) await upload(filePath);
    } catch (error) {
      const message = error && typeof error === 'object' && 'errMsg' in error ? String((error as { errMsg?: unknown }).errMsg || '') : '';
      if (!/cancel/i.test(message)) await Taro.showToast({ title: '无法选择图片', icon: 'none' });
    }
  };
  const saveMutation = useMutation({
    mutationFn: (variables: { avatar: string; frame: FrameId; revision: number; userId: string }) =>
      UserRepo.updateProfile({ avatar: variables.avatar, avatarFrameId: variables.frame }),
    onSuccess: async (result, variables) => {
      const current = useAuthStore.getState();
      if (!mounted.current || current.revision !== variables.revision || current.userId !== variables.userId) return;
      if (!result.ok) { await Taro.showToast({ title: result.error.displayMessage || '保存失败', icon: 'none' }); return; }
      queryClient.setQueryData(['account', 'profile', variables.revision], result);
      await queryClient.invalidateQueries({ queryKey: ['account', 'profile'] });
      await Taro.showToast({ title: '头像设置已保存', icon: 'success' });
    },
    onError: (_error, variables) => {
      const current = useAuthStore.getState();
      if (mounted.current && current.revision === variables.revision && current.userId === variables.userId) {
        void Taro.showToast({ title: '网络异常，请重试', icon: 'none' });
      }
    },
  });

  if (!hydrated) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><AccountFeedback kind='empty' title='请先登录' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/account/account-appearance/index')}` })} /></View>;
  if (profileQuery.isLoading || memberQuery.isLoading) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (!profile || !profileQuery.data?.ok) return <View className='aim-page'><AccountFeedback kind='error' title='资料加载失败' onAction={() => profileQuery.refetch()} /></View>;

  return <View className='aim-page appearance-page'>
    <View className='appearance-preview aim-card'>
      <ProfileAvatar uri={avatar} name={profile.name} frameType={frame === 'vip' ? 'vip' : undefined} size='large' />
      <Text className='appearance-preview__name'>{profile.name}</Text>
      <Text className='appearance-preview__copy'>{presetAvatarId(avatar) ? '已选内置农业主题头像' : '已选自定义头像'}{frame === 'vip' ? ' · VIP 专属头像框' : ''}</Text>
    </View>

    <View className='appearance-heading'><Text>选择默认头像</Text><Text>8 款</Text></View>
    <View className='appearance-presets aim-card'>{PRESET_AVATARS.map((item) => {
      const uri = `preset://${item.id}`;
      return <View className={avatar === uri ? 'appearance-preset appearance-preset--active' : 'appearance-preset'} key={item.id} onClick={() => setAvatar(uri)}><ProfileAvatar uri={uri} name={item.label} /><Text>{item.label}</Text></View>;
    })}</View>

    <View className='appearance-heading'><Text>使用自己的头像</Text><Text>JPG / PNG / WebP</Text></View>
    <View className='appearance-upload aim-card'>
      <Button disabled={uploading} loading={uploading} onClick={() => { void chooseMedia(['album']); }}>从相册选择</Button>
      <Button disabled={uploading} onClick={() => { void chooseMedia(['camera']); }}>拍照</Button>
      <Button className='appearance-upload__wechat' openType='chooseAvatar' disabled={uploading} onChooseAvatar={(event) => { const path = event.detail.avatarUrl; if (path) void upload(path); }}>选择微信头像</Button>
      <Text>图片会上传到 AI爱买买的安全存储，保存后将在当前账号内更新。</Text>
    </View>

    <View className='appearance-heading'><Text>选择头像框</Text><Text>{isVip ? 'VIP 已解锁' : '会员权益'}</Text></View>
    <View className='appearance-frames'>
      <View className={frame === 'default' ? 'appearance-frame aim-card appearance-frame--active' : 'appearance-frame aim-card'} onClick={() => setFrame('default')}><ProfileAvatar uri={avatar} name={profile.name} /><View><Text>默认</Text><Text>所有用户可用</Text></View><Text>{frame === 'default' ? '已选' : '选择'}</Text></View>
      <View className={frame === 'vip' ? 'appearance-frame aim-card appearance-frame--active' : 'appearance-frame aim-card'} onClick={() => { if (isVip) setFrame('vip'); else void Taro.showToast({ title: 'VIP 专属头像框，请先开通 VIP', icon: 'none' }); }}><ProfileAvatar uri={avatar} name={profile.name} frameType='vip' /><View><Text>VIP 动态框</Text><Text>{isVip ? '会员专享' : '开通 VIP 解锁'}</Text></View><Text>{!isVip ? '未解锁' : frame === 'vip' ? '已选' : '选择'}</Text></View>
    </View>
    <Button className='appearance-save' loading={saveMutation.isPending} disabled={saveMutation.isPending} onClick={() => saveMutation.mutate({ avatar, frame, revision: authRevision, userId })}>保存头像设置</Button>
  </View>;
}
