import { Button, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { OrderRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import type { Order, OrderListFilter, RepurchaseResult, Result } from '@/types';
import { MiniOrderCard } from '../_components/order-card';
import {
  canCancelPaidOrder,
  canConfirmOrder,
  canRepurchaseOrder,
  repurchasePresentation,
} from '../_components/order-utils';
import './index.scss';

const PAGE_SIZE = 20;
const filters: Array<{ value: OrderListFilter | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'PAID', label: '待发货' },
  { value: 'SHIPPED', label: '已发货' },
  { value: 'DELIVERED', label: '待收货' },
  { value: 'afterSale', label: '售后' },
  { value: 'RECEIVED', label: '已完成' },
];

function parseFilter(value?: string): OrderListFilter | 'all' {
  return filters.some((item) => item.value === value) ? value as OrderListFilter | 'all' : 'all';
}

export default function OrderListPage() {
  const router = useRouter();
  const initialFilter = parseFilter(typeof router.params.status === 'string' ? router.params.status : undefined);
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const [filter, setFilter] = useState<OrderListFilter | 'all'>(initialFilter);
  const [busyId, setBusyId] = useState<string>();
  const queryClient = useQueryClient();
  const ordersQuery = useInfiniteQuery({
    queryKey: ['orders', filter],
    queryFn: async ({ pageParam = 1 }) => {
      const result = await OrderRepo.list(filter === 'all' ? undefined : filter, { page: pageParam, pageSize: PAGE_SIZE });
      if (!result.ok) throw result.error;
      return result.data;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: hydrated && loggedIn,
  });
  useDidShow(() => { if (useAuthStore.getState().accessToken) void ordersQuery.refetch(); });
  const orders = useMemo(() => ordersQuery.data?.pages.flatMap((page) => page.items) || [], [ordersQuery.data]);

  const refreshOrders = async (orderId?: string) => {
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    if (orderId) await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
  };
  const confirmMutation = useMutation({
    mutationFn: (order: Order) => OrderRepo.confirmReceive(order.id),
    onMutate: (order) => setBusyId(order.id),
    onSuccess: async (result, order) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '确认失败', icon: 'none' }); return; }
      await refreshOrders(order.id);
      Taro.showToast({ title: '已确认收货', icon: 'success' });
    },
    onError: () => Taro.showToast({ title: '网络开小差了', icon: 'none' }),
    onSettled: () => setBusyId(undefined),
  });
  const cancelMutation = useMutation({
    mutationFn: (order: Order) => OrderRepo.cancelPaidUnshipped(order.id),
    onMutate: (order) => setBusyId(order.id),
    onSuccess: async (result, order) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '取消失败', icon: 'none' }); return; }
      await refreshOrders(order.id);
      Taro.showToast({ title: '已取消，退款将原路处理', icon: 'none', duration: 2200 });
    },
    onError: () => Taro.showToast({ title: '网络开小差了', icon: 'none' }),
    onSettled: () => setBusyId(undefined),
  });
  const repurchaseMutation = useMutation({
    mutationFn: (order: Order): Promise<Result<RepurchaseResult>> => OrderRepo.repurchase(order.id),
    onMutate: (order) => setBusyId(order.id),
    onSuccess: async (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '再次购买失败', icon: 'none' }); return; }
      queryClient.setQueryData(['commerce', 'cart'], { ok: true, data: result.data.cart });
      const presentation = repurchasePresentation(result.data);
      const modal = await Taro.showModal({ title: presentation.title, content: presentation.lines.join('\n') || '原订单商品当前不可购买', showCancel: presentation.canOpenCart, cancelText: '稍后再看', confirmText: presentation.canOpenCart ? '去购物车' : '知道了', confirmColor: '#2E7D32' });
      if (presentation.canOpenCart && modal.confirm) void Taro.navigateTo({ url: '/packages/commerce/cart/index' });
    },
    onError: () => Taro.showToast({ title: '网络开小差了', icon: 'none' }),
    onSettled: () => setBusyId(undefined),
  });

  const confirmReceive = async (order: Order) => {
    const modal = await Taro.showModal({ title: '确认收货', content: '请确认已收到商品且无异常。', confirmText: '确认收货', confirmColor: '#2E7D32' });
    if (modal.confirm && !busyId) confirmMutation.mutate(order);
  };
  const cancelOrder = async (order: Order) => {
    const modal = await Taro.showModal({ title: '取消已付款订单', content: '只能在发货前取消，取消后将申请原路退款。', confirmText: '确认取消', confirmColor: '#A04B42' });
    if (modal.confirm && !busyId) cancelMutation.mutate(order);
  };

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page order-auth'><Text className='order-auth__stamp'>单</Text><Text className='order-auth__title'>登录后查看订单</Text><Text className='order-auth__copy'>App 与小程序共用订单数据。</Text><Button className='aim-button-primary order-auth__button' onClick={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/orders/order-list/index')}` })}>微信登录</Button></View>;

  return <View className='order-list-page'>
    <View className='order-list-hero'><View><Text className='order-list-hero__eyebrow'>从下单到收货</Text><Text className='order-list-hero__title'>我的订单</Text></View><Text className='order-list-hero__count'>{orders.length}<Text> 笔已加载</Text></Text></View>
    <ScrollView className='order-filter-scroll' scrollX enhanced showScrollbar={false}><View className='order-filters'>{filters.map((item) => <View key={item.value} className={filter === item.value ? 'order-filter order-filter--active' : 'order-filter'} onClick={() => setFilter(item.value)}>{item.label}</View>)}</View></ScrollView>
    <ScrollView className='order-list-scroll' scrollY enhanced refresherEnabled refresherTriggered={ordersQuery.isRefetching} onRefresherRefresh={() => ordersQuery.refetch()} onScrollToLower={() => { if (ordersQuery.hasNextPage && !ordersQuery.isFetchingNextPage) void ordersQuery.fetchNextPage(); }} lowerThreshold={180}>
      <View className='order-list-content'>
        {ordersQuery.isLoading ? <CatalogFeedback kind='loading' /> : ordersQuery.isError ? <CatalogFeedback kind='error' title='订单加载失败' description={(ordersQuery.error as { displayMessage?: string })?.displayMessage || '请稍后重试'} onRetry={() => ordersQuery.refetch()} /> : orders.length === 0 ? <CatalogFeedback kind='empty' title='暂无订单' description='当前筛选下还没有订单记录' /> : orders.map((order) => <MiniOrderCard key={order.id} order={order} busy={busyId === order.id} onOpen={() => Taro.navigateTo({ url: `/packages/orders/order-detail/index?id=${encodeURIComponent(order.id)}` })} onCancel={canCancelPaidOrder(order) ? () => cancelOrder(order) : undefined} onTrack={canConfirmOrder(order) ? () => Taro.navigateTo({ url: `/packages/orders/order-track/index?orderId=${encodeURIComponent(order.id)}` }) : undefined} onConfirm={canConfirmOrder(order) ? () => confirmReceive(order) : undefined} onRepurchase={canRepurchaseOrder(order) ? () => { if (!busyId) repurchaseMutation.mutate(order); } : undefined} />)}
        {ordersQuery.isFetchingNextPage ? <Text className='order-list-more'>正在加载更多...</Text> : orders.length > 0 && !ordersQuery.hasNextPage ? <Text className='order-list-more'>已经到底了</Text> : null}
      </View>
    </ScrollView>
  </View>;
}
