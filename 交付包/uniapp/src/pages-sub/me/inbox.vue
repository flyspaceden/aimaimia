<template>
  <Screen :safeTop="true">
    <AppHeader title="消息中心" />
    <view class="nm-page">
      <view class="nm-toolbar">
        <view class="nm-tabs">
          <view
            v-for="tab in tabs"
            :key="tab.id"
            :class="['nm-tab', activeTab === tab.id ? 'nm-tab--active' : '']"
            @click="setTab(tab.id)"
          >
            <text :class="['nm-tab__text', activeTab === tab.id ? 'nm-tab__text--active' : '']">{{ tab.label }}</text>
          </view>
        </view>
        <view class="nm-filters">
          <view
            :class="['nm-filter', unreadOnly ? 'nm-filter--active' : '']"
            @click="toggleUnread"
          >仅未读</view>
          <view
            :class="['nm-filter', unreadCount === 0 ? 'nm-filter--disabled' : '']"
            @click="markAllRead"
          >全部已读</view>
        </view>
        <view class="nm-summary">
          <text class="nm-summary__text">{{ summaryText }}</text>
          <text v-if="hasFilter" class="nm-summary__link" @click="resetFilter">清空筛选</text>
        </view>
      </view>

      <view class="nm-list">
        <Skeleton v-if="loading" :count="2" type="card" />
        <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="fetchInbox(true)" />
        <view v-else-if="!loading && items.length === 0" class="nm-empty">
          <EmptyState :text="emptyText" :hint="emptyHint" />
          <view class="nm-empty__action" @click="handleEmptyAction">{{ emptyActionLabel }}</view>
        </view>
        <scroll-view v-else scroll-y refresher-enabled :refresher-triggered="refreshing" @refresherrefresh="onRefresh">
          <view v-for="item in items" :key="item.id" class="nm-item" @click="openDetail(item)">
            <view class="nm-item__icon" :class="iconTone(item)">
              <Icon :name="iconName(item)" :size="36" :color="iconColor(item)" />
            </view>
            <view class="nm-item__body">
              <view class="nm-item__title-row">
                <text class="nm-item__title" :lines="1">{{ item.title }}</text>
                <view v-if="item.unread" class="nm-item__dot" />
              </view>
              <text class="nm-item__desc" :lines="2">{{ item.desc }}</text>
              <text class="nm-item__time" :lines="1">{{ item.time }}</text>
            </view>
            <Icon class="nm-item__arrow" name="chevron-right" :size="40" :color="textSecondary" />
          </view>
        </scroll-view>
      </view>
    </view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo, navTab } from '@/utils/nav';
import { computed, ref } from 'vue';
import { Screen, AppHeader, ErrorState, Skeleton, EmptyState, Icon } from '@/components';
import { InboxRepo, type InboxItem } from '@/services/repos';
import { InboxState } from '@/services/state';

const brandPrimary = '#2F8F4E';
const accentBlue = '#2B6CB0';
const textSecondary = '#4B5B53';
const tabs: Array<{ id: 'all' | '互动' | '交易' | '系统'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: '互动', label: '互动' },
  { id: '交易', label: '交易' },
  { id: '系统', label: '系统' },
];

const activeTab = ref<'all' | '互动' | '交易' | '系统'>('all');
const unreadOnly = ref(false);
const items = ref<InboxItem[]>([]);
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');

const unreadCount = computed(() => items.value.filter((item) => item.unread).length);
const hasFilter = computed(() => activeTab.value !== 'all' || unreadOnly.value);
const summaryText = computed(() => `${hasFilter.value ? '当前筛选' : '全部消息'} · 未读 ${unreadCount.value} 条`);
const emptyText = computed(() => (hasFilter.value ? '暂无匹配消息' : '暂无消息'));
const emptyHint = computed(() => (hasFilter.value ? '试试调整筛选条件' : '互动通知会出现在这里'));
const emptyActionLabel = computed(() => (hasFilter.value ? '清空筛选' : '去农脉圈'));

const fetchInbox = async (reset = true) => {
  loading.value = true;
  const res = await InboxRepo.list({
    page: 1,
    pageSize: 20,
    type: activeTab.value === 'all' ? '全部' : activeTab.value,
    unreadOnly: unreadOnly.value,
  });
  if (res.ok) {
    errorMessage.value = '';
    items.value = res.data.items;
    InboxState.refreshUnreadCount();
  } else {
    errorMessage.value = res.error.message || '加载失败';
  }
  loading.value = false;
  if (refreshing.value) refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  fetchInbox(true);
};

const setTab = (tab: 'all' | '互动' | '交易' | '系统') => {
  activeTab.value = tab;
  fetchInbox(true);
};

const toggleUnread = () => {
  unreadOnly.value = !unreadOnly.value;
  fetchInbox(true);
};

const resetFilter = () => {
  activeTab.value = 'all';
  unreadOnly.value = false;
  fetchInbox(true);
};

const handleEmptyAction = () => {
  if (hasFilter.value) {
    resetFilter();
    return;
  }
  navTab({ url: '/pages/tabbar/circle/circle' });
};

