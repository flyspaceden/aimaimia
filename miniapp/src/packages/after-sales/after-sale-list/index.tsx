import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { useAuthStore } from '@/store/auth';
import { AfterSaleAuthGate } from '../_components/auth-gate';
import { MiniAfterSaleRepo } from '../repo';
import type { AfterSaleStatus } from '../types';
import { AFTER_SALE_STATUS_LABELS, AFTER_SALE_TYPE_LABELS, formatMoney, formatTime, productSnapshot } from '../utils';
import '../_components/after-sale-shared.scss';
import './index.scss';

const tone = (status: AfterSaleStatus) => ['REQUESTED', 'UNDER_REVIEW', 'PENDING_ARBITRATION'].includes(status) ? 'warn' : ['REJECTED', 'SELLER_REJECTED_RETURN'].includes(status) ? 'danger' : ['CLOSED', 'CANCELED'].includes(status) ? 'muted' : 'brand';

export default function AfterSaleListPage() {
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const query = useInfiniteQuery({
    queryKey: ['after-sales'],
    queryFn: async ({ pageParam = 1 }) => { const result = await MiniAfterSaleRepo.list(pageParam, 20); if (!result.ok) throw result.error; return result.data; },
    initialPageParam: 1,
    getNextPageParam: (page) => page.nextPage,
    enabled: loggedIn,
  });
  useDidShow(() => { if (useAuthStore.getState().accessToken) void query.refetch(); });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) || [], [query.data]);

  return <AfterSaleAuthGate returnUrl='/packages/after-sales/after-sale-list/index'><View className='after-sale-list-page'>
    <View className='after-sale-list-hero'><View><Text className='after-sale-list-hero__eyebrow'>SERVICE CASES</Text><Text className='after-sale-list-hero__title'>我的售后</Text></View><Text className='after-sale-list-hero__count'>{items.length} <Text>条已加载</Text></Text></View>
    <ScrollView className='after-sale-list-scroll' scrollY enhanced refresherEnabled refresherTriggered={query.isRefetching && !query.isFetchingNextPage} onRefresherRefresh={() => query.refetch()} lowerThreshold={180} onScrollToLower={() => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage(); }}>
      <View className='after-sale-list-content'>
        {query.isLoading ? <CatalogFeedback kind='loading' /> : query.isError ? <CatalogFeedback kind='error' title='售后记录加载失败' description={(query.error as { displayMessage?: string })?.displayMessage || '请稍后重试'} onRetry={() => query.refetch()} /> : items.length === 0 ? <CatalogFeedback kind='empty' title='暂无售后记录' description='需要帮助时，可从已收货订单发起售后' /> : items.map((item) => { const snapshot = productSnapshot(item); return <View className='after-sale-case aim-card' key={item.id} onClick={() => Taro.navigateTo({ url: `/packages/after-sales/after-sale-detail/index?id=${encodeURIComponent(item.id)}` })}><View className={`after-sale-case__rail after-sale-case__rail--${tone(item.status)}`} /><View className='after-sale-case__body'><View className='after-sale-case__head'><Text className='after-sale-case__shop'>{snapshot?.companyName || item.orderItem?.company?.name || '商家'}</Text><Text className={`after-sale-status after-sale-status--${tone(item.status)}`}>{AFTER_SALE_STATUS_LABELS[item.status]}</Text></View><Text className='after-sale-case__type'>{AFTER_SALE_TYPE_LABELS[item.afterSaleType]}</Text><View className='after-sale-case__product'><Image className='after-sale-case__image' src={snapshot?.image || snapshot?.images?.[0] || ''} mode='aspectFill' /><View className='after-sale-case__copy'><Text className='after-sale-case__title'>{snapshot?.title || '商品'}</Text>{snapshot?.skuTitle ? <Text className='after-sale-case__sku'>{snapshot.skuTitle}</Text> : null}<Text className='after-sale-case__price'>¥{formatMoney(item.orderItem?.unitPrice)} × {item.orderItem?.quantity || 1}</Text></View></View><View className='after-sale-case__foot'><Text>{formatTime(item.createdAt)}</Text>{item.refundAmount != null && !item.afterSaleType.endsWith('EXCHANGE') ? <Text>预计退款 ¥{formatMoney(item.refundAmount)}</Text> : null}</View></View></View>; })}
        {query.isFetchingNextPage ? <Text className='after-sale-list-more'>正在加载更多...</Text> : items.length && !query.hasNextPage ? <Text className='after-sale-list-more'>已显示全部售后记录</Text> : null}
      </View>
    </ScrollView>
  </View></AfterSaleAuthGate>;
}
