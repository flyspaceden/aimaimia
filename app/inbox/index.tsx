import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AppBottomSheet } from '../../src/components/overlay';
import { InboxRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useBottomInset, useTheme } from '../../src/theme';
import { AppError, InboxMessage, InboxType } from '../../src/types';
import {
  DEFAULT_INBOX_FILTERS,
  resetInboxFilters,
  type InboxFilterTab,
} from '../../src/utils/inboxFilters';
import { formatInboxTimestamp } from '../../src/utils/inboxDisplay';
import { resolveBuyerNotificationRoute } from '../../src/utils/notificationRoutes';

type CleanupMode = 'menu' | 'confirm-read' | 'confirm-all' | null;

const iconMap: Partial<Record<InboxType, { name: string; tone: 'brand' | 'accent' | 'neutral' }>> = {
  expert_reply: { name: 'comment-question-outline', tone: 'accent' },
  tip_paid: { name: 'gift-outline', tone: 'brand' },
  cooperation_update: { name: 'handshake-outline', tone: 'accent' },
  like: { name: 'heart-outline', tone: 'brand' },
  comment: { name: 'comment-text-outline', tone: 'brand' },
  follow: { name: 'account-plus-outline', tone: 'accent' },
  order_update: { name: 'truck-delivery-outline', tone: 'brand' },
  'order.shipped': { name: 'truck-delivery-outline', tone: 'brand' },
  'order.delivered': { name: 'package-check', tone: 'brand' },
  'order.receiverInfoRequired': { name: 'map-marker-alert-outline', tone: 'accent' },
  'logistics.exception': { name: 'truck-alert-outline', tone: 'accent' },
  'logistics.stale': { name: 'truck-outline', tone: 'accent' },
  booking_update: { name: 'calendar-check-outline', tone: 'accent' },
  // C12: 钱相关事件
  reward_credited: { name: 'cash-plus', tone: 'brand' },
  'reward.credited': { name: 'cash-plus', tone: 'brand' },
  reward_unfrozen: { name: 'lock-open-outline', tone: 'brand' },
  'reward.unfrozen': { name: 'lock-open-outline', tone: 'brand' },
  reward_expired: { name: 'clock-alert-outline', tone: 'neutral' },
  'reward.expired': { name: 'clock-alert-outline', tone: 'neutral' },
  withdraw_approved: { name: 'bank-transfer-out', tone: 'brand' },
  'withdraw.approved': { name: 'bank-transfer-out', tone: 'brand' },
  withdraw_rejected: { name: 'bank-remove', tone: 'accent' },
  'withdraw.rejected': { name: 'bank-remove', tone: 'accent' },
  'withdraw.processing': { name: 'bank-transfer', tone: 'neutral' },
  'withdraw.paid': { name: 'bank-check', tone: 'brand' },
  'withdraw.failed': { name: 'bank-remove', tone: 'accent' },
  vip_referral_bonus: { name: 'account-star-outline', tone: 'brand' },
  'vip.activated': { name: 'crown-outline', tone: 'brand' },
  refund_credited: { name: 'cash-refund', tone: 'accent' },
  'refund.credited': { name: 'cash-refund', tone: 'accent' },
  'afterSale.approved': { name: 'check-decagram-outline', tone: 'brand' },
  'afterSale.rejected': { name: 'close-octagon-outline', tone: 'accent' },
  'afterSale.returnRequired': { name: 'package-up', tone: 'accent' },
  'afterSale.receivedBySeller': { name: 'package-down', tone: 'brand' },
  'afterSale.sellerRejectedReturn': { name: 'alert-circle-outline', tone: 'accent' },
  'afterSale.replacementShipped': { name: 'truck-delivery-outline', tone: 'brand' },
  'afterSale.closedByTimeout': { name: 'timer-off-outline', tone: 'neutral' },
  'afterSale.refunded': { name: 'cash-refund', tone: 'brand' },
  coupon_granted: { name: 'ticket-percent-outline', tone: 'brand' },
  'coupon.granted': { name: 'ticket-percent-outline', tone: 'brand' },
  coupon_expired: { name: 'ticket-outline', tone: 'neutral' },
  'coupon.expired': { name: 'ticket-outline', tone: 'neutral' },
  'invoice.issued': { name: 'file-check-outline', tone: 'brand' },
  'invoice.failed': { name: 'file-alert-outline', tone: 'accent' },
  'groupBuy.codeActivated': { name: 'account-group-outline', tone: 'brand' },
  'groupBuy.rebateReleased': { name: 'cash-plus', tone: 'brand' },
  'digitalAsset.released': { name: 'chart-timeline-variant', tone: 'brand' },
  'digitalAsset.reversed': { name: 'chart-timeline-variant-shimmer', tone: 'accent' },
  'digitalAsset.adjusted': { name: 'tune-variant', tone: 'neutral' },
  'cs.agentReplyOffline': { name: 'headset', tone: 'accent' },
  // 平台运营消息
  platform_announcement: { name: 'bullhorn-outline', tone: 'accent' },
  platform_notice: { name: 'bell-outline', tone: 'neutral' },
  cs_outreach_invite: { name: 'face-agent', tone: 'brand' },
  // 卖家/系统通知
  new_order: { name: 'package-variant', tone: 'brand' },
  stock_shortage: { name: 'alert-circle-outline', tone: 'accent' },
  vip_activated: { name: 'crown-outline', tone: 'brand' },
  order_receiver_info_required: { name: 'map-marker-alert-outline', tone: 'accent' },
};

