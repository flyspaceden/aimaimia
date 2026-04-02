import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { ContentOpsRepo } from '../../src/repos';
import { StatusPill } from '../../src/components/ui';
import { useTheme } from '../../src/theme';
import { AppError } from '../../src/types';

export default function CircleModerationScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['circle-moderation'],
    queryFn: () => ContentOpsRepo.listModerationQueue(),
  });
  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const listError = data && !data.ok ? data.error : null;
  const items = data?.ok ? data.data : [];

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="举报与审核" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Text style={[typography.caption, { color: colors.text.secondary }]}>审核队列（占位）</Text>
        {isLoading ? (
          <View style={{ marginTop: spacing.md }}>
            <Skeleton height={120} radius={radius.lg} />
            <View style={{ height: spacing.md }} />
            <Skeleton height={120} radius={radius.lg} />
          </View>
        ) : (listError as AppError | null) ? (
          <View style={{ marginTop: spacing.md }}>
            <ErrorState
              title="加载失败"
              description={listError?.displayMessage ?? '请稍后再试'}
              onAction={refetch}
            />
          </View>
        ) : items.length === 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <EmptyState title="暂无举报" description="待审核内容会出现在这里" />
          </View>
        ) : (
          items.map((item) => {
            const tone = item.status === 'flagged' ? 'accent' : item.status === 'approved' ? 'brand' : 'neutral';
            return (
              <Pressable
                key={item.postId}
                onPress={() => router.push({ pathname: '/post/[id]', params: { id: item.postId } })}
                style={[styles.queueRow, { borderBottomColor: colors.border }]}
              >
                <View style={styles.queueInfo}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                    {item.authorName} · 举报 {item.reportCount} 条
                  </Text>
                  {item.lastReviewedAt ? (
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                      最近审核：{item.lastReviewedAt}
                    </Text>
                  ) : null}
                </View>
                <StatusPill
                  label={ContentOpsRepo.getModerationLabel(item.status)}
                  tone={tone as 'brand' | 'accent' | 'neutral'}
                />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  queueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  queueInfo: {
    flex: 1,
    marginRight: 12,
  },
});
