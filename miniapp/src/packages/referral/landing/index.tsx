import { Button, Text, View } from '@tarojs/components';
import Taro, { useRouter, useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { useAuthStore } from '@/store/auth';
import { ReferralRepo } from '../repo';
import { buildMiniappInvitePath, normalizeInviteCode, preferredInviteKind } from '../utils';
import './index.scss';

export default function ReferralLandingPage() {
  const router = useRouter();
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const code = normalizeInviteCode(typeof router.params.code === 'string' ? router.params.code : undefined);
  const rawKind = typeof router.params.kind === 'string' ? router.params.kind : undefined;
  const kind = code ? preferredInviteKind(rawKind, code) : 'normal';
  const attemptedRef = useRef(false);
  const sharePath = code ? buildMiniappInvitePath(code, kind) : '/pages/home/index';
  useShareAppMessage(() => ({ title: '和我一起在 AI爱买买发现产地好物', path: sharePath }));
  useShareTimeline(() => ({ title: '和我一起在 AI爱买买发现产地好物', query: code ? `code=${encodeURIComponent(code)}&kind=${kind}` : '' }));

  const bindMutation = useMutation({
    mutationFn: () => ReferralRepo.bindAuto(code!, kind),
  });
  useEffect(() => {
    attemptedRef.current = false;
  }, [authRevision]);
  useEffect(() => {
    if (!hydrated || !loggedIn || !code || attemptedRef.current) return;
    attemptedRef.current = true;
    bindMutation.mutate();
    // 同一账号代际的同一邀请码只尝试一次，mutation 对象不触发重放。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRevision, code, hydrated, loggedIn]);

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!code) return <View className='aim-page referral-landing-feedback'><CatalogFeedback kind='error' title='邀请信息无效' description='请让好友重新分享小程序卡片' /></View>;
  if (!loggedIn) {
    const returnUrl = buildMiniappInvitePath(code, kind);
    return <View className='aim-page referral-landing-page'>
      <View className='referral-landing-orbit'><Text>爱</Text></View>
      <Text className='referral-landing-eyebrow'>好友邀请</Text>
      <Text className='referral-landing-title'>一起发现源头好物</Text>
      <Text className='referral-landing-copy'>登录后，平台会使用这次分享中的推荐码建立推荐关系。已有关系不会被替换。</Text>
      <Button className='referral-landing-action' onClick={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}` })}>微信登录并继续</Button>
      <Button className='referral-landing-ghost' onClick={() => Taro.switchTab({ url: '/pages/home/index' })}>先逛逛</Button>
    </View>;
  }
  if (bindMutation.isPending || bindMutation.isIdle) return <View className='aim-page referral-landing-feedback'><CatalogFeedback kind='loading' /></View>;
  if (bindMutation.data && !bindMutation.data.ok) return <View className='aim-page referral-landing-feedback'>
    <CatalogFeedback kind='error' title='推荐关系未绑定' description={bindMutation.data.error.displayMessage || '分享码无效或当前账户已有推荐关系'} actionLabel={bindMutation.data.error.retryable ? '重试' : undefined} onRetry={bindMutation.data.error.retryable ? () => bindMutation.mutate() : undefined} />
    <Button className='referral-landing-home' onClick={() => Taro.switchTab({ url: '/pages/home/index' })}>进入 AI爱买买</Button>
  </View>;
  return <View className='aim-page referral-landing-page'>
    <View className='referral-landing-orbit referral-landing-orbit--done'><Text>✓</Text></View>
    <Text className='referral-landing-eyebrow'>绑定完成</Text>
    <Text className='referral-landing-title'>欢迎来到 AI爱买买</Text>
    <Text className='referral-landing-copy'>推荐关系已确认。现在可以正常浏览、下单和使用会员功能。</Text>
    <Button className='referral-landing-action' onClick={() => Taro.switchTab({ url: '/pages/home/index' })}>开始逛逛</Button>
  </View>;
}
