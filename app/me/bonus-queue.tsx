import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { BonusRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';

export default function BonusQueueScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['bonus-queue'],
    queryFn: () => BonusRepo.getQueueStatus(),
    enabled: isLoggedIn,
  });

  const queue = data?.ok ? data.data : null;
  const error = data && !data.ok ? data.error : null;

  // 消费区间展示
  const bucketLabel: Record<string, string> = {
    CNY_0_10: '0-10 元',
    CNY_10_50: '10-50 元',
    CNY_50_100: '50-100 元',
    CNY_100_500: '100-500 元',
    CNY_500_PLUS: '500 元以上',
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="排队队列" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
      >
        {isLoading ? (
          <View>
            <Skeleton height={200} radius={radius.xl} />
          </View>
        ) : error ? (
          <ErrorState title="加载失败" description="请稍后重试" onAction={() => refetch()} />
        ) : !queue?.inQueue ? (
          <Animated.View entering={FadeInDown.duration(300)}>
            <View style={[styles.emptyCard, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.xl }]}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.ai.soft }]}>
                <MaterialCommunityIcons name="account-clock-outline" size={40} color={colors.ai.start} />
              </View>
              <Text style={[typography.title2, { color: colors.text.primary, marginTop: spacing.lg }]}>
                暂未排队
              </Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm, textAlign: 'center' }]}>
                消费后将自动进入对应消费区间的排队队列，后续消费者的红包将按顺序分配给您
              </Text>
            </View>
          </Animated.View>
        ) : (
          <View>
            {/* 队列状态卡片 — 装饰条 + 动画入场 */}
            <Animated.View entering={FadeInDown.duration(300)}>
              <View style={[{ borderRadius: radius.xl, overflow: 'hidden' }, shadow.md]}>
                <LinearGradient
                  colors={[colors.brand.primary, colors.ai.start]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{ height: 3 }}
                />
                <View style={[styles.queueCard, { backgroundColor: colors.accent.blue }]}>
                  <View style={styles.queueHeader}>
                    <MaterialCommunityIcons name="clock-fast" size={24} color="rgba(255,255,255,0.8)" />
                    <Text style={[typography.bodyStrong, { color: colors.text.inverse, marginLeft: 8 }]}>
                      排队中
                    </Text>
                  </View>

                  <View style={styles.positionContainer}>
                    <Text style={[styles.positionNumber, { color: colors.text.inverse }]}>
                      {queue.position}
                    </Text>
                    <Text style={[typography.caption, { color: 'rgba(255,255,255,0.7)' }]}>
                      当前排位
                    </Text>
                  </View>

                  <View style={styles.queueInfo}>
                    <View style={styles.queueInfoItem}>
                      <Text style={[typography.caption, { color: 'rgba(255,255,255,0.6)' }]}>消费区间</Text>
                      <Text style={[typography.bodyStrong, { color: colors.text.inverse, marginTop: 4 }]}>
                        {bucketLabel[queue.bucketKey ?? ''] ?? queue.bucketKey}
                      </Text>
                    </View>
                    <View style={styles.queueInfoItem}>
                      <Text style={[typography.caption, { color: 'rgba(255,255,255,0.6)' }]}>加入时间</Text>
                      <Text style={[typography.bodyStrong, { color: colors.text.inverse, marginTop: 4 }]}>
                        {queue.joinedAt?.slice(0, 10) ?? '-'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </Animated.View>

            {/* 进度指示 — 渐变进度条 */}
            <Animated.View entering={FadeInDown.duration(300).delay(80)}>
              <View style={[styles.progressCard, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>排队进度</Text>
                <View style={[styles.progressTrack, { backgroundColor: colors.border, marginTop: 12 }]}>
                  <LinearGradient
                    colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[
                      styles.progressFill,
                      { width: `${Math.max(5, Math.min(100, (1 / (queue.position ?? 1)) * 100))}%` },
                    ]}
                  />
                </View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 8 }]}>
                  前方还有 {Math.max(0, (queue.position ?? 1) - 1)} 人，请耐心等待
                </Text>
              </View>
            </Animated.View>

            {/* 规则说明 */}
            <Animated.View entering={FadeInDown.duration(300).delay(160)}>
              <View style={[styles.rulesCard, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.lg }]}>
                <Text style={[typography.bodyStrong, { color: colors.brand.primary, marginBottom: 8 }]}>
                  排队规则
                </Text>
                {[
                  '消费后自动进入对应消费区间队列',
                  '后续同区间消费者各发一个红包',
                  '红包先冻结，签收后释放为可提现',
                  '队列轮完后自动退出',
                ].map((rule, i) => (
                  <Animated.View key={i} entering={FadeInDown.duration(300).delay(200 + i * 40)}>
                    <View style={styles.ruleRow}>
                      <Text style={[typography.caption, { color: colors.brand.primary }]}>{i + 1}.</Text>
                      <Text style={[typography.caption, { color: colors.brand.primary, marginLeft: 6, flex: 1 }]}>
                        {rule}
                      </Text>
                    </View>
                  </Animated.View>
                ))}
              </View>
            </Animated.View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyCard: {
    padding: 32,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueCard: {
    padding: 24,
  },
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  positionContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  positionNumber: {
    fontSize: 56,
    fontWeight: '700',
    lineHeight: 64,
  },
  queueInfo: {
    flexDirection: 'row',
  },
  queueInfoItem: {
    flex: 1,
    alignItems: 'center',
  },
  progressCard: {
    padding: 16,
    marginTop: 16,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  rulesCard: {
    padding: 16,
    marginTop: 16,
  },
  ruleRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
});
