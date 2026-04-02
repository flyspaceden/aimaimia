import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AiDivider, Tag } from '../../src/components/ui';
import { TaskRepo, UserRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AppError } from '../../src/types';

export default function TasksScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['me-tasks-list'],
    queryFn: () => TaskRepo.list(),
    enabled: isLoggedIn,
  });

  const listError = data && !data.ok ? data.error : null;
  const tasks = data?.ok ? data.data : [];
  const stats = useMemo(() => {
    const done = tasks.filter((task) => task.status === 'done').length;
    return {
      total: tasks.length,
      done,
      pending: Math.max(0, tasks.length - done),
    };
  }, [tasks]);

  // 成长值进度比例
  const progressRatio = stats.total > 0 ? stats.done / stats.total : 0;

  const handleCompleteTask = async (taskId: string) => {
    const target = tasks.find((item) => item.id === taskId);
    if (!target || target.status === 'done') {
      show({ message: '任务已完成', type: 'info' });
      return;
    }
    const result = await TaskRepo.complete(taskId);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '任务更新失败', type: 'error' });
      return;
    }
    // 任务奖励联动到积分/成长值（复杂业务逻辑需中文注释）
    await UserRepo.applyRewards({
      points: target.rewardPoints ?? 0,
      growthPoints: target.rewardGrowth ?? 0,
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['me-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['me-vip-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['me-tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['me-tasks-list'] }),
    ]);
    show({ message: `任务已完成，${target.rewardLabel}`, type: 'success' });
    refetch();
  };

  // 根据任务状态返回左边框颜色
  const getTaskBorderColor = (status: string): string | undefined => {
    if (status === 'done') return undefined;
    if (status === 'inProgress') return colors.brand.primary;
    return colors.ai.start;
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="我的任务" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
      >
        {/* 任务概览卡 — 装饰条 + 渐变进度条 */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <View style={[{ borderRadius: radius.lg, overflow: 'hidden' }, shadow.md]}>
            <LinearGradient
              colors={[colors.brand.primary, colors.ai.start]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ height: 3 }}
            />
            <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>任务概览</Text>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>总任务</Text>
                  <Text style={[typography.title3, { color: colors.text.primary }]}>{stats.total}</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>已完成</Text>
                  <Text style={[typography.title3, { color: colors.success }]}>{stats.done}</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>待完成</Text>
                  <Text style={[typography.title3, { color: colors.text.primary }]}>{stats.pending}</Text>
                </View>
              </View>
              {/* 今日成长值进度条 */}
              <View style={[styles.progressTrack, { backgroundColor: colors.border, marginTop: spacing.md }]}>
                <LinearGradient
                  colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.progressFill, { width: `${Math.min(100, progressRatio * 100)}%` }]}
                />
              </View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                完成任务可获得成长值/积分奖励，解锁头像框与等级
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* 任务列表 Section */}
        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>任务列表</Text>
          <AiDivider style={{ marginTop: 4, marginBottom: spacing.sm }} />
          {isLoading ? (
            <View style={{ marginTop: spacing.md }}>
              <Skeleton height={120} radius={radius.lg} />
              <View style={{ height: spacing.md }} />
              <Skeleton height={120} radius={radius.lg} />
            </View>
          ) : (listError as AppError | null) ? (
            <View style={{ marginTop: spacing.md }}>
              <ErrorState
                title="任务加载失败"
                description={(listError as AppError)?.displayMessage ?? '请稍后重试'}
                onAction={refetch}
              />
            </View>
          ) : tasks.length === 0 ? (
            <View style={{ marginTop: spacing.md }}>
              <EmptyState title="暂无任务" description="稍后再来看看" />
            </View>
          ) : (
            <View style={{ marginTop: spacing.md }}>
              {tasks.map((task, index) => {
                const done = task.status === 'done';
                const statusTone = done ? 'brand' : task.status === 'inProgress' ? 'accent' : 'neutral';
                const statusLabel = done ? '已完成' : task.status === 'inProgress' ? '进行中' : '去完成';
                const borderColor = getTaskBorderColor(task.status);
                return (
                  <Animated.View key={task.id} entering={FadeInDown.duration(300).delay(50 + index * 30)}>
                    <Pressable
                      onPress={() => router.push(task.targetRoute)}
                      style={[
                        styles.taskCard,
                        shadow.md,
                        {
                          backgroundColor: colors.surface,
                          borderRadius: radius.lg,
                          opacity: done ? 0.7 : 1,
                          borderLeftWidth: borderColor ? 2 : 0,
                          borderLeftColor: borderColor,
                        },
                      ]}
                    >
                      <View style={styles.taskRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{task.title}</Text>
                          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                            {task.rewardLabel}
                          </Text>
                        </View>
                        <Tag label={statusLabel} tone={statusTone as 'brand' | 'accent' | 'neutral'} />
                      </View>
                      <Pressable
                        onPress={(event) => {
                          event.stopPropagation();
                          if (done) {
                            show({ message: '任务已完成', type: 'info' });
                            return;
                          }
                          handleCompleteTask(task.id);
                        }}
                      >
                        {!done ? (
                          <LinearGradient
                            colors={[colors.brand.primarySoft, colors.ai.soft]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={[styles.taskAction, { borderRadius: radius.pill }]}
                          >
                            <Text style={[typography.caption, { color: colors.brand.primary }]}>立即去完成</Text>
                          </LinearGradient>
                        ) : (
                          <View style={[styles.taskAction, { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill }]}>
                            <Text style={[typography.caption, { color: colors.text.secondary }]}>查看</Text>
                          </View>
                        )}
                      </Pressable>
                    </Pressable>
                  </Animated.View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    padding: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  taskCard: {
    padding: 14,
    marginBottom: 12,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskAction: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
  },
});
