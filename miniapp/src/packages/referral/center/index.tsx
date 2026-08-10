import { Button, Input, Text, View } from '@tarojs/components';
import Taro, { useRouter, useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { MiniProgramCodePanel } from '@/components/mini-program-code';
import { PageHeader } from '@/components/PageHeader';
import { useAuthStore } from '@/store/auth';
import { ReferralRepo } from '../repo';
import type { InviteKind } from '../types';
import {
  buildMiniappInvitePath,
  formatReferralDate,
  normalizeInviteCode,
  normalReferralStatusLabel,
  referralRecordName,
  preferredInviteKind,
  vipReferralStatusLabel,
} from '../utils';
import './index.scss';

const PAGE_PATH = '/packages/referral/center/index';

export default function ReferralCenterPage() {
  const router = useRouter();
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const [bindCode, setBindCode] = useState('');
  const timelineAttemptedRef = useRef(false);
  const incomingCode = normalizeInviteCode(typeof router.params.code === 'string' ? router.params.code : undefined);
  const incomingKind = incomingCode
    ? preferredInviteKind(typeof router.params.kind === 'string' ? router.params.kind : undefined, incomingCode)
    : undefined;
  const queryClient = useQueryClient();
  const memberQuery = useQuery({ queryKey: ['referral', 'member', authRevision], queryFn: ReferralRepo.getMember, enabled: hydrated && loggedIn });
  const member = memberQuery.data?.ok ? memberQuery.data.data : undefined;
  const isVip = member?.tier === 'VIP';
  const normalQuery = useQuery({ queryKey: ['referral', 'normal-profile', authRevision], queryFn: ReferralRepo.getNormalProfile, enabled: Boolean(hydrated && loggedIn && member && !isVip) });
  const statsQuery = useQuery({ queryKey: ['referral', 'normal-stats', authRevision], queryFn: ReferralRepo.getNormalStats, enabled: Boolean(hydrated && loggedIn && member && !isVip) });
  const normalRecordsQuery = useQuery({ queryKey: ['referral', 'normal-records', authRevision], queryFn: ReferralRepo.getNormalRecords, enabled: Boolean(hydrated && loggedIn && member && !isVip) });
  const vipRecordsQuery = useQuery({ queryKey: ['referral', 'vip-records', authRevision], queryFn: ReferralRepo.getVipRecords, enabled: Boolean(hydrated && loggedIn && member && isVip) });
  const normalProfile = normalQuery.data?.ok ? normalQuery.data.data : undefined;
  const shareCode = isVip ? member?.referralCode || '' : normalProfile?.status === 'ACTIVE' ? normalProfile.code : '';
  const shareKind: InviteKind = isVip ? 'vip' : 'normal';
  const sharePath = shareCode ? buildMiniappInvitePath(shareCode, shareKind) : PAGE_PATH;
  const shareTitle = isVip ? '和我一起在爱买买发现产地好物' : '我在爱买买发现了优质农产品';

  useShareAppMessage(() => ({ title: shareTitle, path: sharePath }));
  useShareTimeline(() => ({ title: shareTitle, query: shareCode ? `code=${encodeURIComponent(shareCode)}&kind=${shareKind}` : '' }));

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['referral'] }),
    queryClient.invalidateQueries({ queryKey: ['member'] }),
  ]);
  const bindMutation = useMutation({
    mutationFn: ({ code, kind }: { code: string; kind: InviteKind }) => ReferralRepo.bindAuto(code, kind),
    onSuccess: async (result) => {
      if (!result.ok) {
        Taro.showToast({ title: result.error.displayMessage || '绑定失败', icon: 'none' });
        return;
      }
      setBindCode('');
      await invalidate();
      Taro.showToast({ title: '推荐关系已绑定', icon: 'success' });
    },
  });
  useEffect(() => {
    timelineAttemptedRef.current = false;
    setBindCode('');
  }, [authRevision]);
  useEffect(() => {
    if (!hydrated || !loggedIn || !incomingCode || !incomingKind || timelineAttemptedRef.current) return;
    timelineAttemptedRef.current = true;
    bindMutation.mutate({ code: incomingCode, kind: incomingKind });
    // 只由路由邀请码和账号代际驱动，mutation 对象不参与重放判定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRevision, hydrated, incomingCode, incomingKind, loggedIn]);
  const bind = () => {
    const code = normalizeInviteCode(bindCode);
    if (!code) {
      Taro.showToast({ title: '请输入 8 位有效分享码', icon: 'none' });
      return;
    }
    bindMutation.mutate({ code, kind: preferredInviteKind(undefined, code) });
  };

  const records = isVip
    ? vipRecordsQuery.data?.ok ? vipRecordsQuery.data.data : []
    : normalRecordsQuery.data?.ok ? normalRecordsQuery.data.data : [];
  const stats = statsQuery.data?.ok ? statsQuery.data.data : undefined;
  const hasBoundInviter = Boolean(member?.inviterUserId) && !['INVALIDATED_BY_INVITEE_VIP_UPGRADE', 'ADMIN_VOIDED'].includes(member?.directReferralStatus || '');
  const loading = memberQuery.isLoading || (member && !isVip && normalQuery.isLoading);
  const queryError = memberQuery.data && !memberQuery.data.ok ? memberQuery.data.error : normalQuery.data && !normalQuery.data.ok ? normalQuery.data.error : null;
  const recordsError = isVip
    ? vipRecordsQuery.data && !vipRecordsQuery.data.ok ? vipRecordsQuery.data.error : null
    : normalRecordsQuery.data && !normalRecordsQuery.data.ok ? normalRecordsQuery.data.error : null;
  const statsError = !isVip && statsQuery.data && !statsQuery.data.ok ? statsQuery.data.error : null;
  const recentRecords = records.slice(0, 8);

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) {
    const returnUrl = incomingCode && incomingKind
      ? `${PAGE_PATH}?code=${encodeURIComponent(incomingCode)}&kind=${incomingKind}`
      : PAGE_PATH;
    return <View className='aim-page referral-auth'><CatalogFeedback kind='empty' title={incomingCode ? '登录并接受好友邀请' : '登录后查看推荐中心'} description={incomingCode ? '登录后，平台会核验并绑定这次分享中的推荐关系' : '查看自己的分享码和推荐记录'} actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}` })} /></View>;
  }
  if (loading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (queryError) return <View className='aim-page'><CatalogFeedback kind='error' title='推荐中心加载失败' description={queryError.displayMessage || '请稍后重试'} onRetry={() => { void memberQuery.refetch(); void normalQuery.refetch(); }} /></View>;

  return (
    <View className='aim-page referral-center-page'>
      <PageHeader title='推荐中心' eyebrow={isVip ? 'VIP 团队邀请' : '普通用户分享'} />
      <View className={isVip ? 'referral-code-card referral-code-card--vip' : 'referral-code-card referral-code-card--normal'}>
        <Text className='referral-code-card__label'>{isVip ? 'VIP 推荐码' : '普通分享码'}</Text>
        <Text className='referral-code-card__code'>{shareCode ? shareCode.split('').join(' ') : '暂不可用'}</Text>
        <Text className='referral-code-card__copy'>{isVip ? `已推荐 ${member?.inviteeVipCount || 0} 位 VIP。好友成为 VIP 后进入你的 VIP 团队。` : '好友从微信卡片进入并登录后，平台会按当前规则绑定普通推荐关系。'}</Text>
        <View className='referral-code-card__actions'>
          <Button className='referral-code-card__copy-button' disabled={!shareCode} onClick={() => shareCode && Taro.setClipboardData({ data: shareCode })}>复制分享码</Button>
          <Button className='referral-code-card__share-button' disabled={!shareCode} openType='share'>分享给好友</Button>
        </View>
        <Text className='referral-code-card__timeline'>也可通过右上角菜单分享到朋友圈</Text>
      </View>

      <MiniProgramCodePanel kind='REFERRAL' enabled={Boolean(shareCode)} />

      {!hasBoundInviter && !isVip ? <View className='referral-bind aim-card'>
        <Text className='referral-section__title'>绑定分享码</Text>
        <Text className='referral-section__copy'>推荐关系绑定后不能随意更换，请确认无误再提交。</Text>
        <View className='referral-bind__row'><Input className='referral-bind__input' value={bindCode} maxlength={8} placeholder='输入 8 位分享码' onInput={(event) => setBindCode(event.detail.value.toUpperCase())} /><Button className='referral-bind__button' loading={bindMutation.isPending} onClick={bind}>绑定</Button></View>
      </View> : null}

      {!isVip && statsError ? <CatalogFeedback kind='error' title='邀请统计加载失败' description={statsError.displayMessage || '请稍后重试'} onRetry={() => { void statsQuery.refetch(); }} /> : null}
      {!isVip && stats ? <View className='referral-stats'>
        <View><Text className='referral-stats__value'>{stats.totalInvitees}</Text><Text className='referral-stats__label'>已邀请</Text></View>
        <View><Text className='referral-stats__value'>{stats.rewardedInvitees}</Text><Text className='referral-stats__label'>已奖励</Text></View>
        <View><Text className='referral-stats__value'>{stats.pendingInvitees}</Text><Text className='referral-stats__label'>进行中</Text></View>
      </View> : null}

      <View className='referral-records'>
        <View className='referral-records__heading'><Text className='referral-section__title'>最近推荐</Text>{records.length ? <Text className='referral-records__all' onClick={() => Taro.navigateTo({ url: '/packages/referral/records/index' })}>查看全部 {records.length} 条 ›</Text> : null}</View>
        {recordsError ? <CatalogFeedback kind='error' title='推荐记录加载失败' description={recordsError.displayMessage || '请稍后重试'} onRetry={() => { if (isVip) void vipRecordsQuery.refetch(); else void normalRecordsQuery.refetch(); }} /> : recentRecords.length === 0 ? <CatalogFeedback kind='empty' title='暂无推荐记录' description='分享卡片后，好友的有效绑定会显示在这里' /> : recentRecords.map((record) => (
          <View className='referral-record' key={record.id}>
            <Text className='referral-record__seal'>友</Text>
            <View className='referral-record__body'><Text className='referral-record__name'>{referralRecordName(record)}</Text><Text className='referral-record__time'>{formatReferralDate('boundAt' in record ? record.boundAt : undefined)}</Text></View>
            <Text className='referral-record__status'>{'rewardStatus' in record ? normalReferralStatusLabel(record) : vipReferralStatusLabel(record)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
