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
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { useTheme } from '../../src/theme';
import { useAuthStore } from '../../src/store';
import { CsRepo } from '../../src/repos';
import { CsMessage, CsQuickEntry } from '../../src/types';
import { CsMessageBubble } from '../../src/components/cs/CsMessageBubble';
import { CsQuickActions } from '../../src/components/cs/CsQuickActions';
import { CsHotQuestions } from '../../src/components/cs/CsHotQuestions';
import { CsTypingIndicator } from '../../src/components/cs/CsTypingIndicator';
import { CsRatingSheet } from '../../src/components/cs/CsRatingSheet';
import { useToast } from '../../src/components/feedback';
import { USE_MOCK } from '../../src/repos/http/config';

// 轮询间隔（毫秒）
const POLL_INTERVAL = 5000;

export default function CsIndexScreen() {
  const { colors, radius, spacing, typography, isDark } = useTheme();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const { source, sourceId } = useLocalSearchParams<{
    source?: string;
    sourceId?: string;
  }>();

  const scrollRef = useRef<ScrollView>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  // 页面状态
  const [messages, setMessages] = useState<CsMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showRating, setShowRating] = useState(false);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // 获取快捷入口
  const { data: quickEntriesData } = useQuery({
    queryKey: ['cs-quick-entries'],
    queryFn: () => CsRepo.getQuickEntries(),
  });

  const quickEntries: CsQuickEntry[] = quickEntriesData?.ok ? quickEntriesData.data : [];

  // 创建/恢复会话
  useEffect(() => {
    let cancelled = false;
    const initSession = async () => {
      const result = await CsRepo.createSession(source ?? 'MY_PAGE', sourceId);
      if (cancelled) return;
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '创建客服会话失败', type: 'error' });
        return;
      }

      setSessionId(result.data.sessionId);

      // 如果是已有会话，加载历史消息
      if (result.data.isExisting) {
        const messagesResult = await CsRepo.getMessages(result.data.sessionId);
        if (!cancelled && messagesResult.ok) {
          setMessages(messagesResult.data);
        }
      }
    };

    void initSession();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, sourceId]);

  // HTTP 轮询获取新消息（非 Mock 模式）
  useEffect(() => {
    if (USE_MOCK || !sessionId || sessionClosed) return;

    pollTimerRef.current = setInterval(async () => {
      const result = await CsRepo.getMessages(sessionId);
      if (result.ok) {
        setMessages(result.data);
      }
    }, POLL_INTERVAL);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [sessionId, sessionClosed]);

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
  const handleSend = useCallback(async (text?: string) => {
    const value = (text ?? input).trim();
    if (!value || !sessionId || sessionClosed) return;

    // 添加用户消息到本地
    const userMessage: CsMessage = {
      id: `user-${Date.now()}`,
      sessionId,
      senderType: 'USER',
      contentType: 'TEXT',
      content: value,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setSending(true);

    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

    // 调用 API 发送消息
    const result = await CsRepo.sendMessage(sessionId, value);
    setSending(false);

    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '发送失败', type: 'error' });
      // 移除发送失败的用户消息
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      return;
    }

    // 添加 AI/客服回复
    const { aiReply, transferred } = result.data;
    if (aiReply) {
      setMessages((prev) => [...prev, aiReply]);
    }
    // 转人工排队时添加系统提示
    if (transferred === false && result.data.userMessage) {
      // 检查是否有转人工排队的系统消息（通过 Socket.IO 推送，这里仅做 transferred 状态记录）
    }
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [input, sessionId, sessionClosed, show]);

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

  // 结束会话并弹出评价
  const handleEndSession = useCallback(async () => {
    setSessionClosed(true);
    // 通知后端关闭会话（释放坐席计数）
    if (sessionId) {
      await CsRepo.closeSession(sessionId).catch(() => {});
    }
    // 添加系统消息
    const systemMsg: CsMessage = {
      id: `system-end-${Date.now()}`,
      sessionId: sessionId ?? '',
      senderType: 'SYSTEM',
      contentType: 'TEXT',
      content: '本次服务已结束',
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, systemMsg]);
    // 停止轮询
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    // 延迟弹出评价
    setTimeout(() => setShowRating(true), 500);
  }, [sessionId]);

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
  const showInitialContent = messages.length === 0;

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
          {/* 欢迎消息（始终展示） */}
          <CsMessageBubble message={welcomeMessage} />

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

          {/* 消息列表 */}
          {messages.map((message) => (
            <CsMessageBubble key={message.id} message={message} />
          ))}

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
                paddingBottom: insets.bottom || spacing.xs,
                backgroundColor: colors.bgSecondary,
                borderTopColor: colors.border,
              },
            ]}
          >
            <Text style={[typography.body, { color: colors.text.tertiary }]}>
              会话已结束
            </Text>
          </View>
        ) : Platform.OS === 'ios' ? (
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

      {/* 评价弹窗 */}
      <CsRatingSheet
        visible={showRating}
        sessionId={sessionId ?? ''}
        onClose={() => setShowRating(false)}
      />
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
            value={input}
            onChangeText={setInput}
            placeholder="输入您的问题..."
            placeholderTextColor={colors.text.tertiary}
            style={[styles.input, typography.body, { color: colors.text.primary }]}
            onSubmitEditing={() => handleSend()}
            returnKeyType="send"
            editable={!sessionClosed}
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
