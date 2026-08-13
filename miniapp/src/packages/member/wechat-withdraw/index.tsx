import { Button, Input, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { requestMerchantTransferConfirmation } from '@/platform/merchantTransfer';
import { ensureWechatMiniProgramSession } from '@/platform/auth';
import { MiniSubscriptionRepo, requestOptionalMiniProgramSubscriptions } from '@/platform/subscriptions';
import { useAuthStore } from '@/store/auth';
import { MemberFeedback } from '../MemberFeedback';
import { MemberWalletRepo } from '../repos';
import {
  createWithdrawIdempotencyKey,
  calculateWechatWithdrawEstimate,
  formatDateTime,
  formatMoney,
  hasMerchantTransferConfirmation,
  isPendingWithdrawStatus,
} from '../utils';
import type { WithdrawRecord } from '../types';
import '../member.scss';

const QUICK_AMOUNTS = [10, 50, 200];
const normalizeAmount = (value: string) => {
  const clean = value.replace(/[^\d.]/g, '');
  const [integer = '', ...decimals] = clean.split('.');
  return decimals.length ? `${integer}.${decimals.join('').slice(0, 2)}` : integer;
};

function statusCopy(status: string): string {
  if (status === 'PAID') return '已到账';
  if (status === 'FAILED' || status === 'REJECTED') return '未成功，余额已退回';
  return '处理中';
}

export default function WechatWithdrawPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const userId = useAuthStore((state) => state.userId || '');
  const authRevision = useAuthStore((state) => state.revision);
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [requestingSubscription, setRequestingSubscription] = useState(false);
  const [trackedWithdrawId, setTrackedWithdrawId] = useState<string>();
  const [continuingWithdrawId, setContinuingWithdrawId] = useState<string>();
  const retainedKey = useRef<{ amount: number; key: string }>();
  const announcedTerminal = useRef<string>();
  const submitLock = useRef(false);
  const walletQuery = useQuery({ queryKey: ['member', 'wallet', authRevision, userId], queryFn: MemberWalletRepo.getWallet, enabled: hydrated && loggedIn && Boolean(userId) });
  const policyQuery = useQuery({
    queryKey: ['member', 'wechat-withdraw-policy'],
    queryFn: MemberWalletRepo.getWechatWithdrawPolicy,
    enabled: hydrated && loggedIn && Boolean(userId),
    staleTime: 5 * 60_000,
  });
  const subscriptionTemplatesQuery = useQuery({
    queryKey: ['mini-program', 'subscription-templates'],
    queryFn: MiniSubscriptionRepo.templates,
    enabled: hydrated && loggedIn,
    staleTime: 5 * 60_000,
  });
  const historyQuery = useQuery({
    queryKey: ['member', 'withdraw-history', authRevision, userId],
    queryFn: MemberWalletRepo.getWithdrawHistory,
    enabled: hydrated && loggedIn && Boolean(userId),
    refetchInterval: (query) => {
      const result = query.state.data;
      const pendingWechat = result?.ok
        ? result.data.find((item) => item.channel === 'WECHAT' && isPendingWithdrawStatus(item.status))
        : undefined;
      return pendingWechat ? 2_000 : false;
    },
  });
  useDidShow(() => {
    if (!useAuthStore.getState().accessToken) return;
    void walletQuery.refetch();
    void historyQuery.refetch();
  });

  useEffect(() => {
    // 账号代际变更后不得保留上一账号的金额、提现 ID 或幂等标识。
    setAmount('');
    setRequestingSubscription(false);
    setTrackedWithdrawId(undefined);
    setContinuingWithdrawId(undefined);
    retainedKey.current = undefined;
    announcedTerminal.current = undefined;
    submitLock.current = false;
  }, [authRevision, userId]);

  const wallet = walletQuery.data?.ok ? walletQuery.data.data : undefined;
  const available = wallet?.withdrawableBalance ?? wallet?.balance ?? 0;
  const policy = policyQuery.data?.ok ? policyQuery.data.data : undefined;
  const numericAmount = Number.parseFloat(amount) || 0;
  const maxAmount = policy?.grossSingleMax ?? 0;
  const minimumAmount = policy?.grossSingleMin ?? 0;
  const taxRate = policy?.taxRate ?? 0;
  const providerFeeAmount = policy?.providerFeeAmount ?? 0;
  const estimate = calculateWechatWithdrawEstimate(numericAmount, taxRate, providerFeeAmount);
  const exceedsSingleLimit = numericAmount > maxAmount;
  const history = useMemo(() => historyQuery.data?.ok ? historyQuery.data.data : [], [historyQuery.data]);
  const existingPendingWechat = useMemo(
    () => history.find((item) => item.channel === 'WECHAT' && isPendingWithdrawStatus(item.status)),
    [history],
  );
  const tracked = useMemo(
    () => history.find((item) => item.id === trackedWithdrawId) || existingPendingWechat,
    [existingPendingWechat, history, trackedWithdrawId],
  );
  const trackedPending = Boolean(
    existingPendingWechat
    || (trackedWithdrawId && (!tracked || isPendingWithdrawStatus(tracked.status))),
  );

  useEffect(() => {
    if (trackedWithdrawId) return;
    if (existingPendingWechat) setTrackedWithdrawId(existingPendingWechat.id);
  }, [existingPendingWechat, trackedWithdrawId]);

  useEffect(() => {
    if (!tracked || isPendingWithdrawStatus(tracked.status) || announcedTerminal.current === tracked.id) return;
    announcedTerminal.current = tracked.id;
    const succeeded = tracked.status === 'PAID';
    Taro.showToast({ title: succeeded ? '提现已确认到账' : '提现未成功，余额已退回', icon: 'none', duration: 2600 });
    void queryClient.invalidateQueries({ queryKey: ['member', 'wallet'] });
    void queryClient.invalidateQueries({ queryKey: ['member', 'wallet-ledger'] });
  }, [queryClient, tracked]);

  const withdrawMutation = useMutation({
    mutationFn: ({ value, key }: { value: number; key: string; revisionAtStart: number; userIdAtStart: string }) => MemberWalletRepo.requestWechatWithdraw(value, key),
    onSuccess: async (result, variables) => {
      try {
        const current = useAuthStore.getState();
        if (current.revision !== variables.revisionAtStart || current.userId !== variables.userIdAtStart) return;
        if (!result.ok) {
          Taro.showToast({ title: result.error.displayMessage || '提现申请失败', icon: 'none' });
          return;
        }
        retainedKey.current = undefined;
        setTrackedWithdrawId(result.data.withdrawId);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['member', 'wallet'] }),
          queryClient.invalidateQueries({ queryKey: ['member', 'wallet-ledger'] }),
          historyQuery.refetch(),
        ]);
        const afterRefresh = useAuthStore.getState();
        if (afterRefresh.revision !== variables.revisionAtStart || afterRefresh.userId !== variables.userIdAtStart) return;
        if (hasMerchantTransferConfirmation(result.data)) {
          try {
            await requestMerchantTransferConfirmation(result.data);
            Taro.showToast({ title: '已返回 AI爱买买，正在确认到账状态', icon: 'none', duration: 2600 });
          } catch {
            Taro.showToast({ title: '确认页已关闭，可稍后在提现记录查看结果', icon: 'none', duration: 2600 });
          } finally {
            void historyQuery.refetch();
          }
          return;
        }
        Taro.showToast({ title: result.data.message || '提现状态确认中', icon: 'none', duration: 2600 });
      } finally {
        submitLock.current = false;
      }
    },
    onError: (_error, variables) => {
      submitLock.current = false;
      const current = useAuthStore.getState();
      if (current.revision === variables.revisionAtStart && current.userId === variables.userIdAtStart) {
        Taro.showToast({ title: '网络结果不确定，请用原申请重试', icon: 'none', duration: 2600 });
      }
    },
  });

  const continueConfirmation = async (record: WithdrawRecord) => {
    if (continuingWithdrawId) return;
    if (!await ensureWechatMiniProgramSession('/packages/member/wechat-withdraw/index')) return;
    const revisionAtStart = useAuthStore.getState().revision;
    const userIdAtStart = useAuthStore.getState().userId || '';
    setContinuingWithdrawId(record.id);
    try {
      const result = await MemberWalletRepo.continueWechatWithdrawConfirmation(record.id);
      const current = useAuthStore.getState();
      if (current.revision !== revisionAtStart || current.userId !== userIdAtStart) return;
      if (!result.ok) {
        Taro.showToast({ title: result.error.displayMessage || '暂时无法继续确认', icon: 'none' });
        return;
      }
      if (result.data.status !== 'PROCESSING') {
        Taro.showToast({ title: result.data.message, icon: 'none' });
        await Promise.all([historyQuery.refetch(), walletQuery.refetch()]);
        return;
      }
      if (!hasMerchantTransferConfirmation(result.data)) {
        Taro.showToast({ title: result.data.message || '微信原单暂不能继续确认', icon: 'none' });
        return;
      }
      await requestMerchantTransferConfirmation(result.data);
      Taro.showToast({ title: '已返回 AI爱买买，正在确认到账状态', icon: 'none', duration: 2600 });
    } catch {
      Taro.showToast({ title: '确认页已关闭，可稍后继续确认', icon: 'none', duration: 2600 });
    } finally {
      setContinuingWithdrawId(undefined);
      void historyQuery.refetch();
    }
  };

  useEffect(() => {
    withdrawMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRevision, userId]);

  const submit = async () => {
    if (submitLock.current) return;
    if (!await ensureWechatMiniProgramSession('/packages/member/wechat-withdraw/index')) return;
    if (trackedPending) { Taro.showToast({ title: '上一笔提现仍在处理中', icon: 'none' }); return; }
    if (!numericAmount || numericAmount <= 0) { Taro.showToast({ title: '请输入提现金额', icon: 'none' }); return; }
    if (!policy) { Taro.showToast({ title: '提现规则加载中，请稍后重试', icon: 'none' }); return; }
    if (numericAmount < minimumAmount) { Taro.showToast({ title: `单笔最低 ${formatMoney(minimumAmount)}`, icon: 'none' }); return; }
    if (exceedsSingleLimit) { Taro.showToast({ title: `单笔最高 ${formatMoney(maxAmount)}`, icon: 'none' }); return; }
    if (numericAmount > available) { Taro.showToast({ title: '可提现余额不足', icon: 'none' }); return; }
    submitLock.current = true;
    try {
      const modal = await Taro.showModal({
        title: '确认提现到微信零钱',
        content: `申请 ${formatMoney(numericAmount)}，预扣税费 ${formatMoney(estimate.taxAmount)}，预计到账 ${formatMoney(estimate.netAmount)}。最终以系统审核与微信确认结果为准。`,
        confirmText: '确认提现',
        confirmColor: '#2E7D32',
      });
      if (!modal.confirm || withdrawMutation.isPending || requestingSubscription) {
        submitLock.current = false;
        return;
      }
      setRequestingSubscription(true);
      const subscriptionTemplates = subscriptionTemplatesQuery.data?.ok
        ? subscriptionTemplatesQuery.data.data
        : undefined;
      if (subscriptionTemplates) {
        await requestOptionalMiniProgramSubscriptions(['WITHDRAW_RESULT'], subscriptionTemplates);
      }
      const current = useAuthStore.getState();
      if (current.revision !== authRevision || current.userId !== userId) {
        submitLock.current = false;
        return;
      }
      if (!retainedKey.current || retainedKey.current.amount !== numericAmount) {
        retainedKey.current = { amount: numericAmount, key: createWithdrawIdempotencyKey() };
      }
      withdrawMutation.mutate({ value: numericAmount, key: retainedKey.current.key, revisionAtStart: authRevision, userIdAtStart: userId });
    } catch {
      submitLock.current = false;
    } finally {
      setRequestingSubscription(false);
    }
  };

  if (!hydrated) return <View className='aim-page member-page'><MemberFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page member-page'><MemberFeedback kind='login' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/member/wechat-withdraw/index')}` })} /></View>;
  if (walletQuery.isLoading || policyQuery.isLoading) return <View className='aim-page member-page'><MemberFeedback kind='loading' /></View>;
  if (!walletQuery.data?.ok) return <View className='aim-page member-page'><MemberFeedback kind='error' description={walletQuery.data?.error.displayMessage} onAction={() => walletQuery.refetch()} /></View>;
  if (!policyQuery.data?.ok || !policy) {
    const policyErrorMessage = policyQuery.data && !policyQuery.data.ok
      ? policyQuery.data.error.displayMessage
      : '提现规则暂不可用';
    return <View className='aim-page member-page'><MemberFeedback kind='error' description={policyErrorMessage} onAction={() => policyQuery.refetch()} /></View>;
  }

  return <View className='aim-page member-page withdraw-page'>
    <View className='withdraw-balance-card'>
      <Text className='withdraw-balance-card__eyebrow'>当前可提现</Text>
      <Text className='withdraw-balance-card__amount'>{formatMoney(available)}</Text>
      <Text className='withdraw-balance-card__meta'>统一钱包 · 提现到微信零钱</Text>
    </View>
    <View className='withdraw-form aim-card'>
      <Text className='withdraw-form__title'>提现金额</Text>
      <View className='withdraw-input'><Text>¥</Text><Input type='digit' value={amount} placeholder='0.00' onInput={(event) => setAmount(normalizeAmount(event.detail.value))} /></View>
      <View className='withdraw-quick-row'>{QUICK_AMOUNTS.map((value) => {
        const selectable = Math.min(value, available, maxAmount);
        return <View key={value} className='withdraw-quick' onClick={() => setAmount(selectable > 0 ? selectable.toFixed(2) : '')}>{formatMoney(Math.max(0, selectable))}</View>;
      })}<View className='withdraw-quick withdraw-quick--all' onClick={() => setAmount(Math.min(available, maxAmount) > 0 ? Math.min(available, maxAmount).toFixed(2) : '')}>本次最多</View></View>
      {numericAmount > 0 ? <View className='withdraw-estimate'><View><Text>预计到账</Text><Text>{formatMoney(estimate.netAmount)}</Text></View><Text>{`按 ${(taxRate * 100).toFixed(0)}% 税率预扣 ${formatMoney(estimate.taxAmount)}${providerFeeAmount > 0 ? `，含通道费 ${formatMoney(providerFeeAmount)}` : ''}`}</Text></View> : null}
      {exceedsSingleLimit ? <Text className='withdraw-limit-error'>{`单笔申请最多 ${formatMoney(maxAmount)}，请调整金额后再提交`}</Text> : null}
      <View className='withdraw-channel'><Text className='withdraw-channel__logo'>微</Text><View><Text className='withdraw-channel__title'>微信零钱</Text><Text className='withdraw-channel__meta'>收款身份来自当前微信小程序登录，不需要填写账户</Text></View><Text className='withdraw-channel__check'>✓</Text></View>
      <View className='withdraw-rule'><Text>资金说明</Text><Text>{`单笔申请 ${formatMoney(minimumAmount)}–${formatMoney(maxAmount)}；同一用户每日实际到账额度 ¥${policy.netUserDailyMax.toFixed(0)}，平台每日额度 ¥${policy.netPlatformDailyMax.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}。当日额度用完请明日再提。提现规则、税费、冻结和失败退回与 App 保持一致。`}</Text></View>
      <Button className='member-primary-button' disabled={requestingSubscription || withdrawMutation.isPending || trackedPending || numericAmount < minimumAmount || exceedsSingleLimit} loading={requestingSubscription || withdrawMutation.isPending} onClick={submit}>{trackedPending ? '提现处理中' : requestingSubscription ? '准备提醒...' : withdrawMutation.isPending ? '正在提交...' : '确认提现'}</Button>
    </View>
    <View className='member-section-head'><Text>最近提现</Text><Text>{trackedPending ? '正在确认到账' : '最终结果'}</Text></View>
    <View className='withdraw-history aim-card'>
      {historyQuery.isLoading ? <MemberFeedback kind='loading' /> : history.length ? history.slice(0, 8).map((item: WithdrawRecord) => <View className='withdraw-history__row' key={item.id}><View><Text className='withdraw-history__amount'>{formatMoney(item.amount)}</Text><Text className='withdraw-history__date'>{formatDateTime(item.createdAt)}</Text></View><View className='withdraw-history__side'><Text className={`withdraw-history__status withdraw-history__status--${item.status.toLowerCase()}`}>{statusCopy(item.status)}</Text>{item.confirmationAvailable ? <Button className='withdraw-history__continue' disabled={Boolean(continuingWithdrawId)} loading={continuingWithdrawId === item.id} onClick={() => void continueConfirmation(item)}>继续确认收款</Button> : null}</View></View>) : <MemberFeedback kind='empty' title='暂无提现记录' description='提交提现申请后可在这里查看进度' />}
    </View>
  </View>;
}
