import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { WishCard } from '../../src/components/cards';
import { WishForm, WishFormValues } from '../../src/components/forms';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { Screen } from '../../src/components/layout';
import { wishRankPeriods, wishTags } from '../../src/constants';
import { CompanyRepo, WishAiRepo, WishRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AppError, Wish, WishRankingEntry, WishRecommendation } from '../../src/types';

export default function WishesScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'publish' | 'discover'>('discover');
  const [activeTag, setActiveTag] = useState<string>('全部');
  const [rankPeriod, setRankPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['wishes'],
    queryFn: () => WishRepo.list(),
  });
  const {
    data: rankingData,
    isFetching: isFetchingRanking,
    refetch: refetchRankings,
  } = useQuery({
    queryKey: ['wish-rankings', rankPeriod],
    queryFn: () => WishRepo.listRankings(rankPeriod),
  });
  const {
    data: aiData,
    isFetching: isFetchingAi,
    refetch: refetchAi,
  } = useQuery({
    queryKey: ['wish-ai-recommendations'],
    queryFn: () => WishAiRepo.recommendWishes(),
  });
  const { data: companyData, refetch: refetchCompanies } = useQuery({
    queryKey: ['companies'],
    queryFn: () => CompanyRepo.list(),
  });

  const listError = data && !data.ok ? data.error : null;
  const wishes = data?.ok ? data.data : [];
  const rankingError = rankingData && !rankingData.ok ? rankingData.error : null;
  const rankings: WishRankingEntry[] = rankingData?.ok ? rankingData.data : [];
  const aiError = aiData && !aiData.ok ? aiData.error : null;
  const aiRecommendations: WishRecommendation[] = aiData?.ok ? aiData.data : [];
  const companies = companyData?.ok ? companyData.data : [];
  const companyError = companyData && !companyData.ok ? companyData.error : null;
  const tags = useMemo(() => ['全部', ...wishTags], []);
  const filtered = useMemo(() => {
    if (activeTag === '全部') {
      return wishes;
    }
    return wishes.filter((wish) => wish.tags.includes(activeTag));
  }, [activeTag, wishes]);

  const renderWish = ({ item }: { item: Wish }) => (
    <WishCard
      wish={item}
      highlight={item.isPinned}
      onPress={() => router.push(`/wish/${item.id}`)}
      onLike={async (wish) => {
        const result = await WishRepo.toggleLike(wish.id, 'u-001');
        if (!result.ok) {
          show({ message: result.error.displayMessage ?? '点赞失败', type: 'error' });
          return;
        }
        refetch();
      }}
    />
  );

  const handlePublish = async (values: WishFormValues) => {
    const selectedCompany = companies.find((company) => company.id === values.companyId);
    const result = await WishRepo.create({
      title: values.title,
      description: values.description,
      tags: values.tags,
      type: values.type,
      companyId: values.companyId,
      mentions: selectedCompany ? [{ id: selectedCompany.id, name: selectedCompany.name }] : undefined,
    });
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '发布失败，请稍后重试', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['wishes'] });
    show({ message: '心愿已发布', type: 'success' });
    router.push(`/wish/${result.data.id}`);
  };
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchCompanies(), refetchRankings(), refetchAi()]);
    setRefreshing(false);
  };

  const renderRankingCard = () => (
    <View style={[styles.panelCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
      <View style={styles.panelHeader}>
        <Text style={[typography.title3, { color: colors.text.primary }]}>心愿榜单</Text>
        <View style={styles.rankTabs}>
          {wishRankPeriods.map((period) => {
            const active = rankPeriod === period.id;
            return (
              <Pressable
                key={period.id}
                onPress={() => setRankPeriod(period.id as typeof rankPeriod)}
                style={[
                  styles.rankChip,
                  {
                    backgroundColor: active ? colors.brand.primary : colors.surface,
                    borderColor: active ? colors.brand.primary : colors.border,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary }]}>
                  {period.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {isFetchingRanking ? (
        <View>
          <Skeleton height={16} radius={radius.sm} style={{ marginBottom: 8 }} />
          <Skeleton height={16} radius={radius.sm} style={{ marginBottom: 8 }} />
          <Skeleton height={16} radius={radius.sm} />
        </View>
      ) : (rankingError as AppError | null) ? (
        <Text style={[typography.caption, { color: colors.text.secondary }]}>榜单加载失败</Text>
      ) : rankings.length === 0 ? (
        <Text style={[typography.caption, { color: colors.text.secondary }]}>暂无榜单数据</Text>
      ) : (
        rankings.slice(0, 5).map((entry) => (
          <Pressable
            key={entry.id}
            onPress={() => router.push(`/wish/${entry.wishId}`)}
            style={styles.rankRow}
          >
            <View style={[styles.rankIndex, { backgroundColor: colors.brand.primarySoft }]}>
              <Text style={[typography.caption, { color: colors.brand.primary }]}>#{entry.rank}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                {entry.title}
              </Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                {entry.authorName}
              </Text>
            </View>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>{entry.score} 分</Text>
          </Pressable>
        ))
      )}
    </View>
  );

  const renderAiRecommendation = () => (
    <View style={[styles.panelCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
      <View style={styles.panelHeader}>
        <Text style={[typography.title3, { color: colors.text.primary }]}>AI 推荐心愿</Text>
        <Pressable onPress={() => refetchAi()} hitSlop={8}>
          <Text style={[typography.caption, { color: colors.accent.blue }]}>换一批</Text>
        </Pressable>
      </View>
      {isFetchingAi ? (
        <View>
          <Skeleton height={16} radius={radius.sm} style={{ marginBottom: 8 }} />
          <Skeleton height={16} radius={radius.sm} />
        </View>
      ) : (aiError as AppError | null) ? (
        <Text style={[typography.caption, { color: colors.text.secondary }]}>AI 推荐加载失败</Text>
      ) : aiRecommendations.length === 0 ? (
        <Text style={[typography.caption, { color: colors.text.secondary }]}>暂无推荐心愿</Text>
      ) : (
        aiRecommendations.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => router.push(`/wish/${item.wish.id}`)}
            style={styles.aiRow}
          >
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                {item.wish.title}
              </Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                {item.reason}
              </Text>
              <View style={styles.aiTagRow}>
                {item.tags.map((tag) => (
                  <View key={`${item.id}-${tag}`} style={[styles.aiTag, { backgroundColor: colors.brand.primarySoft }]}>
                    <Text style={[typography.caption, { color: colors.brand.primary }]}>{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.secondary} />
          </Pressable>
        ))
      )}
    </View>
  );

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
        <Text style={[typography.title2, { color: colors.text.primary }]}>心愿池</Text>
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
          让你的想法被看见
        </Text>
        <View style={styles.tabRow}>
          {[
            { id: 'discover', label: '发现心愿' },
            { id: 'publish', label: '发表我的心愿' },
          ].map((tab) => {
            const active = activeTab === tab.id;
            const isPublish = tab.id === 'publish';
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id as typeof activeTab)}
                style={[
                  styles.tabBase,
                  isPublish ? styles.publishButton : styles.tabButton,
                  isPublish ? shadow.sm : null,
                  {
                    backgroundColor: isPublish
                      ? active
                        ? colors.brand.primary
                        : colors.brand.primarySoft
                      : active
                        ? colors.accent.blueSoft
                        : colors.surface,
                    borderColor: isPublish ? 'transparent' : active ? colors.accent.blue : colors.border,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                {isPublish ? (
                  <MaterialCommunityIcons
                    name="pencil-plus"
                    size={16}
                    color={active ? colors.text.inverse : colors.brand.primary}
                    style={styles.publishIcon}
                  />
                ) : null}
                <Text
                  style={[
                    typography.caption,
                    {
                      color: isPublish
                        ? active
                          ? colors.text.inverse
                          : colors.brand.primary
                        : active
                          ? colors.accent.blue
                          : colors.text.secondary,
                    },
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {activeTab === 'publish' ? (
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          <View style={[styles.publishCard, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>发布心愿</Text>
            <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
              选择心愿类型、填写内容、添加标签，并可@相关企业。
            </Text>
            {companyError ? (
              <Pressable onPress={() => refetchCompanies()} style={{ marginTop: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.danger }]}>
                  企业列表加载失败，点击重试
                </Text>
              </Pressable>
            ) : null}
            <View style={{ marginTop: spacing.md }}>
              <WishForm companies={companies} onSubmit={handlePublish} />
            </View>
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListHeaderComponent={
            <View>
              {renderRankingCard()}
              <View style={{ height: spacing.md }} />
              {renderAiRecommendation()}
              <View style={styles.tagRow}>
                {tags.map((tag) => {
                  const active = activeTag === tag;
                  return (
                    <Pressable
                      key={tag}
                      onPress={() => setActiveTag(tag)}
                      style={[
                        styles.tagChip,
                        {
                          backgroundColor: active ? colors.brand.primary : colors.surface,
                          borderColor: active ? colors.brand.primary : colors.border,
                          borderRadius: radius.pill,
                        },
                      ]}
                    >
                      <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary }]}>
                        {tag}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          }
          renderItem={renderWish}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          ListEmptyComponent={
            isLoading ? (
              <View>
                <Skeleton height={180} radius={radius.lg} />
                <View style={{ height: spacing.md }} />
                <Skeleton height={180} radius={radius.lg} />
              </View>
            ) : (listError as AppError | null) ? (
              <ErrorState
                title="加载失败"
                description={listError?.displayMessage ?? '请稍后再试'}
                onAction={refetch}
              />
            ) : (
              <EmptyState title="暂无心愿" description="先发布第一个心愿吧" />
            )
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    marginTop: 16,
    alignItems: 'center',
  },
  tabBase: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButton: {
    marginRight: 12,
  },
  publishButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 0,
  },
  publishIcon: {
    marginRight: 6,
  },
  publishCard: {
    padding: 18,
  },
  primaryButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 999,
  },
  panelCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  rankTabs: {
    flexDirection: 'row',
  },
  rankChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    marginLeft: 6,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  rankIndex: {
    width: 36,
    height: 24,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  aiTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  aiTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginRight: 6,
    marginBottom: 6,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
    marginTop: 16,
  },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
  },
});
