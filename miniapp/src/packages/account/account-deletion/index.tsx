import { Button, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AccountFeedback } from '@/components/account-feedback';
import { createWechatMiniappDeletionProof, logoutMiniapp } from '@/platform/auth';
import { AccountDeletionRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import type { AccountDeletionBlockerCode } from '@/types';
import './index.scss';

const CONFIRM_TEXT = '确认注销';
const blockerHints: Record<AccountDeletionBlockerCode, string> = {
  IS_COMPANY_OWNER: '请先完成企业转让或注销',
  USER_NOT_ACTIVE: '当前账号状态不支持注销',
  ACTIVE_CHECKOUT_EXISTS: '请先完成或取消待支付订单',
  PENDING_PAYMENT_EXISTS: '支付结果确认后再试',
  PENDING_AFTER_SALE_SHIPPING_PAYMENT_EXISTS: '请先完成或安全关闭退货运费支付',
  WITHDRAW_PROCESSING_EXISTS: '请等待提现到达终态',
};

export default function AccountDeletionPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const [agreed, setAgreed] = useState(false);
  const [code, setCode] = useState('');
  const [wechatText, setWechatText] = useState('');
  const [wechatDeletionProof, setWechatDeletionProof] = useState('');
  const [countdown, setCountdown] = useState(0);
  const previewQuery = useQuery({
    queryKey: ['account', 'deletion-preview'],
    queryFn: AccountDeletionRepo.preview,
    enabled: hydrated && loggedIn,
    staleTime: 0,
  });
  const preview = previewQuery.data?.ok ? previewQuery.data.data : undefined;

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1_000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const sendMutation = useMutation({
    mutationFn: AccountDeletionRepo.sendCode,
    onSuccess: (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '验证码发送失败', icon: 'none' }); return; }
      setCountdown(60);
      Taro.showToast({ title: '验证码已发送', icon: 'success' });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => AccountDeletionRepo.execute(preview!.identityVerify === 'SMS'
      ? { confirmationMethod: 'SMS', smsCode: code.trim(), acknowledgedNotice: true }
      : { confirmationMethod: 'WECHAT_MODAL', modalConfirmText: wechatText.trim(), wechatDeletionProof, acknowledgedNotice: true }),
    onSuccess: async (result) => {
      if (!result.ok || !result.data.ok) {
        if (!result.ok && /WECHAT|AUTH_SESSION_CHANGED/.test(result.error.code)) {
          setWechatDeletionProof('');
        }
        Taro.showToast({ title: !result.ok ? result.error.displayMessage || '注销失败' : result.data.message || '注销失败', icon: 'none' });
        void previewQuery.refetch();
        return;
      }
      await logoutMiniapp();
      Taro.showToast({ title: '账号已注销', icon: 'none', duration: 2200 });
      setTimeout(() => { void Taro.switchTab({ url: '/pages/home/index' }); }, 500);
    },
    onError: () => Taro.showToast({ title: '网络结果不确定，请重新登录确认账号状态', icon: 'none', duration: 2800 }),
  });

  const submit = async () => {
    if (!preview?.canDelete || !agreed) return;
    if (preview.identityVerify === 'SMS' && !/^\d{4,8}$/.test(code.trim())) {
      Taro.showToast({ title: '请输入短信验证码', icon: 'none' }); return;
    }
    if (preview.identityVerify === 'WECHAT_MODAL' && wechatText.trim() !== CONFIRM_TEXT) {
      Taro.showToast({ title: `请输入“${CONFIRM_TEXT}”`, icon: 'none' }); return;
    }
    if (preview.identityVerify === 'WECHAT_MODAL' && !wechatDeletionProof) {
      const proof = await createWechatMiniappDeletionProof();
      if (!proof.ok) { Taro.showToast({ title: proof.error.displayMessage || '微信验证失败', icon: 'none' }); return; }
      setWechatDeletionProof(proof.data.wechatDeletionProof);
      Taro.showToast({ title: '微信身份已验证，请再次确认注销', icon: 'none' });
      return;
    }
    const modal = await Taro.showModal({
      title: '最后确认',
      content: '注销立即生效且不可恢复，钱包余额、优惠券、VIP、奖品及其他虚拟权益将清零作废。',
      confirmText: '立即注销',
      cancelText: '再想想',
      confirmColor: '#A04B42',
    });
    if (modal.confirm && !deleteMutation.isPending) deleteMutation.mutate();
  };

  if (!hydrated) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><AccountFeedback kind='empty' title='请先登录' description='登录后才能核验注销条件' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/account/account-deletion/index')}` })} /></View>;
  if (previewQuery.isLoading) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (!preview) return <View className='aim-page'><AccountFeedback kind='error' title='注销条件加载失败' description={previewQuery.data && !previewQuery.data.ok ? previewQuery.data.error.displayMessage : '请稍后重试'} onAction={() => previewQuery.refetch()} /></View>;

  const assetRows = [
    ['统一钱包可提现余额', `¥${preview.assets.withdrawableRewards.toFixed(2)}`],
    ['消费积分', `${preview.assets.points}`],
    ['平台红包', `${preview.assets.coupons} 张`],
    ['VIP 权益', '立即终止'],
    ['冻结分润', `¥${preview.assets.frozenRewards.toFixed(2)}`],
    ['数字资产种子余额', `¥${preview.assets.digitalAssetSeedBalance.toFixed(2)}`],
    ['数字资产增量余额', `¥${preview.assets.digitalAssetCreditBalance.toFixed(2)}`],
    ['团购返还可用余额', `¥${preview.assets.groupBuyRebateBalance.toFixed(2)}`],
    ['团购返还冻结余额', `¥${preview.assets.groupBuyRebateReserved.toFixed(2)}`],
    ['团长可用佣金', `¥${preview.assets.captainBalance.toFixed(2)}`],
    ['团长冻结佣金', `¥${preview.assets.captainFrozen.toFixed(2)}`],
    ['抽奖权益', `${preview.assets.lotteryQuota} 个`],
    ['支付中会话', `${preview.assets.activeCheckoutCount} 笔`],
  ];
  const valid = agreed && preview.canDelete && (preview.identityVerify === 'SMS' ? /^\d{4,8}$/.test(code.trim()) : wechatText.trim() === CONFIRM_TEXT && Boolean(wechatDeletionProof));
  return <View className='aim-page deletion-page'>
    <View className='deletion-alert'><Text>注销立即生效、不可恢复</Text><Text>已付款订单和进行中的售后继续履约；虚拟资产在提交成功时清零作废。</Text></View>
    {preview.blockers.length ? <View className='deletion-card aim-card'><Text className='deletion-card__title'>当前暂不能注销</Text>{preview.blockers.map((item) => <View className='deletion-blocker' key={item.code}><Text>{item.message}</Text><Text>{blockerHints[item.code]}{item.count > 0 ? ` · ${item.count} 项` : ''}</Text></View>)}</View> : null}
    <View className='deletion-card aim-card'><Text className='deletion-card__title'>将作废的资产快照</Text>{assetRows.map(([label, value]) => <View className='deletion-row' key={label}><Text>{label}</Text><Text>{value}</Text></View>)}</View>
    <View className='deletion-card aim-card'><Text className='deletion-card__title'>仍会继续处理</Text><View className='deletion-row'><Text>已付款订单</Text><Text>{preview.pending.paidOrders} 笔</Text></View><View className='deletion-row'><Text>进行中售后</Text><Text>{preview.pending.activeAfterSales} 笔</Text></View><Text className='deletion-copy'>交易、支付、退款、发票、售后和审计记录按法律及履约需要保留；手机号和微信身份释放后可以重新注册，但已作废权益不会恢复。</Text></View>
    <View className='deletion-agreement' onClick={() => setAgreed((value) => !value)}><View className={agreed ? 'deletion-check deletion-check--active' : 'deletion-check'}>{agreed ? '✓' : ''}</View><Text>我已阅读并理解上述注销后果，自愿放弃全部虚拟权益</Text></View>
    {preview.canDelete ? <View className='deletion-card aim-card'><Text className='deletion-card__title'>身份核验</Text>{preview.identityVerify === 'SMS' ? <><Text className='deletion-copy'>验证码将发送至 {preview.maskedPhone || '已绑定手机号'}</Text><View className='deletion-code'><Input type='number' maxlength={8} value={code} placeholder='短信验证码' onInput={(event) => setCode(event.detail.value.replace(/\D/g, ''))} /><Button disabled={countdown > 0 || sendMutation.isPending} loading={sendMutation.isPending} onClick={() => sendMutation.mutate()}>{countdown > 0 ? `${countdown}s` : '获取验证码'}</Button></View></> : <><Text className='deletion-copy'>请先输入“{CONFIRM_TEXT}”，再重新验证当前微信身份（验证后 5 分钟内有效）。</Text><Input className='deletion-confirm-input' maxlength={20} value={wechatText} placeholder={CONFIRM_TEXT} onInput={(event) => setWechatText(event.detail.value)} /><Button onClick={() => setWechatDeletionProof('')}>{wechatDeletionProof ? '重新验证微信身份' : '验证当前微信身份'}</Button></>}</View> : null}
    <Button className='deletion-submit' disabled={!valid || deleteMutation.isPending} loading={deleteMutation.isPending} onClick={submit}>{deleteMutation.isPending ? '正在注销...' : '立即永久注销账号'}</Button>
  </View>;
}
