import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CalendarStrip } from '../../src/components/data';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { BookingForm, BookingFormValues } from '../../src/components/forms';
import { AppHeader, Screen } from '../../src/components/layout';
import { AppBottomSheet } from '../../src/components/overlay';
import { Tag } from '../../src/components/ui/Tag';
import { bookingStatusLabels, groupStatusLabels, identityOptions, paymentMethods } from '../../src/constants';
import { BookingRepo, CompanyEventRepo, CompanyRepo, GroupRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AppError, CompanyEvent, Group } from '../../src/types';

const formatDate = (value: Date) => value.toISOString().slice(0, 10);
const parseDateTime = (date: string, time: string) => new Date(`${date}T${time}`);

export default function CompanyDetailScreen() {
  const { colors, radius, spacing, typography, shadow } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [activeTab, setActiveTab] = useState('calendar');
  const [selectedDate, setSelectedDate] = useState(() => formatDate(new Date()));
  const [selectedEvent, setSelectedEvent] = useState<CompanyEvent | null>(null);
  const [bookingSheetOpen, setBookingSheetOpen] = useState(false);
  const [agendaSheetOpen, setAgendaSheetOpen] = useState(false);
  const [agendaSheetDate, setAgendaSheetDate] = useState<string | null>(null);
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'wechat' | 'alipay'>('wechat');
  const [refreshing, setRefreshing] = useState(false);

  const companyId = Array.isArray(id) ? id[0] : id;
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => CompanyRepo.getById(companyId ?? ''),
    enabled: Boolean(companyId),
  });
  const { data: eventResult, refetch: refetchEvents } = useQuery({
    queryKey: ['companyEvents', companyId],
    queryFn: () => CompanyEventRepo.listByCompany(companyId ?? ''),
    enabled: Boolean(companyId),
  });
  const { data: bookingResult, refetch: refetchBookings } = useQuery({
    queryKey: ['companyBookings', companyId],
    queryFn: () => BookingRepo.listByCompany(companyId ?? ''),
    enabled: Boolean(companyId),
  });
  const { data: groupResult, refetch: refetchGroups } = useQuery({
    queryKey: ['companyGroups', companyId],
    queryFn: () => GroupRepo.listByCompany(companyId ?? ''),
    enabled: Boolean(companyId),
  });

  const error = data && !data.ok ? data.error : null;
  const company = data?.ok ? data.data : null;
  const events = eventResult?.ok ? eventResult.data : [];
  const bookings = bookingResult?.ok ? bookingResult.data : [];
  const groups = groupResult?.ok ? groupResult.data : [];
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchEvents(), refetchBookings(), refetchGroups()]);
    setRefreshing(false);
  };

  const tabs = useMemo(
    () => [
      { id: 'calendar', label: '日历' },
      { id: 'profile', label: '档案' },
      { id: 'cert', label: '资质' },
      { id: 'test', label: '检测' },
      { id: 'gallery', label: '风采' },
      { id: 'booking', label: '预约' },
      { id: 'group', label: '组团' },
    ],
    []
  );

  const bookingTypes = useMemo(() => new Set<CompanyEvent['type']>(['visit', 'activity', 'briefing']), []);
  const eventsByDate = useMemo(() => {
    // 按日期聚合并按开始时间排序，便于日历与议程展示
    const map = new Map<string, CompanyEvent[]>();
    events.forEach((event) => {
      const list = map.get(event.date) ?? [];
      list.push(event);
      map.set(event.date, list);
    });
    map.forEach((list) => {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    });
    return map;
  }, [events]);

  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const agendaGroups = useMemo(() => {
    // 日程抽屉：支持全部 or 指定日期聚合展示
    const entries = Array.from(eventsByDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    if (agendaSheetDate) {
      return entries.filter(([date]) => date === agendaSheetDate);
    }
    return entries;
  }, [agendaSheetDate, eventsByDate]);
  const identityLabelMap = useMemo(
    () => new Map(identityOptions.map((option) => [option.value, option.label])),
    []
  );
  const eventTypeLabels: Record<CompanyEvent['type'], string> = {
    visit: '参观',
    activity: '活动',
    briefing: '讲解',
    live: '直播',
  };
  const eventTypeTone: Record<CompanyEvent['type'], 'brand' | 'accent' | 'neutral'> = {
    visit: 'brand',
    activity: 'accent',
    briefing: 'accent',
    live: 'neutral',
  };
  const eventStatusLabels: Record<'open' | 'full' | 'ended', string> = {
    open: '可预约',
    full: '已满',
    ended: '已结束',
  };
  const eventStatusTone: Record<'open' | 'full' | 'ended', { bg: string; fg: string }> = {
    open: { bg: colors.brand.primarySoft, fg: colors.brand.primary },
    full: { bg: colors.border, fg: colors.text.secondary },
    ended: { bg: colors.border, fg: colors.text.secondary },
  };
  const statusTone: Record<string, { bg: string; fg: string }> = {
    pending: { bg: colors.brand.primarySoft, fg: colors.brand.primary },
    approved: { bg: colors.accent.blueSoft, fg: colors.accent.blue },
    rejected: { bg: colors.border, fg: colors.text.secondary },
    invited: { bg: colors.accent.blueSoft, fg: colors.accent.blue },
    joined: { bg: colors.brand.primarySoft, fg: colors.brand.primary },
    paid: { bg: colors.brand.primarySoft, fg: colors.brand.primary },
  };
  const calendarStart = useMemo(() => new Date(), []);
  const calendarWindowDays = 7;

  // 活动状态：根据时间与名额动态判断（复杂逻辑需中文注释）
  const resolveEventStatus = (event: CompanyEvent) => {
    const endAt = parseDateTime(event.date, event.endTime ?? event.startTime);
    if (endAt.getTime() < Date.now()) {
      return 'ended';
    }
    if (
      typeof event.capacity === 'number' &&
      typeof event.bookedCount === 'number' &&
      event.bookedCount >= event.capacity
    ) {
      return 'full';
    }
    return 'open';
  };

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="企业详情" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={220} radius={radius.lg} />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={180} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  if (!company) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="企业详情" />
        {error ? (
          <View style={{ padding: spacing.xl }}>
            <ErrorState
              title="企业信息加载失败"
              description={(error as AppError | null)?.displayMessage ?? '请稍后再试'}
              onAction={refetch}
            />
          </View>
        ) : (
          <View style={{ padding: spacing.xl }}>
            <EmptyState title="未找到企业" description="请稍后再试" />
          </View>
        )}
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={styles.coverWrap}>
          <AppHeader
            title="企业"
            tone="light"
            style={styles.coverHeader}
            rightSlot={
              <Pressable
                onPress={() => show({ message: '更多操作即将上线', type: 'info' })}
                hitSlop={10}
                style={{ padding: 8 }}
              >
                <MaterialCommunityIcons name="dots-horizontal" size={22} color={colors.text.inverse} />
              </Pressable>
            }
          />
          <Image source={{ uri: company.cover }} style={styles.coverImage} contentFit="cover" />
          <View style={[styles.coverOverlay, { backgroundColor: colors.overlay }]} />
          <View style={styles.coverContent}>
            <Text style={[typography.title2, { color: colors.text.inverse }]}>{company.name}</Text>
            <Text style={[typography.caption, { color: colors.text.inverse, marginTop: 6 }]}>
              {company.mainBusiness}
            </Text>
            <View style={styles.coverMetaRow}>
              <Text style={[typography.caption, { color: colors.text.inverse }]}>{company.location}</Text>
              <Text style={[typography.caption, { color: colors.text.inverse }]}>
                距离 {company.distanceKm.toFixed(1)} km
              </Text>
            </View>
          </View>
        </View>
        <View style={{ padding: spacing.xl }}>
          <View style={styles.tagRow}>
            {company.badges.map((badge, index) => (
              <Tag
                key={`${company.id}-${badge}-${index}`}
                label={badge}
                tone="accent"
                style={{ marginRight: spacing.xs, marginBottom: spacing.xs }}
              />
            ))}
          </View>
          <View style={styles.quickRow}>
            <View
              style={[
                styles.quickCard,
                shadow.sm,
                { backgroundColor: colors.surface, borderRadius: radius.lg, marginRight: spacing.sm },
              ]}
            >
              <Text style={[typography.caption, { color: colors.text.secondary }]}>目标成团</Text>
              <Text style={[typography.title3, { color: colors.text.primary, marginTop: 4 }]}>
                {company.groupTargetSize ?? 30} 人
              </Text>
            </View>
            <View style={[styles.quickCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>最近检测</Text>
              <Text style={[typography.title3, { color: colors.text.primary, marginTop: 4 }]}>
                {company.latestTestedAt ?? '暂无'}
              </Text>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.lg }}>
            {tabs.map((tab) => {
              const active = tab.id === activeTab;
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => setActiveTab(tab.id)}
                  style={[
                    styles.segment,
                    {
                      backgroundColor: active ? colors.brand.primary : colors.surface,
                      borderColor: active ? colors.brand.primary : colors.border,
                      marginRight: spacing.sm,
                    },
                  ]}
                >
                  <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary }]}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={{ paddingHorizontal: spacing.xl }}>
          {activeTab === 'calendar' ? (
            <View>
              <View style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
                <View style={styles.calendarHeader}>
                  <View>
                    <Text style={[typography.title3, { color: colors.text.primary }]}>可预约日历</Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                      未来 {calendarWindowDays} 天滚动窗口
                    </Text>
                  </View>
                  <View style={styles.calendarActions}>
                    <Pressable
                      onPress={() => setSelectedDate(formatDate(new Date()))}
                      style={[styles.ghostButton, { borderColor: colors.border, marginRight: spacing.sm }]}
                    >
                      <Text style={[typography.caption, { color: colors.text.secondary }]}>今天</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setAgendaSheetDate(null);
                        setAgendaSheetOpen(true);
                      }}
                      style={[styles.primaryButton, { backgroundColor: colors.brand.primary }]}
                    >
                      <Text style={[typography.caption, { color: colors.text.inverse }]}>全部日程</Text>
                    </Pressable>
                  </View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <CalendarStrip
                    events={events}
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    days={calendarWindowDays}
                    startDate={calendarStart}
                  />
                </ScrollView>
              </View>

              <View style={{ marginTop: spacing.lg }}>
                <View style={styles.agendaHeader}>
                  <Text style={[typography.title3, { color: colors.text.primary }]}>
                    {selectedDate} · {selectedEvents.length} 场
                  </Text>
                  {selectedEvents.length > 3 ? (
                    <Pressable
                      onPress={() => {
                        setAgendaSheetDate(selectedDate);
                        setAgendaSheetOpen(true);
                      }}
                    >
                      <Text style={[typography.caption, { color: colors.accent.blue }]}>
                        查看当天全部
                      </Text>
                    </Pressable>
                  ) : null}
                </View>

                {selectedEvents.length === 0 ? (
                  <EmptyState title="暂无活动" description="可切换日期或查看全部日程" />
                ) : (
                  selectedEvents.slice(0, 3).map((event) => {
                    const status = resolveEventStatus(event);
                    const canBook = bookingTypes.has(event.type) && status === 'open';
                    return (
                      <View
                        key={event.id}
                        style={[
                          styles.eventCard,
                          shadow.sm,
                          { backgroundColor: colors.surface, borderRadius: radius.lg },
                        ]}
                      >
                        <View style={styles.eventRow}>
                          <View style={[styles.timePill, { backgroundColor: colors.brand.primarySoft }]}>
                            <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>{event.startTime}</Text>
                            {event.endTime ? (
                              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                                ~ {event.endTime}
                              </Text>
                            ) : null}
                          </View>
                          <View style={styles.eventContent}>
                            <View style={styles.rowBetween}>
                              <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                                {event.title}
                              </Text>
                              <Tag label={eventTypeLabels[event.type]} tone={eventTypeTone[event.type]} />
                            </View>
                            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                              {event.location ?? company.location}
                            </Text>
                            {typeof event.capacity === 'number' ? (
                              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                                已报名 {event.bookedCount ?? 0}/{event.capacity}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                        <View style={styles.eventFooter}>
                          <View
                            style={[
                              styles.statusPill,
                              {
                                backgroundColor: eventStatusTone[status].bg,
                                borderRadius: radius.pill,
                              },
                            ]}
                          >
                            <Text style={[typography.caption, { color: eventStatusTone[status].fg }]}>
                              {eventStatusLabels[status]}
                            </Text>
                          </View>
                          {canBook ? (
                            <Pressable
                              onPress={() => {
                                setSelectedEvent(event);
                                setBookingSheetOpen(true);
                              }}
                              style={[styles.primaryButton, { backgroundColor: colors.brand.primary, paddingVertical: 8 }]}
                            >
                              <Text style={[typography.caption, { color: colors.text.inverse }]}>预约</Text>
                            </Pressable>
                          ) : (
                            <Text style={[typography.caption, { color: colors.text.secondary }]}>
                              {bookingTypes.has(event.type) ? '暂不可预约' : '无需预约'}
                            </Text>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            </View>
          ) : null}

          {activeTab === 'profile' ? (
            <View style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>企业档案</Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                主营：{company.mainBusiness}
              </Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.xs }]}>
                地址：{company.location}
              </Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.xs }]}>
                距离：{company.distanceKm.toFixed(1)} km
              </Text>
            </View>
          ) : null}

          {activeTab === 'cert' ? (
            <View style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>资质认证</Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                已通过多项品质与产地认证，支持产地溯源。
              </Text>
              <View style={styles.tagRow}>
                {company.badges.map((badge, index) => (
                  <Tag
                    key={`cert-${company.id}-${badge}-${index}`}
                    label={badge}
                    tone="brand"
                    style={{ marginRight: spacing.xs, marginBottom: spacing.xs }}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {activeTab === 'test' ? (
            <View style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>检测报告预览</Text>
              <View style={[styles.preview, { borderColor: colors.border }]}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  最近检测：{company.latestTestedAt ?? '暂无'}
                </Text>
                <Text style={[typography.caption, { color: colors.muted, marginTop: 6 }]}>
                  报告内容占位，后续接入真实检测文件
                </Text>
              </View>
            </View>
          ) : null}

          {activeTab === 'gallery' ? (
            <View style={styles.galleryRow}>
              {[1, 2, 3].map((item) => (
                <Image
                  key={`gallery-${item}`}
                  source={{ uri: company.cover }}
                  style={[styles.galleryItem, { borderRadius: radius.md }]}
                  contentFit="cover"
                />
              ))}
            </View>
          ) : null}

          {activeTab === 'booking' ? (
            <View>
              <View style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
                <Text style={[typography.title3, { color: colors.text.primary }]}>预约记录</Text>
                <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                  你提交的预约会进入审核流程，审核结果将通知。
                </Text>
              </View>
              {bookings.length === 0 ? (
                <EmptyState title="暂无预约" description="在日历里选择活动并提交预约" />
              ) : (
                bookings.map((booking) => (
                  <View
                    key={booking.id}
                    style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
                  >
                    <View style={styles.rowBetween}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                        {booking.date}
                      </Text>
                      <View
                        style={[
                          styles.statusPill,
                          {
                            backgroundColor: statusTone[booking.status]?.bg ?? colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            typography.caption,
                            { color: statusTone[booking.status]?.fg ?? colors.text.secondary },
                          ]}
                        >
                          {bookingStatusLabels[booking.status]}
                        </Text>
                      </View>
                    </View>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
                      人数 {booking.headcount} · 身份{' '}
                      {identityLabelMap.get(booking.identity) ?? booking.identity}
                    </Text>
                    {booking.auditNote ? (
                      <Text style={[typography.caption, { color: colors.muted, marginTop: spacing.xs }]}>
                        审核备注：{booking.auditNote}
                      </Text>
                    ) : null}
                  </View>
                ))
              )}
            </View>
          ) : null}

          {activeTab === 'group' ? (
            <View>
              <View style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
                <Text style={[typography.title3, { color: colors.text.primary }]}>组团状态看板</Text>
                <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                  目标成团人数可由后台配置，当前默认 {company.groupTargetSize ?? 30} 人。
                </Text>
              </View>
              {groups.length === 0 ? (
                <EmptyState title="暂无考察团" description="达到阈值后会自动发起组团" />
              ) : (
                groups.map((group) => (
                  <View
                    key={group.id}
                    style={[styles.panel, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
                  >
                    <View style={styles.rowBetween}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{group.title}</Text>
                      <Pressable onPress={() => router.push(`/group/${group.id}`)}>
                        <Text style={[typography.caption, { color: colors.accent.blue }]}>查看详情</Text>
                      </Pressable>
                    </View>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
                      目的地：{group.destination}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
                      进度 {group.memberCount}/{group.targetSize} · 截止 {group.deadline}
                    </Text>
                    <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            backgroundColor: colors.brand.primary,
                            width: `${Math.min(100, (group.memberCount / group.targetSize) * 100)}%`,
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.rowBetween}>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
                        {groupStatusLabels[group.status]}
                      </Text>
                      <Pressable
                        onPress={() => {
                          setSelectedGroup(group);
                          setGroupSheetOpen(true);
                        }}
                        style={[styles.primaryButton, { backgroundColor: colors.brand.primary, paddingVertical: 8 }]}
                      >
                        <Text style={[typography.caption, { color: colors.text.inverse }]}>一键参团</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <AppBottomSheet
        open={bookingSheetOpen}
        onClose={() => {
          setBookingSheetOpen(false);
          setSelectedEvent(null);
        }}
        mode="half"
        title="预约参观"
      >
        <BookingForm
          event={selectedEvent}
          onSubmit={async (values: BookingFormValues) => {
            if (!companyId) {
              return;
            }
            // 预约提交后进入待审核状态
            const result = await BookingRepo.create({
              companyId,
              eventId: selectedEvent?.id,
              date: values.date,
              headcount: values.headcount,
              identity: values.identity,
              note: values.note,
              contactName: values.contactName,
              contactPhone: values.contactPhone,
            });

            if (!result.ok) {
              show({ message: result.error.displayMessage ?? '提交失败，请稍后再试', type: 'error' });
              return;
            }

            setBookingSheetOpen(false);
            setSelectedEvent(null);
            refetchBookings();
            show({ message: '预约已提交，等待审核', type: 'success' });
          }}
        />
      </AppBottomSheet>

      <AppBottomSheet
        open={agendaSheetOpen}
        onClose={() => setAgendaSheetOpen(false)}
        mode="half"
        title={agendaSheetDate ? `${agendaSheetDate} 日程` : '全部日程'}
      >
        {agendaGroups.length === 0 ? (
          <EmptyState title="暂无日程" description="稍后再来看看" />
        ) : (
          agendaGroups.map(([date, list]) => (
            <View key={date} style={{ marginBottom: spacing.md }}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{date}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                共 {list.length} 场
              </Text>
              {list.map((event) => {
                const status = resolveEventStatus(event);
                const canBook = bookingTypes.has(event.type) && status === 'open';
                return (
                  <View
                    key={event.id}
                    style={[
                      styles.agendaItem,
                      shadow.sm,
                      { backgroundColor: colors.surface, borderRadius: radius.md },
                    ]}
                  >
                    <View style={styles.agendaItemRow}>
                      <View style={styles.agendaTime}>
                        <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>
                          {event.startTime}
                        </Text>
                        {event.endTime ? (
                          <Text style={[typography.caption, { color: colors.text.secondary }]}>
                            ~ {event.endTime}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.agendaContent}>
                        <View style={styles.rowBetween}>
                          <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                            {event.title}
                          </Text>
                          <Tag label={eventTypeLabels[event.type]} tone={eventTypeTone[event.type]} />
                        </View>
                        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                          {event.location ?? company.location}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.agendaFooter}>
                      <View
                        style={[
                          styles.statusPill,
                          { backgroundColor: eventStatusTone[status].bg },
                        ]}
                      >
                        <Text style={[typography.caption, { color: eventStatusTone[status].fg }]}>
                          {eventStatusLabels[status]}
                        </Text>
                      </View>
                      {canBook ? (
                        <Pressable
                          onPress={() => {
                            setAgendaSheetOpen(false);
                            setSelectedEvent(event);
                            setBookingSheetOpen(true);
                          }}
                          style={[styles.primaryButton, { backgroundColor: colors.brand.primary, paddingVertical: 8 }]}
                        >
                          <Text style={[typography.caption, { color: colors.text.inverse }]}>预约</Text>
                        </Pressable>
                      ) : (
                        <Text style={[typography.caption, { color: colors.text.secondary }]}>
                          {bookingTypes.has(event.type) ? '暂不可预约' : '无需预约'}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          ))
        )}
      </AppBottomSheet>

      <AppBottomSheet
        open={groupSheetOpen}
        onClose={() => setGroupSheetOpen(false)}
        mode="half"
        title="一键参团"
      >
        {selectedGroup ? (
          <View>
            <View style={[styles.sheetCard, { borderColor: colors.border, marginBottom: spacing.md }]}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{selectedGroup.title}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
                目标 {selectedGroup.targetSize} 人 · 已报名 {selectedGroup.memberCount}
              </Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
                截止日期：{selectedGroup.deadline}
              </Text>
            </View>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>选择支付方式</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
              {paymentMethods.map((method) => {
                const active = paymentMethod === method.value;
                return (
                  <Pressable
                    key={method.value}
                    onPress={() => setPaymentMethod(method.value)}
                    style={[
                      styles.identityChip,
                      {
                        backgroundColor: active ? colors.brand.primary : colors.surface,
                        borderColor: active ? colors.brand.primary : colors.border,
                        borderRadius: radius.pill,
                        marginRight: spacing.sm,
                        marginBottom: spacing.sm,
                      },
                    ]}
                  >
                    <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary }]}>
                      {method.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={async () => {
                // 参团确认后进入待支付状态（支付入口占位）
                const result = await GroupRepo.join(selectedGroup.id, 1);
                if (!result.ok) {
                  show({ message: result.error.displayMessage ?? '参团失败，请稍后再试', type: 'error' });
                  return;
                }
                refetchGroups();
                setGroupSheetOpen(false);
                show({
                  message: `已选择${paymentMethod === 'wechat' ? '微信支付' : '支付宝'}（支付入口占位）`,
                  type: 'info',
                });
              }}
              style={[styles.primaryButton, { backgroundColor: colors.brand.primary }]}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>确认参团并支付</Text>
            </Pressable>
          </View>
        ) : (
          <EmptyState title="暂无可参团信息" description="请选择一个考察团" />
        )}
      </AppBottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  coverWrap: {
    height: 240,
  },
  coverHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  coverImage: {
    height: 240,
    width: '100%',
  },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  coverContent: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 18,
  },
  coverMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  quickRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  quickCard: {
    flex: 1,
    padding: 12,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  panel: {
    padding: 16,
    marginBottom: 16,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  calendarActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  agendaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  eventCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 12,
  },
  eventRow: {
    flexDirection: 'row',
  },
  timePill: {
    width: 72,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  eventContent: {
    flex: 1,
    marginLeft: 12,
  },
  eventFooter: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  agendaItem: {
    borderWidth: 1,
    borderColor: 'transparent',
    padding: 12,
    marginTop: 12,
  },
  agendaItemRow: {
    flexDirection: 'row',
  },
  agendaTime: {
    width: 64,
    alignItems: 'center',
  },
  agendaContent: {
    flex: 1,
    marginLeft: 12,
  },
  agendaFooter: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  preview: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  galleryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  galleryItem: {
    width: '31%',
    height: 100,
  },
  primaryButton: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButton: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  sheetCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 16,
  },
  identityChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
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
});
