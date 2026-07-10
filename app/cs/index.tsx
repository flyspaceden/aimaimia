import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { AppHeader, Screen } from '../../src/components/layout';
import { useBottomInset, useTheme } from '../../src/theme';
import { useAuthStore } from '../../src/store';
import { CsRepo } from '../../src/repos';
import { CsMessage, CsQuickEntry, CsSessionListScope, CsSessionSummary } from '../../src/types';
import { CsMessageBubble } from '../../src/components/cs/CsMessageBubble';
import { CsQuickActions } from '../../src/components/cs/CsQuickActions';
import { CsHotQuestions } from '../../src/components/cs/CsHotQuestions';
import { CsTypingIndicator } from '../../src/components/cs/CsTypingIndicator';
import { useToast } from '../../src/components/feedback';
import { USE_MOCK, WS_BASE_URL } from '../../src/repos/http/config';
import {
  mergeCustomerServiceMessages,
  sortCustomerServiceMessages,
} from '../../src/utils/customerServiceMessages';

// 轮询间隔（毫秒）
const POLL_INTERVAL = 5000;

const SESSION_SOURCE_LABEL: Record<string, string> = {
  ADMIN_OUTREACH: '平台客服',
  MY_PAGE: '我的咨询',
  ORDER_DETAIL: '订单咨询',
  AFTERSALE_DETAIL: '售后咨询',
};

const SESSION_STATUS_LABEL: Record<string, string> = {
  AI_HANDLING: 'AI 接待中',
  QUEUING: '排队中',
  AGENT_HANDLING: '客服处理中',
  CLOSED: '已结束',
};

function formatSessionTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function CsIndexScreen() {
  const { colors, radius, spacing, typography, isDark } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const inputBottomPadding = useBottomInset(spacing.xs);
  const { source, sourceId, sessionId: routeSessionId, sessionStatus: routeSessionStatus } = useLocalSearchParams<{
    source?: string;
    sourceId?: string;
    sessionId?: string;
    sessionStatus?: CsSessionSummary['status'];
  }>();
  const showConversationList = !routeSessionId && !source && !sourceId;

  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // 同步锁：防止快速连点发送时 useState 异步导致的重复发送
  const sendingRef = useRef(false);
  const closingSessionRef = useRef(false);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const accessToken = useAuthStore((state) => state.accessToken);

  // 页面状态
  const [messages, setMessages] = useState<CsMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [sessionSocketReady, setSessionSocketReady] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [sessionScope, setSessionScope] = useState<CsSessionListScope>('active');

  const { data: sessionListData, isLoading: sessionListLoading, refetch: refetchSessionList } = useQuery({
    queryKey: ['cs-sessions', sessionScope],
    queryFn: () => CsRepo.listSessions(sessionScope, { page: 1, pageSize: 30 }),
    enabled: isLoggedIn && showConversationList,
    refetchInterval: showConversationList && sessionScope === 'active' ? POLL_INTERVAL : false,
  });

  const sessionList: CsSessionSummary[] = sessionListData?.ok ? sessionListData.data.items : [];

  // 获取快捷入口
  const { data: quickEntriesData } = useQuery({
    queryKey: ['cs-quick-entries'],
    queryFn: () => CsRepo.getQuickEntries(),
  });

  const quickEntries: CsQuickEntry[] = quickEntriesData?.ok ? quickEntriesData.data : [];

  // 创建/恢复会话
  useEffect(() => {
    if (showConversationList) return;

    let cancelled = false;
    const initSession = async () => {
      if (routeSessionId) {
        setMessages([]);
        setSessionId(routeSessionId);
        setSessionClosed(routeSessionStatus === 'CLOSED');
        const [sessionResult, messagesResult] = await Promise.all([
          CsRepo.getSession(routeSessionId),
          CsRepo.getMessages(routeSessionId),
        ]);
        if (!cancelled && sessionResult.ok) {
          setSessionClosed(sessionResult.data.status === 'CLOSED');
        }
        if (!cancelled && !sessionResult.ok) {
          show({ message: sessionResult.error.displayMessage ?? '加载客服会话状态失败', type: 'error' });
        }
        if (!cancelled && messagesResult.ok) {
          setMessages(mergeCustomerServiceMessages([], messagesResult.data));
        }
        if (!cancelled && !messagesResult.ok) {
          show({ message: messagesResult.error.displayMessage ?? '加载客服会话失败', type: 'error' });
        }
        return;
      }

      setMessages([]);
      const result = await CsRepo.createSession(source ?? 'MY_PAGE', sourceId);
      if (cancelled) return;
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '创建客服会话失败', type: 'error' });
        return;
      }

      setSessionId(result.data.sessionId);
      setSessionClosed(false);

      // 如果是已有会话，加载历史消息（按 createdAt 排序）
      if (result.data.isExisting) {
        const messagesResult = await CsRepo.getMessages(result.data.sessionId);
        if (!cancelled && messagesResult.ok) {
          setMessages(mergeCustomerServiceMessages([], messagesResult.data));
        }
      }
    };

    void initSession();
    return () => { cancelled = true; };
  }, [routeSessionId, routeSessionStatus, show, source, sourceId]);

  const mergeIncomingMessage = useCallback((incoming: CsMessage) => {
    setMessages((prev) => mergeCustomerServiceMessages(prev, [incoming]));
  }, []);

  useEffect(() => {
    if (showConversationList || USE_MOCK || !sessionId || !accessToken || sessionClosed) return;

    setSessionSocketReady(false);
    const socket = io(`${WS_BASE_URL}/cs`, {
      auth: { token: accessToken },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('cs:ready', () => {
      socket.emit('cs:join_session', { sessionId });
    });

    socket.on('cs:joined', (payload: { sessionId: string }) => {
      if (payload.sessionId !== sessionId) return;
      setSessionSocketReady(true);
    });

    socket.on('disconnect', () => {
      setSessionSocketReady(false);
    });

    socket.on('connect_error', () => {
      setSessionSocketReady(false);
    });

    socket.on('cs:message', (message: CsMessage) => {
      if (message.sessionId && message.sessionId !== sessionId) return;
      const normalizedMessage: CsMessage = {
        ...message,
        id: (message as any).id ?? `socket-${Date.now()}`,
        sessionId: message.sessionId ?? sessionId,
        createdAt: message.createdAt ?? new Date().toISOString(),
      };
      mergeIncomingMessage(normalizedMessage);
      if (message.senderType !== 'USER') {
        void CsRepo.markSessionRead(sessionId);
        void queryClient.invalidateQueries({ queryKey: ['cs-sessions'] });
      }
    });

    socket.on('cs:agent_released', (payload: { sessionId: string; systemMessage?: CsMessage | null }) => {
      if (payload.sessionId !== sessionId || !payload.systemMessage) return;
      mergeIncomingMessage(payload.systemMessage);
      void CsRepo.markSessionRead(sessionId);
      void queryClient.invalidateQueries({ queryKey: ['cs-sessions'] });
    });

    socket.on('cs:session_closed', (payload: { sessionId: string }) => {
      if (payload.sessionId !== sessionId) return;
      setSessionClosed(true);
      void queryClient.invalidateQueries({ queryKey: ['cs-sessions'] });
    });

    socket.on('cs:error', (payload: { message?: string }) => {
      if (payload?.message) show({ message: payload.message, type: 'error' });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken, mergeIncomingMessage, queryClient, sessionClosed, sessionId, show, showConversationList]);

  // HTTP 轮询获取新消息（非 Mock 模式）
  // D1+D8 修复：合并服务器消息时按 createdAt 排序 + 按 id 去重
  useEffect(() => {
    if (showConversationList || USE_MOCK || !sessionId || sessionClosed || sessionSocketReady) return;

    pollTimerRef.current = setInterval(async () => {
      // 修复竞态：发送中时跳过轮询，让 HTTP 响应独占状态更新
      if (sendingRef.current) return;

      const result = await CsRepo.getMessages(sessionId);
      if (result.ok) {
        setMessages((prev) => mergeCustomerServiceMessages(prev, result.data));
      }
    }, POLL_INTERVAL);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [sessionId, sessionClosed, sessionSocketReady, showConversationList]);

  // 监听键盘高度（跟 ai/chat.tsx 保持一致）
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        if (Platform.OS === 'ios') {
          LayoutAnimation.configureNext({
            duration: e.duration,
            update: { type: LayoutAnimation.Types.keyboard },
          });
        }
        setKeyboardHeight(e.endCoordinates.height);
      },
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      (e) => {
        if (Platform.OS === 'ios') {
          LayoutAnimation.configureNext({
            duration: e.duration,
            update: { type: LayoutAnimation.Types.keyboard },
          });
        }
        setKeyboardHeight(0);
      },
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // 发送消息
  // D4 修复：失败时不删除本地消息，标记为 failed 状态供重试
  const handleSend = useCallback(async (text?: string) => {
    // 同步锁：防止快速连点重复发送 + 让轮询识别发送中状态
    if (sendingRef.current) return;
    const value = (text ?? input).trim();
    if (!value || !sessionId || sessionClosed) return;

    sendingRef.current = true;

    // 添加用户消息到本地（带 status='sending' 标记）
    const localId = `local-${Date.now()}`;
    const userMessage: CsMessage = {
      id: localId,
      sessionId,
      senderType: 'USER',
      contentType: 'TEXT',
      content: value,
      createdAt: new Date().toISOString(),
      // @ts-ignore - extended local-only field
      _status: 'sending',
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setSending(true);

    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

    // 调用 API 发送消息
    const result = await CsRepo.sendMessage(sessionId, value);
    setSending(false);
    sendingRef.current = false;

    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '发送失败，请重试', type: 'error' });
      // D4: 不删除消息，标记为 failed 让用户能看到并重发
      setMessages((prev) =>
        prev.map((m) =>
          m.id === localId ? ({ ...m, _status: 'failed' } as any) : m,
        ),
      );
      return;
    }

    // 成功：用后端返回的 userMessage 替换本地占位
    // 修复竞态：如果 polling 已经提前拉到了后端消息，这里要避免重复
    setMessages((prev) => {
      const serverUserId = result.data.userMessage.id;
      const serverUserMsg = { ...result.data.userMessage, _status: 'sent' } as any;

      // 1. 去掉本地占位（localId）
      // 2. 如果 polling 已经拉到 serverUserId，也要去重
      const deduped = prev.filter((m) => m.id !== localId && m.id !== serverUserId);
      deduped.push(serverUserMsg);

      // 添加 AI 回复（按 id 去重）
      const { aiReply } = result.data;
      if (aiReply && !deduped.some((m) => m.id === aiReply.id)) {
        deduped.push(aiReply);
      }
      return sortCustomerServiceMessages(deduped);
    });
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
      // 重新聚焦输入框（submitBehavior 不生效时的兜底）
      inputRef.current?.focus();
    });
  }, [input, sessionId, sessionClosed, show]);

  // D4: 失败消息重发
  const handleResend = useCallback(async (failedMsg: CsMessage) => {
    if (sendingRef.current || !sessionId || sessionClosed) return;
    // 删除失败消息后重新发送
    setMessages((prev) => prev.filter((m) => m.id !== failedMsg.id));
    await handleSend(failedMsg.content);
  }, [handleSend, sessionClosed, sessionId]);

  // 处理快捷操作点击
  const handleQuickActionPress = useCallback((entry: CsQuickEntry) => {
    const text = entry.message ?? entry.label;
    void handleSend(text);
  }, [handleSend]);

  // 处理热门问题点击
  const handleHotQuestionPress = useCallback((entry: CsQuickEntry) => {
    const text = entry.message ?? entry.label;
    void handleSend(text);
  }, [handleSend]);

  // 结束会话（不弹评价，用户想结束就直接结束）
  const handleEndSession = useCallback(async () => {
    if (!sessionId || closingSessionRef.current) return;
    closingSessionRef.current = true;
    try {
      const result = await CsRepo.closeSession(sessionId);
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '结束会话失败，请重试', type: 'error' });
        return;
      }
      if (!result.data.ok) {
        show({ message: '结束会话失败，请重试', type: 'error' });
        return;
      }
      setSessionClosed(true);
      void queryClient.invalidateQueries({ queryKey: ['cs-sessions'] });
      const systemMsg: CsMessage = {
        id: `system-end-${Date.now()}`,
        sessionId,
        senderType: 'SYSTEM',
        contentType: 'TEXT',
        content: '本次服务已结束',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, systemMsg]);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    } catch {
      show({ message: '结束会话失败，请重试', type: 'error' });
    } finally {
      closingSessionRef.current = false;
    }
  }, [queryClient, sessionId, show]);

  const handleStartConversation = useCallback(() => {
    if (!isLoggedIn) {
      show({ message: '请先登录后再联系客服', type: 'info' });
      return;
    }
    router.push('/cs?source=MY_PAGE');
  }, [isLoggedIn, router, show]);

  const handleOpenSession = useCallback((item: CsSessionSummary) => {
    router.push({ pathname: '/cs', params: { sessionId: item.id, sessionStatus: item.status } });
  }, [router]);

  const renderSessionCard = (item: CsSessionSummary) => {
    const sourceLabel = SESSION_SOURCE_LABEL[item.source] ?? '客服对话';
    const statusLabel = SESSION_STATUS_LABEL[item.status] ?? '处理中';
    const lastContent = item.lastMessage?.content ?? '暂无消息';
    const lastTime = formatSessionTime(item.lastMessage?.createdAt ?? item.createdAt);
    const isClosed = item.status === 'CLOSED';

    return (
      <Pressable
        key={item.id}
        onPress={() => handleOpenSession(item)}
        style={({ pressed }) => [
          styles.sessionCard,
          {
            backgroundColor: colors.surfaceElevated,
            borderColor: colors.border,
            opacity: pressed ? 0.82 : 1,
          },
        ]}
      >
        <View style={styles.sessionIconWrap}>
          <View
            style={[
              styles.sessionIcon,
              { backgroundColor: item.source === 'ADMIN_OUTREACH' ? '#EEF2FF' : '#E8F5E9' },
            ]}
          >
            <MaterialCommunityIcons
              name={item.source === 'ADMIN_OUTREACH' ? 'account-tie-voice-outline' : 'headset'}
              size={22}
              color={item.source === 'ADMIN_OUTREACH' ? '#1D4ED8' : '#2E7D32'}
            />
          </View>
          {item.unreadCount > 0 ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>
                {item.unreadCount > 99 ? '99+' : item.unreadCount}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.sessionBody}>
          <View style={styles.sessionTitleRow}>
            <Text
              numberOfLines={1}
              style={[typography.body, styles.sessionTitle, { color: colors.text.primary }]}
            >
              {sourceLabel}
            </Text>
            <Text style={[typography.caption, { color: colors.text.tertiary }]}>{lastTime}</Text>
          </View>

          <Text numberOfLines={1} style={[typography.caption, { color: colors.text.secondary }]}>
            {lastContent}
          </Text>

          <View style={styles.sessionMetaRow}>
            <View
              style={[
                styles.statusPill,
                { backgroundColor: isClosed ? colors.bgSecondary : '#FFF7ED' },
              ]}
            >
              <Text
                style={[
                  typography.caption,
                  { color: isClosed ? colors.text.secondary : '#C2410C', fontWeight: '600' },
                ]}
              >
                {statusLabel}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.tertiary} />
          </View>
        </View>
      </Pressable>
    );
  };

  // AI 欢迎消息
  const welcomeMessage: CsMessage = {
    id: 'ai-welcome',
    sessionId: sessionId ?? '',
    senderType: 'AI',
    contentType: 'TEXT',
    content: '你好！我是爱买买智能客服，请问有什么可以帮您的？',
    createdAt: new Date().toISOString(),
  };

  // 是否展示初始内容（欢迎 + 快捷操作 + 热门问题）
  const showInitialContent = messages.length === 0 && !routeSessionId;
  const showWelcomeMessage = !routeSessionId;

  if (showConversationList) {
    const emptyTitle = isLoggedIn
      ? sessionScope === 'active' ? '暂无进行中的对话' : '暂无历史对话'
      : '登录后查看客服对话';

    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader
          title="客服中心"
          rightSlot={
            <Pressable onPress={handleStartConversation} style={styles.startHeaderButton}>
              <MaterialCommunityIcons name="plus-circle-outline" size={22} color={colors.brand.primary} />
            </Pressable>
          }
        />

        <View style={[styles.listContainer, { padding: spacing.lg }]}>
          <View style={styles.segmentRow}>
            {(['active', 'history'] as CsSessionListScope[]).map((scope) => {
              const selected = sessionScope === scope;
              return (
                <Pressable
                  key={scope}
                  onPress={() => setSessionScope(scope)}
                  style={[
                    styles.segmentButton,
                    {
                      backgroundColor: selected ? colors.brand.primary : colors.bgSecondary,
                      borderColor: selected ? colors.brand.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      typography.body,
                      { color: selected ? colors.text.inverse : colors.text.secondary, fontWeight: '700' },
                    ]}
                  >
                    {scope === 'active' ? '进行中' : '历史对话'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView
            style={styles.sessionList}
            contentContainerStyle={styles.sessionListContent}
            keyboardShouldPersistTaps="handled"
          >
            {sessionListLoading ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="progress-clock" size={34} color={colors.text.tertiary} />
                <Text style={[typography.body, { color: colors.text.secondary }]}>正在加载</Text>
              </View>
            ) : sessionList.length > 0 ? (
              sessionList.map(renderSessionCard)
            ) : (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="message-text-outline" size={38} color={colors.text.tertiary} />
                <Text style={[typography.body, { color: colors.text.secondary, fontWeight: '600' }]}>
                  {emptyTitle}
                </Text>
                {sessionScope === 'active' ? (
                  <Pressable
                    onPress={handleStartConversation}
                    style={({ pressed }) => [
                      styles.primaryAction,
                      { backgroundColor: colors.brand.primary, opacity: pressed ? 0.86 : 1 },
                    ]}
                  >
                    <MaterialCommunityIcons name="headset" size={18} color={colors.text.inverse} />
                    <Text style={[typography.body, { color: colors.text.inverse, fontWeight: '700' }]}>
                      发起咨询
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </ScrollView>

          <Pressable
            onPress={() => refetchSessionList()}
            style={({ pressed }) => [
              styles.refreshButton,
              {
                borderColor: colors.border,
                backgroundColor: colors.surfaceElevated,
                opacity: pressed ? 0.76 : 1,
              },
            ]}
          >
            <MaterialCommunityIcons name="refresh" size={18} color={colors.text.secondary} />
            <Text style={[typography.caption, { color: colors.text.secondary, fontWeight: '600' }]}>刷新</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="在线客服"
        rightSlot={
          !sessionClosed ? (
            <Pressable onPress={handleEndSession} style={styles.endButton}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>
                结束会话
              </Text>
            </Pressable>
          ) : undefined
        }
      />

      <View style={{ flex: 1, marginBottom: keyboardHeight }}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing.md }}
          onContentSizeChange={() =>
            requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
          }
          keyboardShouldPersistTaps="handled"
        >
          {showWelcomeMessage ? (
            <CsMessageBubble message={welcomeMessage} />
          ) : null}

          {/* 初始内容：快捷操作 + 热门问题 */}
          {showInitialContent && (
            <Animated.View entering={FadeInDown.duration(300)}>
              <CsQuickActions
                entries={quickEntries}
                onPress={handleQuickActionPress}
              />
              <CsHotQuestions
                entries={quickEntries}
                onPress={handleHotQuestionPress}
              />
            </Animated.View>
          )}

          {/* 消息列表 - U11: 每组消息首条显示时间戳（超过 5 分钟间隔或首条时） */}
          {messages.map((message, idx) => {
            const prev = messages[idx - 1];
            const showTimestamp =
              !prev ||
              new Date(message.createdAt).getTime() -
                new Date(prev.createdAt).getTime() >
                5 * 60 * 1000;
            return (
              <CsMessageBubble
                key={message.id}
                message={message}
                showTimestamp={showTimestamp}
                onRetry={() => void handleResend(message)}
              />
            );
          })}

          {/* 正在输入指示器 */}
          {sending && (
            <Animated.View
              entering={FadeInDown.duration(200)}
              style={styles.typingRow}
            >
              <View style={[styles.typingAvatar, { backgroundColor: '#E8F5E9' }]}>
                <MaterialCommunityIcons name="robot-outline" size={14} color="#2E7D32" />
              </View>
              <CsTypingIndicator />
            </Animated.View>
          )}
        </ScrollView>

        {/* 输入栏 */}
        {sessionClosed ? (
          <View
            style={[
              styles.closedBar,
              {
                paddingBottom: inputBottomPadding,
                backgroundColor: colors.bgSecondary,
                borderTopColor: colors.border,
              },
            ]}
          >
            <Pressable
              onPress={() => {
                setSessionClosed(false);
                setSessionId(null);
                setMessages([]);
                // 重新创建会话
                CsRepo.createSession(source ?? 'MY_PAGE', sourceId).then((res) => {
                  if (res.ok) setSessionId(res.data.sessionId);
                });
              }}
              style={({ pressed }) => [
                {
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.xl,
                  borderRadius: radius.pill,
                  backgroundColor: pressed ? colors.brand.primarySoft : colors.brand.primary,
                },
              ]}
            >
              <Text style={[typography.body, { color: colors.text.inverse, fontWeight: '600' }]}>
                重新开始对话
              </Text>
            </Pressable>
          </View>
        ) : Platform.OS === 'ios' ? (
          <BlurView
            intensity={80}
            tint={isDark ? 'dark' : 'light'}
            style={[
              styles.inputBarFlow,
              {
                paddingBottom: keyboardHeight > 0 ? spacing.xs : inputBottomPadding,
                borderTopColor: colors.border,
              },
            ]}
          >
            {renderInputContent()}
          </BlurView>
        ) : (
          <View
            style={[
              styles.inputBarFlow,
              {
                paddingBottom: keyboardHeight > 0 ? spacing.xs : inputBottomPadding,
                borderTopColor: colors.border,
                backgroundColor: isDark ? 'rgba(6,14,6,0.95)' : 'rgba(250,252,250,0.95)',
              },
            ]}
          >
            {renderInputContent()}
          </View>
        )}
      </View>

    </Screen>
  );

  function renderInputContent() {
    return (
      <View style={styles.inputRow}>
        {/* 输入框 */}
        <View
          style={[
            styles.inputWrapper,
            {
              backgroundColor: colors.bgSecondary,
              borderRadius: radius.lg,
              borderColor: colors.border,
            },
          ]}
        >
          <TextInput
            ref={inputRef}
            value={input}
            onChangeText={setInput}
            placeholder="输入您的问题..."
            placeholderTextColor={colors.text.tertiary}
            style={[styles.input, typography.body, { color: colors.text.primary }]}
            onSubmitEditing={() => handleSend()}
            returnKeyType="send"
            editable={!sessionClosed}
            blurOnSubmit={false}
          />
        </View>

        {/* 发送按钮 */}
        <Pressable
          onPress={() => handleSend()}
          disabled={sending || !input.trim()}
          style={({ pressed }) => [
            styles.sendButton,
            {
              borderRadius: radius.pill,
              backgroundColor: sending || !input.trim()
                ? colors.text.tertiary
                : '#2E7D32',
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <MaterialCommunityIcons name="send" size={16} color="#FFFFFF" />
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  startHeaderButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContainer: {
    flex: 1,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  segmentButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionList: {
    flex: 1,
  },
  sessionListContent: {
    paddingBottom: 88,
    gap: 10,
  },
  sessionCard: {
    minHeight: 92,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionIconWrap: {
    width: 52,
    height: 52,
    marginRight: 12,
  },
  sessionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadge: {
    position: 'absolute',
    right: 0,
    top: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  sessionBody: {
    flex: 1,
    minWidth: 0,
  },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  sessionTitle: {
    flex: 1,
    fontWeight: '800',
  },
  sessionMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusPill: {
    minHeight: 24,
    borderRadius: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  primaryAction: {
    minHeight: 42,
    borderRadius: 22,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  refreshButton: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    minHeight: 38,
    borderRadius: 19,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  endButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  typingAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputBarFlow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputWrapper: {
    flex: 1,
    borderWidth: 1,
    marginRight: 8,
  },
  input: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  sendButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  closedBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    paddingVertical: 16,
  },
});
