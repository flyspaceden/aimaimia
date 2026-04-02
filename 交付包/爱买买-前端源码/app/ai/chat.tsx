import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { AiAssistantRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AiChatMessage } from '../../src/types';
import { useToast } from '../../src/components/feedback';

export default function AiChatScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const { show } = useToast();
  const { prompt } = useLocalSearchParams<{ prompt?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);

  const { data: shortcutData, refetch } = useQuery({
    queryKey: ['ai-shortcuts'],
    queryFn: () => AiAssistantRepo.listShortcuts(),
  });

  const shortcuts = shortcutData?.ok ? shortcutData.data : [];

  const greeting = useMemo<AiChatMessage>(
    () => ({
      id: 'ai-greeting',
      role: 'assistant',
      content: '你好，我是 AI 农管家。',
      createdAt: new Date().toISOString(),
    }),
    []
  );

  useEffect(() => {
    setMessages([greeting]);
  }, [greeting]);

  useEffect(() => {
    if (!prompt) {
      return;
    }
    handleSend(String(prompt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleSend = async (text?: string) => {
    const value = (text ?? input).trim();
    if (!value) {
      return;
    }
    const userMessage: AiChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: value,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setSending(true);
    const result = await AiAssistantRepo.chat(value);
    setSending(false);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '发送失败', type: 'error' });
      return;
    }
    setMessages((prev) => [...prev, result.data]);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="AI 农管家" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flex: 1 }}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            <View style={styles.shortcutRow}>
              {shortcuts.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => handleSend(item.prompt)}
                  style={[
                    styles.shortcutChip,
                    { backgroundColor: colors.brand.primarySoft, borderRadius: radius.pill },
                  ]}
                >
                  <Text style={[typography.caption, { color: colors.brand.primary }]}>{item.title}</Text>
                </Pressable>
              ))}
            </View>

            {messages.map((message) => {
              const isUser = message.role === 'user';
              return (
                <View
                  key={message.id}
                  style={[
                    styles.messageRow,
                    { justifyContent: isUser ? 'flex-end' : 'flex-start' },
                  ]}
                >
                  <View
                    style={[
                      styles.bubble,
                      {
                        backgroundColor: isUser ? colors.brand.primary : colors.surface,
                        borderColor: isUser ? colors.brand.primary : colors.border,
                        borderRadius: radius.lg,
                      },
                    ]}
                  >
                    <Text style={[typography.body, { color: isUser ? colors.text.inverse : colors.text.primary }]}>
                      {message.content}
                    </Text>
                  </View>
                </View>
              );
            })}

            {sending ? (
              <View style={[styles.messageRow, { justifyContent: 'flex-start' }]}>
                <View style={[styles.bubble, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg }]}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>AI 正在思考…</Text>
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View style={[styles.inputBar, { borderTopColor: colors.border }]}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="向 AI 农管家提问"
              placeholderTextColor={colors.text.secondary}
              style={[styles.input, { color: colors.text.primary }]}
            />
            <Pressable
              onPress={() => handleSend()}
              style={[styles.sendButton, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
            >
              <MaterialCommunityIcons name="send" size={16} color={colors.text.inverse} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  shortcutRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  shortcutChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  inputBar: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  sendButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 8,
  },
});
