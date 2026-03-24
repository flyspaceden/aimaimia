import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CalendarStrip } from '../../src/components/data';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { BookingForm, BookingFormValues } from '../../src/components/forms';
import { Screen } from '../../src/components/layout';
import { AppBottomSheet } from '../../src/components/overlay';
import { ProductCard } from '../../src/components/cards';
import { Tag } from '../../src/components/ui/Tag';
import { bookingStatusLabels, groupStatusLabels, identityOptions, paymentMethods } from '../../src/constants';
import { BookingRepo, CompanyEventRepo, CompanyRepo, FollowRepo, GroupRepo } from '../../src/repos';
import { useAuthStore, useCartStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import type { AppError, CompanyEvent, CompanyProduct, CompanyProductsResponse, Group, PaymentMethod, Product } from '../../src/types';

// 日期工具函数
const formatDate = (value: Date) => value.toISOString().slice(0, 10);
const parseDateTime = (date: string, time: string) => new Date(`${date}T${time}`);

// 四标签页定义（图标 + 文字纵向排列）
const TABS = [
  { key: 'products', label: '商品', icon: 'cart-outline' as const },
  { key: 'events', label: '活动预约', icon: 'calendar-clock' as const },
  { key: 'profile', label: '企业档案', icon: 'file-document-outline' as const },
  { key: 'group', label: '组团', icon: 'account-group-outline' as const },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function CompanyDetailScreen() {
  const { colors, radius, spacing, typography, shadow, gradients } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const { addItem } = useCartStore();
  const { id } = useLocalSearchParams();

  // ---- 状态 ----
  const [activeTab, setActiveTab] = useState<TabKey>('products');
  const [selectedDate, setSelectedDate] = useState(() => formatDate(new Date()));
  const [selectedEvent, setSelectedEvent] = useState<CompanyEvent | null>(null);
  const [bookingSheetOpen, setBookingSheetOpen] = useState(false);
  const [agendaSheetOpen, setAgendaSheetOpen] = useState(false);
  const [agendaSheetDate, setAgendaSheetDate] = useState<string | null>(null);
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('wechat');
  const [refreshing, setRefreshing] = useState(false);
  const [isFollowed, setIsFollowed] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const companyId = Array.isArray(id) ? id[0] : id;

  // ---- 数据查询 ----
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
    enabled: Boolean(companyId && isLoggedIn),
  });
  const { data: groupResult, refetch: refetchGroups } = useQuery({
    queryKey: ['companyGroups', companyId],
    queryFn: () => GroupRepo.listByCompany(companyId ?? ''),
    enabled: Boolean(companyId),
  });

  // 商品分页查询
  const {
    data: productsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: productsLoading,
    refetch: refetchProducts,
  } = useInfiniteQuery<CompanyProductsResponse, AppError>({
    queryKey: ['companyProducts', companyId, selectedCategory],
    queryFn: async ({ pageParam = 1 }) => {
      const result = await CompanyRepo.listProducts(companyId ?? '', {
        page: typeof pageParam === 'number' ? pageParam : 1,
        pageSize: 10,
        category: selectedCategory ?? undefined,
      });
      if (!result.ok) throw result.error;
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 1,
    enabled: Boolean(companyId),
  });

  const error = data && !data.ok ? data.error : null;
  const company = data?.ok ? data.data : null;
  const events = eventResult?.ok ? eventResult.data : [];
  const bookings = bookingResult?.ok ? bookingResult.data : [];
  const groups = groupResult?.ok ? groupResult.data : [];
  const products = productsData?.pages?.flatMap((page) => page.items) ?? [];
  const productCategories = productsData?.pages?.[0]?.categories ?? [];

  // 初始化关注状态
  React.useEffect(() => {
    if (company?.isFollowed !== undefined) {
      setIsFollowed(company.isFollowed);
    }
  }, [company?.isFollowed]);

  // ---- 商品网格尺寸 ----
  const columns = 2;
  const horizontalPadding = spacing.xl;
  const gap = spacing.md;
  const cardWidth = (screenWidth - horizontalPadding * 2 - gap * (columns - 1)) / columns;

  // ---- 活动相关 Memo ----
  const bookingTypes = useMemo(() => new Set<CompanyEvent['type']>(['visit', 'activity', 'briefing']), []);
  const eventsByDate = useMemo(() => {
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

  // 活动状态：根据时间与名额动态判断
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

  // ---- 操作回调 ----
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchEvents(), refetchBookings(), refetchGroups(), refetchProducts()]);
    setRefreshing(false);
  }, [refetch, refetchEvents, refetchBookings, refetchGroups, refetchProducts]);

  const handleFollow = useCallback(async () => {
    if (!isLoggedIn) {
      show({ message: '请先登录', type: 'info' });
      return;
    }
    if (!companyId) return;
    setIsFollowed((prev) => !prev);
    const result = await FollowRepo.toggleFollow(companyId, '');
    if (!result.ok) {
      setIsFollowed((prev) => !prev);
      show({ message: '操作失败', type: 'error' });
    }
  }, [isLoggedIn, companyId, show]);

  const handleShare = useCallback(async () => {
    if (!company) return;
    try {
      await Share.share({ message: `${company.name} - ${company.mainBusiness}` });
    } catch {
      // 用户取消分享
    }
  }, [company]);

  const handleCall = useCallback(() => {
    if (company?.servicePhone) {
      Linking.openURL(`tel:${company.servicePhone}`);
    }
  }, [company?.servicePhone]);

  // CompanyProduct 转 Product（供 ProductCard 使用）
  const toProduct = useCallback((item: CompanyProduct): Product => ({
    id: item.id,
    title: item.title,
    price: item.price,
    image: item.image,
    defaultSkuId: item.defaultSkuId,
    tags: item.tags,
    unit: item.unit,
    origin: item.origin,
  }), []);

  // ---- 加载态 ----
  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={260} radius={radius.lg} />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={60} radius={radius.lg} />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={180} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  // ---- 错误/空态 ----
  if (!company) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
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

  // =============== 公共头部区域（Cover + Info + Badges + Tabs） ===============
  const renderHeaderContent = () => (
    <>
      {/* 1. 封面区域 260px */}
      <View style={styles.coverWrap}>
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.brand.primary }]} />
        {company.cover ? (
          <Image source={{ uri: company.cover }} style={styles.coverImage} contentFit="cover" />
        ) : null}
        <LinearGradient
          colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.65)']}
          style={styles.coverOverlay}
        />

        {/* 顶部按钮栏：返回 + 分享/更多 */}
        <View style={styles.coverTopBar}>
          <Pressable
            onPress={() => router.back()}
            style={styles.circleButton}
            hitSlop={10}
          >
            <MaterialCommunityIcons name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable onPress={handleShare} style={styles.circleButton} hitSlop={10}>
              <MaterialCommunityIcons name="share-variant-outline" size={18} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => show({ message: '更多操作即将上线', type: 'info' })}
              style={styles.circleButton}
              hitSlop={10}
            >
              <MaterialCommunityIcons name="dots-horizontal" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>

        {/* 底部信息 + 关注按钮 */}
        <View style={styles.coverBottom}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            {/* 企业头像 */}
            <View style={styles.avatarCircle}>
              {company.cover ? (
                <Image
                  source={{ uri: company.cover }}
                  style={{ width: 52, height: 52, borderRadius: 26 }}
                  contentFit="cover"
                />
              ) : (
                <MaterialCommunityIcons name="storefront-outline" size={24} color="#fff" />
              )}
            </View>
            <View style={{ marginLeft: spacing.md, flex: 1 }}>
              <Text style={[typography.title2, { color: '#fff' }]} numberOfLines={1}>
                {company.name}
              </Text>
              <Text style={[typography.caption, { color: 'rgba(255,255,255,0.85)', marginTop: 2 }]} numberOfLines={1}>
                {company.mainBusiness}
              </Text>
              <Text style={[typography.caption, { color: 'rgba(255,255,255,0.7)', marginTop: 2 }]}>
                {company.location} · {company.distanceKm.toFixed(1)} km
              </Text>
            </View>
          </View>
          {/* 关注按钮 */}
          <Pressable
            onPress={handleFollow}
            style={[
              styles.followButton,
              {
                backgroundColor: isFollowed ? 'rgba(255,255,255,0.2)' : colors.brand.primary,
                borderColor: isFollowed ? 'rgba(255,255,255,0.4)' : colors.brand.primary,
              },
            ]}
          >
            {isFollowed ? (
              <Text style={[typography.caption, { color: '#fff' }]}>✓ 已关注</Text>
            ) : (
              <Text style={[typography.caption, { color: '#fff', fontWeight: '600' }]}>+ 关注</Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* 2. 信息栏（评分 + 联系商家） */}
      <View style={[styles.infoBar, { paddingHorizontal: spacing.xl, paddingVertical: spacing.md }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[typography.caption, { color: colors.text.tertiary }]}>
            ★★★★★
          </Text>
          <Text style={[typography.caption, { color: colors.text.tertiary, marginLeft: spacing.xs }]}>
            4.8
          </Text>
          <Text style={[typography.caption, { color: colors.text.tertiary, marginLeft: spacing.sm }]}>
            暂无评价
          </Text>
        </View>
        {company.servicePhone ? (
          <Pressable onPress={handleCall} style={[styles.contactButton, { backgroundColor: colors.brand.primarySoft }]}>
            <MaterialCommunityIcons name="phone-outline" size={14} color={colors.brand.primary} />
            <Text style={[typography.caption, { color: colors.brand.primary, marginLeft: spacing.xs }]}>
              联系商家
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* 3. 徽章行 */}
      {company.badges.length > 0 ? (
        <View style={[styles.tagRow, { paddingHorizontal: spacing.xl }]}>
          {company.badges.map((badge, index) => (
            <Tag
              key={`${company.id}-${badge}-${index}`}
              label={badge}
              tone="accent"
              style={{ marginRight: spacing.xs, marginBottom: spacing.xs }}
            />
          ))}
        </View>
      ) : null}

      {/* 4. 标签栏（图标 + 文字纵向排列） */}
      <View style={[styles.tabBar, { paddingHorizontal: spacing.xl, borderBottomColor: colors.border }]}>
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={styles.tabItem}
            >
              <View
                style={[
                  styles.tabIconBox,
                  {
                    backgroundColor: active ? colors.brand.primary : colors.bgSecondary,
                    borderRadius: radius.sm,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={tab.icon}
                  size={18}
                  color={active ? '#fff' : colors.text.tertiary}
                />
              </View>
              <Text
                style={[
                  typography.caption,
                  {
                    color: active ? colors.brand.primary : colors.text.tertiary,
                    marginTop: spacing.xs,
                    fontWeight: active ? '600' : '400',
                  },
                ]}
              >
                {tab.label}
              </Text>
              {active ? (
                <View style={[styles.tabIndicator, { backgroundColor: colors.brand.primary }]} />
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {/* 商品标签页：分类筛选条 */}
      {activeTab === 'products' && productCategories.length > 0 ? (
        <View style={[styles.categoryChipRow, { paddingHorizontal: spacing.xl }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Pressable
              onPress={() => setSelectedCategory(null)}
              style={[
                styles.categoryChip,
                {
                  backgroundColor: selectedCategory === null ? colors.brand.primary : colors.bgSecondary,
                  borderRadius: radius.pill,
                  marginRight: spacing.sm,
                },
              ]}
            >
              <Text
                style={[
                  typography.caption,
                  { color: selectedCategory === null ? '#fff' : colors.text.secondary },
                ]}
              >
                全部
              </Text>
            </Pressable>
            {productCategories.map((cat) => (
              <Pressable
                key={cat}
                onPress={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
                style={[
                  styles.categoryChip,
                  {
                    backgroundColor: selectedCategory === cat ? colors.brand.primary : colors.bgSecondary,
                    borderRadius: radius.pill,
                    marginRight: spacing.sm,
                  },
                ]}
              >
                <Text
                  style={[
                    typography.caption,
                    { color: selectedCategory === cat ? '#fff' : colors.text.secondary },
                  ]}
                >
                  {cat}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </>
  );

  // =============== 标签页内容渲染 ===============

  // ---- 活动预约标签页 ----
  const renderEventsTab = () => (
    <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
      {/* 日历条 */}
      <View style={[styles.panel, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' }]}>
        <LinearGradient
          colors={[...gradients.aiGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ height: 3, position: 'absolute', top: 0, left: 0, right: 0 }}
        />
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

      {/* 当天活动卡片 */}
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
          selectedEvents.slice(0, 3).map((event, eventIndex) => {
            const status = resolveEventStatus(event);
            const canBook = bookingTypes.has(event.type) && status === 'open';
            return (
              <Animated.View
                key={event.id}
                entering={FadeInDown.duration(300).delay(50 + eventIndex * 30)}
                style={[
                  styles.eventCard,
                  shadow.md,
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
              </Animated.View>
            );
          })
        )}
      </View>

      {/* 分割线 + 我的预约 */}
      <View style={[styles.sectionDivider, { borderTopColor: colors.divider, marginTop: spacing.lg }]}>
        <Text style={[typography.title3, { color: colors.text.primary, paddingTop: spacing.lg }]}>
          我的预约
        </Text>
      </View>
      <View style={[styles.panel, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
        <Text style={[typography.body, { color: colors.text.secondary }]}>
          你提交的预约会进入审核流程，审核结果将通知。
        </Text>
      </View>
      {bookings.length === 0 ? (
        <EmptyState
          title={isLoggedIn ? '暂无预约' : '登录后可查看预约记录'}
          description={isLoggedIn ? '在日历里选择活动并提交预约' : '登录后可查看你的企业预约与审核状态'}
        />
      ) : (
        bookings.map((booking, bIndex) => (
          <Animated.View
            key={booking.id}
            entering={FadeInDown.duration(300).delay(50 + bIndex * 30)}
            style={[styles.panel, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
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
          </Animated.View>
        ))
      )}
    </View>
  );

  // ---- 企业档案标签页（4 合 1） ----
  const renderProfileTab = () => (
    <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
      {/* 卡片 1：企业简介 */}
      <Animated.View entering={FadeInDown.duration(300)} style={[styles.panel, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
        <Text style={[typography.title3, { color: colors.text.primary }]}>企业简介</Text>
        {company.description ? (
          <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.md, lineHeight: 22 }]}>
            {company.description}
          </Text>
        ) : null}
        <View style={{ marginTop: spacing.md }}>
          {[
            { label: '主营', value: company.mainBusiness },
            { label: '类型', value: company.companyType },
            { label: '地址', value: company.address?.text || company.location },
            { label: '距离', value: `${company.distanceKm.toFixed(1)} km` },
          ].map(
            (item) =>
              item.value ? (
                <View key={item.label} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                  <Text style={[typography.bodySm, { color: colors.text.tertiary, width: 50 }]}>{item.label}</Text>
                  <Text style={[typography.bodySm, { color: colors.text.primary, flex: 1 }]}>{item.value}</Text>
                </View>
              ) : null
          )}
        </View>
        {company.highlights && Object.keys(company.highlights).length > 0 ? (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: spacing.sm }]}>企业亮点</Text>
            {Object.entries(company.highlights).map(([key, value]) => (
              <View key={key} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                <Text style={[typography.bodySm, { color: colors.text.tertiary, width: 80 }]}>{key}</Text>
                <Text style={[typography.bodySm, { color: colors.text.primary, flex: 1 }]}>{value}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Animated.View>

      {/* 卡片 2：资质认证 */}
      <Animated.View entering={FadeInDown.duration(300).delay(50)} style={[styles.panel, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
        <Text style={[typography.title3, { color: colors.text.primary }]}>资质认证</Text>
        <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
          已通过多项品质与产地认证，支持产地溯源。
        </Text>
        <View style={styles.certTagRow}>
          {company.badges.map((badge, index) => (
            <View key={`cert-${company.id}-${badge}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', marginRight: spacing.md, marginBottom: spacing.sm }}>
              <MaterialCommunityIcons name="check-circle" size={14} color={colors.brand.primary} style={{ marginRight: spacing.xs }} />
              <Text style={[typography.bodySm, { color: colors.text.primary }]}>{badge}</Text>
            </View>
          ))}
          {(company.certifications ?? []).map((cert, index) => (
            <View key={`cert-detail-${index}`} style={{ flexDirection: 'row', alignItems: 'center', marginRight: spacing.md, marginBottom: spacing.sm }}>
              <MaterialCommunityIcons name="check-circle" size={14} color={colors.brand.primary} style={{ marginRight: spacing.xs }} />
              <Text style={[typography.bodySm, { color: colors.text.primary }]}>{cert}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* 卡片 3：检测报告 */}
      <Animated.View entering={FadeInDown.duration(300).delay(100)} style={[styles.panel, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
        <Text style={[typography.title3, { color: colors.text.primary }]}>检测报告</Text>
        <View style={[styles.testStatsRow, { marginTop: spacing.md }]}>
          {[
            { label: '检测批次', value: '—' },
            { label: '合格率', value: '—' },
            { label: '最近检测', value: company.latestTestedAt ?? '—' },
          ].map((stat) => (
            <View key={stat.label} style={[styles.testStatBox, { backgroundColor: colors.bgSecondary, borderRadius: radius.md }]}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>{stat.value}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>{stat.label}</Text>
            </View>
          ))}
        </View>
        <Pressable
          onPress={() => show({ message: '检测报告详情即将上线', type: 'info' })}
          style={{ marginTop: spacing.md, alignSelf: 'flex-end' }}
        >
          <Text style={[typography.caption, { color: colors.accent.blue }]}>查看报告 →</Text>
        </Pressable>
      </Animated.View>

      {/* 卡片 4：企业风采 */}
      <Animated.View entering={FadeInDown.duration(300).delay(150)} style={[styles.panel, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
        <Text style={[typography.title3, { color: colors.text.primary, marginBottom: spacing.md }]}>企业风采</Text>
        <View style={styles.galleryRow}>
          {[1, 2, 3].map((item, idx) => (
            <Image
              key={`gallery-${item}`}
              source={{ uri: company.cover }}
              style={[styles.galleryItem, { borderRadius: radius.md }]}
              contentFit="cover"
            />
          ))}
        </View>
      </Animated.View>
    </View>
  );

  // ---- 组团标签页 ----
  const renderGroupTab = () => (
    <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
      {/* 渐变状态看板 */}
      <LinearGradient
        colors={[colors.brand.primary, colors.ai.start]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.panel, { borderRadius: radius.lg }]}
      >
        <Text style={[typography.title3, { color: '#fff' }]}>组团状态看板</Text>
        <Text style={[typography.body, { color: 'rgba(255,255,255,0.85)', marginTop: spacing.sm }]}>
          目标成团人数可由后台配置，当前默认 {company.groupTargetSize ?? 30} 人。
        </Text>
      </LinearGradient>

      {groups.length === 0 ? (
        <EmptyState title="暂无考察团" description="达到阈值后会自动发起组团" />
      ) : (
        groups.map((group, gIndex) => (
          <Animated.View
            key={group.id}
            entering={FadeInDown.duration(300).delay(50 + gIndex * 30)}
            style={[styles.panel, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
          >
            <View style={styles.rowBetween}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{group.title}</Text>
              <Pressable onPress={() => router.push({ pathname: '/group/[id]', params: { id: group.id } })}>
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
              <LinearGradient
                colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[
                  styles.progressFill,
                  { width: `${Math.min(100, (group.memberCount / group.targetSize) * 100)}%` as any },
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
              >
                <LinearGradient
                  colors={[colors.brand.primary, colors.ai.start]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.primaryButton, { paddingVertical: 8 }]}
                >
                  <Text style={[typography.caption, { color: colors.text.inverse }]}>一键参团</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </Animated.View>
        ))
      )}
    </View>
  );

  // =============== 底部面板（3 个 BottomSheet） ===============
  const renderBottomSheets = () => (
    <>
      {/* 预约表单面板 */}
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
            if (!companyId) return;
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

      {/* 日程面板 */}
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

      {/* 参团面板 */}
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
                const result = await GroupRepo.join(selectedGroup.id, 1);
                if (!result.ok) {
                  show({ message: result.error.displayMessage ?? '参团失败，请稍后再试', type: 'error' });
                  return;
                }
                refetchGroups();
                setGroupSheetOpen(false);
                show({
                  message: '参团成功！支付功能开发中',
                  type: 'success',
                });
              }}
            >
              <LinearGradient
                colors={[colors.brand.primary, colors.ai.start]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.primaryButton}
              >
                <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>确认参团并支付</Text>
              </LinearGradient>
            </Pressable>
          </View>
        ) : (
          <EmptyState title="暂无可参团信息" description="请选择一个考察团" />
        )}
      </AppBottomSheet>
    </>
  );

  // =============== 根据 activeTab 返回不同容器 ===============

  // 商品标签页：FlatList 作为顶层滚动容器
  if (activeTab === 'products') {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <FlatList
          key={columns}
          data={products}
          numColumns={columns}
          keyExtractor={(item) => item.id}
          initialNumToRender={6}
          maxToRenderPerBatch={8}
          windowSize={10}
          columnWrapperStyle={{ justifyContent: 'space-between', paddingHorizontal: spacing.xl }}
          contentContainerStyle={{ paddingBottom: spacing['3xl'] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          onEndReachedThreshold={0.2}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage();
            }
          }}
          ListHeaderComponent={renderHeaderContent()}
          ListEmptyComponent={() => {
            if (productsLoading) {
              return (
                <View style={{ padding: spacing.xl }}>
                  <View style={styles.skeletonRow}>
                    <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
                    <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
                  </View>
                  <View style={styles.skeletonRow}>
                    <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
                    <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
                  </View>
                </View>
              );
            }
            return (
              <EmptyState
                title="暂无商品"
                description="该企业暂未上架商品"
              />
            );
          }}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={{ paddingHorizontal: spacing.xl }}>
                <View style={styles.skeletonRow}>
                  <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
                  <Skeleton height={cardWidth + 110} radius={radius.lg} style={{ width: cardWidth }} />
                </View>
              </View>
            ) : null
          }
          renderItem={({ item, index }) => {
            const imageHeight = cardWidth * 0.85;
            const product = toProduct(item);
            return (
              <Animated.View entering={FadeInDown.duration(300).delay(50 + index * 30)} style={{ width: cardWidth, marginBottom: spacing.md }}>
                <ProductCard
                  product={product}
                  width={cardWidth}
                  imageHeight={imageHeight}
                  onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.id } })}
                  onAdd={(p) => {
                    addItem(p, 1, item.defaultSkuId, item.price);
                    show({ message: '已加入购物车', type: 'success' });
                  }}
                />
              </Animated.View>
            );
          }}
        />
        {renderBottomSheets()}
      </Screen>
    );
  }

  // 其他标签页：ScrollView 作为顶层滚动容器
  return (
    <Screen contentStyle={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {renderHeaderContent()}

        {activeTab === 'events' ? renderEventsTab() : null}
        {activeTab === 'profile' ? renderProfileTab() : null}
        {activeTab === 'group' ? renderGroupTab() : null}
      </ScrollView>
      {renderBottomSheets()}
    </Screen>
  );
}

const styles = StyleSheet.create({
  coverWrap: {
    height: 260,
  },
  coverImage: {
    height: 260,
    width: '100%',
  },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  coverTopBar: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  circleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverBottom: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  followButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  infoBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  tabBar: {
    flexDirection: 'row',
    paddingTop: 12,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingBottom: 8,
  },
  tabIconBox: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    width: 24,
    height: 3,
    borderRadius: 1.5,
  },
  categoryChipRow: {
    paddingVertical: 12,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
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
  sectionDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
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
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  certTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  testStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  testStatBox: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  galleryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  galleryItem: {
    width: '31%',
    height: 100,
  },
  primaryButton: {
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButton: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  sheetCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
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
  skeletonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
});