export default function InboxScreen() {
  const { colors, radius, spacing, typography, shadow } = useTheme();
  const undoBottomOffset = useBottomInset(spacing.lg);
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(DEFAULT_INBOX_FILTERS);
  const [cleanupMode, setCleanupMode] = useState<CleanupMode>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [lastDeletedMessage, setLastDeletedMessage] = useState<InboxMessage | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { activeTab, unreadOnly } = filters;
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const PAGE_SIZE = 20;

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['inbox', activeTab, unreadOnly],
    queryFn: async ({ pageParam = 1 }) => {
      const result = await InboxRepo.list(
        activeTab === 'all' ? undefined : activeTab,
        unreadOnly,
        { page: pageParam as number, pageSize: PAGE_SIZE },
      );
      if (!result.ok) throw result.error;
      return result.data;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (
      lastPage.length === PAGE_SIZE ? allPages.length + 1 : undefined
    ),
    enabled: isLoggedIn,
  });

  const { data: unreadCountResult } = useQuery({
    queryKey: ['me-inbox-unread'],
    queryFn: InboxRepo.getUnreadCount,
    enabled: isLoggedIn,
  });

  const listError = isError ? (error as unknown as AppError) : null;
  const messages = data?.pages.flatMap((page) => page) ?? [];
  const hasFilter = activeTab !== 'all' || unreadOnly;
  const unreadCount = unreadCountResult?.ok
    ? unreadCountResult.data
    : messages.filter((message) => message.unread).length;

  const tabs = useMemo(
    () => [
      { id: 'all', label: '全部' },
      { id: 'interaction', label: '互动' },
      { id: 'transaction', label: '交易' },
      { id: 'system', label: '系统' },
    ],
    []
  );

  const invalidateInboxState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inbox'] }),
      queryClient.invalidateQueries({ queryKey: ['me-inbox-unread'] }),
    ]);
  };

  const clearFilters = () => {
    setFilters(resetInboxFilters());
  };

  const startUndoWindow = (message: InboxMessage) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setLastDeletedMessage(message);
    undoTimerRef.current = setTimeout(() => {
      setLastDeletedMessage(null);
      undoTimerRef.current = null;
    }, 5000);
  };

  const handleDeleteMessage = async (message: InboxMessage) => {
    const result = await InboxRepo.deleteMessage(message.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '删除失败', type: 'error' });
      return;
    }
    startUndoWindow(message);
    await invalidateInboxState();
  };

  const handleRestoreMessage = async () => {
    if (!lastDeletedMessage) return;
    const messageId = lastDeletedMessage.id;
    const result = await InboxRepo.restoreMessage(messageId);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '恢复失败', type: 'error' });
      return;
    }
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setLastDeletedMessage(null);
    await invalidateInboxState();
    show({ message: '消息已恢复', type: 'success' });
  };

  const handleBulkDelete = async (scope: 'READ' | 'ALL') => {
    setCleanupLoading(true);
    try {
      const result = scope === 'READ'
        ? await InboxRepo.deleteReadMessages()
        : await InboxRepo.deleteAllMessages();
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '清理失败', type: 'error' });
        return;
      }
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
      setLastDeletedMessage(null);
      clearFilters();
      setCleanupMode(null);
      await invalidateInboxState();
      const count = result.data.deletedCount ?? 0;
      show({
        message: count > 0 ? `已清理 ${count} 条消息` : '没有需要清理的消息',
        type: count > 0 ? 'success' : 'info',
      });
    } finally {
      setCleanupLoading(false);
    }
  };

  const renderDeleteAction = (message: InboxMessage, swipeable: SwipeableMethods) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`删除消息：${message.title}`}
      onPress={() => {
        swipeable.close();
        void handleDeleteMessage(message);
      }}
      style={[styles.deleteAction, { backgroundColor: colors.danger }]}
    >
      <MaterialCommunityIcons name="trash-can-outline" size={22} color={colors.text.inverse} />
      <Text style={[typography.caption, { color: colors.text.inverse, marginTop: 4 }]}>删除</Text>
    </Pressable>
  );

  const handleOpenMessage = async (message: InboxMessage) => {
    if (message.unread) {
      const result = await InboxRepo.markRead(message.id);
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '操作失败', type: 'error' });
        return;
      }
      await invalidateInboxState();
    }

    const route = resolveBuyerNotificationRoute(message.action ?? message.target);
    if (route) {
      router.push(route as any);
      return;
    }

    show({ message: '该消息暂无可跳转的页面', type: 'info' });
  };

  // 判断单条消息是否可点击跳转，用于 chevron 条件渲染
  const isMessageClickable = (message: InboxMessage): boolean =>
    resolveBuyerNotificationRoute(message.action ?? message.target) !== null;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="消息中心"
        rightSlot={(
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清理消息"
            hitSlop={10}
            onPress={() => setCleanupMode('menu')}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressedControl]}
          >
            <MaterialCommunityIcons name="delete-sweep-outline" size={23} color={colors.text.secondary} />
          </Pressable>
        )}
      />
      <View style={{ padding: spacing.xl, paddingBottom: spacing['3xl'], flex: 1 }}>
        <View style={styles.toolbar}>
          <View style={styles.tabRow}>
            {tabs.map((tab) => {
              const active = tab.id === activeTab;
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => setFilters((current) => ({
                    ...current,
                    activeTab: tab.id as InboxFilterTab,
                  }))}
                  style={[
                    styles.tabChip,
                    {
                      overflow: 'hidden',
                      borderColor: active ? colors.brand.primary : colors.border,
                      borderRadius: radius.pill,
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
                  <Text style={[typography.caption, { color: active ? colors.brand.primary : colors.text.secondary }]}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.filterRow}>
            <Pressable
              onPress={() => setFilters((current) => ({
                ...current,
                unreadOnly: !current.unreadOnly,
              }))}
              style={[
                styles.filterChip,
                {
                  borderColor: unreadOnly ? colors.accent.blue : colors.border,
                  backgroundColor: unreadOnly ? colors.accent.blueSoft : colors.surface,
                  borderRadius: radius.pill,
                },
              ]}
            >
              <Text style={[typography.caption, { color: unreadOnly ? colors.accent.blue : colors.text.secondary }]}>
                仅未读
              </Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (unreadCount === 0) {
                  show({ message: '暂无未读消息', type: 'info' });
                  return;
                }
                const result = await InboxRepo.markAllRead();
                if (!result.ok) {
                  show({ message: result.error.displayMessage ?? '操作失败', type: 'error' });
                  return;
                }
                show({ message: '全部标为已读', type: 'success' });
                await invalidateInboxState();
              }}
              disabled={unreadCount === 0}
              style={[
                styles.filterChip,
                {
                  borderColor: colors.border,
                  borderRadius: radius.pill,
                  opacity: unreadCount === 0 ? 0.5 : 1,
                },
              ]}
            >
              <Text style={[typography.caption, { color: colors.text.secondary }]}>全部已读</Text>
            </Pressable>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>
              {hasFilter ? '当前筛选' : '全部消息'} · 未读 {unreadCount} 条
            </Text>
            {hasFilter ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="清空消息筛选"
                hitSlop={10}
                onPress={clearFilters}
                style={({ pressed }) => [styles.resetFilter, pressed && styles.pressedControl]}
              >
                <MaterialCommunityIcons name="filter-remove-outline" size={16} color={colors.accent.blue} />
                <Text style={[typography.caption, { color: colors.accent.blue }]}>清空筛选</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {isLoading ? (
          <View>
            <Skeleton height={120} radius={radius.lg} />
            <View style={{ height: spacing.md }} />
            <Skeleton height={120} radius={radius.lg} />
          </View>
        ) : (listError as AppError | null) ? (
          <ErrorState
            title="消息加载失败"
            description={listError?.displayMessage ?? '请稍后重试'}
            onAction={refetch}
          />
        ) : messages.length === 0 ? (
          <EmptyState
            title={hasFilter ? '暂无匹配消息' : '暂无消息'}
            description={hasFilter ? '试试调整筛选条件' : '互动通知会出现在这里'}
            actionLabel={hasFilter ? '清空筛选' : '去首页'}
            onAction={() => {
              if (hasFilter) {
                clearFilters();
                return;
              }
              router.push('/(tabs)/home');
            }}
          />
        ) : (
          <ScrollView
            refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
            showsVerticalScrollIndicator={false}
          >
            {messages.map((message, msgIndex) => {
              const icon = iconMap[message.type] ?? { name: 'bell-outline', tone: 'neutral' };
              const isImportantAnnouncement = (
                message.type === 'platform_announcement' || message.type === 'platform_notice'
              ) && (
                message.severity === 'WARNING' || message.metadata?.priority === 'IMPORTANT'
              );
              const iconColor =
                icon.tone === 'brand'
                  ? colors.brand.primary
                  : icon.tone === 'accent'
                  ? colors.accent.blue
                  : colors.text.secondary;
              const iconBg =
                icon.tone === 'brand'
                  ? colors.brand.primarySoft
                  : icon.tone === 'accent'
                  ? colors.accent.blueSoft
                  : colors.border;
              return (
                <Animated.View
                  key={message.id}
                  entering={FadeInDown.duration(300).delay(50 + msgIndex * 30)}
                  style={[shadow.md, { marginBottom: 8, borderRadius: radius.lg }]}
                >
                  <ReanimatedSwipeable
                    friction={2}
                    rightThreshold={42}
                    overshootRight={false}
                    renderRightActions={(_progress, _translation, swipeable) => renderDeleteAction(message, swipeable)}
                    containerStyle={{ borderRadius: radius.lg, overflow: 'hidden' }}
                  >
                    <Pressable
                      onPress={() => handleOpenMessage(message)}
                      style={[styles.messageRow, { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 12 }]}
                    >
                      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
                        <MaterialCommunityIcons name={icon.name as any} size={18} color={iconColor} />
                      </View>
                      <View style={styles.messageInfo}>
                        <View style={styles.messageHeader}>
                          <Text style={[typography.bodyStrong, styles.messageTitle, { color: colors.text.primary }]} numberOfLines={1}>
                            {message.title}
                          </Text>
                          {isImportantAnnouncement ? (
                            <View style={[styles.importantBadge, { borderColor: colors.warning }]}>
                              <Text style={[typography.caption, { color: colors.warning }]}>重要</Text>
                            </View>
                          ) : null}
                          {message.unread ? <View style={[styles.dot, { backgroundColor: colors.danger }]} /> : null}
                        </View>
                        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]} numberOfLines={2}>
                          {message.content}
                        </Text>
                        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                          {formatInboxTimestamp(message.createdAt)}
                        </Text>
                      </View>
                      {/* 仅当消息可跳转时显示 chevron，info-only 消息不显示避免误导 */}
                      {isMessageClickable(message) ? (
                        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.secondary} />
                      ) : null}
                    </Pressable>
                  </ReanimatedSwipeable>
                </Animated.View>
              );
            })}
            {hasNextPage ? (
              <Pressable
                onPress={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                style={[
                  styles.loadMoreButton,
                  {
                    borderColor: colors.border,
                    borderRadius: radius.pill,
                    opacity: isFetchingNextPage ? 0.6 : 1,
                  },
                ]}
              >
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  {isFetchingNextPage ? '加载中...' : '加载更多'}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        )}
      </View>

      <AppBottomSheet
        open={cleanupMode !== null}
        onClose={() => {
          if (!cleanupLoading) setCleanupMode(null);
        }}
        title={cleanupMode === 'menu' ? '清理消息' : '确认清理'}
      >
        {cleanupMode === 'menu' ? (
          <View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setCleanupMode('confirm-read')}
              style={({ pressed }) => [
                styles.cleanupOption,
                { borderColor: colors.border },
                pressed && styles.pressedControl,
              ]}
            >
              <View style={[styles.cleanupIcon, { backgroundColor: colors.brand.primarySoft }]}>
                <MaterialCommunityIcons name="email-open-multiple-outline" size={22} color={colors.brand.primary} />
              </View>
              <View style={styles.cleanupText}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>清空已读消息</Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 3 }]}>保留所有未读消息</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.tertiary} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => setCleanupMode('confirm-all')}
              style={({ pressed }) => [
                styles.cleanupOption,
                { borderColor: colors.border, marginTop: 10 },
                pressed && styles.pressedControl,
              ]}
            >
              <View style={[styles.cleanupIcon, { backgroundColor: colors.bgSecondary }]}>
                <MaterialCommunityIcons name="delete-alert-outline" size={22} color={colors.danger} />
              </View>
              <View style={styles.cleanupText}>
                <Text style={[typography.bodyStrong, { color: colors.danger }]}>清空全部消息</Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 3 }]}>包括所有分类中的未读消息</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.tertiary} />
            </Pressable>
          </View>
        ) : cleanupMode ? (
          <View>
            <Text style={[typography.body, { color: colors.text.secondary, lineHeight: 24 }]}>
              {cleanupMode === 'confirm-all'
                ? '确定清空全部消息吗？所有分类中的已读和未读消息都会从消息中心移除。'
                : '确定清空全部已读消息吗？未读消息会继续保留。'}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                disabled={cleanupLoading}
                onPress={() => setCleanupMode('menu')}
                style={({ pressed }) => [
                  styles.confirmButton,
                  { borderColor: colors.border },
                  pressed && styles.pressedControl,
                ]}
              >
                <Text style={[typography.bodyStrong, { color: colors.text.secondary }]}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={cleanupLoading}
                onPress={() => void handleBulkDelete(cleanupMode === 'confirm-all' ? 'ALL' : 'READ')}
                style={({ pressed }) => [
                  styles.confirmButton,
                  {
                    backgroundColor: cleanupMode === 'confirm-all' ? colors.danger : colors.brand.primary,
                    borderColor: cleanupMode === 'confirm-all' ? colors.danger : colors.brand.primary,
                    opacity: cleanupLoading ? 0.6 : 1,
                  },
                  pressed && styles.pressedControl,
                ]}
              >
                <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                  {cleanupLoading ? '清理中...' : '确认清理'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </AppBottomSheet>

      {lastDeletedMessage ? (
        <View
          style={[
            styles.undoBar,
            shadow.md,
            {
              bottom: undoBottomOffset,
              backgroundColor: colors.text.primary,
              borderRadius: radius.lg,
            },
          ]}
        >
          <Text style={[typography.caption, styles.undoText, { color: colors.surface }]} numberOfLines={1}>
            已删除“{lastDeletedMessage.title}”
          </Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => void handleRestoreMessage()}
            style={({ pressed }) => [styles.undoButton, pressed && styles.pressedControl]}
          >
            <Text style={[typography.bodyStrong, { color: colors.warning }]}>撤销</Text>
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: {
    marginBottom: 12,
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  tabChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  filterRow: {
    flexDirection: 'row',
  },
  filterChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  resetFilter: {
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pressedControl: {
    opacity: 0.55,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deleteAction: {
    width: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  messageInfo: {
    flex: 1,
    marginRight: 8,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  messageTitle: {
    flex: 1,
  },
  importantBadge: {
    borderWidth: 1,
    borderRadius: 4,
    marginLeft: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 6,
  },
  loadMoreButton: {
    alignItems: 'center',
    borderWidth: 1,
    marginTop: 4,
    marginBottom: 16,
    paddingVertical: 8,
  },
  cleanupOption: {
    minHeight: 68,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cleanupIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cleanupText: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  confirmButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  undoBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    minHeight: 52,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  undoText: {
    flex: 1,
    minWidth: 0,
    marginRight: 12,
  },
  undoButton: {
    minWidth: 52,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
