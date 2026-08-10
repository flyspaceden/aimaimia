import { Button, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { useAuthStore } from '@/store/auth';
import { InvoiceAuthGate } from '../_components/auth-gate';
import { openInvoicePdf } from '../pdf';
import { MiniInvoiceRepo } from '../repo';
import type { Invoice, InvoiceStatus } from '../types';
import { formatTime, INVOICE_STATUS_LABELS } from '../utils';
import '../_components/invoice-shared.scss';
import './index.scss';

const tone = (status: InvoiceStatus) => status === 'REQUESTED' ? 'requested' : status === 'FAILED' ? 'failed' : status === 'CANCELED' ? 'canceled' : 'issued';

export default function InvoiceListPage() {
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({ queryKey: ['invoices'], queryFn: async ({ pageParam = 1 }) => { const result = await MiniInvoiceRepo.list(pageParam, 20); if (!result.ok) throw result.error; return result.data; }, initialPageParam: 1, getNextPageParam: (page) => page.nextPage, enabled: loggedIn });
  useDidShow(() => { if (useAuthStore.getState().accessToken) void query.refetch(); });
  const invoices = useMemo(() => query.data?.pages.flatMap((page) => page.items) || [], [query.data]);
  const cancelMutation = useMutation({ mutationFn: (invoice: Invoice) => MiniInvoiceRepo.cancel(invoice.id), onSuccess: async (result, invoice) => { if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '取消失败', icon: 'none' }); return; } await Promise.all([queryClient.invalidateQueries({ queryKey: ['invoices'] }), queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] }), queryClient.invalidateQueries({ queryKey: ['orders'] })]); Taro.showToast({ title: '已取消开票申请', icon: 'success' }); } });
  const cancel = async (invoice: Invoice) => { const modal = await Taro.showModal({ title: '取消开票申请', content: '只有待开票且尚未被服务商受理的申请可取消。', confirmColor: '#A04B42' }); if (modal.confirm) cancelMutation.mutate(invoice); };
  const openPdf = async (url?: string | null) => { try { await openInvoicePdf(url); } catch (error) { Taro.showToast({ title: error instanceof Error ? error.message : '无法打开发票', icon: 'none' }); } };

  return <InvoiceAuthGate returnUrl='/packages/invoices/invoice-list/index'><View className='invoice-list-page'><View className='invoice-list-hero'><View><Text className='invoice-list-hero__eyebrow'>E-INVOICE ARCHIVE</Text><Text className='invoice-list-hero__title'>我的发票</Text></View><Text className='invoice-list-hero__count'>{invoices.length}<Text> 张发票</Text></Text></View><ScrollView className='invoice-list-scroll' scrollY enhanced refresherEnabled refresherTriggered={query.isRefetching && !query.isFetchingNextPage} onRefresherRefresh={() => query.refetch()} onScrollToLower={() => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage(); }} lowerThreshold={180}><View className='invoice-list-content'>
    {query.isLoading ? <CatalogFeedback kind='loading' /> : query.isError ? <CatalogFeedback kind='error' title='发票加载失败' description={(query.error as { displayMessage?: string })?.displayMessage || '请稍后重试'} onRetry={() => query.refetch()} /> : invoices.length === 0 ? <CatalogFeedback kind='empty' title='暂无发票记录' description='已确认收货的订单可申请开票' /> : invoices.map((invoice) => <View className='invoice-ticket aim-card' key={invoice.id}><View className='invoice-ticket__top' onClick={() => Taro.navigateTo({ url: `/packages/invoices/invoice-detail/index?id=${encodeURIComponent(invoice.id)}` })}><Text className='invoice-ticket__order'>订单 {invoice.orderId}</Text><Text className={`invoice-status invoice-status--${tone(invoice.status)}`}>{INVOICE_STATUS_LABELS[invoice.status]}</Text></View><View className='invoice-ticket__tear' /><View className='invoice-ticket__body' onClick={() => Taro.navigateTo({ url: `/packages/invoices/invoice-detail/index?id=${encodeURIComponent(invoice.id)}` })}><Text className='invoice-ticket__title'>{invoice.profileSnapshot.title}</Text><Text className='invoice-ticket__meta'>{invoice.profileSnapshot.type === 'COMPANY' ? '企业' : '个人'} · {formatTime(invoice.requestedAt || invoice.createdAt)}</Text>{invoice.status === 'FAILED' && invoice.failReason ? <Text className='invoice-ticket__error'>{invoice.failReason}</Text> : null}</View><View className='invoice-ticket__actions'>{invoice.status === 'ISSUED' && invoice.pdfUrl ? <Button onClick={() => openPdf(invoice.pdfUrl)}>查看发票</Button> : null}{invoice.status === 'REQUESTED' ? <Button disabled={cancelMutation.isPending} onClick={() => cancel(invoice)}>{cancelMutation.isPending ? '处理中...' : '取消申请'}</Button> : null}</View></View>)}
    {query.isFetchingNextPage ? <Text className='invoice-list-more'>正在加载更多...</Text> : null}
  </View></ScrollView><View className='invoice-list-bar'><Button onClick={() => Taro.navigateTo({ url: '/packages/invoices/profile-list/index' })}>管理发票抬头</Button></View></View></InvoiceAuthGate>;
}
