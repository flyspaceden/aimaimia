import { Button, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { useAuthStore } from '@/store/auth';
import { InvoiceAuthGate } from '../_components/auth-gate';
import { MiniInvoiceRepo } from '../repo';
import type { InvoiceProfile } from '../types';
import '../_components/invoice-shared.scss';
import './index.scss';

export default function InvoiceProfileListPage() {
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken)); const queryClient = useQueryClient(); const query = useQuery({ queryKey: ['invoice-profiles'], queryFn: MiniInvoiceRepo.getProfiles, enabled: loggedIn }); useDidShow(() => { if (useAuthStore.getState().accessToken) void query.refetch(); }); const profiles = query.data?.ok ? query.data.data : undefined;
  const removeMutation = useMutation({ mutationFn: (profile: InvoiceProfile) => MiniInvoiceRepo.deleteProfile(profile.id), onSuccess: async (result) => { if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '删除失败', icon: 'none' }); return; } await queryClient.invalidateQueries({ queryKey: ['invoice-profiles'] }); Taro.showToast({ title: '抬头已删除', icon: 'success' }); } });
  const remove = async (profile: InvoiceProfile) => { const modal = await Taro.showModal({ title: '删除发票抬头', content: `确认删除「${profile.title}」？已申请发票保留当时的抬头快照。`, confirmColor: '#A04B42' }); if (modal.confirm) removeMutation.mutate(profile); };
  return <InvoiceAuthGate returnUrl='/packages/invoices/profile-list/index'><View className='invoice-profiles-page'><View className='invoice-profiles-heading'><Text>发票抬头</Text><Text>修改抬头不会改变已提交发票的快照。</Text></View>{query.isLoading ? <CatalogFeedback kind='loading' /> : !profiles ? <CatalogFeedback kind='error' title='抬头加载失败' description={query.data && !query.data.ok ? query.data.error.displayMessage : '请稍后重试'} onRetry={() => query.refetch()} /> : <ScrollView className='invoice-profiles-scroll' scrollY enhanced refresherEnabled refresherTriggered={query.isRefetching} onRefresherRefresh={() => query.refetch()}><View className='invoice-profiles-content'>{profiles.length === 0 ? <CatalogFeedback kind='empty' title='暂无发票抬头' description='新建个人或企业抬头，申请开票时可直接选择' /> : profiles.map((profile) => <View className='invoice-profile-card aim-card' key={profile.id} onClick={() => Taro.navigateTo({ url: `/packages/invoices/profile-edit/index?id=${encodeURIComponent(profile.id)}` })}><View className='invoice-profile-card__head'><Text>{profile.type === 'COMPANY' ? '企业' : '个人'}</Text><Text onClick={(event) => { event.stopPropagation(); void remove(profile); }}>删除</Text></View><Text className='invoice-profile-card__title'>{profile.title}</Text>{profile.taxNo ? <Text className='invoice-profile-card__meta'>税号：{profile.taxNo}</Text> : null}{profile.email || profile.phone ? <Text className='invoice-profile-card__meta'>{[profile.email, profile.phone].filter(Boolean).join(' · ')}</Text> : null}</View>)}</View></ScrollView>}<View className='invoice-profiles-bar'><Button onClick={() => Taro.navigateTo({ url: '/packages/invoices/profile-edit/index' })}>新建发票抬头</Button></View></View></InvoiceAuthGate>;
}
