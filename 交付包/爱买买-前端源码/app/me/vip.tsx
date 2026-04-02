import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { Tag } from '../../src/components/ui';
import { UserRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';

export default function VipScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['me-vip-profile'],
    queryFn: () => UserRepo.profile(),
  });

  const profile = data?.ok ? data.data : null;
  const error = data && !data.ok ? data.error : null;

  const tiers = [
    {
      id: '种子会员',
      label: '种子会员',
      perks: ['运费减免', '会员价', '专属内容'],
    },
    {
      id: '生长会员',
      label: '生长会员',
      perks: ['更高折扣', '生日礼包', '优先客服', '活动名额'],
    },
    {
      id: '丰收会员',
      label: '丰收会员',
      perks: ['全年免邮', '新品尝鲜', '一对一顾问', '年度礼盒'],
    },
  ];

  const currentIndex = tiers.findIndex((tier) => tier.id === profile?.level);
  const nextTier = currentIndex >= 0 && currentIndex < tiers.length - 1 ? tiers[currentIndex + 1] : null;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="会员权益" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
      >
        {isLoading ? (
          <View>
            <Skeleton height={160} radius={radius.lg} />
            <View style={{ height: spacing.md }} />
            <Skeleton height={220} radius={radius.lg} />
          </View>
        ) : error ? (
          <ErrorState title="会员信息加载失败" description={error.displayMessage ?? '请稍后重试'} onAction={refetch} />
        ) : !profile ? (
          <EmptyState title="暂无会员信息" description="请稍后再试" />
        ) : (
          <>
            <View style={[styles.heroCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={styles.heroRow}>
                <View>
                  <Text style={[typography.title2, { color: colors.text.primary }]}>{profile.level}</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                    成长值 {profile.growthPoints} / {profile.nextLevelPoints}
                  </Text>
                </View>
                <Tag label="会员体系" tone="accent" />
              </View>
              <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    { backgroundColor: colors.brand.primary, width: `${Math.min(100, profile.levelProgress * 100)}%` },
                  ]}
                />
              </View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 8 }]}>
                {nextTier ? `距离 ${nextTier.label} 还差 ${Math.max(0, profile.nextLevelPoints - profile.growthPoints)} 成长值` : '已达最高等级'}
              </Text>
              <Pressable
                onPress={() => show({ message: '成长值来源：消费 / 互动 / 创作（占位）', type: 'info' })}
                style={[styles.actionButton, { borderColor: colors.border, borderRadius: radius.pill }]}
              >
                <Text style={[typography.caption, { color: colors.text.secondary }]}>成长值规则</Text>
              </Pressable>
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>等级权益</Text>
              {tiers.map((tier, index) => {
                const active = tier.id === profile.level;
                return (
                  <View
                    key={tier.id}
                    style={[
                      styles.tierCard,
                      shadow.sm,
                      {
                        backgroundColor: colors.surface,
                        borderRadius: radius.lg,
                        borderColor: active ? colors.brand.primary : 'transparent',
                      },
                    ]}
                  >
                    <View style={styles.tierHeader}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{tier.label}</Text>
                      {active ? <Tag label="当前等级" tone="brand" /> : <Tag label={`Lv.${index + 1}`} tone="neutral" />}
                    </View>
                    <View style={styles.perkRow}>
                      {tier.perks.map((perk) => (
                        <View key={perk} style={[styles.perkChip, { backgroundColor: colors.brand.primarySoft }]}>
                          <Text style={[typography.caption, { color: colors.brand.primary }]}>{perk}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  heroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 12,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  actionButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
  },
  tierCard: {
    padding: 14,
    borderWidth: 1,
    marginTop: 12,
  },
  tierHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  perkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  perkChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginRight: 8,
    marginBottom: 8,
  },
});
