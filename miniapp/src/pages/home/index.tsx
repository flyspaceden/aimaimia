import { Button, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { formatMoney } from '@/components/commerce-utils';
import { ProfileAvatar } from '@/components/profile-avatar';
import { SeafoodImage } from '@/components/SeafoodImage';
import { cancelVoiceRecording, startVoiceRecording, stopVoiceRecording } from '@/platform/voice';
import { CartRepo, CheckoutRepo, UserRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import { BenefitsRepo } from '@/packages/benefits/repos';
import type { AiPageAction, AiVoiceIntent } from '@/packages/ai/types';
import { AiVoiceRepo } from '@/packages/ai/repo';
import { aiReply, candidateToIntent, resolveAiAction } from '@/packages/ai/intent';
import { MemberDigitalAssetRepo } from '@/packages/member/repos';
import './index.scss';

type VoicePhase = 'idle' | 'starting' | 'recording' | 'recognizing';

const openLogin = (returnUrl = '/pages/home/index') => Taro.navigateTo({
  url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}`,
});

export default function HomePage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [voiceIntent, setVoiceIntent] = useState<AiVoiceIntent>();
  const lifecycleRef = useRef(0);
  const finishingRef = useRef(false);
  const prepareRef = useRef<ReturnType<typeof AiVoiceRepo.prepare>>();

  const profileQuery = useQuery({
    queryKey: ['home', 'profile', authRevision],
    queryFn: UserRepo.profile,
    enabled: hydrated && loggedIn,
    staleTime: 60_000,
  });
  const cartQuery = useQuery({
    queryKey: ['commerce', 'cart', authRevision],
    queryFn: CartRepo.get,
    enabled: hydrated && loggedIn,
    staleTime: 15_000,
  });
  const pendingQuery = useQuery({
    queryKey: ['commerce', 'pending-checkout', authRevision],
    queryFn: CheckoutRepo.getPending,
    enabled: hydrated && loggedIn,
    refetchInterval: 30_000,
  });
  const memberQuery = useQuery({
    queryKey: ['benefits', 'member', authRevision],
    queryFn: BenefitsRepo.getMember,
    enabled: hydrated && loggedIn,
    staleTime: 60_000,
  });
  const giftsQuery = useQuery({
    queryKey: ['benefits', 'vip-gifts', 'home'],
    queryFn: BenefitsRepo.getVipGiftOptions,
    staleTime: 3 * 60_000,
  });
  const digitalAssetQuery = useQuery({
    queryKey: ['member', 'digital-assets', 'summary', authRevision],
    queryFn: MemberDigitalAssetRepo.getSummary,
    enabled: hydrated && loggedIn,
    staleTime: 60_000,
  });

  const profile = profileQuery.data?.ok ? profileQuery.data.data : undefined;
  const member = memberQuery.data?.ok ? memberQuery.data.data : undefined;
  const pending = pendingQuery.data?.ok ? pendingQuery.data.data : null;
  const cartCount = cartQuery.data?.ok
    ? cartQuery.data.data.items.reduce((total, item) => total + item.quantity, 0)
    : 0;
  const assetRank = digitalAssetQuery.data?.ok
    ? digitalAssetQuery.data.data.assetRank
    : null;
  const vipPackages = giftsQuery.data?.ok ? giftsQuery.data.data.packages : [];
  const vipCards = vipPackages.flatMap((pkg) => {
    const gift = pkg.giftOptions.find((item) => item.available);
    return gift ? [{ pkg, gift }] : [];
  }).slice(0, 3);

  const refresh = () => {
    if (useAuthStore.getState().accessToken) {
      void Promise.all([
        profileQuery.refetch(),
        cartQuery.refetch(),
        pendingQuery.refetch(),
        memberQuery.refetch(),
        digitalAssetQuery.refetch(),
      ]);
    }
    void giftsQuery.refetch();
  };
  useDidShow(refresh);

  const discardRecording = () => {
    lifecycleRef.current += 1;
    finishingRef.current = false;
    prepareRef.current = undefined;
    cancelVoiceRecording();
    setVoicePhase('idle');
  };
  useDidHide(discardRecording);
  useUnload(discardRecording);

  const finishRecording = async (operation = lifecycleRef.current) => {
    if (finishingRef.current || voicePhase !== 'recording') return;
    finishingRef.current = true;
    setVoicePhase('recognizing');
    try {
      const recording = await stopVoiceRecording();
      if (operation !== lifecycleRef.current) return;
      if (recording.durationMs < 650) {
        Taro.showToast({ title: '说话时间太短，请再试一次', icon: 'none' });
        return;
      }
      const prepared = await prepareRef.current;
      if (operation !== lifecycleRef.current) return;
      const result = await AiVoiceRepo.recognize(recording, {
        prepareId: prepared?.ok ? prepared.data.prepareId : undefined,
        page: 'miniapp-home',
      });
      if (!result.ok) {
        Taro.showToast({ title: result.error.displayMessage || '没有听清楚，请再试一次', icon: 'none' });
        return;
      }
      setVoiceIntent(result.data);
    } catch (error) {
      if (operation === lifecycleRef.current) {
        Taro.showToast({
          title: error instanceof Error && error.message ? error.message : '录音失败，请检查麦克风权限',
          icon: 'none',
        });
      }
    } finally {
      if (operation === lifecycleRef.current) {
        finishingRef.current = false;
        prepareRef.current = undefined;
        setVoicePhase('idle');
      }
    }
  };

  const beginRecording = async () => {
    if (voicePhase !== 'idle') return;
    const operation = lifecycleRef.current + 1;
    lifecycleRef.current = operation;
    setVoiceIntent(undefined);
    setVoicePhase('starting');
    prepareRef.current = AiVoiceRepo.prepare();
    try {
      await startVoiceRecording();
      if (operation === lifecycleRef.current) setVoicePhase('recording');
    } catch (error) {
      if (operation === lifecycleRef.current) {
        prepareRef.current = undefined;
        setVoicePhase('idle');
        Taro.showToast({
          title: error instanceof Error && error.message ? error.message : '无法开始录音',
          icon: 'none',
        });
      }
    }
  };

  const performAction = async (action: AiPageAction | null) => {
    if (!action?.url) return;
    if (action.requiresAuth && !loggedIn) {
      await openLogin('/pages/home/index');
      return;
    }
    if (action.mode === 'switchTab') await Taro.switchTab({ url: action.url });
    else await Taro.navigateTo({ url: action.url });
  };
  const voiceAction = voiceIntent ? resolveAiAction(voiceIntent) : null;
  const voiceHint = voicePhase === 'starting'
    ? '正在打开麦克风…'
    : voicePhase === 'recording'
      ? '松开发送语音'
      : voicePhase === 'recognizing'
        ? '正在理解你的需求…'
        : '长按光球，说出你想买的';

  return (
    <View className='aim-page home-page'>
      <View className='home-particles' aria-hidden>
        {Array.from({ length: 12 }, (_, index) => <View className={`home-particle home-particle--${index + 1}`} key={index} />)}
      </View>

      {pending ? (
        <View
          className='home-pending aim-card'
          hoverClass='home-pending--pressed'
          onClick={() => Taro.navigateTo({ url: `/packages/commerce/checkout-pending/index?sessionId=${encodeURIComponent(pending.sessionId)}` })}
        >
          <View className='home-pending__mark'>待</View>
          <View className='home-pending__copy'>
            <Text className='home-pending__title'>有一笔支付尚未完成</Text>
            <Text className='home-pending__meta'>{pending.preview.firstItemTitle} · ¥{formatMoney(pending.expectedTotal)}</Text>
          </View>
          <Text className='home-pending__action'>继续支付 ›</Text>
        </View>
      ) : null}

      <View className='home-heading'>
        <Text className='home-heading__statement'>消费者就是生产力{`\n`}是社会价值的创造者</Text>
        <View
          className='home-cart aim-card'
          hoverClass='home-cart--pressed'
          onClick={() => loggedIn ? Taro.navigateTo({ url: '/packages/commerce/cart/index' }) : openLogin('/packages/commerce/cart/index')}
        >
          <Text className='home-cart__glyph'>购</Text>
          {cartCount > 0 ? <Text className='home-cart__badge'>{cartCount > 99 ? '99+' : cartCount}</Text> : null}
        </View>
      </View>

      {!loggedIn ? (
        <View className='home-identity home-identity--login aim-card'>
          <View className='home-identity__copy'>
            <Text className='home-identity__title'>登录/注册</Text>
            <Text className='home-identity__meta'>登录后解锁会员权益与订单追踪</Text>
          </View>
          <View className='home-identity__actions'>
            <Button className='home-identity__scan' onClick={() => Taro.navigateTo({ url: '/packages/community/scanner/index' })}>扫一扫</Button>
            <Button className='home-identity__login-button' onClick={() => openLogin()}>立即登录/注册</Button>
          </View>
        </View>
      ) : profileQuery.isLoading ? <CatalogFeedback kind='loading' />
        : profile ? (
          <View className='home-identity home-identity--profile aim-card'>
            <View className='home-identity__top'>
              <View onClick={() => Taro.navigateTo({ url: '/packages/account/account-appearance/index' })}>
                <ProfileAvatar uri={profile.avatar} name={profile.name} frameType={profile.avatarFrame?.type} />
              </View>
              <View className='home-identity__profile-copy'>
                <Text className='home-identity__name'>{profile.name}</Text>
                <Text className='home-identity__buyer-no' onClick={() => profile.buyerNo && Taro.setClipboardData({ data: profile.buyerNo })}>
                  {profile.buyerNo ? `ID: ${profile.buyerNo} · 复制` : '用户编号生成中'}
                </Text>
              </View>
              <View className='home-identity__profile-actions'>
                <Text onClick={() => Taro.navigateTo({ url: '/packages/community/scanner/index' })}>扫一扫</Text>
                <Text onClick={() => Taro.navigateTo({ url: '/packages/account/account-profile/index' })}>编辑</Text>
              </View>
            </View>
            <View className='home-identity__bottom'>
              <Text onClick={() => Taro.navigateTo({ url: '/packages/referral/center/index' })}>推荐中心</Text>
              <Text onClick={() => Taro.navigateTo({ url: '/packages/member/digital-assets/index' })}>数字资产排行榜：{assetRank ?? '未上榜'}</Text>
            </View>
          </View>
        ) : <CatalogFeedback kind='error' title='资料加载失败' description='请稍后重试' onRetry={() => profileQuery.refetch()} />}

      {member?.tier === 'VIP' && member.referralCode ? (
        <View className='home-referral aim-card' onClick={() => Taro.navigateTo({ url: '/packages/referral/center/index' })}>
          <View className='home-referral__icon'><SeafoodImage name='icon-order-scallop' /></View>
          <View className='home-referral__copy'><Text>推荐好友开通 VIP</Text><Text>邀请好友 · 一起享 VIP 礼遇</Text></View>
          <Text className='home-referral__action'>去分享</Text>
        </View>
      ) : null}

      <View className='home-search aim-card' hoverClass='home-search--pressed' onClick={() => Taro.navigateTo({ url: '/packages/commerce/catalog-search/index' })}>
        <SeafoodImage className='home-search__character' name='icon-order-puffer' />
        <View className='home-search__divider' />
        <Text className='home-search__prompt'>搜索商品，或问我...</Text>
        <Text className='home-search__mic'>声</Text>
      </View>

      <View className='home-ai-stage'>
        <SeafoodImage className='home-ai-stage__lobster' name='home-lobster' />
        <View
          className={`home-ai-orb home-ai-orb--${voicePhase}`}
          hoverClass='home-ai-orb--pressed'
          onLongPress={() => { void beginRecording(); }}
          onTouchEnd={() => { void finishRecording(); }}
          onTouchCancel={() => { void finishRecording(); }}
        >
          <View className='home-ai-orb__ring home-ai-orb__ring--outer' />
          <View className='home-ai-orb__ring home-ai-orb__ring--inner' />
          <View className='home-ai-orb__core' />
          <Text className='home-ai-orb__label'>{voicePhase === 'recording' ? '正在听' : voicePhase === 'recognizing' ? '思考中' : 'AI 助手'}</Text>
        </View>
        <SeafoodImage className='home-ai-stage__crab' name='home-king-crab' />
      </View>
      <Text className='home-ai-hint'>{voiceHint}</Text>

      {voiceIntent ? (
        <View className='home-ai-result aim-card'>
          <Text className='home-ai-result__heard'>我听到 “{voiceIntent.transcript}”</Text>
          <Text className='home-ai-result__reply'>{aiReply(voiceIntent)}</Text>
          {voiceIntent.type === 'clarify' && voiceIntent.clarify?.candidates.length ? (
            <View className='home-ai-result__choices'>
              {voiceIntent.clarify.candidates.slice(0, 4).map((candidate) => (
                <Text className='home-ai-result__choice' key={candidate.id} onClick={() => setVoiceIntent(candidateToIntent(candidate, voiceIntent.transcript))}>{candidate.label}</Text>
              ))}
            </View>
          ) : null}
          {voiceAction ? <Button className='home-ai-result__action' onClick={() => { void performAction(voiceAction); }}>{voiceAction.label} ›</Button> : null}
        </View>
      ) : null}

      {vipCards.length ? (
        <View className='home-vip'>
          <View className='home-vip__header'><Text>精选 VIP 礼包</Text><Text>左右滑动查看</Text></View>
          <ScrollView className='home-vip__scroll' scrollX enhanced showScrollbar={false}>
            <View className='home-vip__row'>
              {vipCards.map(({ pkg, gift }) => (
                <View
                  className='home-vip-card'
                  key={`${pkg.id}-${gift.id}`}
                  onClick={() => Taro.navigateTo({ url: `/packages/benefits/vip-gifts/index?packageId=${encodeURIComponent(pkg.id)}&giftOptionId=${encodeURIComponent(gift.id)}` })}
                >
                  <View className='home-vip-card__top'><Text className='home-vip-card__price'>¥{formatMoney(pkg.price)}</Text><Text>VIP 礼包</Text><Text className='home-vip-card__gift'>礼</Text></View>
                  <View className='home-vip-card__title-row'><Text>{gift.title}</Text>{gift.badge ? <Text>{gift.badge}</Text> : null}</View>
                  <Text className='home-vip-card__subtitle'>{gift.subtitle || '精选礼包组合'}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
