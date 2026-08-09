import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CartRepo } from '@/repos';
import { queryClient } from '@/query/client';
import { useAuthStore } from '@/store/auth';
import { BenefitsFeedback } from '../BenefitsFeedback';
import { BenefitsRepo } from '../repos';
import type { DrawResult } from '../types';
import {
  benefitsLoginUrl,
  buildPrizeMergeItem,
  clearPendingPrize,
  createOperationKey,
  getDeviceFingerprint,
  readPendingPrize,
  savePendingPrize,
} from '../utils';
import './index.scss';

export default function LotteryPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const fingerprint = useMemo(getDeviceFingerprint, []);
  const [result, setResult] = useState<DrawResult>();
  const [claimNotice, setClaimNotice] = useState('');
  const claimAttempted = useRef(false);
  const prizesQuery = useQuery({ queryKey: ['benefits', 'lottery', 'prizes'], queryFn: BenefitsRepo.getLotteryPrizes });
  const todayQuery = useQuery({ queryKey: ['benefits', 'lottery', 'today', loggedIn], queryFn: () => BenefitsRepo.getLotteryToday(loggedIn, fingerprint), enabled: hydrated });

  useEffect(() => {
    if (!hydrated || !loggedIn || claimAttempted.current) return;
    const claim = readPendingPrize();
    if (!claim) return;
    claimAttempted.current = true;
    void (async () => {
      const merged = await CartRepo.mergeItems([buildPrizeMergeItem(claim)], claim.mergeKey);
      if (!merged.ok) {
        setClaimNotice(merged.error.displayMessage || '奖品同步失败，请稍后重试');
        claimAttempted.current = false;
        return;
      }
      const merge = merged.data.mergeResults?.find((item) => item.localKey === `pending-prize-${claim.prizeId}`);
      if (merge?.status !== 'MERGED') {
        setClaimNotice(merge?.message || '奖品凭证未能合并，请稍后重试');
        claimAttempted.current = false;
        return;
      }
      clearPendingPrize();
      setClaimNotice(`「${claim.prizeName}」已加入购物车`);
      await queryClient.invalidateQueries({ queryKey: ['commerce', 'cart'] });
    })();
  }, [hydrated, loggedIn]);

  const drawMutation = useMutation({
    mutationFn: () => BenefitsRepo.drawLottery(loggedIn, fingerprint),
    onSuccess: async (response) => {
      if (!response.ok) { Taro.showToast({ title: response.error.displayMessage || '抽奖失败', icon: 'none' }); return; }
      setResult(response.data);
      if (!loggedIn && response.data.won && response.data.claimToken && response.data.prize) {
        savePendingPrize({
          claimToken: response.data.claimToken,
          prizeId: response.data.prize.id,
          prizeName: response.data.prize.name,
          createdAt: new Date().toISOString(),
          mergeKey: createOperationKey('mini-prize-claim'),
        });
      }
      await todayQuery.refetch();
    },
  });

  if (!hydrated || prizesQuery.isLoading || todayQuery.isLoading) return <View className='aim-page benefits-page benefits-page--harvest'><BenefitsFeedback kind='loading' /></View>;
  if (!prizesQuery.data?.ok || !todayQuery.data?.ok) return <View className='aim-page benefits-page benefits-page--harvest'><BenefitsFeedback kind='error' description={!prizesQuery.data?.ok && prizesQuery.data ? prizesQuery.data.error.displayMessage : !todayQuery.data?.ok && todayQuery.data ? todayQuery.data.error.displayMessage : '抽奖数据加载失败'} onAction={() => { void prizesQuery.refetch(); void todayQuery.refetch(); }} /></View>;
  const prizes = prizesQuery.data.data;
  const today = todayQuery.data.data;

  return <View className='aim-page benefits-page benefits-page--harvest'>
    <View className='benefits-hero benefits-hero--red'><View className='benefits-hero__orbit' /><Text className='benefits-hero__eyebrow'>DAILY HARVEST</Text><Text className='benefits-hero__title'>每日一次，开启今日惊喜</Text><Text className='benefits-hero__description'>剩余次数、奖池和中奖结果全部由服务端裁决，客户端不展示未公开配置。</Text><View className='benefits-stat-row'><View><Text>今日剩余</Text><Text>{today.remainingDraws} 次</Text></View><View><Text>登录状态</Text><Text>{loggedIn ? '已登录' : '游客'}</Text></View><View><Text>奖池</Text><Text>{prizes.length} 项</Text></View></View></View>
    {claimNotice ? <View className='benefits-payment-state'>{claimNotice}</View> : null}
    <View className='lottery-stage'><View className='lottery-wheel'>{prizes.length ? prizes.slice(0, 9).map((prize, index) => <View className='lottery-prize' key={prize.id}><Text className='lottery-prize__mark'>{index + 1}</Text><Text className='lottery-prize__name'>{prize.name}</Text></View>) : <View className='lottery-prize'><Text className='lottery-prize__mark'>·</Text><Text className='lottery-prize__name'>暂无奖品</Text></View>}</View></View>
    {(result || today.lastResult) ? <View className='lottery-result aim-card'><Text className='lottery-result__title'>{(result || today.lastResult)?.won ? '恭喜获奖' : '谢谢参与'}</Text><Text className='lottery-result__description'>{(result || today.lastResult)?.prize?.name || (result || today.lastResult)?.message}</Text>{!loggedIn && result?.won ? <Text className='lottery-result__description'>登录后系统会用一次性凭证将奖品合并到购物车。</Text> : null}</View> : null}
    <Button className='benefits-primary benefits-primary--red' loading={drawMutation.isPending} disabled={drawMutation.isPending || today.remainingDraws <= 0 || !prizes.length} onClick={() => drawMutation.mutate()}>{drawMutation.isPending ? '正在开奖...' : today.remainingDraws > 0 ? '立即抽奖' : '今日已参与'}</Button>
    {!loggedIn && readPendingPrize() ? <Button className='benefits-secondary' onClick={() => Taro.redirectTo({ url: benefitsLoginUrl('/packages/benefits/lottery/index') })}>登录并领取奖品</Button> : null}
    {loggedIn ? <Button className='benefits-secondary' onClick={() => Taro.navigateTo({ url: '/packages/commerce/cart/index' })}>查看购物车奖品</Button> : null}
    <Text className='benefits-note'>未登录中奖凭证有效期受服务端约束，请尽快登录领取；合并成功前不会删除本地凭证。</Text>
  </View>;
}
