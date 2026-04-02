import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppHeader, Screen } from '../../src/components/layout';
import { AppBottomSheet } from '../../src/components/overlay';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { bookingStatusLabels } from '../../src/constants';
import { BookingRepo, CompanyRepo, GroupRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { Booking, BookingStatus, Company } from '../../src/types';

const REVIEW_STATUS_OPTIONS: Array<{ value: Extract<BookingStatus, 'approved' | 'rejected'>; label: string }> = [
  { value: 'approved', label: '通过' },
  { value: 'rejected', label: '驳回' },
];

export default function AdminAuditScreen() {
  const { colors, radius, spacing, typography, shadow } = useTheme();
  const { show } = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<Extract<BookingStatus, 'approved' | 'rejected'>>('approved');
  const [reviewNote, setReviewNote] = useState('');
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [refreshing, setRefreshing] = useState(false);

  const { data: bookingResult, isLoading, refetch } = useQuery({
    queryKey: ['adminBookings'],
    queryFn: () => BookingRepo.list(),
  });
  const { data: companyResult, refetch: refetchCompanies } = useQuery({
    queryKey: ['companies'],
    queryFn: () => CompanyRepo.list(),
  });
  const { data: groupResult, refetch: refetchGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: () => GroupRepo.list(),
  });

  const bookings = bookingResult?.ok ? bookingResult.data : [];
  const bookingError = bookingResult && !bookingResult.ok ? bookingResult.error : null;
  const companies = companyResult?.ok ? companyResult.data : [];
  const companyMap = useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies]
  );
  const groups = groupResult?.ok ? groupResult.data : [];

  const sortedBookings = useMemo(() => {
    const order: BookingStatus[] = ['pending', 'approved', 'invited', 'joined', 'paid', 'rejected'];
    return [...bookings].sort(
      (a, b) => order.indexOf(a.status) - order.indexOf(b.status)
    );
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    if (statusFilter === 'all') {
      return sortedBookings;
    }
    return sortedBookings.filter((booking) => booking.status === statusFilter);
  }, [sortedBookings, statusFilter]);

  const stats = useMemo(() => {
    const pending = bookings.filter((item) => item.status === 'pending').length;
    const approved = bookings.filter((item) => item.status === 'approved').length;
    const rejected = bookings.filter((item) => item.status === 'rejected').length;
    return [
      { label: '待审核', value: pending },
      { label: '已通过', value: approved },
      { label: '已驳回', value: rejected },
    ];
  }, [bookings]);

  const statusTone: Record<string, { bg: string; fg: string }> = {
    pending: { bg: colors.brand.primarySoft, fg: colors.brand.primary },
    approved: { bg: colors.accent.blueSoft, fg: colors.accent.blue },
    rejected: { bg: colors.border, fg: colors.text.secondary },
    invited: { bg: colors.accent.blueSoft, fg: colors.accent.blue },
    joined: { bg: colors.brand.primarySoft, fg: colors.brand.primary },
    paid: { bg: colors.brand.primarySoft, fg: colors.brand.primary },
  };
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchGroups(), refetchCompanies()]);
    setRefreshing(false);
  };

  const openReviewSheet = (booking: Booking, status: Extract<BookingStatus, 'approved' | 'rejected'>) => {
    setActiveBooking(booking);
    setReviewStatus(status);
    setReviewNote('');
    setSheetOpen(true);
  };

  const getCompanyLabel = (companyId: string) => companyMap.get(companyId)?.name ?? '未知企业';

  const formatDate = (value: Date) => value.toISOString().slice(0, 10);

  const handleReview = async () => {
    if (!activeBooking) {
      return;
    }

    const result = await BookingRepo.review(activeBooking.id, reviewStatus, reviewNote.trim() || undefined);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '审核失败', type: 'error' });
      return;
    }

    // 审核通过后检查阈值，自动创建考察团（复杂业务逻辑需中文注释）
    if (reviewStatus === 'approved') {
      await maybeCreateGroup(activeBooking.companyId, companyMap.get(activeBooking.companyId), groups);
    }

    setSheetOpen(false);
    await refetch();
    await refetchGroups();
    show({ message: `已${reviewStatus === 'approved' ? '通过' : '驳回'}预约`, type: 'success' });
  };

  const inviteApprovedBookings = async (companyId: string, groupId: string) => {
    const bookingList = await BookingRepo.listByCompany(companyId);
    if (!bookingList.ok) {
      return;
    }

    const approvedBookings = bookingList.data.filter((booking) => booking.status === 'approved');
    await Promise.all(
      approvedBookings.map((booking) => BookingRepo.inviteToGroup(booking.id, groupId))
    );
  };

  const maybeCreateGroup = async (companyId: string, company: Company | undefined, groupList: typeof groups) => {
    if (!company) {
      return;
    }
    const bookingList = await BookingRepo.listByCompany(companyId);
    if (!bookingList.ok) {
      return;
    }
    const approvedHeadcount = bookingList.data
      .filter((booking) => booking.status === 'approved')
      .reduce((sum, booking) => sum + booking.headcount, 0);

    const target = company.groupTargetSize ?? 30;
    const hasActiveGroup = groupList.some(
      (group) => group.companyId === companyId && ['forming', 'inviting', 'confirmed'].includes(group.status)
    );

    if (!hasActiveGroup && approvedHeadcount >= target) {
      const created = await GroupRepo.create({
        companyId,
        title: `${company.name}考察团`,
        destination: company.location,
        targetSize: target,
        deadline: formatDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
      });
      if (created.ok) {
        // 成团后向已通过审核的预约发送参团邀请（复杂业务逻辑需中文注释）
        await inviteApprovedBookings(companyId, created.data.id);
      }
      show({ message: `已自动发起${company.name}考察团`, type: 'info' });
    }
  };

  const handleManualCreateGroup = async (company: Company) => {
    const created = await GroupRepo.create({
      companyId: company.id,
      title: `${company.name}考察团`,
      destination: company.location,
      targetSize: company.groupTargetSize ?? 30,
      deadline: formatDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
    });
    if (created.ok) {
      await inviteApprovedBookings(company.id, created.data.id);
    }
    refetch();
    refetchGroups();
    show({ message: '已手动发起考察团', type: 'success' });
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="运营审核中心"
        rightSlot={
          <Pressable onPress={() => refetch()} hitSlop={10} style={{ padding: 8 }}>
            <MaterialCommunityIcons name="refresh" size={20} color={colors.text.secondary} />
          </Pressable>
        }
      />
      <FlatList
        data={filteredBookings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListHeaderComponent={
          <View style={{ marginBottom: spacing.lg }}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>预约审核 · 组团管理</Text>
            <View style={styles.statsRow}>
              {stats.map((item, index) => (
                <View
                  key={item.label}
                  style={[
                    styles.statCard,
                    shadow.sm,
                    {
                      backgroundColor: colors.surface,
                      borderRadius: radius.lg,
                      marginRight: index === stats.length - 1 ? 0 : spacing.sm,
                    },
                  ]}
                >
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>{item.label}</Text>
                  <Text style={[typography.title3, { color: colors.text.primary, marginTop: 4 }]}>
                    {item.value}
                  </Text>
                </View>
              ))}
            </View>
            <View style={styles.filterRow}>
              {[
                { id: 'all', label: '全部' },
                { id: 'pending', label: '待审核' },
                { id: 'approved', label: '已通过' },
                { id: 'rejected', label: '已驳回' },
              ].map((item) => {
                const active = statusFilter === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setStatusFilter(item.id as typeof statusFilter)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: active ? colors.brand.primary : colors.surface,
                        borderColor: active ? colors.brand.primary : colors.border,
                        borderRadius: radius.pill,
                        marginRight: spacing.sm,
                      },
                    ]}
                  >
                    <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary }]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>手动发起组团</Text>
              {companies.map((company) => (
                <View key={company.id} style={styles.rowBetween}>
                  <Text style={[typography.body, { color: colors.text.primary }]}>{company.name}</Text>
                  <Pressable
                    onPress={() => handleManualCreateGroup(company)}
                    style={[styles.primaryButton, { backgroundColor: colors.brand.primary, paddingVertical: 6 }]}
                  >
                    <Text style={[typography.caption, { color: colors.text.inverse }]}>发起</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <View style={styles.rowBetween}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                {getCompanyLabel(item.companyId)}
              </Text>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: statusTone[item.status]?.bg ?? colors.border },
                ]}
              >
                <Text style={[typography.caption, { color: statusTone[item.status]?.fg ?? colors.text.secondary }]}>
                  {bookingStatusLabels[item.status]}
                </Text>
              </View>
            </View>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
              日期 {item.date} · 人数 {item.headcount}
            </Text>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
              备注：{item.note || '无'}
            </Text>
            {item.auditNote ? (
              <Text style={[typography.caption, { color: colors.muted, marginTop: spacing.xs }]}>
                审核备注：{item.auditNote}
              </Text>
            ) : null}
            {item.status === 'pending' ? (
              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => openReviewSheet(item, 'approved')}
                  style={[styles.primaryButton, { backgroundColor: colors.brand.primary, flex: 1, marginRight: spacing.sm }]}
                >
                  <Text style={[typography.caption, { color: colors.text.inverse }]}>通过</Text>
                </Pressable>
                <Pressable
                  onPress={() => openReviewSheet(item, 'rejected')}
                  style={[styles.ghostButton, { borderColor: colors.border, flex: 1 }]}
                >
                  <Text style={[typography.caption, { color: colors.text.primary }]}>驳回</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          isLoading ? (
            <View>
              <Skeleton height={180} radius={radius.lg} />
              <View style={{ height: spacing.md }} />
              <Skeleton height={180} radius={radius.lg} />
            </View>
          ) : bookingError ? (
            <ErrorState
              title="加载失败"
              description={bookingError.displayMessage ?? '请稍后再试'}
              onAction={refetch}
            />
          ) : (
            <EmptyState title="暂无预约审核" description="稍后再来看看" />
          )
        }
      />

      <AppBottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} mode="half" title="审核处理">
        <View style={{ flexDirection: 'row', marginBottom: spacing.md }}>
          {REVIEW_STATUS_OPTIONS.map((option) => {
            const active = option.value === reviewStatus;
            return (
              <Pressable
                key={option.value}
                onPress={() => setReviewStatus(option.value)}
                style={[
                  styles.identityChip,
                  {
                    backgroundColor: active ? colors.brand.primary : colors.surface,
                    borderColor: active ? colors.brand.primary : colors.border,
                    borderRadius: radius.pill,
                    marginRight: spacing.sm,
                  },
                ]}
              >
                <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[typography.caption, { color: colors.text.secondary }]}>审核备注</Text>
        <TextInput
          value={reviewNote}
          onChangeText={setReviewNote}
          placeholder="填写审核备注（可选）"
          placeholderTextColor={colors.muted}
          style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
        />
        <Pressable
          onPress={handleReview}
          style={[styles.primaryButton, { backgroundColor: colors.brand.primary, marginTop: spacing.md }]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>确认提交</Text>
        </Pressable>
      </AppBottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    marginTop: 16,
  },
  statCard: {
    flex: 1,
    padding: 12,
  },
  filterRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
  panel: {
    padding: 16,
    marginTop: 16,
  },
  card: {
    padding: 16,
    marginBottom: 16,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  primaryButton: {
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButton: {
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  identityChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
});
