import { Button, ScrollView, Switch, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { PageHeader } from '@/components/PageHeader';
import { useAuthStore } from '@/store/auth';
import { MessageRepo } from '../repo';
import type { InboxCategory, InboxFilter, InboxMessage } from '../types';
import { categoryLabel, formatMessageTime, messageSeal, messageSealTone } from '../utils';
import './index.scss';

const PAGE_SIZE = 20;
const PAGE_PATH = '/packages/messages/inbox/index';
const filters: Array<{ value: InboxFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'interaction', label: '互动' },
  { value: 'transaction', label: '交易' },
  { value: 'system', label: '系统' },
];

export default function MessageInboxPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [lastDeleted, setLastDeleted] = useState<InboxMessage>();
  const [deletedRevision, setDeletedRevision] = useState(authRevision);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const queryClient = useQueryClient();
  const inboxQuery = useInfiniteQuery({
    queryKey: ['messages', 'inbox', authRevision, filter, unreadOnly],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const result = await MessageRepo.list(filter === 'all' ? undefined : filter as InboxCategory, unreadOnly, pageParam, PAGE_SIZE);
      if (!result.ok) throw result.error;
      return result.data;
    },
    getNextPageParam: (lastPage, allPages) => lastPage.length === PAGE_SIZE ? allPages.length + 1 : undefined,
    enabled: hydrated && loggedIn,
  });
  const unreadQuery = useQuery({
    queryKey: ['messages', 'unread-count', authRevision],
    queryFn: MessageRepo.getUnreadCount,
    enabled: hydrated && loggedIn,
  });
  useDidShow(() => { if (useAuthStore.getState().accessToken) void inboxQuery.refetch(); });
  useEffect(() => () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }, []);
  useEffect(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setLastDeleted(undefined);
    setDeletedRevision(authRevision);
  }, [authRevision]);

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['messages', 'inbox'] }),
    queryClient.invalidateQueries({ queryKey: ['messages', 'unread-count'] }),
  ]);
  const messages = useMemo(() => {
    const unique = new Map<string, InboxMessage>();
    for (const message of inboxQuery.data?.pages.flat() || []) {
      if (!unique.has(message.id)) unique.set(message.id, message);
    }
    return [...unique.values()];
  }, [inboxQuery.data]);
  const unreadCount = unreadQuery.data?.ok ? unreadQuery.data.data : messages.filter((item) => item.unread).length;

  const deleteMutation = useMutation({
    mutationFn: (message: InboxMessage) => MessageRepo.delete(message.id),
    onSuccess: async (result, message) => {
      if (!result.ok) {
        Taro.showToast({ title: result.error.displayMessage || '删除失败', icon: 'none' });
        return;
      }
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setDeletedRevision(authRevision);
      setLastDeleted(message);
      undoTimerRef.current = setTimeout(() => setLastDeleted(undefined), 5_000);
      await invalidate();
    },
  });
  const restoreMutation = useMutation({
    mutationFn: (id: string) => MessageRepo.restore(id),
    onSuccess: async (result) => {
      if (!result.ok) {
        Taro.showToast({ title: result.error.displayMessage || '恢复失败', icon: 'none' });
        return;
      }
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setLastDeleted(undefined);
      await invalidate();
    },
  });
  const markAllMutation = useMutation({
    mutationFn: MessageRepo.markAllRead,
    onSuccess: async (result) => {
      if (!result.ok) Taro.showToast({ title: result.error.displayMessage || '操作失败', icon: 'none' });
      else await invalidate();
    },
  });
  const visibleDeleted = deletedRevision === authRevision ? lastDeleted : undefined;

  const cleanup = async () => {
    let sheet: Awaited<ReturnType<typeof Taro.showActionSheet>>;
    try {
      sheet = await Taro.showActionSheet({ itemList: ['清理已读消息', '清空全部消息'] });
    } catch {
      return;
    }
    const all = sheet.tapIndex === 1;
    const modal = await Taro.showModal({
      title: all ? '清空全部消息？' : '清理已读消息？',
      content: all ? '所有消息将从当前账户移除。' : '未读消息会保留。',
      confirmText: all ? '全部清空' : '确认清理',
      confirmColor: '#A04B42',
    });
    if (!modal.confirm) return;
    const result = all ? await MessageRepo.deleteAll() : await MessageRepo.deleteRead();
    if (!result.ok) {
      Taro.showToast({ title: result.error.displayMessage || '清理失败', icon: 'none' });
      return;
    }
    setLastDeleted(undefined);
    await invalidate();
    Taro.showToast({ title: `已清理 ${result.data.deletedCount || 0} 条`, icon: 'none' });
  };

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page message-auth'><CatalogFeedback kind='empty' title='登录后查看消息' description='订单、客服和系统消息只对当前账户可见' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(PAGE_PATH)}` })} /></View>;

  return (
    <View className='message-inbox-page'>
      <View className='message-inbox-hero'>
        <PageHeader title='消息中心' eyebrow='订单进度 · 服务提醒'>
          <Button className='message-inbox-hero__more' onClick={() => { void cleanup(); }}>整理</Button>
        </PageHeader>
        <View className='message-inbox-summary'>
          <Text><Text className='message-inbox-summary__count'>{unreadCount}</Text> 条未读消息</Text>
          <View className='message-inbox-summary__toggle'><Text>仅看未读</Text><Switch checked={unreadOnly} color='#2E7D32' onChange={(event) => setUnreadOnly(event.detail.value)} /></View>
        </View>
      </View>
      <View className='message-inbox-tabs'>{filters.map((item) => <View key={item.value} className={filter === item.value ? 'message-inbox-tab message-inbox-tab--active' : 'message-inbox-tab'} onClick={() => setFilter(item.value)}>{item.label}</View>)}</View>
      <ScrollView className='message-inbox-scroll' scrollY enhanced refresherEnabled refresherTriggered={inboxQuery.isRefetching} onRefresherRefresh={() => inboxQuery.refetch()} onScrollToLower={() => { if (inboxQuery.hasNextPage && !inboxQuery.isFetchingNextPage) void inboxQuery.fetchNextPage(); }} lowerThreshold={160}>
        <View className='message-inbox-content'>
          {inboxQuery.isLoading ? <CatalogFeedback kind='loading' /> : inboxQuery.isError ? <CatalogFeedback kind='error' description={(inboxQuery.error as { displayMessage?: string })?.displayMessage || '消息加载失败'} onRetry={() => inboxQuery.refetch()} /> : messages.length === 0 ? <CatalogFeedback kind='empty' title={unreadOnly ? '没有未读消息' : '暂无消息'} description='新的服务进度会出现在这里' /> : messages.map((message) => (
            <View className={message.unread ? 'message-card aim-card message-card--unread' : 'message-card aim-card'} key={message.id}>
              <View className={`message-card__seal message-card__seal--${messageSealTone(message.category)}`}>{messageSeal(message.category)}</View>
              <View className='message-card__body' onClick={() => Taro.navigateTo({ url: `/packages/messages/detail/index?id=${encodeURIComponent(message.id)}` })}>
                <View className='message-card__heading'><Text className='message-card__title'>{message.title}</Text><Text className='message-card__time'>{formatMessageTime(message.createdAt)}</Text></View>
                <Text className='message-card__category'>{categoryLabel(message.category)}{message.severity === 'WARNING' || message.severity === 'CRITICAL' ? ' · 重要' : ''}</Text>
                <Text className='message-card__content'>{message.content}</Text>
              </View>
              <Text className='message-card__delete' onClick={() => deleteMutation.mutate(message)}>删除</Text>
            </View>
          ))}
          {messages.length > 0 && !inboxQuery.hasNextPage ? <Text className='message-inbox-end'>已展示全部消息</Text> : null}
        </View>
      </ScrollView>
      {unreadCount > 0 ? <Button className='message-inbox-read-all' loading={markAllMutation.isPending} onClick={() => markAllMutation.mutate()}>全部标为已读</Button> : null}
      {visibleDeleted ? <View className='message-inbox-undo'><Text>已删除“{visibleDeleted.title}”</Text><Text className='message-inbox-undo__action' onClick={() => restoreMutation.mutate(visibleDeleted.id)}>撤销</Text></View> : null}
    </View>
  );
}
