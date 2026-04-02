import React from 'react';
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

export default function AiTraceScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['ai-trace'],
    queryFn: () => AiFeatureRepo.getTraceOverview(),
  });

  const traceError = data && !data.ok ? data.error : null;
  const overview = data?.ok ? data.data : null;
  const refreshing = isFetching;
  const statusTone = {
    done: colors.brand.primary,
    doing: colors.accent.blue,
    pending: colors.border,
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="AI 溯源" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} />}
      >
        {isLoading ? (
          <View>
            <Skeleton height={140} radius={radius.lg} style={{ marginBottom: spacing.md }} />
            <Skeleton height={96} radius={radius.lg} style={{ marginBottom: spacing.md }} />
            <Skeleton height={96} radius={radius.lg} style={{ marginBottom: spacing.md }} />
          </View>
        ) : traceError ? (
          <ErrorState
            title="溯源信息加载失败"
            description={(traceError as AppError).displayMessage ?? '请稍后重试'}
            onAction={refetch}
          />
        ) : !overview ? (
          <EmptyState title="暂无溯源数据" description="稍后再试或切换商品" />
        ) : (
          <View>
            <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={[styles.icon, { backgroundColor: colors.accent.blueSoft }]}>
                <MaterialCommunityIcons name="timeline-text" size={20} color={colors.accent.blue} />
              </View>
              <Text style={[typography.title3, { color: colors.text.primary, marginTop: spacing.sm }]}>
                {overview.productName}
              </Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                批次：{overview.batchId} · 基地：{overview.farmName}
              </Text>
              <Text style={[typography.caption, { color: colors.brand.primary, marginTop: 6 }]}>
                {overview.statusLabel}
              </Text>
              <View style={styles.tagRow}>
                {overview.tags.map((tag) => (
                  <Tag key={tag} label={tag} tone="accent" style={{ marginRight: 6 }} />
                ))}
              </View>
              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => router.push(`/product/${overview.productId}`)}
                  style={[
                    styles.actionButton,
                    { borderRadius: radius.pill, borderColor: colors.brand.primary },
                  ]}
                >
                  <Text style={[typography.caption, { color: colors.brand.primary }]}>查看商品</Text>
                </Pressable>
                <Pressable
                  onPress={() => show({ message: '检测报告生成中', type: 'info' })}
                  style={[
                    styles.actionButton,
                    { borderRadius: radius.pill, borderColor: colors.border },
                  ]}
                >
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>下载报告</Text>
                </Pressable>
              </View>
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>溯源节点</Text>
              {overview.steps.map((step, index) => (
                <View
                  key={step.id}
                  style={[
                    styles.stepCard,
                    shadow.sm,
                    { backgroundColor: colors.surface, borderRadius: radius.lg },
                  ]}
                >
                  <View style={styles.stepLeft}>
                    <View style={[styles.dot, { backgroundColor: statusTone[step.status] }]} />
                    {index !== overview.steps.length - 1 ? (
                      <View style={[styles.line, { backgroundColor: colors.border }]} />
                    ) : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{step.title}</Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                      {step.description}
                    </Text>
                    <View style={styles.stepMeta}>
                      {step.time ? (
                        <Text style={[typography.caption, { color: colors.text.secondary }]}>{step.time}</Text>
                      ) : null}
                      {step.location ? (
                        <Text style={[typography.caption, { color: colors.text.secondary }]}>{step.location}</Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              ))}
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
  actionRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  actionButton: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 10,
  },
  stepCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginTop: 12,
    flexDirection: 'row',
  },
  stepLeft: {
    width: 24,
    alignItems: 'center',
    marginRight: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  line: {
    width: 2,
    flex: 1,
    marginTop: 4,
  },
  stepMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
});
