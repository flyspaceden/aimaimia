import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { AiAssistantRepo, AiSessionRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AuthSession, AiChatMessage, AiChatMessageExtended, AiSuggestedAction } from '../../src/types';
import { useToast } from '../../src/components/feedback';
import { AiChatBubble } from '../../src/components/ui/AiChatBubble';
import { AiDivider } from '../../src/components/ui/AiDivider';
import { AiLoadingIndicator } from '../../src/components/effects/AiLoadingIndicator';
import { useAiChatStore, useAuthStore } from '../../src/store';
import { USE_MOCK } from '../../src/repos/http/config';
import { AuthModal } from '../../src/components/overlay';

export default function AiChatScreen() {
  const { colors, radius, spacing, typography, isDark } = useTheme();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { prompt, sessionId: paramSessionId, initialTranscript, initialReply, initialMessage, suggestedActions: suggestedActionsStr } = useLocalSearchParams<{
    prompt?: string;
    sessionId?: string;
    initialTranscript?: string;
    initialReply?: string;
    initialMessage?: string;
    suggestedActions?: string;
  }>();
  const scrollRef = useRef<ScrollView>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [newestMessageId, setNewestMessageId] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [remoteSessionId, setRemoteSessionId] = useState<string | null>(paramSessionId ?? null);
  const [remoteMessages, setRemoteMessages] = useState<AiChatMessageExtended[]>([]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const promptHandledRef = useRef(false);
  const pendingSendRef = useRef<string | null>(null);
  // session 初始化锁：resolve 后 handleSend 才能执行，防止 ensureRemoteSession 创建重复 session
  const sessionReadyPromiseRef = useRef<Promise<void> | null>(null);
  const sessionReadyResolveRef = useRef<(() => void) | null>(null);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const setLoggedIn = useAuthStore((state) => state.setLoggedIn);

  // Store
  const {
    activeSessionId,
    createSession,
    setActiveSession,
    addMessage,
    getActiveMessages,
  } = useAiChatStore();

  // 初始化会话：恢复已有 / 创建新会话
  // 使用 onRehydrateStorage 确保 AsyncStorage 数据已加载
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!USE_MOCK) {
      setInitialized(true);
      return;
    }

    const initSession = () => {
      if (paramSessionId) {
        // 直接从 store 获取最新状态（避免闭包问题）
        const currentSessions = useAiChatStore.getState().sessions;
        const exists = currentSessions.find((s) => s.id === paramSessionId);
        if (exists) {
          setActiveSession(paramSessionId);
          setInitialized(true);
          return;
        }
      }
      // 没有指定 sessionId 或找不到，创建新会话
      createSession();
      setInitialized(true);
    };

    // 检查 store 是否已经 hydrate 完成
    // zustand persist 的 onRehydrateStorage 是同步触发的
    // 但 AsyncStorage 是异步的，需要等待
    const unsub = useAiChatStore.persist.onFinishHydration(() => {
      initSession();
    });

    // 如果已经 hydrate 过了（非首次挂载），直接初始化
    if (useAiChatStore.persist.hasHydrated()) {
      initSession();
    }

    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (USE_MOCK) return;
    let cancelled = false;

    // 创建初始化锁，handleSend 会等待此 promise resolve 后才发送
    sessionReadyPromiseRef.current = new Promise<void>((resolve) => {
      sessionReadyResolveRef.current = resolve;
    });

    const initRemoteSession = async () => {
      if (paramSessionId) {
        const sessionResult = await AiSessionRepo.get(String(paramSessionId));
        if (cancelled) return;
        if (sessionResult.ok) {
          setRemoteSessionId(sessionResult.data.id);
          setRemoteMessages(AiSessionRepo.toMessages(sessionResult.data));
          sessionReadyResolveRef.current?.();
          return;
        }
      }

      const created = await AiSessionRepo.create('assistant');
      if (cancelled) return;
      if (!created.ok) {
        show({ message: created.error.displayMessage ?? '创建会话失败', type: 'error' });
        sessionReadyResolveRef.current?.();
        return;
      }

      // 首页"继续对话"跳转时：先 seed 首轮对话到后端，再设 sessionId
      // 确保后续 sendMessage 读到的历史一定包含首页那轮
      if (initialTranscript && initialReply) {
        const seedResult = await AiSessionRepo.seedMessage(
          created.data.id, String(initialTranscript), String(initialReply),
        );
        if (cancelled) return;
        if (!seedResult.ok) {
          console.warn('[AiChat] seedMessage failed, initial context may be missing from backend history');
        }
      }

      setRemoteSessionId(created.data.id);
      setRemoteMessages([]);
      sessionReadyResolveRef.current?.();
    };

    void initRemoteSession();

    return () => {
      cancelled = true;
      // 组件卸载时也要 resolve，防止 handleSend 永远挂起
      sessionReadyResolveRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramSessionId, show]);

  const ensureRemoteSession = useCallback(async () => {
    if (remoteSessionId) return remoteSessionId;

    const created = await AiSessionRepo.create('assistant');
    if (!created.ok) {
      show({ message: created.error.displayMessage ?? '创建会话失败', type: 'error' });
      return null;
    }
    setRemoteSessionId(created.data.id);
    setRemoteMessages([]);
    return created.data.id;
  }, [remoteSessionId, show]);

  // 监听键盘高度
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

  const { data: shortcutData, refetch } = useQuery({
    queryKey: ['ai-shortcuts'],
    queryFn: () => AiAssistantRepo.listShortcuts(),
  });

  const shortcuts = shortcutData?.ok ? shortcutData.data : [];

  // 从 Store 获取当前会话消息
  const storedMessages = getActiveMessages();
  const currentMessages = USE_MOCK ? storedMessages : remoteMessages;

  // 展示消息列表：greeting + 会话消息
  const greeting = useMemo<AiChatMessageExtended>(
    () => ({
      id: 'ai-greeting',
      role: 'assistant',
      content: '你好，我是 AI 农管家。有什么可以帮你的吗？',
      createdAt: new Date().toISOString(),
    }),
    [],
  );

  const displayMessages = useMemo<AiChatMessageExtended[]>(
    () => [greeting, ...currentMessages],
    [currentMessages, greeting],
  );

  // 处理 prompt 参数（仅首次）
  useEffect(() => {
    if (!prompt || promptHandledRef.current || (!USE_MOCK && !remoteSessionId) || (USE_MOCK && !activeSessionId)) return;
    promptHandledRef.current = true;
    handleSend(String(prompt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, activeSessionId, remoteSessionId]);

  // 处理首页 → 聊天页初始上下文注入（本地消息显示）
  // 后端持久化已在 initRemoteSession 里同步完成（seed → setRemoteSessionId）
  const initialContextHandledRef = useRef(false);

  useEffect(() => {
    if (!initialTranscript || !initialReply || initialContextHandledRef.current) return;
    // Mock 模式立即注入；真实模式等 remoteSessionId 就绪（seed 已完成）
    if (!USE_MOCK && !remoteSessionId) return;
    initialContextHandledRef.current = true;

    const userMsg: AiChatMessageExtended = {
      id: `init-user-${Date.now()}`,
      role: 'user',
      content: String(initialTranscript),
      createdAt: new Date().toISOString(),
    };
    const assistantMsg: AiChatMessageExtended = {
      id: `init-assistant-${Date.now()}`,
      role: 'assistant',
      content: String(initialReply),
      createdAt: new Date().toISOString(),
    };

    if (USE_MOCK) {
      addMessage(userMsg);
      addMessage(assistantMsg);
    } else {
      setRemoteMessages((prev) => [...prev, userMsg, assistantMsg]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTranscript, initialReply, remoteSessionId]);

  // 处理语音助手 out-of-domain 引导回复（chatResponse 参数注入）
  // useVoiceRecording 检测到 chatResponse 时跳转此页携带 initialMessage + suggestedActions
  const chatResponseHandledRef = useRef(false);

  useEffect(() => {
    if (!initialMessage || chatResponseHandledRef.current) return;
    // Mock 模式等 activeSessionId；真实模式等 remoteSessionId
    if (!USE_MOCK && !remoteSessionId) return;
    if (USE_MOCK && !activeSessionId) return;
    chatResponseHandledRef.current = true;

    let parsedActions: AiSuggestedAction[] = [];
    if (suggestedActionsStr) {
      try {
        parsedActions = JSON.parse(String(suggestedActionsStr));
      } catch {
        parsedActions = [];
      }
    }

    const assistantMsg: AiChatMessageExtended = {
      id: `chat-response-${Date.now()}`,
      role: 'assistant',
      content: String(initialMessage),
      createdAt: new Date().toISOString(),
      suggestedActions: parsedActions.length > 0 ? parsedActions : undefined,
    };

    if (USE_MOCK) {
      addMessage(assistantMsg);
    } else {
      setRemoteMessages((prev) => [...prev, assistantMsg]);
    }
    setNewestMessageId(assistantMsg.id);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, suggestedActionsStr, activeSessionId, remoteSessionId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleSend = async (text?: string) => {
    const value = (text ?? input).trim();
    if (!value) return;

    // 等待 session 初始化完成（含 seed），防止 ensureRemoteSession 创建重复 session
    if (!USE_MOCK && sessionReadyPromiseRef.current) {
      await sessionReadyPromiseRef.current;
    }

    if (!USE_MOCK && !isLoggedIn) {
      pendingSendRef.current = value;
      setAuthModalOpen(true);
      show({ message: '请先登录或注册，再继续 AI 对话', type: 'warning' });
      return;
    }

    // 直接从 store 读最新状态，避免闭包捕获到旧的 null
    let currentSessionId = useAiChatStore.getState().activeSessionId;
    if (USE_MOCK && !currentSessionId) {
      // 极端情况：session 还未创建，立即创建一个
      currentSessionId = createSession();
    }

    const resolvedRemoteSessionId = USE_MOCK ? null : await ensureRemoteSession();
    if (!USE_MOCK && !resolvedRemoteSessionId) {
      return;
    }

    const userMessage: AiChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: value,
      createdAt: new Date().toISOString(),
    };

    // 追加到 Store（自动持久化）
    if (USE_MOCK) {
      addMessage(userMessage);
    } else {
      setRemoteMessages((prev) => [...prev, userMessage]);
    }
    setNewestMessageId(userMessage.id);
    setInput('');
    setSending(true);

    if (USE_MOCK) {
      const result = await AiAssistantRepo.chat(value);
      setSending(false);

      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '发送失败', type: 'error' });
        return;
      }

      addMessage(result.data);
      setNewestMessageId(result.data.id);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      return;
    }

    const result = await AiSessionRepo.sendMessage(resolvedRemoteSessionId!, value);
    setSending(false);

    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '发送失败', type: 'error' });
      setRemoteMessages((prev) => prev.filter((message) => message.id !== userMessage.id));
      return;
    }

    const nextMessages = AiSessionRepo.toMessages({
      id: resolvedRemoteSessionId!,
      page: 'assistant',
      createdAt: new Date().toISOString(),
      utterances: [result.data],
    });
    const assistantMessage = nextMessages.find((message) => message.role === 'assistant');
    if (assistantMessage) {
      setRemoteMessages((prev) => [...prev, assistantMessage]);
      setNewestMessageId(assistantMessage.id);
    }
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const handleAuthSuccess = useCallback(async (session: AuthSession) => {
    setLoggedIn({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      userId: session.userId,
      loginMethod: session.loginMethod,
    });
    setAuthModalOpen(false);

    const pendingMessage = pendingSendRef.current;
    pendingSendRef.current = null;
    if (!pendingMessage) return;

    await ensureRemoteSession();
    void handleSend(pendingMessage);
  }, [ensureRemoteSession, handleSend, setLoggedIn]);

  const handleTypingComplete = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  // 新建对话
  const handleNewChat = () => {
    if (USE_MOCK) {
      createSession();
      promptHandledRef.current = false;
      return;
    }

    void (async () => {
      const created = await AiSessionRepo.create('assistant');
      if (!created.ok) {
        show({ message: created.error.displayMessage ?? '创建会话失败', type: 'error' });
        return;
      }
      setRemoteSessionId(created.data.id);
      setRemoteMessages([]);
      promptHandledRef.current = false;
    })();
    promptHandledRef.current = false;
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="AI 农管家"
        rightSlot={
          <Pressable onPress={handleNewChat} style={styles.newChatButton}>
            <MaterialCommunityIcons name="plus" size={22} color={colors.brand.primary} />
          </Pressable>
        }
      />
      <View style={{ flex: 1, marginBottom: keyboardHeight }}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          onContentSizeChange={() =>
            requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
          }
          keyboardShouldPersistTaps="handled"
        >
          {/* 快捷指令区 */}
          {shortcuts.length > 0 && currentMessages.length === 0 && (
            <Animated.View entering={FadeInDown.duration(300)}>
              <View style={styles.shortcutRow}>
                {shortcuts.map((item, index) => (
                  <Animated.View
                    key={item.id}
                    entering={FadeInDown.duration(300).delay(50 + index * 50)}
                  >
                    <Pressable
                      onPress={() => handleSend(item.prompt)}
                      style={{
                        borderRadius: radius.pill,
                        overflow: 'hidden',
                        marginRight: 8,
                        marginBottom: 8,
                      }}
                    >
                      <LinearGradient
                        colors={[colors.brand.primarySoft, colors.ai.soft]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.shortcutChip, { borderRadius: radius.pill }]}
                      >
                        <Text style={[typography.caption, { color: colors.ai.start }]}>
                          ✦ {item.title}
                        </Text>
                      </LinearGradient>
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
              <AiDivider style={{ marginBottom: spacing.md }} />
            </Animated.View>
          )}

          {/* 消息列表 */}
          {displayMessages.map((message) => (
            <AiChatBubble
              key={message.id}
              message={message}
              isNew={message.id === newestMessageId && message.role === 'assistant'}
              onTypingComplete={handleTypingComplete}
              onFollowUpPress={(question) => handleSend(question)}
            />
          ))}

          {/* AI 思考态 */}
          {sending && (
            <Animated.View
              entering={FadeInDown.duration(300)}
              style={[styles.thinkingRow, { justifyContent: 'flex-start' }]}
            >
              <AiLoadingIndicator />
            </Animated.View>
          )}
        </ScrollView>

        {/* 输入栏 */}
        {Platform.OS === 'ios' ? (
          <BlurView
            intensity={80}
            tint={isDark ? 'dark' : 'light'}
            style={[
              styles.inputBarFlow,
              {
                paddingBottom: keyboardHeight > 0 ? spacing.xs : insets.bottom || spacing.xs,
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
                paddingBottom: keyboardHeight > 0 ? spacing.xs : insets.bottom || spacing.xs,
                borderTopColor: colors.border,
                backgroundColor: isDark ? 'rgba(6,14,6,0.95)' : 'rgba(250,252,250,0.95)',
              },
            ]}
          >
            {renderInputContent()}
          </View>
        )}
      </View>

      <AuthModal
        open={authModalOpen}
        onClose={() => {
          setAuthModalOpen(false);
          pendingSendRef.current = null;
        }}
        onSuccess={handleAuthSuccess}
      />
    </Screen>
  );

  function renderInputContent() {
    return (
      <View style={styles.inputRow}>
        {/* 历史会话按钮 */}
        <Pressable
          onPress={() => router.push('/ai/history')}
          style={[styles.iconButton, { backgroundColor: colors.ai.soft }]}
        >
          <MaterialCommunityIcons name="history" size={20} color={colors.ai.start} />
        </Pressable>

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
            value={input}
            onChangeText={setInput}
            placeholder="向 AI 农管家提问..."
            placeholderTextColor={colors.text.tertiary}
            style={[styles.input, typography.body, { color: colors.text.primary }]}
            onSubmitEditing={() => handleSend()}
            returnKeyType="send"
          />
        </View>

        {/* 发送按钮 */}
        <Pressable
          onPress={() => handleSend()}
          style={{ borderRadius: radius.pill, overflow: 'hidden' }}
        >
          <LinearGradient
            colors={[colors.brand.primary, colors.ai.start]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.sendButton, { borderRadius: radius.pill }]}
          >
            <MaterialCommunityIcons name="send" size={16} color={colors.text.inverse} />
          </LinearGradient>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  shortcutRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  shortcutChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  thinkingRow: {
    flexDirection: 'row',
    marginBottom: 10,
    paddingHorizontal: 4,
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
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  inputWrapper: {
    flex: 1,
    borderWidth: 1,
    marginHorizontal: 4,
  },
  input: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  sendButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  newChatButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
