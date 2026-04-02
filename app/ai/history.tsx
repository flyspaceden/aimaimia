import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { useTheme } from '../../src/theme';
import { useAiChatStore, AiChatSession, useAuthStore } from '../../src/store';
import { AiSessionRepo } from '../../src/repos';
import { AuthModal } from '../../src/components/overlay';
import { USE_MOCK } from '../../src/repos/http/config';
import { AuthSession } from '../../src/types';

/** 格式化时间显示 */
function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}天前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function AiHistoryScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const { sessions, deleteSession, clearAllSessions } = useAiChatStore();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const setLoggedIn = useAuthStore((state) => state.setLoggedIn);
  const sessionQuery = useQuery({
    queryKey: ['ai-sessions', isLoggedIn],
    queryFn: () => AiSessionRepo.list(),
    enabled: !USE_MOCK && isLoggedIn,
  });

  const remoteSessions = sessionQuery.data?.ok ? sessionQuery.data.data : [];
  const displaySessions = USE_MOCK ? sessions : remoteSessions;

  const handleOpen = (session: AiChatSession | { id: string }) => {
    router.push({ pathname: '/ai/chat', params: { sessionId: session.id } });
  };

  const handleDelete = (session: AiChatSession) => {
    Alert.alert('删除对话', `确定删除「${session.title}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deleteSession(session.id) },
    ]);
  };

  const handleClearAll = () => {
    if (sessions.length === 0) return;
    Alert.alert('清空所有对话', '确定清空全部本地对话记录？此操作不可恢复。', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: clearAllSessions },
    ]);
  };

  const handleAuthSuccess = async (session: AuthSession) => {
    setLoggedIn({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      userId: session.userId,
      loginMethod: session.loginMethod,
    });
    setAuthModalOpen(false);
    await sessionQuery.refetch();
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="对话记录"
        rightSlot={
          USE_MOCK && sessions.length > 0 ? (
            <Pressable onPress={handleClearAll} style={styles.clearButton}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>清空</Text>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}>
        {!USE_MOCK && !isLoggedIn ? (
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons
              name="lock-outline"
              size={48}
              color={colors.text.tertiary}
            />
            <Text style={[typography.body, { color: colors.text.tertiary, marginTop: spacing.md }]}>
              登录后可查看 AI 对话记录
            </Text>
            <Pressable
              onPress={() => setAuthModalOpen(true)}
              style={{ borderRadius: radius.pill, overflow: 'hidden', marginTop: spacing.lg }}
            >
              <LinearGradient
                colors={[colors.brand.primary, colors.ai.start]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.startButton, { borderRadius: radius.pill }]}
              >
                <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                  登录 / 注册
                </Text>
              </LinearGradient>
            </Pressable>
          </View>
        ) : displaySessions.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons
              name="chat-outline"
              size={48}
              color={colors.text.tertiary}
            />
            <Text style={[typography.body, { color: colors.text.tertiary, marginTop: spacing.md }]}>
              暂无对话记录
            </Text>
            <Pressable
              onPress={() => router.push('/ai/chat')}
              style={{ borderRadius: radius.pill, overflow: 'hidden', marginTop: spacing.lg }}
            >
              <LinearGradient
                colors={[colors.brand.primary, colors.ai.start]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.startButton, { borderRadius: radius.pill }]}
              >
                <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                  开始新对话
                </Text>
              </LinearGradient>
            </Pressable>
          </View>
        ) : (
          displaySessions.map((session: any, index) => {
            const messageCount = USE_MOCK
              ? session.messages.filter((m: any) => m.role === 'user').length
              : undefined;
            const preview = USE_MOCK
              ? (
                session.messages[session.messages.length - 1]
                  ? session.messages[session.messages.length - 1].content.slice(0, 40) +
                    (session.messages[session.messages.length - 1].content.length > 40 ? '...' : '')
                  : '空对话'
              )
              : (session.lastMessage || '空对话');
            const updatedAt = USE_MOCK ? session.updatedAt : (session.lastMessageAt || session.createdAt);
            const title = USE_MOCK ? session.title : (session.lastMessage || '新对话');

            return (
              <Animated.View
                key={session.id}
                entering={FadeInDown.duration(250).delay(index * 40)}
              >
                <Pressable
                  onPress={() => handleOpen(session)}
                  onLongPress={USE_MOCK ? () => handleDelete(session) : undefined}
                  style={[
                    styles.sessionCard,
                    shadow.sm,
                    {
                      backgroundColor: colors.surface,
                      borderRadius: radius.lg,
                      marginBottom: spacing.sm,
                    },
                  ]}
                >
                  <View style={[styles.sessionIcon, { backgroundColor: colors.ai.soft }]}>
                    <MaterialCommunityIcons
                      name="message-text-outline"
                      size={20}
                      color={colors.ai.start}
                    />
                  </View>
                  <View style={styles.sessionContent}>
                    <Text
                      style={[typography.bodyStrong, { color: colors.text.primary }]}
                      numberOfLines={1}
                    >
                      {title}
                    </Text>
                    <Text
                      style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}
                      numberOfLines={1}
                    >
                      {preview}
                    </Text>
                  </View>
                  <View style={styles.sessionMeta}>
                    <Text style={[typography.caption, { color: colors.text.tertiary }]}>
                      {formatTime(updatedAt)}
                    </Text>
                    {typeof messageCount === 'number' && (
                      <Text
                        style={[
                          typography.caption,
                          { color: colors.text.tertiary, marginTop: 2, textAlign: 'right' },
                        ]}
                      >
                        {messageCount} 条
                      </Text>
                    )}
                  </View>
                </Pressable>
              </Animated.View>
            );
          })
        )}
      </ScrollView>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  startButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  sessionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  sessionContent: {
    flex: 1,
  },
  sessionMeta: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
});
