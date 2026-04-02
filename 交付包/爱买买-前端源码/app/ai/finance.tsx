import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { Tag } from '../../src/components/ui';
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
            <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={[styles.icon, { backgroundColor: colors.skeleton }]}>
                <MaterialCommunityIcons name="cash-multiple" size={20} color={colors.text.secondary} />
              </View>
              <Text style={[typography.title3, { color: colors.text.primary, marginTop: spacing.sm }]}>
                金融服务入口
              </Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                额度评估、分期与保障服务的统一入口
              </Text>
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>可用服务</Text>
              {services.map((service) => {
                const config = statusConfig[service.status];
                return (
                  <View
                    key={service.id}
                    style={[
                      styles.serviceCard,
                      shadow.sm,
                      { backgroundColor: colors.surface, borderRadius: radius.lg },
                    ]}
                  >
                    <View style={styles.serviceHeader}>
                      <View>
                        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                          {service.title}
                        </Text>
                        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                          {service.description}
                        </Text>
                      </View>
                      <Tag
                        label={config.label}
                        tone={service.status === 'available' ? 'brand' : 'accent'}
                        style={{ backgroundColor: config.bg }}
                      />
                    </View>
                    <View style={styles.serviceFooter}>
                      {service.badge ? (
                        <Text style={[typography.caption, { color: colors.text.secondary }]}>{service.badge}</Text>
                      ) : (
                        <Text style={[typography.caption, { color: colors.text.secondary }]}>AI 风控评估</Text>
                      )}
                      <Pressable
                        onPress={() =>
                          show({
                            message: `${service.title} ${config.cta}`,
                            type: service.status === 'available' ? 'success' : 'info',
                          })
                        }
                        style={[
                          styles.actionButton,
                          { borderRadius: radius.pill, borderColor: config.color },
                        ]}
                      >
                        <Text style={[typography.caption, { color: config.color }]}>{config.cta}</Text>
                      </Pressable>
                    </View>
                  </View>
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
  serviceCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginTop: 12,
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
  actionButton: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
