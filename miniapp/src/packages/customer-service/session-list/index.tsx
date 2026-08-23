import { Button, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { PageHeader } from '@/components/PageHeader';
import { useAuthStore } from '@/store/auth';
import { CustomerServiceRepo } from '../repo';
import type { CsSessionScope, CsSessionSummary } from '../types';
import { CS_SOURCE_LABEL, CS_STATUS_LABEL, formatCsTime, mergeCsSessionPages, nextCsSessionPage } from '../utils';
import './index.scss';

const PAGE_PATH = '/packages/customer-service/session-list/index';

export default function CustomerServiceSessionListPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const [scope, setScope] = useState<CsSessionScope>('active');
  const queryClient = useQueryClient();
  const sessionsQuery = useInfiniteQuery({
    queryKey: ['customer-service', 'sessions', authRevision, scope],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => CustomerServiceRepo.listSessions(scope, pageParam, 30),
    getNextPageParam: nextCsSessionPage,
    enabled: hydrated && loggedIn,
    refetchInterval: scope === 'active' ? 5_000 : false,
  });
  useDidShow(() => { if (useAuthStore.getState().accessToken) void sessionsQuery.refetch(); });
  const createMutation = useMutation({
    mutationFn: () => CustomerServiceRepo.createSession('MY_PAGE'),
    onSuccess: async (result) => {
      if (!result.ok) {
        Taro.showToast({ title: result.error.displayMessage || '发起咨询失败', icon: 'none' });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['customer-service', 'sessions'] });
      await Taro.navigateTo({
        url: `/packages/customer-service/chat/index?sessionId=${encodeURIComponent(result.data.sessionId)}`,
      });
    },
  });
  const pages = useMemo(() => sessionsQuery.data?.pages ?? [], [sessionsQuery.data?.pages]);
  const sessions = useMemo(() => mergeCsSessionPages(pages), [pages]);
  const failedPage = pages.find((page) => !page.ok);
  const error = failedPage && !failedPage.ok ? failedPage.error : null;

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return (
    <View className='aim-page cs-auth'>
      <Text className='cs-auth__stamp'>服</Text>
      <Text className='cs-auth__title'>登录后联系客服</Text>
      <Text className='cs-auth__copy'>客服会话只对当前账户可见。</Text>
      <Button className='aim-button-primary cs-auth__button' onClick={() => Taro.redirectTo({
        url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(PAGE_PATH)}`,
      })}
      >去登录</Button>
    </View>
  );

  const openSession = (item: CsSessionSummary) => Taro.navigateTo({
    url: `/packages/customer-service/chat/index?sessionId=${encodeURIComponent(item.id)}`,
  });

  return (
    <View className='cs-list-page'>
      <View className='cs-list-hero'>
        <PageHeader title='客服中心' eyebrow='AI 先答 · 人工接力'>
          <Button className='cs-list-hero__new' loading={createMutation.isPending} onClick={() => createMutation.mutate()}>新咨询</Button>
        </PageHeader>
        <View className='cs-list-lane'>
          <View className='cs-list-lane__dot' />
          <Text>消息由平台客服系统保存，断线后可继续查看</Text>
        </View>
      </View>
      <View className='cs-list-tabs'>
        {(['active', 'history'] as CsSessionScope[]).map((value) => (
          <View key={value} className={scope === value ? 'cs-list-tab cs-list-tab--active' : 'cs-list-tab'} onClick={() => setScope(value)}>
            {value === 'active' ? '进行中' : '历史对话'}
          </View>
        ))}
      </View>
      <ScrollView className='cs-list-scroll' scrollY enhanced refresherEnabled refresherTriggered={sessionsQuery.isRefetching} onRefresherRefresh={() => sessionsQuery.refetch()}>
        <View className='cs-list-content'>
          {sessionsQuery.isLoading ? <CatalogFeedback kind='loading' /> : error ? (
            <CatalogFeedback kind='error' description={error.displayMessage || '客服会话加载失败'} onRetry={() => sessionsQuery.refetch()} />
          ) : sessions.length === 0 ? (
            <CatalogFeedback kind='empty' title={scope === 'active' ? '暂无进行中的对话' : '暂无历史对话'} description={scope === 'active' ? '有问题时可随时发起咨询' : '结束的服务会保存在这里'} actionLabel={scope === 'active' ? '发起咨询' : undefined} onRetry={scope === 'active' ? () => createMutation.mutate() : undefined} />
          ) : sessions.map((item) => (
            <View className='cs-session-card aim-card' key={item.id} hoverClass='cs-session-card--pressed' onClick={() => { void openSession(item); }}>
              <View className={item.source === 'ADMIN_OUTREACH' ? 'cs-session-card__seal cs-session-card__seal--outreach' : 'cs-session-card__seal'}>{item.source === 'ADMIN_OUTREACH' ? '台' : '服'}</View>
              <View className='cs-session-card__body'>
                <View className='cs-session-card__heading'>
                  <Text className='cs-session-card__title'>{CS_SOURCE_LABEL[item.source]}</Text>
                  <Text className='cs-session-card__time'>{formatCsTime(item.lastMessage?.createdAt || item.createdAt)}</Text>
                </View>
                <Text className='cs-session-card__preview'>{item.lastMessage?.content || '暂无消息'}</Text>
                <View className='cs-session-card__footer'>
                  <Text className={item.status === 'CLOSED' ? 'cs-session-card__status cs-session-card__status--closed' : 'cs-session-card__status'}>{CS_STATUS_LABEL[item.status]}</Text>
                  {item.unreadCount > 0 ? <Text className='cs-session-card__unread'>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text> : null}
                </View>
              </View>
              <Text className='cs-session-card__arrow'>›</Text>
            </View>
          ))}
          {sessionsQuery.hasNextPage ? <Button className='cs-list-load-more' loading={sessionsQuery.isFetchingNextPage} disabled={sessionsQuery.isFetchingNextPage} onClick={() => sessionsQuery.fetchNextPage()}>{sessionsQuery.isFetchingNextPage ? '加载中...' : '加载更多对话'}</Button> : null}
        </View>
      </ScrollView>
    </View>
  );
}
