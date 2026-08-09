import { Button, ScrollView, Text, Textarea, View } from '@tarojs/components';
import Taro, { useDidHide, useDidShow, useRouter, useUnload } from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { CustomerServiceSocket } from '@/platform/customerServiceSocket';
import { useAuthStore } from '@/store/auth';
import { CustomerServiceRepo, normalizeCsSource } from '../repo';
import type { CsMessage, CsQuickEntry } from '../types';
import { CS_STATUS_LABEL, mergeCsMessages, normalizeSocketMessage } from '../utils';
import './index.scss';

function chatReturnUrl(params: Record<string, string | undefined>): string {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `/packages/customer-service/chat/index${query ? `?${query}` : ''}`;
}

export default function CustomerServiceChatPage() {
  const router = useRouter();
  const hydrated = useAuthStore((state) => state.hydrated);
  const accessToken = useAuthStore((state) => state.accessToken);
  const authRevision = useAuthStore((state) => state.revision);
  const loggedIn = Boolean(accessToken);
  const routeSessionId = typeof router.params.sessionId === 'string' ? router.params.sessionId : undefined;
  const routeSource = typeof router.params.source === 'string' ? router.params.source : undefined;
  const routeSourceId = typeof router.params.sourceId === 'string' ? router.params.sourceId : undefined;
  const [sessionId, setSessionId] = useState(routeSessionId);
  const [messages, setMessages] = useState<CsMessage[]>([]);
  const [messagesRevision, setMessagesRevision] = useState(authRevision);
  const [input, setInput] = useState('');
  const [socketJoined, setSocketJoined] = useState(false);
  const [socketHint, setSocketHint] = useState('正在连接实时客服');
  const [pageVisible, setPageVisible] = useState(true);
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingSent, setRatingSent] = useState(false);
  const sendingRef = useRef(false);
  const pageVisibleRef = useRef(true);
  const socketRef = useRef<CustomerServiceSocket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setMessages([]);
    setMessagesRevision(authRevision);
    setInput('');
    setSessionId(routeSessionId);
    setRatingSent(false);
    setSocketJoined(false);
  }, [authRevision, routeSessionId]);

  useEffect(() => {
    if (!hydrated || !loggedIn || routeSessionId || sessionId) return;
    let cancelled = false;
    void CustomerServiceRepo.createSession(normalizeCsSource(routeSource), routeSourceId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        Taro.showToast({ title: result.error.displayMessage || '创建客服会话失败', icon: 'none' });
        return;
      }
      setSessionId(result.data.sessionId);
    });
    return () => { cancelled = true; };
  }, [hydrated, loggedIn, routeSessionId, routeSource, routeSourceId, sessionId]);

  const detailQuery = useQuery({
    queryKey: ['customer-service', 'session', authRevision, sessionId],
    queryFn: () => CustomerServiceRepo.getSession(sessionId!),
    enabled: Boolean(hydrated && loggedIn && sessionId),
  });
  const messagesQuery = useQuery({
    queryKey: ['customer-service', 'messages', authRevision, sessionId],
    queryFn: () => CustomerServiceRepo.getMessages(sessionId!),
    enabled: Boolean(hydrated && loggedIn && sessionId),
    refetchInterval: pageVisible && !socketJoined ? 5_000 : false,
  });
  const quickEntriesQuery = useQuery({
    queryKey: ['customer-service', 'quick-entries', authRevision],
    queryFn: CustomerServiceRepo.getQuickEntries,
    enabled: hydrated && loggedIn,
    staleTime: 5 * 60_000,
  });
  const refetchDetail = detailQuery.refetch;
  const refetchMessages = messagesQuery.refetch;

  useEffect(() => {
    const result = messagesQuery.data;
    if (result?.ok) {
      setMessagesRevision(authRevision);
      setMessages((previous) => mergeCsMessages(previous, result.data));
    }
  }, [authRevision, messagesQuery.data]);

  const session = detailQuery.data?.ok ? detailQuery.data.data : undefined;
  const closed = session?.status === 'CLOSED';
  const rated = Boolean(session?.rating || ratingSent);

  useDidShow(() => {
    pageVisibleRef.current = true;
    setPageVisible(true);
    setSocketHint('正在连接实时客服');
    if (accessToken && sessionId) {
      void Promise.all([refetchDetail(), refetchMessages()]);
      void CustomerServiceRepo.markRead(sessionId);
    }
  });
  useDidHide(() => {
    pageVisibleRef.current = false;
    socketRef.current?.disconnect();
    socketRef.current = null;
    setPageVisible(false);
    setSocketJoined(false);
    setSocketHint('页面已隐藏，实时连接已暂停');
  });
  useUnload(() => {
    pageVisibleRef.current = false;
    socketRef.current?.disconnect();
    socketRef.current = null;
  });

  useEffect(() => {
    if (!pageVisible || !accessToken || !sessionId || closed) return;
    const socket = new CustomerServiceSocket(accessToken);
    socketRef.current = socket;
    const unsubscribers = [
      socket.on('connect', () => setSocketHint('已连接，正在加入会话')),
      socket.on('cs:ready', () => socket.emit('cs:join_session', { sessionId })),
      socket.on<{ sessionId: string }>('cs:joined', (payload) => {
        if (payload?.sessionId !== sessionId) return;
        setSocketJoined(true);
        setSocketHint('实时客服已连接');
        void refetchMessages();
      }),
      socket.on('disconnect', () => {
        setSocketJoined(false);
        setSocketHint('连接中断，已切换自动刷新');
      }),
      socket.on('connect_error', () => {
        setSocketJoined(false);
        setSocketHint('实时连接不可用，已切换自动刷新');
      }),
      socket.on('cs:error', (payload: unknown) => {
        const message = payload && typeof payload === 'object' && 'message' in payload
          ? String((payload as { message?: unknown }).message || '')
          : '';
        if (message) Taro.showToast({ title: message, icon: 'none' });
      }),
      socket.on('cs:message', (payload) => {
        const normalized = normalizeSocketMessage(payload, sessionId);
        if (!normalized) return;
        setMessages((previous) => mergeCsMessages(previous, [normalized]));
        if (normalized.senderType !== 'USER' && pageVisibleRef.current) void CustomerServiceRepo.markRead(sessionId);
      }),
      socket.on<{ sessionId: string; systemMessage?: unknown }>('cs:agent_released', (payload) => {
        if (payload?.sessionId !== sessionId) return;
        const normalized = normalizeSocketMessage(payload.systemMessage, sessionId);
        if (normalized) setMessages((previous) => mergeCsMessages(previous, [normalized]));
        void refetchDetail();
      }),
      socket.on<{ sessionId: string }>('cs:agent_joined', (payload) => {
        if (payload?.sessionId === sessionId) void refetchDetail();
      }),
      socket.on<{ sessionId: string }>('cs:session_closed', (payload) => {
        if (payload?.sessionId !== sessionId) return;
        setSocketJoined(false);
        void refetchDetail();
      }),
    ];
    void socket.connect();
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
      setSocketJoined(false);
    };
  }, [accessToken, closed, pageVisible, refetchDetail, refetchMessages, sessionId]);

  const sendMutation = useMutation({
    mutationFn: ({ content }: { content: string; localId: string }) => CustomerServiceRepo.sendMessage(sessionId!, content),
    onSuccess: (result, variables) => {
      sendingRef.current = false;
      if (!result.ok) {
        setMessages((previous) => previous.map((message) => message.id === variables.localId ? { ...message, _status: 'failed' } : message));
        Taro.showToast({ title: result.error.displayMessage || '发送失败，请点击重试', icon: 'none' });
        return;
      }
      setMessages((previous) => {
        const retained = previous.filter((message) => message.id !== variables.localId && message.id !== result.data.userMessage.id);
        return mergeCsMessages(retained, [result.data.userMessage, ...(result.data.aiReply ? [result.data.aiReply] : [])]);
      });
      void detailQuery.refetch();
    },
    onError: (_error, variables) => {
      sendingRef.current = false;
      setMessages((previous) => previous.map((message) => message.id === variables.localId ? { ...message, _status: 'failed' } : message));
    },
  });

  const send = (raw = input, failedId?: string) => {
    const content = raw.trim();
    if (!content || !sessionId || closed || sendingRef.current) return;
    if (content.length > 5000) {
      Taro.showToast({ title: '消息不能超过 5000 个字', icon: 'none' });
      return;
    }
    sendingRef.current = true;
    const localId = `local-${Date.now()}`;
    const localMessage: CsMessage = {
      id: localId,
      sessionId,
      senderType: 'USER',
      contentType: 'TEXT',
      content,
      createdAt: new Date().toISOString(),
      _status: 'sending',
    };
    setMessages((previous) => [...previous.filter((message) => message.id !== failedId), localMessage]);
    setInput('');
    sendMutation.mutate({ content, localId });
  };

  const closeMutation = useMutation({
    mutationFn: () => CustomerServiceRepo.closeSession(sessionId!),
    onSuccess: async (result) => {
      if (!result.ok || !result.data.ok) {
        Taro.showToast({ title: result.ok ? '结束会话失败' : result.error.displayMessage || '结束会话失败', icon: 'none' });
        return;
      }
      await Promise.all([
        detailQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['customer-service', 'sessions'] }),
      ]);
    },
  });
  const ratingMutation = useMutation({
    mutationFn: () => CustomerServiceRepo.submitRating(sessionId!, {
      score: ratingScore,
      comment: ratingComment.trim() || undefined,
    }),
    onSuccess: (result) => {
      if (!result.ok) {
        Taro.showToast({ title: result.error.displayMessage || '评价提交失败', icon: 'none' });
        return;
      }
      setRatingSent(true);
      void detailQuery.refetch();
      Taro.showToast({ title: '感谢你的评价', icon: 'success' });
    },
  });

  const initialEntries = useMemo(
    () => quickEntriesQuery.data?.ok ? quickEntriesQuery.data.data : [],
    [quickEntriesQuery.data],
  );
  const quickEntries = useMemo(() => initialEntries.filter((entry) => entry.type === 'QUICK_ACTION').slice(0, 4), [initialEntries]);
  const questions = useMemo(() => initialEntries.filter((entry) => entry.type === 'HOT_QUESTION').slice(0, 6), [initialEntries]);
  const visibleMessages = messagesRevision === authRevision ? messages : [];
  const selectEntry = (entry: CsQuickEntry) => send(entry.message || entry.label);

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) {
    const returnUrl = chatReturnUrl({ sessionId: routeSessionId, source: routeSource, sourceId: routeSourceId });
    return <View className='aim-page cs-chat-auth'><CatalogFeedback kind='empty' title='登录后联系客服' description='客服会话只对当前账户可见' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}` })} /></View>;
  }
  if (!sessionId || detailQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (detailQuery.data && !detailQuery.data.ok) return <View className='aim-page'><CatalogFeedback kind='error' title='会话无法打开' description={detailQuery.data.error.displayMessage || '请确认会话仍然有效'} onRetry={() => detailQuery.refetch()} /></View>;

  return (
    <View className='cs-chat-page'>
      <View className='cs-chat-header'>
        <View>
          <Text className='cs-chat-header__eyebrow'>在线客服</Text>
          <Text className='cs-chat-header__title'>{session ? CS_STATUS_LABEL[session.status] : '正在接入'}</Text>
        </View>
        {!closed ? <Button className='cs-chat-header__close' loading={closeMutation.isPending} onClick={async () => {
          const modal = await Taro.showModal({ title: '结束本次服务？', content: '结束后仍可在历史对话中查看记录。', confirmText: '结束会话', confirmColor: '#2E7D32' });
          if (modal.confirm) closeMutation.mutate();
        }}
        >结束</Button> : null}
      </View>
      <View className={socketJoined ? 'cs-chat-connection cs-chat-connection--online' : 'cs-chat-connection'}>
        <View className='cs-chat-connection__dot' /><Text>{socketHint}</Text>
      </View>
      <ScrollView className='cs-chat-scroll' scrollY enhanced scrollWithAnimation>
        <View className='cs-chat-content'>
          {messagesQuery.isLoading && visibleMessages.length === 0 ? <CatalogFeedback kind='loading' /> : null}
          {messagesQuery.data && !messagesQuery.data.ok && visibleMessages.length === 0 ? <CatalogFeedback kind='error' title='消息加载失败' description={messagesQuery.data.error.displayMessage || '请稍后重试'} onRetry={() => messagesQuery.refetch()} /> : null}
          {visibleMessages.length === 0 && !routeSessionId ? (
            <View className='cs-chat-welcome aim-card'>
              <Text className='cs-chat-welcome__mark'>AI</Text>
              <Text className='cs-chat-welcome__title'>你好，我是爱买买智能客服</Text>
              <Text className='cs-chat-welcome__copy'>先描述你的问题；需要人工处理时，客服系统会继续接力。</Text>
              {quickEntries.length ? <View className='cs-chat-chips'>{quickEntries.map((entry) => <Text className='cs-chat-chip' key={entry.id} onClick={() => selectEntry(entry)}>{entry.label}</Text>)}</View> : null}
              {questions.map((entry) => <View className='cs-chat-question' key={entry.id} onClick={() => selectEntry(entry)}><Text>{entry.label}</Text><Text>›</Text></View>)}
            </View>
          ) : null}
          {visibleMessages.map((message) => (
            <View key={message.id} className={`cs-message cs-message--${message.senderType.toLowerCase()}`}>
              {message.senderType !== 'USER' ? <Text className='cs-message__sender'>{message.senderType === 'AGENT' ? '客服' : message.senderType === 'AI' ? 'AI 客服' : '系统'}</Text> : null}
              <View className='cs-message__bubble'>
                <Text className='cs-message__text'>{message.content}</Text>
                {message._status === 'sending' ? <Text className='cs-message__state'>发送中</Text> : null}
                {message._status === 'failed' ? <Text className='cs-message__retry' onClick={() => send(message.content, message.id)}>发送失败，点击重试</Text> : null}
              </View>
            </View>
          ))}
          {closed ? (
            <View className='cs-chat-rating aim-card'>
              <Text className='cs-chat-rating__title'>{rated ? '本次服务已评价' : '本次服务已结束'}</Text>
              {!rated ? <>
                <Text className='cs-chat-rating__copy'>请为这次服务打分</Text>
                <View className='cs-chat-rating__stars'>{[1, 2, 3, 4, 5].map((score) => <Text key={score} className={score <= ratingScore ? 'cs-chat-rating__star cs-chat-rating__star--active' : 'cs-chat-rating__star'} onClick={() => setRatingScore(score)}>★</Text>)}</View>
                <Textarea className='cs-chat-rating__input' value={ratingComment} maxlength={1000} placeholder='补充意见（选填）' onInput={(event) => setRatingComment(event.detail.value)} />
                <Button className='cs-chat-rating__submit' loading={ratingMutation.isPending} onClick={() => ratingMutation.mutate()}>提交评价</Button>
              </> : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
      {!closed ? <View className='cs-chat-composer'>
        <Textarea className='cs-chat-composer__input' value={input} maxlength={5000} autoHeight placeholder='请输入你的问题' onInput={(event) => setInput(event.detail.value)} />
        <Button className='cs-chat-composer__send' disabled={!input.trim() || sendMutation.isPending} onClick={() => send()}>发送</Button>
      </View> : null}
    </View>
  );
}
