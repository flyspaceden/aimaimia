import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { Tag } from '../../src/components/ui';
import { BonusRepo, GrowthRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useBottomInset, useTheme } from '../../src/theme';
import type { NormalShareRecord, VipReferralRecord } from '../../src/types';

const rewardStatusLabels: Record<NormalShareRecord['rewardStatus'], string> = {
  PENDING: '已绑定',
  REGISTER_REWARDED: '注册已奖',
  FIRST_ORDER_PENDING: '待首单',
  ISSUED: '首单已奖',
  REVERSED: '已冲正',
  VOIDED: '已作废',
};

const relationStatusLabels: Record<NonNullable<NormalShareRecord['relationStatus']>, string> = {
  ACTIVE: '关系有效',
  SUPERSEDED_BY_VIP_TREE: '转入 VIP 关系',
  INVALIDATED_BY_INVITEE_VIP_UPGRADE: '已因对方升级 VIP 结束',
  ADMIN_VOIDED: '已作废',
};

function formatDate(value?: string | null) {
  if (!value) return '暂无时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无时间';
  return date.toLocaleDateString();
}

function normalName(record: NormalShareRecord) {
  return record.invitee?.profile?.nickname || record.invitee?.buyerNo || '新用户';
}

function vipName(record: VipReferralRecord) {
  return record.nickname || record.invitee?.profile?.nickname || record.buyerNo || record.maskedPhone || '新用户';
}

export default function ReferralUsersScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const bottomInset = useBottomInset(0);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const memberQuery = useQuery({
    queryKey: ['bonus-member'],
    queryFn: () => BonusRepo.getMember(),
    enabled: isLoggedIn,
  });
  const member = memberQuery.data?.ok ? memberQuery.data.data : null;
  const isVip = member?.tier === 'VIP';
  const normalEnabled = Boolean(isLoggedIn && memberQuery.data?.ok && !isVip);
  const vipEnabled = Boolean(isLoggedIn && memberQuery.data?.ok && isVip);

  const normalRecordsQuery = useQuery({
    queryKey: ['normal-share-records'],
    queryFn: () => GrowthRepo.getNormalShareRecords(),
    enabled: normalEnabled,
  });
  const vipRecordsQuery = useQuery({
    queryKey: ['vip-referral-records'],
    queryFn: () => BonusRepo.getReferralRecords(),
    enabled: vipEnabled,
  });

  const normalRecords = normalRecordsQuery.data?.ok ? normalRecordsQuery.data.data : [];
  const vipRecords = vipRecordsQuery.data?.ok ? vipRecordsQuery.data.data : [];
  const loading =
    memberQuery.isLoading ||
    (normalEnabled && normalRecordsQuery.isLoading) ||
    (vipEnabled && vipRecordsQuery.isLoading);
  const refreshing = memberQuery.isFetching || normalRecordsQuery.isFetching || vipRecordsQuery.isFetching;

  const refresh = async () => {
    const tasks: Array<Promise<unknown>> = [memberQuery.refetch()];
    if (normalEnabled) tasks.push(normalRecordsQuery.refetch());
    if (vipEnabled) tasks.push(vipRecordsQuery.refetch());
    await Promise.all(tasks);
  };

  if (!isLoggedIn) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="推荐用户" />
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl }}>
          <EmptyState title="登录后查看推荐用户" description="登录后可以查看你直接推荐的用户" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="推荐用户" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] + bottomInset }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <>
            <Skeleton height={88} radius={radius.lg} />
            <View style={{ height: spacing.md }} />
            <Skeleton height={88} radius={radius.lg} />
          </>
        ) : memberQuery.data && !memberQuery.data.ok ? (
          <ErrorState
            title="推荐用户加载失败"
            description={memberQuery.data.error.displayMessage ?? '请稍后重试'}
            onAction={memberQuery.refetch}
          />
        ) : isVip ? (
          <View style={[styles.listCard, { backgroundColor: colors.surface, borderRadius: radius.lg }, shadow.sm]}>
            <View style={styles.titleRow}>
              <Text style={[typography.headingSm, { color: colors.text.primary }]}>VIP 推荐</Text>
              <Tag label={`${vipRecords.length} 人`} tone="accent" />
            </View>
            {vipRecords.length === 0 ? (
              <EmptyState title="暂无推荐用户" description="分享 VIP 推荐码后，这里会显示直接推荐的用户" />
            ) : (
              <View style={{ marginTop: spacing.sm }}>
                {vipRecords.map((record) => (
                  <View key={record.id} style={[styles.row, { borderBottomColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{vipName(record)}</Text>
                      <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 3 }]}>
                        {record.buyerNo ?? record.maskedPhone ?? '暂无编号'} · {formatDate(record.vipPurchasedAt ?? record.boundAt)}
                      </Text>
                    </View>
                    <Tag label={record.tier === 'VIP' ? '已成为 VIP' : '普通用户'} tone={record.tier === 'VIP' ? 'brand' : 'neutral'} />
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.listCard, { backgroundColor: colors.surface, borderRadius: radius.lg }, shadow.sm]}>
            <View style={styles.titleRow}>
              <Text style={[typography.headingSm, { color: colors.text.primary }]}>普通推荐</Text>
              <Tag label={`${normalRecords.length} 人`} tone="accent" />
            </View>
            {normalRecords.length === 0 ? (
              <EmptyState title="暂无推荐用户" description="分享普通分享码后，这里会显示直接推荐的用户" />
            ) : (
              <View style={{ marginTop: spacing.sm }}>
                {normalRecords.map((record) => (
                  <View key={record.id} style={[styles.row, { borderBottomColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{normalName(record)}</Text>
                      <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 3 }]}>
                        {(record.relationStatus && relationStatusLabels[record.relationStatus]) || '关系有效'} · {formatDate(record.boundAt)}
                      </Text>
                    </View>
                    <Tag label={rewardStatusLabels[record.rewardStatus]} tone={record.rewardStatus === 'ISSUED' ? 'brand' : 'accent'} />
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  listCard: {
    padding: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  row: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
});