const markAllRead = async () => {
  if (unreadCount.value === 0) {
    uni.showToast({ title: '暂无未读消息', icon: 'none' });
    return;
  }
  await InboxRepo.markAllRead();
  items.value = items.value.map((item) => ({ ...item, unread: false }));
  InboxState.setUnreadCount(0);
  uni.showToast({ title: '全部标为已读', icon: 'success' });
};

const openDetail = async (item: InboxItem) => {
  if (item.unread) {
    await InboxRepo.markRead(item.id);
    item.unread = false;
  }
  const params = [
    `id=${item.id}`,
    `title=${encodeURIComponent(item.title)}`,
    `desc=${encodeURIComponent(item.desc)}`,
    `time=${encodeURIComponent(item.time)}`,
    `type=${encodeURIComponent(item.type)}`,
    item.status ? `status=${encodeURIComponent(item.status)}` : '',
    item.actionType ? `actionType=${encodeURIComponent(item.actionType)}` : '',
  ]
    .filter(Boolean)
    .join('&');
  navTo({ url: `/pages-sub/me/interaction-detail?${params}` });
};

const ACTION_ICON_MAP: Record<NonNullable<InboxItem['actionType']>, { name: string; tone: 'brand' | 'accent' | 'neutral' }> = {
  expert: { name: 'comment-question-outline', tone: 'accent' },
  reward: { name: 'gift-outline', tone: 'brand' },
  coop: { name: 'handshake-outline', tone: 'accent' },
  group: { name: 'account-group-outline', tone: 'brand' },
  like: { name: 'heart-outline', tone: 'brand' },
  system: { name: 'bell-outline', tone: 'neutral' },
};

const TYPE_ICON_MAP: Record<InboxItem['type'], { name: string; tone: 'brand' | 'accent' | 'neutral' }> = {
  交易: { name: 'truck-delivery-outline', tone: 'brand' },
  互动: { name: 'comment-text-outline', tone: 'accent' },
  系统: { name: 'bell-outline', tone: 'neutral' },
};

const iconConfig = (item: InboxItem) => {
  if (item.actionType && ACTION_ICON_MAP[item.actionType]) {
    return ACTION_ICON_MAP[item.actionType];
  }
  return TYPE_ICON_MAP[item.type] ?? { name: 'bell-outline', tone: 'neutral' };
};

const iconName = (item: InboxItem) => iconConfig(item).name;

const iconTone = (item: InboxItem) => {
  const tone = iconConfig(item).tone;
  if (tone === 'brand') return 'nm-item__icon--brand';
  if (tone === 'accent') return 'nm-item__icon--accent';
  return 'nm-item__icon--neutral';
};

const iconColor = (item: InboxItem) => {
  const tone = iconConfig(item).tone;
  if (tone === 'brand') return brandPrimary;
  if (tone === 'accent') return accentBlue;
  return textSecondary;
};

fetchInbox(true);
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-toolbar {
  margin-bottom: $nm-space-md;
}

.nm-tabs {
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: 16rpx;
}

.nm-tab {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  margin-right: 16rpx;
  margin-bottom: 16rpx;
}

.nm-tab--active {
  border-color: $nm-brand-primary;
  background-color: $nm-brand-primary-soft;
}

.nm-tab__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-tab__text--active {
  color: $nm-brand-primary;
  font-weight: 600;
}

.nm-filters {
  flex-direction: row;
}

.nm-filter {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  margin-right: 16rpx;
}

.nm-filter--active {
  border-color: $nm-accent-blue;
  background-color: $nm-accent-blue-soft;
  color: $nm-accent-blue;
}

.nm-filter--disabled {
  opacity: 0.5;
}

.nm-summary {
  margin-top: $nm-space-sm;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-summary__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-summary__link {
  padding: 8rpx 12rpx;
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-empty {
  margin-top: $nm-space-md;
}

.nm-empty__action {
  margin-top: $nm-space-sm;
  padding: 10rpx 16rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  align-self: center;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-item {
  padding: $nm-space-md 0;
  border-bottom: 1rpx solid $nm-border;
  display: flex;
  flex-direction: row;
  align-items: center;
}

.nm-item__icon {
  width: 72rpx;
  height: 72rpx;
  border-radius: $nm-radius-pill;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 20rpx;
}

.nm-item__icon--brand {
  background-color: $nm-brand-primary-soft;
}

.nm-item__icon--accent {
  background-color: $nm-accent-blue-soft;
}

.nm-item__icon--neutral {
  background-color: $nm-border;
}

.nm-item__body {
  flex: 1;
  margin-right: 16rpx;
}

.nm-item__title-row {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.nm-item__title {
  font-size: $nm-font-body;
  line-height: $nm-line-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-item__dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 999rpx;
  background-color: $nm-danger;
  margin-left: 12rpx;
}

.nm-item__desc {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  line-height: $nm-line-caption;
  color: $nm-text-secondary;
}

.nm-item__time {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  line-height: $nm-line-caption;
  color: $nm-text-secondary;
}

.nm-item__arrow {
  flex-shrink: 0;
}
</style>
