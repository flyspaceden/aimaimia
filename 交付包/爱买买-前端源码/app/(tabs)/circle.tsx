import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { PostCard } from '../../src/components/cards';
import { PostComposerEntry, ProductQuickSheet } from '../../src/components/posts';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { Screen } from '../../src/components/layout';
import { PostShareSheet } from '../../src/components/overlay';
import { FeedRepo } from '../../src/repos';
import { mockUserProfile } from '../../src/mocks';
import { useTheme } from '../../src/theme';
import { AppError, FollowSuggestion, Post } from '../../src/types';

type CircleTab = 'recommend' | 'following' | 'company' | 'mine';
type SortOption = 'latest' | 'earliest' | 'relevant';

const toTime = (value: string) => new Date(value.replace(' ', 'T')).getTime();

export default function CircleScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<CircleTab>('recommend');
  const [sortOption, setSortOption] = useState<SortOption>('latest');
  const [productId, setProductId] = useState<string | undefined>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePost, setSharePost] = useState<Post | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['circle', activeTab],
    queryFn: () => {
      if (activeTab === 'following') {
        return FeedRepo.listFollowing();
      }
      if (activeTab === 'company') {
        return FeedRepo.listCompanies();
      }
      if (activeTab === 'mine') {
        return FeedRepo.listMine(mockUserProfile.id);
      }
      return FeedRepo.listRecommend();
    },
  });
  const { data: suggestionData, isFetching: isFetchingSuggestions, refetch: refetchSuggestions } = useQuery({
    queryKey: ['follow-suggestions'],
    queryFn: () => FeedRepo.listFollowSuggestions(mockUserProfile),
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const listError = data && !data.ok ? data.error : null;
  const posts = data?.ok ? data.data : [];
  const suggestionError = suggestionData && !suggestionData.ok ? suggestionData.error : null;
  const suggestions = suggestionData?.ok
    ? suggestionData.data
    : {
        sameCity: [],
        sameInterest: [],
      };
  const tabs = useMemo(
    () => [
      { id: 'recommend', label: '推荐' },
      { id: 'following', label: '关注' },
      { id: 'company', label: '企业' },
      { id: 'mine', label: '我的发布' },
    ],
    []
  );
  const sortOptions = useMemo(
    () => [
      { id: 'latest', label: '最晚' },
      { id: 'earliest', label: '最早' },
      { id: 'relevant', label: '最相关' },
    ],
    []
  );

  const sortedPosts = useMemo(() => {
    const list = [...posts];
    if (sortOption === 'earliest') {
      return list.sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt));
    }
    if (sortOption === 'relevant') {
      return list.sort((a, b) => {
        const scoreA = a.likeCount + a.commentCount * 2 + (a.shareCount ?? 0);
        const scoreB = b.likeCount + b.commentCount * 2 + (b.shareCount ?? 0);
        return scoreB - scoreA;
      });
    }
    return list.sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
  }, [posts, sortOption]);
  const refreshing = isFetching || isFetchingSuggestions;
  const handleRefresh = async () => {
    await Promise.all([refetch(), refetchSuggestions()]);
  };

  const openProductSheet = (post: Post) => {
    if (!post.productId) {
      show({ message: '暂无关联商品', type: 'info' });
      return;
    }
    setProductId(post.productId);
    setSheetOpen(true);
  };

  const openShareSheet = (post: Post) => {
    setSharePost(post);
    setShareOpen(true);
  };

  const handleFollowToggle = async (authorId: string) => {
    const result = await FeedRepo.toggleFollow(authorId, mockUserProfile.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '关注失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['circle'] });
    refetch();
    refetchSuggestions();
  };

  const handleOpenAuthor = (author: FollowSuggestion['author']) => {
    if (author.type === 'company' && author.companyId) {
      router.push({ pathname: '/company/[id]', params: { id: author.companyId } });
      return;
    }
    router.push({ pathname: '/user/[id]', params: { id: author.id } });
  };

  const renderSuggestionSection = () => (
    <View style={styles.suggestionBlock}>
      <View style={styles.suggestionHeader}>
        <View>
          <Text style={[typography.title3, { color: colors.text.primary }]}>推荐关注</Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>根据同城与兴趣为你推荐</Text>
        </View>
        <Pressable onPress={() => show({ message: '发现更多功能待接入', type: 'info' })} hitSlop={6}>
          <Text style={[typography.caption, { color: colors.accent.blue }]}>发现更多</Text>
        </Pressable>
      </View>
      {suggestionError ? (
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
          推荐加载失败，请稍后再试
        </Text>
      ) : !suggestions.sameCity.length && !suggestions.sameInterest.length ? (
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
          暂无匹配的关注推荐
        </Text>
      ) : (
        <>
          {renderSuggestionGroup('同城推荐', suggestions.sameCity)}
          {renderSuggestionGroup('同好推荐', suggestions.sameInterest)}
        </>
      )}
    </View>
  );

  const renderSuggestionGroup = (title: string, items: FollowSuggestion[]) => {
    if (!items.length) {
      return null;
    }
    return (
      <View style={{ marginTop: spacing.md }}>
        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{title}</Text>
        <View style={styles.suggestionList}>
          {items.map((item) => {
            const subLabel = item.author.title ?? item.author.tags?.[0] ?? '内容创作者';
            const summary = [subLabel, item.reasonLabel, item.author.city].filter(Boolean).join(' · ');
            return (
              <Pressable
                key={`${item.reason}-${item.author.id}`}
                onPress={() => handleOpenAuthor(item.author)}
                style={[styles.suggestionRow, { borderBottomColor: colors.border }]}
              >
                {item.author.avatar ? (
                  <Image source={{ uri: item.author.avatar }} style={styles.suggestionAvatar} />
                ) : (
                  <View style={[styles.suggestionAvatar, { backgroundColor: colors.brand.primarySoft }]} />
                )}
                <View style={styles.suggestionInfo}>
                  <Text numberOfLines={1}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{item.author.name}</Text>
                    {summary ? (
                      <Text style={[typography.caption, { color: colors.text.secondary }]}> · {summary}</Text>
                    ) : null}
                  </Text>
                </View>
                <Pressable
                  onPress={(event) => {
                    event.stopPropagation();
                    handleFollowToggle(item.author.id);
                  }}
                  style={[
                    styles.suggestionFollow,
                    {
                      borderColor: item.author.isFollowed ? colors.border : colors.brand.primary,
                      backgroundColor: item.author.isFollowed ? colors.surface : colors.brand.primary,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Text
                    style={[
                      typography.caption,
                      { color: item.author.isFollowed ? colors.text.secondary : colors.text.inverse },
                    ]}
                  >
                    {item.author.isFollowed ? '已关注' : '关注'}
                  </Text>
                </Pressable>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <FlatList
        data={sortedPosts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListHeaderComponent={
          <View>
            <View style={styles.titleRow}>
              <View>
                <Text style={[typography.title2, { color: colors.text.primary }]}>爱买买圈</Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                  连接消费者与生产者的内容社区
                </Text>
              </View>
              <Pressable
                onPress={() => router.push('/circle/ops')}
                style={[styles.opsButton, { borderColor: colors.accent.blue, borderRadius: radius.pill }]}
              >
                <MaterialCommunityIcons name="chart-line" size={16} color={colors.accent.blue} />
                <Text style={[typography.caption, { color: colors.accent.blue, marginLeft: 4 }]}>运营中心</Text>
              </Pressable>
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <PostComposerEntry
                onCreate={() => router.push('/post/create')}
                onTemplate={() => router.push('/post/create')}
                onAiAssist={() => router.push('/post/create')}
              />
            </View>

            <View style={styles.toolbar}>
              <View style={styles.tabRow}>
                {tabs.map((tab, index) => {
                  const active = tab.id === activeTab;
                  return (
                    <Pressable
                      key={tab.id}
                      onPress={() => setActiveTab(tab.id as CircleTab)}
                      style={[
                        styles.tabButton,
                        {
                          backgroundColor: active ? colors.brand.primary : colors.surface,
                          borderColor: active ? colors.brand.primary : colors.border,
                          borderRadius: radius.pill,
                          marginRight: index === tabs.length - 1 ? 0 : spacing.sm,
                        },
                      ]}
                    >
                      <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary }]}>
                        {tab.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.sortRow}>
                {sortOptions.map((option) => {
                  const active = option.id === sortOption;
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() => setSortOption(option.id as SortOption)}
                      style={[
                        styles.sortChip,
                        active ? styles.sortChipActive : null,
                        {
                          borderBottomColor: active ? colors.accent.blue : 'transparent',
                        },
                      ]}
                    >
                      <Text style={[typography.caption, { color: active ? colors.accent.blue : colors.text.secondary }]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

          </View>
        }
        renderItem={({ item }) => (
          <View style={{ marginBottom: spacing.lg }}>
            <PostCard
              post={item}
              liked={item.likedBy.includes(mockUserProfile.id)}
              currentUserId={mockUserProfile.id}
              onPress={(post) => router.push({ pathname: '/post/[id]', params: { id: post.id } })}
              onAuthorPress={(post) => {
                if (post.author.type === 'company' && post.author.companyId) {
                  router.push({ pathname: '/company/[id]', params: { id: post.author.companyId } });
                  return;
                }
                router.push({ pathname: '/user/[id]', params: { id: post.author.id } });
              }}
              onMore={() => show({ message: '已记录反馈', type: 'info' })}
              onProductPress={openProductSheet}
              onLike={async (post) => {
                const result = await FeedRepo.toggleLike(post.id, mockUserProfile.id);
                if (!result.ok) {
                  show({ message: result.error.displayMessage ?? '点赞失败', type: 'error' });
                  return;
                }
                refetch();
              }}
              onComment={(post) => router.push({ pathname: '/post/[id]', params: { id: post.id } })}
              onShare={openShareSheet}
              onFollowToggle={(post) => handleFollowToggle(post.author.id)}
            />
            {activeTab === 'mine' ? (
              <View style={styles.myActions}>
                <Pressable
                  onPress={() => router.push({ pathname: '/post/create', params: { postId: item.id } })}
                  style={[styles.actionButton, { borderColor: colors.border }]}
                >
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>编辑</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    const result = await FeedRepo.remove(item.id);
                    if (!result.ok) {
                      show({ message: result.error.displayMessage ?? '删除失败', type: 'error' });
                      return;
                    }
                    show({ message: '已删除内容', type: 'success' });
                    refetch();
                  }}
                  style={[styles.actionButton, { borderColor: colors.border, marginLeft: spacing.sm }]}
                >
                  <Text style={[typography.caption, { color: colors.danger }]}>删除</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          isLoading ? (
            <View>
              <Skeleton height={220} radius={radius.lg} />
              <View style={{ height: spacing.md }} />
              <Skeleton height={220} radius={radius.lg} />
            </View>
          ) : (listError as AppError | null) ? (
            <ErrorState
              title="加载失败"
              description={listError?.displayMessage ?? '请稍后再试'}
              onAction={refetch}
            />
          ) : activeTab === 'following' ? (
            <View>
              <EmptyState title="暂无关注内容" description="先关注一些农友或企业吧" />
              {renderSuggestionSection()}
            </View>
          ) : (
            <EmptyState
              title={activeTab === 'mine' ? '暂无发布' : '暂无内容'}
              description={activeTab === 'mine' ? '去发布第一条内容吧' : '去发布第一条内容吧'}
            />
          )
        }
      />

      <ProductQuickSheet open={sheetOpen} productId={productId} onClose={() => setSheetOpen(false)} />
      <PostShareSheet open={shareOpen} post={sharePost} onClose={() => setShareOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  opsButton: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolbar: {
    marginTop: 16,
    marginBottom: 8,
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  tabButton: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  sortRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    flexWrap: 'wrap',
  },
  sortChip: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderBottomWidth: 1,
    marginRight: 12,
  },
  sortChipActive: {
    borderBottomWidth: 2,
  },
  suggestionBlock: {
    marginTop: 12,
    marginBottom: 8,
  },
  suggestionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  suggestionList: {
    marginTop: 8,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  suggestionAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
  },
  suggestionInfo: {
    flex: 1,
    marginRight: 10,
  },
  suggestionFollow: {
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  myActions: {
    flexDirection: 'row',
    marginTop: 8,
  },
  actionButton: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
});
