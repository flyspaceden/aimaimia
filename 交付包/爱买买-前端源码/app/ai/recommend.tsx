import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { Tag } from '../../src/components/ui';
import { AiFeatureRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AppError } from '../../src/types';

export default function AiRecommendScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['ai-recommend'],
    queryFn: () => AiFeatureRepo.getRecommendInsights(),
  });

  const listError = data && !data.ok ? data.error : null;
  const insights = data?.ok ? data.data : [];
  const topTags = useMemo(() => {
    const tags = insights.flatMap((item) => item.tags);
    const unique = tags.filter((tag, index) => tags.indexOf(tag) === index);
    return unique.slice(0, 6);
  }, [insights]);

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="AI 推荐" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
      >
        {isLoading ? (
          <View>
            <Skeleton height={140} radius={radius.lg} style={{ marginBottom: spacing.md }} />
            <Skeleton height={96} radius={radius.lg} style={{ marginBottom: spacing.md }} />
          </View>
        ) : listError ? (
          <ErrorState
            title="推荐数据加载失败"
            description={(listError as AppError).displayMessage ?? '请稍后重试'}
            onAction={refetch}
          />
        ) : insights.length === 0 ? (
          <EmptyState title="暂无推荐画像" description="稍后再试或完善偏好" />
        ) : (
          <View>
            <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={[styles.icon, { backgroundColor: colors.brand.primarySoft }]}>
                <MaterialCommunityIcons name="brain" size={20} color={colors.brand.primary} />
              </View>
              <Text style={[typography.title3, { color: colors.text.primary, marginTop: spacing.sm }]}>
                AI 推荐画像
              </Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                基于浏览、收藏与互动构建的偏好标签
              </Text>
              <View style={styles.tagRow}>
                {topTags.map((tag) => (
                  <Tag key={tag} label={tag} tone="accent" style={{ marginRight: 6 }} />
                ))}
              </View>
              <Pressable
                onPress={() => router.push('/search')}
                style={[
                  styles.actionButton,
                  {
                    borderRadius: radius.pill,
                    borderColor: colors.brand.primary,
                    marginTop: spacing.md,
                  },
                ]}
              >
                <Text style={[typography.caption, { color: colors.brand.primary }]}>查看推荐商品</Text>
              </Pressable>
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>推荐理由</Text>
              {insights.map((item) => (
                <View
                  key={item.id}
                  style={[
                    styles.reasonCard,
                    shadow.sm,
                    { backgroundColor: colors.surface, borderRadius: radius.lg },
                  ]}
                >
                  <View style={styles.reasonHeader}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{item.title}</Text>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>
                      权重 {Math.round(item.weight * 100)}%
                    </Text>
                  </View>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                    {item.description}
                  </Text>
                  <View style={styles.tagRow}>
                    {item.tags.map((tag) => (
                      <Tag key={`${item.id}-${tag}`} label={tag} tone="brand" style={{ marginRight: 6 }} />
                    ))}
                  </View>
                </View>
              ))}
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>推荐策略</Text>
              <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  当前策略：健康轻食优先 / 附近产地加权 / 认证标签加分
                </Text>
                <Pressable
                  onPress={() => show({ message: '推荐策略已更新', type: 'success' })}
                  style={[
                    styles.actionButton,
                    { borderRadius: radius.pill, borderColor: colors.border, marginTop: spacing.md },
                  ]}
                >
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>一键优化策略</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  actionButton: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  reasonCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginTop: 12,
  },
  reasonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
