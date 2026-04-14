import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { InboxRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AppError, InboxCategory, InboxMessage, InboxType } from '../../src/types';

type InboxTab = 'all' | InboxCategory;

const iconMap: Record<InboxType, { name: string; tone: 'brand' | 'accent' | 'neutral' }> = {
  expert_reply: { name: 'comment-question-outline', tone: 'accent' },
  tip_paid: { name: 'gift-outline', tone: 'brand' },
  cooperation_update: { name: 'handshake-outline', tone: 'accent' },
  like: { name: 'heart-outline', tone: 'brand' },
  comment: { name: 'comment-text-outline', tone: 'brand' },
  follow: { name: 'account-plus-outline', tone: 'accent' },
  order_update: { name: 'truck-delivery-outline', tone: 'brand' },
  booking_update: { name: 'calendar-check-outline', tone: 'accent' },
  // C12: 钱相关事件
  reward_credited: { name: 'cash-plus', tone: 'brand' },
  reward_unfrozen: { name: 'lock-open-outline', tone: 'brand' },
  reward_expired: { name: 'clock-alert-outline', tone: 'neutral' },
  withdraw_approved: { name: 'bank-transfer-out', tone: 'brand' },
  withdraw_rejected: { name: 'bank-remove', tone: 'accent' },
  vip_referral_bonus: { name: 'account-star-outline', tone: 'brand' },
  refund_credited: { name: 'cash-refund', tone: 'accent' },
  coupon_granted: { name: 'ticket-percent-outline', tone: 'brand' },
  coupon_expired: { name: 'ticket-outline', tone: 'neutral' },
  // 卖家/系统通知
  new_order: { name: 'package-variant', tone: 'brand' },
  stock_shortage: { name: 'alert-circle-outline', tone: 'accent' },
  vip_activated: { name: 'crown-outline', tone: 'brand' },
};

export default function InboxScreen() {
  const { colors, radius, spacing, typography, shadow } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<InboxTab>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['inbox', activeTab, unreadOnly],
    queryFn: () => InboxRepo.list(activeTab === 'all' ? undefined : activeTab, unreadOnly),
    enabled: isLoggedIn,
  });

  const listError = data && !data.ok ? data.error : null;
  const messages = data?.ok ? data.data : [];
  const hasFilter = activeTab !== 'all' || unreadOnly;
  const unreadCount = messages.filter((message) => message.unread).length;

  const tabs = useMemo(
    () => [
      { id: 'all', label: '全部' },
      { id: 'interaction', label: '互动' },
      { id: 'transaction', label: '交易' },
      { id: 'system', label: '系统' },
    ],
    []
  );

  const handleOpenMessage = async (message: InboxMessage) => {
    if (message.unread) {
      await InboxRepo.markRead(message.id);
      refetch();
    }
    if (message.target?.route) {
      router.push({ pathname: message.target.route, params: message.target.params });
      return;
    }
    show({ message: '暂无详情跳转', type: 'info' });
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="消息中心" />
      <View style={{ padding: spacing.xl, paddingBottom: spacing['3xl'], flex: 1 }}>
        <View style={styles.toolbar}>
          <View style={styles.tabRow}>
            {tabs.map((tab) => {
              const active = tab.id === activeTab;
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => setActiveTab(tab.id as InboxTab)}
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
              onPress={() => setUnreadOnly((prev) => !prev)}
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
                refetch();
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
                onPress={() => {
                  setActiveTab('all');
                  setUnreadOnly(false);
                }}
                style={styles.resetFilter}
              >
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
                setActiveTab('all');
                setUnreadOnly(false);
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
                <Animated.View key={message.id} entering={FadeInDown.duration(300).delay(50 + msgIndex * 30)}>
                  <Pressable
                    onPress={() => handleOpenMessage(message)}
                    style={[styles.messageRow, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg, marginBottom: 8, padding: 12 }]}
                  >
                    <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
                      <MaterialCommunityIcons name={icon.name as any} size={18} color={iconColor} />
                    </View>
                    <View style={styles.messageInfo}>
                      <View style={styles.messageHeader}>
                        <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                          {message.title}
                        </Text>
                        {message.unread ? <View style={[styles.dot, { backgroundColor: colors.danger }]} /> : null}
                      </View>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]} numberOfLines={2}>
                        {message.content}
                      </Text>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                        {message.createdAt}
                      </Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.secondary} />
                  </Pressable>
                </Animated.View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 6,
  },
});
