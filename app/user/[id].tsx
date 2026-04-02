import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { FollowRepo } from '../../src/repos';
import { mockUserProfile } from '../../src/mocks';
import { useTheme } from '../../src/theme';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const authorId = String(id ?? '');
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['user-profile', authorId],
    queryFn: () => FollowRepo.getAuthorProfile(authorId),
    enabled: Boolean(authorId),
  });

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="用户主页" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={140} radius={radius.lg} />
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

  const handleFollowToggle = async () => {
    const result = await FollowRepo.toggleFollow(author.id, mockUserProfile.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '关注失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['me-following'] });
    refetch();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="用户主页" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Animated.View entering={FadeInDown.duration(300)} style={[styles.profileCard, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <View style={styles.profileRow}>
            {author.avatar ? (
              <Image source={{ uri: author.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.brand.primarySoft }]} />
            )}
            <View style={styles.profileInfo}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>{author.name}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                {author.title ?? author.tags?.[0] ?? '用户'}
              </Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                {(author.city ? `${author.city} · ` : '') + `粉丝 ${author.followerCount ?? 0}`}
              </Text>
            </View>
            {!isSelf ? (
              isFollowed ? (
                <Pressable
                  onPress={handleFollowToggle}
                  style={[
                    styles.followButton,
                    { borderColor: colors.border, borderRadius: radius.pill },
                  ]}
                >
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>已关注</Text>
                </Pressable>
              ) : (
                <Pressable onPress={handleFollowToggle} style={{ overflow: 'hidden', borderRadius: radius.pill }}>
                  <LinearGradient
                    colors={[colors.brand.primary, colors.ai.start]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ paddingHorizontal: 12, paddingVertical: 6 }}
                  >
                    <Text style={[typography.caption, { color: colors.text.inverse }]}>关注</Text>
                  </LinearGradient>
                </Pressable>
              )
            ) : null}
          </View>
          {isFollowed ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>亲密度 {intimacyLevel}%</Text>
              <View style={[styles.intimacyTrack, { backgroundColor: colors.border }]}>
                <LinearGradient
                  colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.intimacyFill, { width: `${intimacyLevel}%` }]}
                />
              </View>
            </View>
          ) : null}
          {author.interestTags?.length ? (
            <Animated.View entering={FadeInDown.duration(300).delay(80)} style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
              {author.interestTags.slice(0, 3).map((tag) => (
                <View key={tag} style={{ overflow: 'hidden', borderRadius: radius.pill, marginRight: 6, marginBottom: 4 }}>
                  <LinearGradient
                    colors={[colors.brand.primarySoft, colors.ai.soft]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ paddingHorizontal: 10, paddingVertical: 4 }}
                  >
                    <Text style={[typography.caption, { color: colors.brand.primary }]}>{tag}</Text>
                  </LinearGradient>
                </View>
              ))}
            </Animated.View>
          ) : null}
        </Animated.View>
      </ScrollView>
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
