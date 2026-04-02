import React, { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { PostCard } from '../../src/components/cards';
import { ContentOpsRepo } from '../../src/repos';
import { mockUserProfile } from '../../src/mocks';
import { useTheme } from '../../src/theme';
import { AppError } from '../../src/types';

export default function CircleFeaturedScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['circle-featured'],
    queryFn: () => ContentOpsRepo.listFeaturedPosts(),
  });
  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const listError = data && !data.ok ? data.error : null;
  const posts = data?.ok ? data.data : [];

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="精华专区" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Text style={[typography.caption, { color: colors.text.secondary }]}>精选内容合集（占位）</Text>
        {isLoading ? (
          <View style={{ marginTop: spacing.md }}>
            <Skeleton height={220} radius={radius.lg} />
            <View style={{ height: spacing.md }} />
            <Skeleton height={220} radius={radius.lg} />
          </View>
        ) : (listError as AppError | null) ? (
          <View style={{ marginTop: spacing.md }}>
            <ErrorState
              title="加载失败"
              description={listError?.displayMessage ?? '请稍后再试'}
              onAction={refetch}
            />
          </View>
        ) : posts.length === 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <EmptyState title="暂无精华内容" description="优质内容会出现在这里" />
          </View>
        ) : (
          posts.map((post) => (
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
      </ScrollView>
    </Screen>
  );
}
