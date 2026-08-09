import { Button, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { useAuthStore } from '@/store/auth';
import { MessageRepo } from '../repo';
import { categoryLabel, formatMessageTime, messageSeal, resolveMessageRoute } from '../utils';
import './index.scss';

export default function MessageDetailPage() {
  const router = useRouter();
  const id = typeof router.params.id === 'string' ? router.params.id : '';
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const queryClient = useQueryClient();
  const messageQuery = useQuery({
    queryKey: ['messages', 'detail', authRevision, id],
    queryFn: () => MessageRepo.get(id),
    enabled: hydrated && loggedIn && Boolean(id),
  });
  const message = messageQuery.data?.ok ? messageQuery.data.data : undefined;
  useEffect(() => {
    if (!message?.unread) return;
    void MessageRepo.markRead(message.id).then((result) => {
      if (!result.ok) return;
      queryClient.setQueryData(['messages', 'detail', authRevision, message.id], {
        ok: true,
        data: { ...message, unread: false },
      });
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['messages', 'inbox'] }),
        queryClient.invalidateQueries({ queryKey: ['messages', 'unread-count'] }),
      ]);
    });
  }, [authRevision, message, queryClient]);
  const route = useMemo(() => resolveMessageRoute(message?.action || message?.target), [message]);

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) {
    const returnUrl = `/packages/messages/detail/index?id=${encodeURIComponent(id)}`;
    return <View className='aim-page message-detail-auth'><CatalogFeedback kind='empty' title='请先登录' description='登录后才能查看消息详情' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}` })} /></View>;
  }
  if (messageQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!id || !messageQuery.data || !messageQuery.data.ok) return <View className='aim-page'><CatalogFeedback kind='error' title='消息无法打开' description={messageQuery.data && !messageQuery.data.ok ? messageQuery.data.error.displayMessage || '消息不存在或已删除' : '消息参数不完整'} onRetry={() => messageQuery.refetch()} /></View>;

  return (
    <View className='aim-page message-detail-page'>
      <View className='message-detail-meta'>
        <Text className={`message-detail-meta__seal message-detail-meta__seal--${messageSeal(message!.category)}`}>{messageSeal(message!.category)}</Text>
        <View><Text className='message-detail-meta__category'>{categoryLabel(message!.category)}</Text><Text className='message-detail-meta__time'>{formatMessageTime(message!.createdAt, true)}</Text></View>
        {message!.severity === 'WARNING' || message!.severity === 'CRITICAL' ? <Text className='message-detail-meta__important'>重要</Text> : null}
      </View>
      <Text className='message-detail-title'>{message!.title}</Text>
      <View className='message-detail-rule' />
      <Text className='message-detail-content'>{message!.content}</Text>
      {route ? <Button className='message-detail-action' onClick={() => route.mode === 'switchTab' ? Taro.switchTab({ url: route.url }) : Taro.navigateTo({ url: route.url })}>{route.label} →</Button> : null}
      {!route && (message!.action || message!.target) ? <Text className='message-detail-safe-note'>相关功能暂未在小程序开放，请在对应业务页面中查看。</Text> : null}
    </View>
  );
}
