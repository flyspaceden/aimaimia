import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { PageHeader } from '@/components/PageHeader';
import { useAuthStore } from '@/store/auth';
import { ReferralRepo } from '../repo';
import {
  formatReferralDate,
  normalReferralStatusLabel,
  referralRecordName,
  vipReferralStatusLabel,
} from '../utils';
import '../center/index.scss';

const PAGE_PATH = '/packages/referral/records/index';

export default function ReferralRecordsPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const memberQuery = useQuery({ queryKey: ['referral', 'member', authRevision], queryFn: ReferralRepo.getMember, enabled: hydrated && loggedIn });
  const member = memberQuery.data?.ok ? memberQuery.data.data : undefined;
  const isVip = member?.tier === 'VIP';
  const normalQuery = useQuery({ queryKey: ['referral', 'normal-records', authRevision], queryFn: ReferralRepo.getNormalRecords, enabled: Boolean(member && !isVip) });
  const vipQuery = useQuery({ queryKey: ['referral', 'vip-records', authRevision], queryFn: ReferralRepo.getVipRecords, enabled: Boolean(member && isVip) });
  const records = isVip ? vipQuery.data?.ok ? vipQuery.data.data : [] : normalQuery.data?.ok ? normalQuery.data.data : [];
  const recordsResult = isVip ? vipQuery.data : normalQuery.data;
  const loading = memberQuery.isLoading || Boolean(member && (isVip ? vipQuery.isLoading : normalQuery.isLoading));

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后查看全部推荐记录' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(PAGE_PATH)}` })} /></View>;
  if (loading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!memberQuery.data?.ok || !recordsResult?.ok) return <View className='aim-page'><CatalogFeedback kind='error' title='推荐记录加载失败' description={!memberQuery.data?.ok && memberQuery.data ? memberQuery.data.error.displayMessage : recordsResult && !recordsResult.ok ? recordsResult.error.displayMessage : '请稍后重试'} onRetry={() => { void memberQuery.refetch(); if (isVip) void vipQuery.refetch(); else void normalQuery.refetch(); }} /></View>;

  return <View className='aim-page referral-center-page'>
    <PageHeader title='全部推荐记录' eyebrow={isVip ? 'VIP 团队邀请' : '普通用户分享'} />
    <View className='referral-records'>
      {records.length ? records.map((record) => <View className='referral-record' key={record.id}>
        <Text className='referral-record__seal'>友</Text>
        <View className='referral-record__body'><Text className='referral-record__name'>{referralRecordName(record)}</Text><Text className='referral-record__time'>{formatReferralDate(record.boundAt)}</Text></View>
        <Text className='referral-record__status'>{'rewardStatus' in record ? normalReferralStatusLabel(record) : vipReferralStatusLabel(record)}</Text>
      </View>) : <CatalogFeedback kind='empty' title='暂无推荐记录' description='好友的有效绑定会显示在这里' />}
    </View>
  </View>;
}
