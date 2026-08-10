import { Button, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { useAuthStore } from '@/store/auth';
import { InvoiceAuthGate } from '../_components/auth-gate';
import { MiniInvoiceRepo } from '../repo';
import '../_components/invoice-shared.scss';
import './index.scss';

export default function InvoiceRequestPage() {
  const router = useRouter(); const orderId = typeof router.params.orderId === 'string' ? router.params.orderId : ''; const loggedIn = useAuthStore((state) => Boolean(state.accessToken)); const queryClient = useQueryClient(); const [selectedId, setSelectedId] = useState('');
  const query = useQuery({ queryKey: ['invoice-profiles'], queryFn: MiniInvoiceRepo.getProfiles, enabled: loggedIn }); useDidShow(() => { if (useAuthStore.getState().accessToken) void query.refetch(); }); const profiles = query.data?.ok ? query.data.data : undefined;
  const mutation = useMutation({ mutationFn: () => MiniInvoiceRepo.requestInvoice({ orderId, profileId: selectedId }), onSuccess: async (result) => { if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '申请失败', icon: 'none' }); return; } await Promise.all([queryClient.invalidateQueries({ queryKey: ['invoices'] }), queryClient.invalidateQueries({ queryKey: ['orders'] })]); Taro.showToast({ title: '开票申请已提交', icon: 'success' }); setTimeout(() => Taro.redirectTo({ url: `/packages/invoices/invoice-detail/index?id=${encodeURIComponent(result.data.id)}` }), 400); } });
  const submit = () => { if (!selectedId) { Taro.showToast({ title: '请选择发票抬头', icon: 'none' }); return; } if (!mutation.isPending) mutation.mutate(); };
  const returnUrl = `/packages/invoices/invoice-request/index?orderId=${encodeURIComponent(orderId)}`;
  return <InvoiceAuthGate returnUrl={returnUrl}><View className='invoice-request-page'>{!orderId ? <CatalogFeedback kind='error' title='订单参数缺失' description='请从已收货订单重新申请' /> : query.isLoading ? <CatalogFeedback kind='loading' /> : !profiles ? <CatalogFeedback kind='error' title='发票抬头加载失败' description={query.data && !query.data.ok ? query.data.error.displayMessage : '请稍后重试'} onRetry={() => query.refetch()} /> : <><View className='invoice-request-heading'><Text>选择发票抬头</Text><Text>提交时会自动核验订单状态，避免重复申请。</Text></View><ScrollView className='invoice-request-scroll' scrollY enhanced><View className='invoice-request-content'>{profiles.map((profile) => <View key={profile.id} className={selectedId === profile.id ? 'invoice-profile-choice invoice-profile-choice--active aim-card' : 'invoice-profile-choice aim-card'} onClick={() => setSelectedId(profile.id)}><View><Text className='invoice-profile-choice__type'>{profile.type === 'COMPANY' ? '企业' : '个人'}</Text><Text className='invoice-profile-choice__title'>{profile.title}</Text>{profile.taxNo ? <Text className='invoice-profile-choice__meta'>税号 {profile.taxNo}</Text> : null}</View><Text className='invoice-profile-choice__radio'>{selectedId === profile.id ? '●' : '○'}</Text></View>)}{profiles.length === 0 ? <CatalogFeedback kind='empty' title='暂无发票抬头' description='新建抬头后即可申请开票' /> : null}<Button className='invoice-request-add' onClick={() => Taro.navigateTo({ url: `/packages/invoices/profile-edit/index?returnUrl=${encodeURIComponent(returnUrl)}` })}>+ 新建发票抬头</Button></View></ScrollView><View className='invoice-request-bar'><Button loading={mutation.isPending} disabled={!selectedId || mutation.isPending} onClick={submit}>{mutation.isPending ? '提交中...' : '确认申请开票'}</Button></View></>}</View></InvoiceAuthGate>;
}
