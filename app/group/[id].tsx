import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { bookingStatusLabels, groupStatusLabels, identityOptions, paymentMethods } from '../../src/constants';
import { BookingRepo, CompanyRepo, GroupRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AppError, Booking, Group, PaymentMethod } from '../../src/types';

export default function GroupDetailScreen() {
  const { colors, radius, spacing, typography, shadow, gradients } = useTheme();
  const { show } = useToast();
  const { id } = useLocalSearchParams();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('wechat');
  const [refreshing, setRefreshing] = useState(false);

  const groupId = Array.isArray(id) ? id[0] : id;
  const { data: groupResult, isLoading, refetch } = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => GroupRepo.getById(groupId ?? ''),
    enabled: Boolean(groupId),
  });
  const { data: companyResult, refetch: refetchCompanies } = useQuery({
    queryKey: ['companies'],
    queryFn: () => CompanyRepo.list(),
  });
  const { data: bookingResult, refetch: refetchBookings } = useQuery({
    queryKey: ['groupBookings', groupId],
    queryFn: () => BookingRepo.listByGroup(groupId ?? ''),
    enabled: Boolean(groupId),
  });

  const group = groupResult?.ok ? groupResult.data : null;
  const error = groupResult && !groupResult.ok ? groupResult.error : null;
  const companies = companyResult?.ok ? companyResult.data.items : [];
  const bookings = bookingResult?.ok ? bookingResult.data : [];

  const identityLabelMap = useMemo(
    () => new Map(identityOptions.map((option) => [option.value, option.label])),
    []
  );

  const companyName = companies.find((item) => item.id === group?.companyId)?.name ?? '企业';
  const statusTone: Record<string, { bg: string; fg: string }> = {
    forming: { bg: colors.brand.primarySoft, fg: colors.brand.primary },
    inviting: { bg: colors.accent.blueSoft, fg: colors.accent.blue },
    confirmed: { bg: colors.accent.blueSoft, fg: colors.accent.blue },
    paid: { bg: colors.brand.primarySoft, fg: colors.brand.primary },
    completed: { bg: colors.border, fg: colors.text.secondary },
  };
  const bookingTone: Record<string, { bg: string; fg: string }> = {
    pending: { bg: colors.brand.primarySoft, fg: colors.brand.primary },
    approved: { bg: colors.accent.blueSoft, fg: colors.accent.blue },
    rejected: { bg: colors.border, fg: colors.text.secondary },
    invited: { bg: colors.accent.blueSoft, fg: colors.accent.blue },
    joined: { bg: colors.brand.primarySoft, fg: colors.brand.primary },
    paid: { bg: colors.brand.primarySoft, fg: colors.brand.primary },
  };

  const handleJoinAndPay = async (target: Group) => {
    // 参团 + 支付（支付功能开发中，当前仅记录参团）
    const bookingResult = await BookingRepo.joinGroup({
      companyId: target.companyId,
      groupId: target.id,
      identity: 'consumer',
      headcount: 1,
      contactName: '当前用户',
    });
    if (!bookingResult.ok) {
      show({ message: bookingResult.error.displayMessage ?? '参团失败', type: 'error' });
      return;
    }

    const result = await GroupRepo.join(target.id, bookingResult.data.headcount);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '参团失败', type: 'error' });
      return;
    }
    await refetch();
    await refetchBookings();
    show({
      message: '参团成功！支付功能开发中',
      type: 'success',
    });
  };
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchBookings(), refetchCompanies()]);
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="考察团详情" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={220} radius={radius.lg} />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={180} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  if (!group) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="考察团详情" />
        {error ? (
          <View style={{ padding: spacing.xl }}>
            <ErrorState
              title="考察团加载失败"
              description={(error as AppError | null)?.displayMessage ?? '请稍后再试'}
              onAction={refetch}
            />
          </View>
        ) : (
          <View style={{ padding: spacing.xl }}>
            <EmptyState title="未找到考察团" description="请稍后再试" />
          </View>
        )}
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="考察团详情" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Animated.View entering={FadeInDown.duration(300)} style={[styles.panel, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' }]}>
          <LinearGradient
            colors={[...gradients.aiGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ height: 3, position: 'absolute', top: 0, left: 0, right: 0 }}
          />
          <Text style={[typography.title2, { color: colors.text.primary }]}>{group.title}</Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
            {companyName} · {group.destination}
          </Text>
          <View style={styles.rowBetween}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>
              进度 {group.memberCount}/{group.targetSize}
            </Text>
            <View style={[styles.statusPill, { backgroundColor: statusTone[group.status]?.bg ?? colors.border }]}>
              <Text style={[typography.caption, { color: statusTone[group.status]?.fg ?? colors.text.secondary }]}>
                {groupStatusLabels[group.status]}
              </Text>
            </View>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <LinearGradient
              colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[
                styles.progressFill,
                { width: `${Math.min(100, (group.memberCount / group.targetSize) * 100)}%` },
              ]}
            />
          </View>
          <Text style={[typography.caption, { color: colors.muted, marginTop: spacing.xs }]}>
            截止日期：{group.deadline}
          </Text>
          <View style={styles.infoRow}>
            <View style={[styles.infoCard, shadow.md, { backgroundColor: colors.surface, borderColor: 'transparent', marginRight: spacing.sm }]}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>目标人数</Text>
              <Text style={[typography.title3, { color: colors.text.primary, marginTop: 4 }]}>
                {group.targetSize}
              </Text>
            </View>
            <View style={[styles.infoCard, shadow.md, { backgroundColor: colors.surface, borderColor: 'transparent', marginRight: 0 }]}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>当前报名</Text>
              <Text style={[typography.title3, { color: colors.text.primary, marginTop: 4 }]}>
                {group.memberCount}
              </Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(80)} style={[styles.panel, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>参团成员</Text>
          {bookings.length === 0 ? (
            <EmptyState title="暂无成员" description="成团邀请发送后会展示成员信息" />
          ) : (
            bookings.map((booking: Booking, index: number) => (
              <Animated.View
                key={booking.id}
                entering={FadeInDown.duration(300).delay(50 + index * 30)}
                style={[
                  styles.memberRow,
                  {
                    borderBottomColor: colors.border,
                    borderBottomWidth: index === bookings.length - 1 ? 0 : 1,
                  },
                ]}
              >
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                  {booking.contactName || '匿名'}
                </Text>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  {identityLabelMap.get(booking.identity) ?? booking.identity} · {booking.headcount} 人
                </Text>
                <View
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor: bookingTone[booking.status]?.bg ?? colors.border,
                      marginTop: 6,
                    },
                  ]}
                >
                  <Text
                    style={[
                      typography.caption,
                      { color: bookingTone[booking.status]?.fg ?? colors.text.secondary },
                    ]}
                  >
                    {bookingStatusLabels[booking.status]}
                  </Text>
                </View>
              </Animated.View>
            ))
          )}
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(160)} style={[styles.panel, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>支付方式</Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
            支付功能开发中，选择支付方式后确认参团
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
            {paymentMethods.map((method) => {
              const active = paymentMethod === method.value;
              return (
                <Pressable
                  key={method.value}
                  onPress={() => setPaymentMethod(method.value)}
                  style={[
                    styles.methodChip,
                    {
                      overflow: 'hidden',
                      borderColor: active ? colors.brand.primary : colors.border,
                      borderRadius: radius.pill,
                      marginRight: spacing.sm,
                      marginBottom: spacing.sm,
                    },
                  ]}
                >
                  {active ? (
                    <LinearGradient
                      colors={[colors.brand.primarySoft, colors.ai.soft]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFill}
                    />
                  ) : null}
                  <MaterialCommunityIcons
                    name={active ? 'check-circle' : 'circle-outline'}
                    size={14}
                    color={active ? colors.brand.primary : colors.text.secondary}
                  />
                  <Text
                    style={[
                      typography.caption,
                      { color: active ? colors.brand.primary : colors.text.secondary, marginLeft: 4 },
                    ]}
                  >
                    {method.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => handleJoinAndPay(group)}>
            <LinearGradient
              colors={[colors.brand.primary, colors.ai.start]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.primaryButton}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>确认参团并支付</Text>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 16,
    marginBottom: 16,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  memberRow: {
    paddingVertical: 10,
  },
  methodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  infoRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  infoCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginRight: 10,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 10,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  primaryButton: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
});
