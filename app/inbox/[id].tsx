import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { InboxRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import type { AppError, InboxCategory } from '../../src/types';
import { formatInboxDetailTimestamp } from '../../src/utils/inboxDisplay';
import {
  getBuyerNotificationActionLabel,
  resolveBuyerNotificationRoute,
} from '../../src/utils/notificationRoutes';

const categoryLabel = (category: InboxCategory) => {
  if (category === 'interaction' || category === 'service') return '互动消息';
  if (['transaction', 'order', 'after_sale', 'wallet', 'group_buy'].includes(category)) return '交易消息';
  return '系统消息';
};

export default function InboxDetailScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const messageId = Array.isArray(params.id) ? params.id[0] : params.id;
  const markedReadRef = useRef<string | null>(null);

  const {
    data: message,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['inbox-message', messageId],
    enabled: Boolean(messageId),
    queryFn: async () => {
      const result = await InboxRepo.getMessage(messageId!);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });

  useEffect(() => {
    if (!message?.unread || markedReadRef.current === message.id) return;
    markedReadRef.current = message.id;

    void InboxRepo.markRead(message.id).then(async (result) => {
      if (!result.ok) {
        markedReadRef.current = null;
        show({ message: result.error.displayMessage ?? '标记已读失败', type: 'error' });
        return;
      }
      queryClient.setQueryData(['inbox-message', message.id], { ...message, unread: false });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['inbox'] }),
        queryClient.invalidateQueries({ queryKey: ['me-inbox-unread'] }),
      ]);
    });
  }, [message, queryClient, show]);

  const target = message?.action ?? message?.target;
  const targetRoute = useMemo(() => resolveBuyerNotificationRoute(target), [target]);
  const actionLabel = useMemo(() => getBuyerNotificationActionLabel(target), [target]);
  const isImportant = message
    ? (message.severity === 'WARNING' || message.metadata?.priority === 'IMPORTANT')
    : false;

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="消息详情" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={36} radius={radius.md} />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={180} radius={radius.md} />
        </View>
      </Screen>
    );
  }

  if (!messageId || isError || !message) {
    const detailError = error as AppError | null;
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="消息详情" />
        <ErrorState
          title="消息无法打开"
          description={detailError?.displayMessage ?? '消息不存在或已被删除'}
          onAction={messageId ? refetch : undefined}
        />
      </Screen>
    );
  }

  return (
    <Screen safeAreaBottom contentStyle={{ flex: 1 }}>
      <AppHeader title="消息详情" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { padding: spacing.xl }]}
      >
        <View style={styles.metaRow}>
          <View style={[styles.typeIcon, { backgroundColor: colors.accent.blueSoft, borderRadius: radius.pill }]}>
            <MaterialCommunityIcons
              name={message.type === 'cs_outreach_invite' ? 'face-agent' : 'bell-outline'}
              size={20}
              color={colors.accent.blue}
            />
          </View>
          <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 10 }]}>
            {categoryLabel(message.category)}
          </Text>
          {isImportant ? (
            <View style={[styles.importantBadge, { borderColor: colors.warning, borderRadius: radius.sm }]}>
              <Text style={[typography.caption, { color: colors.warning }]}>重要</Text>
            </View>
          ) : null}
        </View>

        <Text style={[typography.headingLg, styles.title, { color: colors.text.primary }]}>
          {message.title}
        </Text>
        <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: 8 }]}>
          {formatInboxDetailTimestamp(message.createdAt)}
        </Text>

        <View style={[styles.divider, { backgroundColor: colors.divider }]} />

        <Text style={[typography.bodyLg, styles.body, { color: colors.text.primary }]}>
          {message.content}
        </Text>
      </ScrollView>

      {targetRoute && actionLabel ? (
        <View style={[styles.actionBar, { borderTopColor: colors.border, backgroundColor: colors.surface }, shadow.md]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            onPress={() => router.push(targetRoute as any)}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: colors.brand.primary,
                borderRadius: radius.md,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>{actionLabel}</Text>
            <MaterialCommunityIcons name="arrow-right" size={20} color={colors.text.inverse} />
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typeIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importantBadge: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 10,
  },
  title: {
    marginTop: 22,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 24,
  },
  body: {
    lineHeight: 28,
  },
  actionBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  actionButton: {
    minHeight: 50,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
