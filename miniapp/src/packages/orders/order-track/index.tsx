import { Button, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { LogisticsRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import type { Shipment, ShipmentDetail } from '@/types';
import { dedupeTrackingEvents, formatOrderTime, maskTrackingNo, shipmentPackages, shortOrderNo } from '../_components/order-utils';
import './index.scss';

const statusLabels: Record<string, string> = {
  INIT: '待揽收', CREATED: '已创建', SHIPPED: '已发货', PICKED_UP: '已揽收', IN_TRANSIT: '运输中', DELIVERING: '派送中', DELIVERED: '已送达', EXCEPTION: '物流异常',
};

function PackageTimeline({ shipment, index, total }: { shipment: Shipment; index: number; total: number }) {
  const timeline = dedupeTrackingEvents(shipment.events || []);
  const tracking = shipment.trackingNoMasked || maskTrackingNo(shipment.trackingNo);
  return <View className='order-track-package aim-card'>
    <View className='order-track-package__head'><View><Text className='order-track-package__name'>{total > 1 ? `包裹 ${index + 1}` : '物流包裹'} · {shipment.carrierName || '承运商'}</Text><Text className='order-track-package__state'>{statusLabels[shipment.status] || shipment.status || '等待更新'}</Text></View><Text className='order-track-package__number' onClick={() => { if (shipment.trackingNo) void Taro.setClipboardData({ data: shipment.trackingNo }); }}>{tracking}{shipment.trackingNo ? ' 复制' : ''}</Text></View>
    {timeline.length ? <View className='order-track-timeline'>{timeline.map((event, eventIndex) => <View className={eventIndex === 0 ? 'order-track-event order-track-event--latest' : 'order-track-event'} key={event.id}><View className='order-track-event__rail'><View className='order-track-event__dot' />{eventIndex < timeline.length - 1 ? <View className='order-track-event__line' /> : null}</View><View className='order-track-event__copy'><Text className='order-track-event__message'>{event.message || '物流更新'}</Text>{event.location ? <Text className='order-track-event__location'>{event.location}</Text> : null}<Text className='order-track-event__time'>{formatOrderTime(event.occurredAt)}</Text></View></View>)}</View> : <Text className='order-track-package__empty'>承运商暂未回传物流节点</Text>}
  </View>;
}

export default function OrderTrackPage() {
  const router = useRouter();
  const orderId = typeof router.params.orderId === 'string' ? router.params.orderId : '';
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const queryClient = useQueryClient();
  const shipmentQuery = useQuery({ queryKey: ['shipment', orderId], queryFn: () => LogisticsRepo.getByOrderId(orderId), enabled: hydrated && loggedIn && Boolean(orderId), refetchInterval: 30_000 });
  useDidShow(() => { if (orderId && useAuthStore.getState().accessToken) void shipmentQuery.refetch(); });
  const refreshMutation = useMutation({
    mutationFn: () => LogisticsRepo.refreshTracking(orderId),
    onSuccess: (result) => { if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '更新失败', icon: 'none' }); return; } queryClient.setQueryData(['shipment', orderId], result); Taro.showToast({ title: '物流已更新', icon: 'success' }); },
    onError: () => Taro.showToast({ title: '网络开小差了', icon: 'none' }),
  });

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后才能查看物流' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(`/packages/orders/order-track/index?orderId=${orderId}`)}` })} /></View>;
  if (!orderId) return <View className='aim-page'><CatalogFeedback kind='error' title='订单信息缺失' description='请从订单详情重新进入' /></View>;
  if (shipmentQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!shipmentQuery.data || !shipmentQuery.data.ok) return <View className='aim-page'><CatalogFeedback kind='error' title='物流加载失败' description={shipmentQuery.data && !shipmentQuery.data.ok ? shipmentQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => shipmentQuery.refetch()} /></View>;

  const shipment = shipmentQuery.data.data as ShipmentDetail | null;
  const packages = shipmentPackages(shipment);
  return <View className='order-track-page'>
    <View className='order-track-hero'><View className='order-track-hero__trail'><View /><View /><View /></View><View><Text className='order-track-hero__eyebrow'>产地履约轨迹</Text><Text className='order-track-hero__title'>订单 {shortOrderNo(orderId)}</Text><Text className='order-track-hero__copy'>{packages.length > 1 ? `已拆分为 ${packages.length} 个包裹分别发货` : '下拉或点击按钮获取最新物流节点'}</Text></View><Button className='order-track-refresh' loading={refreshMutation.isPending} disabled={refreshMutation.isPending} onClick={() => refreshMutation.mutate()}>{refreshMutation.isPending ? '更新中' : '更新'}</Button></View>
    <ScrollView className='order-track-scroll' scrollY enhanced refresherEnabled refresherTriggered={shipmentQuery.isRefetching} onRefresherRefresh={() => refreshMutation.mutate()}>
      <View className='order-track-content'>{!shipment || packages.length === 0 ? <CatalogFeedback kind='empty' title='暂无物流信息' description='商家发货后，这里会展示承运商和运输轨迹' /> : packages.map((item, index) => <PackageTimeline shipment={item} index={index} total={packages.length} key={item.id} />)}</View>
    </ScrollView>
  </View>;
}
