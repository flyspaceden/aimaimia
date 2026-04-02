import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { PostCard } from '../../src/components/cards';
import { PostShareSheet } from '../../src/components/overlay';
import { FeedRepo } from '../../src/repos';
import { mockUserProfile } from '../../src/mocks';
import { useTheme } from '../../src/theme';
import { AppError, Post } from '../../src/types';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const authorId = String(id ?? '');
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePost, setSharePost] = useState<Post | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['user-profile', authorId],
    queryFn: () => FeedRepo.getAuthorProfile(authorId),
    enabled: Boolean(authorId),
  });

  const { data: postsData, isLoading: postsLoading, refetch: refetchPosts } = useQuery({
    queryKey: ['user-posts', authorId],
    queryFn: () => FeedRepo.listByAuthor(authorId),
    enabled: Boolean(authorId),
  });

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="用户主页" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={140} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={220} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1, paddingHorizontal: spacing.xl }}>
        <AppHeader title="用户主页" />
        <ErrorState
          title="资料加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={refetch}
        />
      </Screen>
    );
  }

  const author = data.data;
  const isSelf = author.id === mockUserProfile.id;
  const isFollowed = Boolean(author.isFollowed);
  const intimacyLevel = Math.min(100, Math.max(0, author.intimacyLevel ?? 0));
  const postsError = postsData && !postsData.ok ? postsData.error : null;
  const posts = postsData?.ok ? postsData.data : [];

  const handleFollowToggle = async () => {
    const result = await FeedRepo.toggleFollow(author.id, mockUserProfile.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '关注失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['circle'] });
    refetch();
    refetchPosts();
  };
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchPosts()]);
    setRefreshing(false);
  };

  const openShareSheet = (post: Post) => {
    setSharePost(post);
    setShareOpen(true);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="用户主页" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={[styles.profileCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <View style={styles.profileRow}>
            {author.avatar ? (
              <Image source={{ uri: author.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.brand.primarySoft }]} />
            )}
            <View style={styles.profileInfo}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>{author.name}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                {author.title ?? author.tags?.[0] ?? '内容创作者'}
              </Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                {(author.city ? `${author.city} · ` : '') + `粉丝 ${author.followerCount ?? 0}`}
              </Text>
            </View>
            {!isSelf ? (
              <Pressable
                onPress={handleFollowToggle}
                style={[
                  styles.followButton,
                  {
                    borderColor: isFollowed ? colors.border : colors.brand.primary,
                    backgroundColor: isFollowed ? colors.surface : colors.brand.primary,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text style={[typography.caption, { color: isFollowed ? colors.text.secondary : colors.text.inverse }]}>
                  {isFollowed ? '已关注' : '关注'}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {isFollowed ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>亲密度 {intimacyLevel}%</Text>
              <View style={[styles.intimacyTrack, { backgroundColor: colors.border }]}>
                <View
                  style={[styles.intimacyFill, { backgroundColor: colors.brand.primary, width: `${intimacyLevel}%` }]}
                />
              </View>
            </View>
          ) : null}
          {author.interestTags?.length ? (
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
              兴趣：{author.interestTags.slice(0, 3).join(' / ')}
            </Text>
          ) : null}
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>Ta 的内容</Text>
        </View>

        {postsLoading ? (
          <View style={{ marginTop: spacing.md }}>
            <Skeleton height={220} radius={radius.lg} />
            <View style={{ height: spacing.md }} />
            <Skeleton height={220} radius={radius.lg} />
          </View>
        ) : (postsError as AppError | null) ? (
          <View style={{ marginTop: spacing.md }}>
            <ErrorState
              title="内容加载失败"
              description={postsError?.displayMessage ?? '请稍后重试'}
              onAction={refetchPosts}
            />
          </View>
        ) : posts.length === 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <EmptyState title="暂无内容" description="Ta 还没有发布内容" />
          </View>
        ) : (
          posts.map((post) => (
            <View key={post.id} style={{ marginTop: spacing.md }}>
              <PostCard
                post={post}
                liked={post.likedBy.includes(mockUserProfile.id)}
                currentUserId={mockUserProfile.id}
                onPress={(item) => router.push({ pathname: '/post/[id]', params: { id: item.id } })}
                onMore={() => show({ message: '已记录反馈', type: 'info' })}
                onLike={async (item) => {
                  const result = await FeedRepo.toggleLike(item.id, mockUserProfile.id);
                  if (!result.ok) {
                    show({ message: result.error.displayMessage ?? '点赞失败', type: 'error' });
                    return;
                  }
                  refetchPosts();
                }}
                onComment={(item) => router.push({ pathname: '/post/[id]', params: { id: item.id } })}
                onShare={openShareSheet}
              />
            </View>
          ))
        )}
      </ScrollView>
      <PostShareSheet open={shareOpen} post={sharePost} onClose={() => setShareOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginRight: 12,
  },
  profileInfo: {
    flex: 1,
  },
  followButton: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  intimacyTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 6,
  },
  intimacyFill: {
    height: '100%',
    borderRadius: 999,
  },
});
