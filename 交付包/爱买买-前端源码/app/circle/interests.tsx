import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { AnalyticsRepo } from '../../src/repos';
import { mockUserProfile } from '../../src/mocks';
import { useTheme } from '../../src/theme';

export default function CircleInterestsScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['circle-interests', mockUserProfile.id],
    queryFn: () => AnalyticsRepo.getUserInterestProfile(mockUserProfile.id),
  });
  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="用户兴趣图谱" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={180} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={140} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1, paddingHorizontal: spacing.xl }}>
        <AppHeader title="用户兴趣图谱" />
        <ErrorState
          title="数据加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={refetch}
        />
      </Screen>
    );
  }

  const profile = data.data;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="用户兴趣图谱" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Text style={[typography.title3, { color: colors.text.primary }]}>兴趣摘要</Text>
        <View style={[styles.summaryCard, { borderColor: colors.border, borderRadius: radius.lg }]}>
          {profile.summary.map((item) => (
            <Text key={item} style={[typography.body, { color: colors.text.secondary, marginBottom: 6 }]}>
              · {item}
            </Text>
          ))}
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>兴趣标签</Text>
          <View style={[styles.tagCard, { borderColor: colors.border, borderRadius: radius.lg }]}>
            {profile.tags.length === 0 ? (
              <EmptyState title="暂无数据" description="互动后将生成兴趣标签" />
            ) : (
              profile.tags.map((tag) => (
                <View key={tag.label} style={styles.tagRow}>
                  <Text style={[typography.body, { color: colors.text.primary }]}>{tag.label}</Text>
                  <View style={[styles.tagTrack, { backgroundColor: colors.border }]}>
                    <View
                      style={[
                        styles.tagFill,
                        { backgroundColor: colors.brand.primary, width: `${Math.min(100, tag.weight)}%` },
                      ]}
                    />
                  </View>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>{tag.weight}%</Text>
                </View>
              ))
            )}
          </View>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>行为信号</Text>
          <View style={[styles.summaryCard, { borderColor: colors.border, borderRadius: radius.lg }]}>
            {profile.behaviors.map((item) => (
              <Text key={item} style={[typography.body, { color: colors.text.secondary, marginBottom: 6 }]}>
                · {item}
              </Text>
            ))}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderWidth: 1,
    padding: 14,
    marginTop: 10,
  },
  tagCard: {
    borderWidth: 1,
    padding: 12,
    marginTop: 10,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  tagTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  tagFill: {
    height: '100%',
    borderRadius: 999,
  },
});
