import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { ContentOpsRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AppError } from '../../src/types';

export default function CircleRankingsScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['circle-rankings'],
    queryFn: () => ContentOpsRepo.listContributionRankings(),
  });
  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const listError = data && !data.ok ? data.error : null;
  const ranks = data?.ok ? data.data : [];

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="榜单与贡献值" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Text style={[typography.caption, { color: colors.text.secondary }]}>贡献值榜单（占位）</Text>
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
        ) : ranks.length === 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <EmptyState title="暂无榜单数据" description="贡献值将用于激励优质创作者" />
          </View>
        ) : (
          ranks.map((item, index) => (
            <View
              key={item.id}
              style={[styles.rankRow, { borderBottomColor: colors.border }]}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.primary, width: 24 }]}>
                {index + 1}
              </Text>
              {item.avatar ? (
                <Image source={{ uri: item.avatar }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: colors.brand.primarySoft }]} />
              )}
              <View style={styles.rankInfo}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  {item.role === 'company' ? '企业' : '用户'} · {item.badge ?? '贡献值'}
                </Text>
              </View>
              <View>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{item.score}</Text>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>贡献值</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    marginLeft: 6,
  },
  rankInfo: {
    flex: 1,
  },
});
