import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { PostCard } from '../../src/components/cards';
import { AnalyticsRepo } from '../../src/repos';
import { mockUserProfile } from '../../src/mocks';
import { useTheme } from '../../src/theme';

export default function CircleAnalyticsScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['circle-analytics', 'c-002'],
    queryFn: () => AnalyticsRepo.getCompanyContentStats('c-002'),
  });
  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="企业内容分析" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={180} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={220} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1, paddingHorizontal: spacing.xl }}>
        <AppHeader title="企业内容分析" />
        <ErrorState
          title="数据加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={refetch}
        />
      </Screen>
    );
  }

  const stats = data.data;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="企业内容分析" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={[styles.headerCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>{stats.companyName}</Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
            内容表现概览（Mock）
          </Text>
          <View style={styles.metricRow}>
            <View style={styles.metricItem}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>{stats.totalPosts}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>帖子数</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>{stats.totalLikes}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>点赞</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>{stats.totalComments}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>评论</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>{stats.totalShares}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>转发</Text>
            </View>
          </View>
          <View style={{ marginTop: spacing.sm }}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>
              互动率 {stats.engagementRate}
            </Text>
          </View>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>近 7 日互动趋势</Text>
          <View style={[styles.trendCard, { borderColor: colors.border, borderRadius: radius.lg }]}>
            {stats.weeklyTrend.map((point) => (
              <View key={point.label} style={styles.trendRow}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>{point.label}</Text>
                <View style={[styles.trendTrack, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.trendFill,
                      { backgroundColor: colors.brand.primary, width: `${Math.min(100, point.value)}%` },
                    ]}
                  />
                </View>
                <Text style={[typography.caption, { color: colors.text.primary }]}>{point.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>高频标签</Text>
          <View style={styles.tagRow}>
            {stats.topTags.map((tag) => (
              <View key={tag} style={[styles.tagPill, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.pill }]}>
                <Text style={[typography.caption, { color: colors.brand.primary }]}>{tag}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>表现最佳内容</Text>
          {stats.topPosts.length === 0 ? (
            <View style={{ marginTop: spacing.md }}>
              <EmptyState title="暂无内容" description="发布内容后将显示数据" />
            </View>
          ) : (
            stats.topPosts.map((post) => (
              <View key={post.id} style={{ marginTop: spacing.md }}>
                <PostCard
                  post={post}
                  liked={post.likedBy.includes(mockUserProfile.id)}
                  currentUserId={mockUserProfile.id}
                  onPress={(item) => router.push({ pathname: '/post/[id]', params: { id: item.id } })}
                />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  metricItem: {
    alignItems: 'center',
    flex: 1,
  },
  trendCard: {
    borderWidth: 1,
    padding: 12,
    marginTop: 10,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  trendTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  trendFill: {
    height: '100%',
    borderRadius: 999,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  tagPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
    marginBottom: 8,
  },
});
