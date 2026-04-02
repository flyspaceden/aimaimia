import React, { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { DraftRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';

const templateLabels: Record<string, string> = {
  story: '产品故事',
  diary: '种植日志',
  recipe: '食谱教程',
  general: '随手记录',
};

export default function PostDraftsScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['post-drafts'],
    queryFn: DraftRepo.list,
  });
  const refreshing = isFetching;

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="草稿箱" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} />}
      >
        {isLoading ? (
          <View>
            <Skeleton height={120} radius={radius.lg} />
            <Skeleton height={120} radius={radius.lg} style={{ marginTop: spacing.md }} />
          </View>
        ) : !data || !data.ok ? (
          <ErrorState
            title="草稿加载失败"
            description={data?.ok === false ? data.error.displayMessage ?? '请稍后再试' : '请稍后再试'}
            onAction={refetch}
          />
        ) : data.data.length === 0 ? (
          <EmptyState title="暂无草稿" description="去发布页保存第一条草稿吧" />
        ) : (
          data.data.map((draft) => (
            <Pressable
              key={draft.id}
              onPress={() => router.push({ pathname: '/post/create', params: { draftId: draft.id } })}
              style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
            >
              <View style={styles.cardRow}>
                {draft.images[0] ? (
                  <Image source={{ uri: draft.images[0] }} style={[styles.cover, { borderRadius: radius.md }]} />
                ) : (
                  <View style={[styles.cover, { borderRadius: radius.md, backgroundColor: colors.brand.primarySoft }]} />
                )}
                <View style={styles.cardBody}>
                  <View style={styles.rowBetween}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                      {draft.title || '未命名草稿'}
                    </Text>
                    <Pressable
                      onPress={async (event) => {
                        event.stopPropagation();
                        const result = await DraftRepo.remove(draft.id);
                        if (!result.ok) {
                          show({ message: result.error.displayMessage ?? '删除失败', type: 'error' });
                          return;
                        }
                        show({ message: '已删除草稿', type: 'success' });
                        refetch();
                      }}
                      hitSlop={10}
                    >
                      <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.text.secondary} />
                    </Pressable>
                  </View>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]} numberOfLines={2}>
                    {draft.content || '暂无内容'}
                  </Text>
                  <View style={[styles.metaRow, { marginTop: 8 }]}>
                    <View style={[styles.metaTag, { backgroundColor: colors.brand.primarySoft }]}>
                      <Text style={[typography.caption, { color: colors.brand.primary }]}>
                        {templateLabels[draft.template] ?? '自定义'}
                      </Text>
                    </View>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: spacing.sm }]}>
                      {draft.updatedAt}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.footerRow}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  图片 {draft.images.length} · 标签 {draft.tags.length}
                </Text>
                <Text style={[typography.caption, { color: colors.accent.blue }]}>继续编辑</Text>
              </View>
            </Pressable>
          ))
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
    marginBottom: 16,
  },
  cardRow: {
    flexDirection: 'row',
  },
  cardBody: {
    flex: 1,
    marginLeft: 12,
  },
  cover: {
    width: 86,
    height: 86,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  footerRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
