import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AiBadge, AiCardGlow, AiDivider } from '../../src/components/ui';
import { AiOrb } from '../../src/components/effects';
import { AiFeatureRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AppError, AiFinanceService } from '../../src/types';

export default function AiFinanceScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['ai-finance'],
    queryFn: () => AiFeatureRepo.getFinanceServices(),
  });

  const listError = data && !data.ok ? data.error : null;
  const services = data?.ok ? data.data : [];
  const statusConfig: Record<
    AiFinanceService['status'],
    { label: string; color: string; bg: string; cta: string }
  > = {
    available: {
      label: '可申请',
      color: colors.brand.primary,
      bg: colors.brand.primarySoft,
      cta: '立即申请',
    },
    soon: {
      label: '即将上线',
      color: colors.accent.blue,
      bg: colors.accent.blueSoft,
      cta: '预约提醒',
    },
    locked: {
      label: '需认证',
      color: colors.text.secondary,
      bg: colors.border,
      cta: '了解门槛',
    },
  };

  // 渲染服务卡片（根据状态有不同视觉）
  const renderServiceCard = (service: AiFinanceService, index: number) => {
    const config = statusConfig[service.status];

    if (service.status === 'available') {
      // 可用状态：AiCardGlow 包裹 + 顶部渐变线 + 渐变按钮
      return (
        <Animated.View
          key={service.id}
          entering={FadeInDown.duration(300).delay(200 + index * 50)}
        >
          <AiCardGlow style={[shadow.md, { marginTop: 12, borderRadius: radius.lg }]}>
            <View style={[styles.serviceInner, { overflow: 'hidden', borderRadius: radius.lg }]}>
              <LinearGradient
                colors={[colors.ai.start, colors.ai.end]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ height: 2 }}
              />
              <View style={styles.serviceContent}>
                <View style={styles.serviceHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                      {service.title}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                      {service.description}
                    </Text>
                  </View>
                  <AiBadge variant="recommend" />
                </View>
                <View style={styles.serviceFooter}>
                  {service.badge ? (
                    <Text style={[typography.caption, { color: colors.ai.start }]}>{service.badge}</Text>
                  ) : (
                    <Text style={[typography.caption, { color: colors.ai.start }]}>AI 风控评估</Text>
                  )}
                  <Pressable
                    onPress={() => show({ message: `${service.title} ${config.cta}`, type: 'success' })}
                    style={{ borderRadius: radius.pill, overflow: 'hidden' }}
                  >
                    <LinearGradient
                      colors={[colors.brand.primary, colors.ai.start]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[styles.gradientCta, { borderRadius: radius.pill }]}
                    >
                      <Text style={[typography.caption, { color: colors.text.inverse }]}>{config.cta}</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              </View>
            </View>
          </AiCardGlow>
        </Animated.View>
      );
    }

    if (service.status === 'soon') {
      // 即将上线：蓝色左边框 + shadow.sm
      return (
        <Animated.View
          key={service.id}
          entering={FadeInDown.duration(300).delay(200 + index * 50)}
        >
          <View
            style={[
              styles.soonCard,
              shadow.sm,
              {
                backgroundColor: colors.surface,
                borderRadius: radius.lg,
                borderLeftColor: colors.accent.blue,
              },
            ]}
          >
            <View style={styles.serviceHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                  {service.title}
                </Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                  {service.description}
                </Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: colors.accent.blueSoft }]}>
                <Text style={[typography.captionSm, { color: colors.accent.blue }]}>{config.label}</Text>
              </View>
            </View>
            <View style={styles.serviceFooter}>
              {service.badge ? (
                <Text style={[typography.caption, { color: colors.accent.blue }]}>{service.badge}</Text>
              ) : (
                <Text style={[typography.caption, { color: colors.text.secondary }]}>AI 风控评估</Text>
              )}
              <Pressable
                onPress={() => show({ message: `${service.title} ${config.cta}`, type: 'info' })}
                style={[styles.outlineCta, { borderColor: colors.accent.blue, borderRadius: radius.pill }]}
              >
                <Text style={[typography.caption, { color: colors.accent.blue }]}>{config.cta}</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      );
    }

    // locked 状态：灰色调 + 锁定图标
    return (
      <Animated.View
        key={service.id}
        entering={FadeInDown.duration(300).delay(200 + index * 50)}
      >
        <View
          style={[
            styles.lockedCard,
            shadow.sm,
            {
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              borderLeftColor: colors.border,
            },
          ]}
        >
          <View style={styles.serviceHeader}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[typography.bodyStrong, { color: colors.text.tertiary }]}>
                  {service.title}
                </Text>
                <MaterialCommunityIcons
                  name="lock-outline"
                  size={14}
                  color={colors.text.tertiary}
                  style={{ marginLeft: 6 }}
                />
              </View>
              <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: 4 }]}>
                {service.description}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: colors.border }]}>
              <Text style={[typography.captionSm, { color: colors.text.secondary }]}>{config.label}</Text>
            </View>
          </View>
          <View style={styles.serviceFooter}>
            <Text style={[typography.caption, { color: colors.text.tertiary }]}>认证后解锁</Text>
            <Pressable
              onPress={() => show({ message: `${service.title} ${config.cta}`, type: 'info' })}
              style={[styles.outlineCta, { borderColor: colors.border, borderRadius: radius.pill }]}
            >
              <Text style={[typography.caption, { color: colors.text.secondary }]}>{config.cta}</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    );
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="AI 金融" />
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
            title="金融服务加载失败"
            description={(listError as AppError).displayMessage ?? '请稍后重试'}
            onAction={refetch}
          />
        ) : services.length === 0 ? (
          <EmptyState title="暂无金融服务" description="稍后再试或联系客服" />
        ) : (
          <View>
            {/* 页面头部 */}
            <Animated.View entering={FadeInDown.duration(300)}>
              <View style={[styles.headerCard, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' }]}>
                <LinearGradient
                  colors={[colors.ai.start, colors.ai.end]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.topGradient}
                />
                <View style={styles.headerContent}>
                  <View style={styles.headerRow}>
                    <AiOrb size="mini" />
                    <Text style={[typography.title3, { color: colors.text.primary, marginLeft: 10 }]}>
                      农业智能金融
                    </Text>
                    <AiBadge variant="analysis" style={{ marginLeft: 8 }} />
                  </View>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                    额度评估、分期与保障服务的统一入口
                  </Text>
                </View>
              </View>
            </Animated.View>

            {/* 可用服务 */}
            <View style={{ marginTop: spacing.lg }}>
              <View style={styles.sectionHeader}>
                <Text style={[typography.title3, { color: colors.text.primary }]}>可用服务</Text>
                <AiBadge variant="recommend" style={{ marginLeft: 8 }} />
              </View>
              <AiDivider style={{ marginTop: spacing.xs, marginBottom: spacing.xs }} />
              {services.map((service, index) => renderServiceCard(service, index))}
            </View>

            {/* 底部 AI 风控评估卡 */}
            <Animated.View entering={FadeInDown.duration(300).delay(400)}>
              <AiCardGlow style={[shadow.sm, { marginTop: spacing.lg, borderRadius: radius.lg }]}>
                <View style={[styles.riskCard, { backgroundColor: colors.ai.soft }]}>
                  <View style={styles.riskHeader}>
                    <AiBadge variant="analysis" />
                  </View>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: 8 }]}>
                    AI 风控评估
                  </Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                    基于购买行为、信用数据与农产品交易记录，为您提供个性化金融风险评估和额度建议。
                  </Text>
                </View>
              </AiCardGlow>
            </Animated.View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerCard: {
    borderWidth: 0,
  },
  topGradient: {
    height: 3,
  },
  headerContent: {
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serviceInner: {
    flex: 1,
  },
  serviceContent: {
    padding: 14,
  },
  serviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  serviceFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  gradientCta: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  outlineCta: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  soonCard: {
    padding: 14,
    marginTop: 12,
    borderLeftWidth: 2,
  },
  lockedCard: {
    padding: 14,
    marginTop: 12,
    borderLeftWidth: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  riskCard: {
    padding: 16,
    borderRadius: 10,
  },
  riskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
