import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { SearchInput } from '../../src/components/inputs';
import { FollowRepo } from '../../src/repos';
import { mockUserProfile } from '../../src/mocks';
import { useTheme } from '../../src/theme';
import { AppError, FollowListItem, FollowSortOption, PostAuthor } from '../../src/types';

type FollowTab = 'users' | 'companies';

const sortOptions: Array<{ id: FollowSortOption; label: string }> = [
  { id: 'recent', label: '最近关注' },
  { id: 'active', label: '最活跃' },
];

export default function FollowingScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<FollowTab>('users');
  const [sortOption, setSortOption] = useState<FollowSortOption>('recent');
  const [keyword, setKeyword] = useState('');

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['me-following', activeTab, sortOption],
    queryFn: () => FollowRepo.listFollowing(activeTab === 'users' ? 'user' : 'company', sortOption),
  });

  const listError = data && !data.ok ? data.error : null;
  const items = data?.ok ? data.data : [];

  const filteredItems = useMemo(() => {
    if (!keyword.trim()) {
      return items;
    }
    const term = keyword.trim().toLowerCase();
    return items.filter((item) => {
      const author = item.author;
      return (
        author.name.toLowerCase().includes(term) ||
        (author.title?.toLowerCase().includes(term) ?? false) ||
        (author.tags?.some((tag) => tag.toLowerCase().includes(term)) ?? false) ||
        (author.city?.toLowerCase().includes(term) ?? false)
      );
    });
  }, [items, keyword]);

  const hasKeyword = Boolean(keyword.trim());

  const handleOpenAuthor = (author: PostAuthor) => {
    if (author.type === 'company' && author.companyId) {
      router.push({ pathname: '/company/[id]', params: { id: author.companyId } });
      return;
    }
    router.push({ pathname: '/user/[id]', params: { id: author.id } });
  };

  const handleUnfollow = async (author: PostAuthor) => {
    const result = await FollowRepo.toggleFollow(author.id, mockUserProfile.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '操作失败', type: 'error' });
      return;
    }
    show({ message: '已取消关注', type: 'success' });
    refetch();
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="我的关注" />
      <View style={{ padding: spacing.xl, flex: 1 }}>
        <View style={styles.tabRow}>
          {[
            { id: 'users', label: '用户' },
            { id: 'companies', label: '企业' },
          ].map((tab) => {
            const active = tab.id === activeTab;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id as FollowTab)}
                style={[
                  styles.tabChip,
                  {
                    borderColor: active ? colors.brand.primary : colors.border,
                    backgroundColor: active ? colors.brand.primarySoft : colors.surface,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text style={[typography.caption, { color: active ? colors.brand.primary : colors.text.secondary }]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <SearchInput value={keyword} onChangeText={setKeyword} placeholder="搜索名称/标签/城市" />

        <View style={styles.sortRow}>
          {sortOptions.map((option) => {
            const active = option.id === sortOption;
            return (
              <Pressable
                key={option.id}
                onPress={() => setSortOption(option.id)}
                style={[
                  styles.sortChip,
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

        {isLoading ? (
          <View style={{ marginTop: spacing.md }}>
            <Skeleton height={120} radius={radius.lg} />
            <View style={{ height: spacing.md }} />
            <Skeleton height={120} radius={radius.lg} />
          </View>
        ) : (listError as AppError | null) ? (
          <View style={{ marginTop: spacing.md }}>
            <ErrorState
              title="关注列表加载失败"
              description={listError?.displayMessage ?? '请稍后重试'}
              onAction={refetch}
            />
          </View>
        ) : filteredItems.length === 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <EmptyState
              title={hasKeyword ? '未找到匹配结果' : '暂无关注'}
              description={hasKeyword ? '试试调整关键词或筛选条件' : '先去关注你感兴趣的用户或企业'}
              actionLabel={hasKeyword ? '清空搜索' : '去爱买买圈'}
              onAction={() => {
                if (hasKeyword) {
                  setKeyword('');
                  return;
                }
                router.push('/circle');
              }}
            />
          </View>
        ) : (
          <ScrollView
            style={{ marginTop: spacing.md }}
            refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
            showsVerticalScrollIndicator={false}
          >
            {filteredItems.map((item: FollowListItem) => (
              <Pressable
                key={item.author.id}
                onPress={() => handleOpenAuthor(item.author)}
                style={[styles.row, { borderBottomColor: colors.border }]}
              >
                {item.author.avatar ? (
                  <Image source={{ uri: item.author.avatar }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: colors.brand.primarySoft }]} />
                )}
                <View style={styles.info}>
                  <View style={styles.nameRow}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                      {item.author.name}
                    </Text>
                    {item.author.city ? (
                      <Text style={[typography.caption, { color: colors.muted, marginLeft: 6 }]}>
                        {item.author.city}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]} numberOfLines={1}>
                    {item.author.title ?? item.author.tags?.[0] ?? '内容创作者'}
                  </Text>
                </View>
                <Pressable
                  onPress={(event) => {
                    event.stopPropagation();
                    handleUnfollow(item.author);
                  }}
                  style={[
                    styles.unfollowButton,
                    { borderColor: colors.border, borderRadius: radius.pill },
                  ]}
                >
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>取消关注</Text>
                </Pressable>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  tabChip: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 10,
  },
  sortRow: {
    flexDirection: 'row',
    marginTop: 10,
  },
  sortChip: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderBottomWidth: 2,
    marginRight: 12,
  },
  row: {
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
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  unfollowButton: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
