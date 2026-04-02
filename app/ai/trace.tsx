import React, { useEffect } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AiBadge, AiCardGlow, AiDivider, Tag } from '../../src/components/ui';
import { AiOrb } from '../../src/components/effects';
import { AiFeatureRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AppError, AiTraceStepStatus } from '../../src/types';

// 节点 emoji 映射（按顺序分配给步骤）
const STEP_EMOJIS = ['🌱', '🔬', '📦', '🚚', '✅'];

// 脉动动画组件（doing 状态专用）
function PulsingNode({ children }: { children: React.ReactNode }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.15, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [scale]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={pulseStyle}>{children}</Animated.View>;
}

export default function AiTraceScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  // I02修复：读取商品ID参数
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['ai-trace', productId],
    queryFn: () => AiFeatureRepo.getTraceOverview(productId),
  });

  const traceError = data && !data.ok ? data.error : null;
  const overview = data?.ok ? data.data : null;
  const refreshing = isFetching;

  // 节点样式配置
  const getNodeStyle = (status: AiTraceStepStatus) => {
    switch (status) {
      case 'done':
        return { bg: colors.brand.primarySoft, border: colors.brand.primary };
      case 'doing':
        return { bg: colors.ai.soft, border: colors.ai.start };
      case 'pending':
        return { bg: 'transparent', border: colors.border };
    }
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
            {/* 头部卡片 */}
            <Animated.View entering={FadeInDown.duration(300)}>
              <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' }]}>
                <LinearGradient
                  colors={[colors.ai.start, colors.ai.end]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.topGradient}
                />
                <View style={styles.cardContent}>
                  <View style={styles.headerRow}>
                    <AiOrb size="mini" />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[typography.title3, { color: colors.text.primary }]}>
                          {overview.productName}
                        </Text>
                        <AiBadge variant="trace" style={{ marginLeft: 8 }} />
                      </View>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                        批次：{overview.batchId} · 基地：{overview.farmName}
                      </Text>
                    </View>
                  </View>
                  <Text style={[typography.caption, { color: colors.ai.start, marginTop: 8, fontWeight: '600' }]}>
                    {overview.statusLabel}
                  </Text>
                  <View style={styles.tagRow}>
                    {overview.tags.map((tag) => (
                      <Tag key={tag} label={tag} tone="accent" style={{ marginRight: 6 }} />
                    ))}
                  </View>
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => router.push({ pathname: '/product/[id]', params: { id: overview.productId } })}
                      style={{ borderRadius: radius.pill, overflow: 'hidden', marginRight: 10 }}
                    >
                      <LinearGradient
                        colors={[colors.brand.primary, colors.ai.start]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.gradientButton, { borderRadius: radius.pill }]}
                      >
                        <Text style={[typography.caption, { color: colors.text.inverse }]}>查看商品</Text>
                      </LinearGradient>
                    </Pressable>
                    <Pressable
                      onPress={() => show({ message: '检测报告生成中', type: 'info' })}
                      style={[styles.outlineButton, { borderRadius: radius.pill, borderColor: colors.border }]}
                    >
                      <Text style={[typography.caption, { color: colors.text.secondary }]}>下载报告</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </Animated.View>

            {/* AI 可信度评分卡 */}
            <Animated.View entering={FadeInDown.duration(300).delay(100)}>
              <AiCardGlow style={[shadow.md, { marginTop: spacing.md, borderRadius: radius.lg }]}>
                <View style={[styles.scoreCard, { backgroundColor: colors.ai.soft }]}>
                  <View style={styles.scoreHeader}>
                    <AiBadge variant="score" />
                  </View>
                  <View style={styles.scoreRow}>
                    <Text style={[styles.scoreNumber, { color: colors.ai.start }]}>96</Text>
                    <Text style={[typography.title3, { color: colors.text.secondary }]}>/100</Text>
                  </View>
                  {/* 渐变进度条 */}
                  <View style={[styles.scoreTrack, { backgroundColor: colors.border }]}>
                    <LinearGradient
                      colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[styles.scoreFill, { width: '96%' }]}
                    />
                  </View>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 8, fontStyle: 'italic' }]}>
                    "该产品溯源信息完整，来源可信，检测报告齐全，综合可信度极高。"
                  </Text>
                </View>
              </AiCardGlow>
            </Animated.View>

            {/* 溯源节点 */}
            <View style={{ marginTop: spacing.lg }}>
              <View style={styles.sectionHeader}>
                <Text style={[typography.title3, { color: colors.text.primary }]}>溯源节点</Text>
                <AiBadge variant="trace" style={{ marginLeft: 8 }} />
              </View>
              <AiDivider style={{ marginTop: spacing.xs, marginBottom: spacing.sm }} />

              {overview.steps.map((step, index) => {
                const emoji = STEP_EMOJIS[index % STEP_EMOJIS.length];
                const nodeStyle = getNodeStyle(step.status);
                const isLast = index === overview.steps.length - 1;

                const nodeContent = (
                  <View
                    style={[
                      styles.emojiNode,
                      {
                        backgroundColor: nodeStyle.bg,
                        borderColor: nodeStyle.border,
                        borderWidth: step.status === 'pending' ? 2 : 0,
                      },
                      step.status === 'doing' && shadow.md,
                    ]}
                  >
                    {step.status === 'pending' ? null : (
                      <Text style={{ fontSize: 16 }}>{step.status === 'done' ? '✅' : emoji}</Text>
                    )}
                  </View>
                );

                return (
                  <Animated.View
                    key={step.id}
                    entering={FadeInDown.duration(300).delay(200 + index * 50)}
                    style={styles.stepRow}
                  >
                    {/* 左侧时间线 */}
                    <View style={styles.stepLeft}>
                      {step.status === 'doing' ? (
                        <PulsingNode>{nodeContent}</PulsingNode>
                      ) : (
                        nodeContent
                      )}
                      {/* 连接线 */}
                      {!isLast && (
                        <View style={styles.lineWrapper}>
                          <LinearGradient
                            colors={[colors.ai.start, colors.ai.end]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.gradientLine}
                          />
                        </View>
                      )}
                    </View>

                    {/* 右侧内容 */}
                    <View style={[styles.stepContent, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
                      <Text style={[typography.bodyStrong, { color: step.status === 'pending' ? colors.text.tertiary : colors.text.primary }]}>
                        {step.title}
                      </Text>
                      <Text style={[typography.caption, { color: step.status === 'pending' ? colors.text.tertiary : colors.text.secondary, marginTop: 4 }]}>
                        {step.description}
                      </Text>
                      {(step.time || step.location) && (
                        <View style={styles.stepMeta}>
                          {step.time && (
                            <View style={styles.metaItem}>
                              <MaterialCommunityIcons name="clock-outline" size={12} color={colors.text.tertiary} />
                              <Text style={[typography.captionSm, { color: colors.text.tertiary, marginLeft: 4 }]}>{step.time}</Text>
                            </View>
                          )}
                          {step.location && (
                            <View style={styles.metaItem}>
                              <MaterialCommunityIcons name="map-marker-outline" size={12} color={colors.text.tertiary} />
                              <Text style={[typography.captionSm, { color: colors.text.tertiary, marginLeft: 4 }]}>{step.location}</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  </Animated.View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 0,
  },
  topGradient: {
    height: 3,
  },
  cardContent: {
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  gradientButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  outlineButton: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  scoreCard: {
    padding: 16,
    borderRadius: 10,
  },
  scoreHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 8,
  },
  scoreNumber: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 1,
  },
  scoreTrack: {
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    overflow: 'hidden',
  },
  scoreFill: {
    height: 6,
    borderRadius: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  stepLeft: {
    width: 44,
    alignItems: 'center',
  },
  emojiNode: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineWrapper: {
    flex: 1,
    width: 2,
    alignSelf: 'center',
    marginVertical: 2,
    overflow: 'hidden',
    borderRadius: 1,
  },
  gradientLine: {
    flex: 1,
    width: 2,
  },
  stepContent: {
    flex: 1,
    padding: 12,
    marginLeft: 8,
    marginBottom: 8,
  },
  stepMeta: {
    flexDirection: 'row',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
});
