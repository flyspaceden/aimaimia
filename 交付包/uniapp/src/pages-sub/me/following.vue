<template>
  <Screen :safeTop="true">
    <AppHeader title="我的关注" />
    <view class="nm-page">
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

      <view class="nm-search">
        <Icon class="nm-search__icon" name="magnify" :size="40" :color="textMuted" />
        <input
          v-model="keyword"
          class="nm-search__input"
          placeholder="搜索名称/标签/城市"
          placeholder-class="nm-search__placeholder"
        />
        <view v-if="keyword" class="nm-search__clear" @click="keyword = ''">
          <Icon name="close-circle" :size="36" :color="textMuted" />
        </view>
      </view>

      <view class="nm-sort">
        <text
          v-for="item in sortOptions"
          :key="item.id"
          :class="['nm-sort__item', sortOption === item.id ? 'nm-sort__item--active' : '']"
          @click="setSort(item.id)"
        >
          {{ item.label }}
        </text>
      </view>

      <view v-if="loading" class="nm-loading">
        <Skeleton :count="2" type="card" />
      </view>
      <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="fetchFollowing" />
      <view v-else-if="filteredItems.length === 0" class="nm-empty">
        <EmptyState :text="emptyText" :hint="emptyHint" />
        <view class="nm-empty__action" @click="handleEmptyAction">{{ emptyActionLabel }}</view>
      </view>
      <scroll-view
        v-else
        scroll-y
        refresher-enabled
        :refresher-triggered="refreshing"
        @refresherrefresh="onRefresh"
        class="nm-list"
      >
        <view class="nm-item" v-for="item in filteredItems" :key="item.id" @click="openAuthor(item)">
          <view class="nm-avatar" />
          <view class="nm-info">
            <view class="nm-name-row">
              <text class="nm-name">{{ item.name }}</text>
              <text v-if="item.city" class="nm-city">{{ item.city }}</text>
            </view>
            <text class="nm-meta">{{ item.title || '内容创作者' }}</text>
          </view>
          <view class="nm-unfollow" @click.stop="unfollow(item)">取消关注</view>
        </view>
      </scroll-view>
    </view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo, navTab } from '@/utils/nav';
import { computed, ref } from 'vue';
import { Screen, AppHeader, EmptyState, ErrorState, Skeleton, Icon } from '@/components';
import { FollowRepo, type FollowItem } from '@/services/repos';

const textMuted = '#8A9B90';
const tabs: Array<{ id: 'users' | 'companies'; label: string }> = [
  { id: 'users', label: '用户' },
  { id: 'companies', label: '企业' },
];

const sortOptions: Array<{ id: 'recent' | 'active'; label: string }> = [
  { id: 'recent', label: '最近关注' },
  { id: 'active', label: '最活跃' },
];

const activeTab = ref<'users' | 'companies'>('users');
const sortOption = ref<'recent' | 'active'>('recent');
const keyword = ref('');
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');
const items = ref<FollowItem[]>([]);

const filteredItems = computed(() => {
  const list = items.value.map((item) => ({
    id: item.id,
    name: item.author?.name || item.name,
    city: item.author?.city || '',
    title: item.author?.title || item.meta,
    type: item.type,
    companyId: item.author?.companyId,
  }));
  const sorted = sortOption.value === 'active'
    ? [...list].sort((a, b) => a.name.localeCompare(b.name))
    : list;
  if (!keyword.value.trim()) return sorted;
  const term = keyword.value.trim().toLowerCase();
  return sorted.filter((item) => {
    return (
      item.name.toLowerCase().includes(term) ||
      (item.title || '').toLowerCase().includes(term) ||
      (item.city || '').toLowerCase().includes(term)
    );
  });
});

const emptyText = computed(() => (keyword.value.trim() ? '未找到匹配结果' : '暂无关注'));
const emptyHint = computed(() =>
  keyword.value.trim() ? '试试调整关键词或筛选条件' : '先去关注你感兴趣的用户或企业'
);
const emptyActionLabel = computed(() => (keyword.value.trim() ? '清空搜索' : '去农脉圈'));

const fetchFollowing = async () => {
  loading.value = true;
  const res = await FollowRepo.list({
    page: 1,
    pageSize: 20,
    type: activeTab.value === 'users' ? 'user' : 'company',
  });
  if (res.ok) {
    errorMessage.value = '';
    items.value = res.data.items;
  } else {
    errorMessage.value = res.error.message || '加载失败';
  }
  loading.value = false;
  if (refreshing.value) refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  fetchFollowing();
};

const setTab = (tab: 'users' | 'companies') => {
  activeTab.value = tab;
  fetchFollowing();
};

const setSort = (value: 'recent' | 'active') => {
  sortOption.value = value;
  fetchFollowing();
};

const openAuthor = (item: { id: string; type: 'user' | 'company'; companyId?: string }) => {
  if (item.type === 'company' && item.companyId) {
    navTo({ url: `/pages-sub/museum/company-detail?id=${item.companyId}` });
    return;
  }
  navTo({ url: `/pages-sub/circle/user?id=${item.id}` });
};

const unfollow = async (item: { id: string }) => {
  const res = await FollowRepo.toggleFollow(item.id);
  if (!res.ok) {
    uni.showToast({ title: res.error.message || '操作失败', icon: 'none' });
    return;
  }
  uni.showToast({ title: '已取消关注', icon: 'success' });
  fetchFollowing();
};

const handleEmptyAction = () => {
  if (keyword.value.trim()) {
    keyword.value = '';
    return;
  }
  navTab({ url: '/pages/tabbar/circle/circle' });
};

fetchFollowing();
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-tabs {
  flex-direction: row;
  margin-bottom: $nm-space-md;
}

.nm-tab {
  margin-right: 20rpx;
  padding: 12rpx 28rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
}

.nm-tab--active {
  background-color: $nm-brand-primary-soft;
  border-color: $nm-brand-primary;
}

.nm-tab__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-tab__text--active {
  color: $nm-brand-primary;
  font-weight: 600;
}

.nm-search {
  flex-direction: row;
  align-items: center;
  padding: 16rpx 24rpx;
  border-radius: $nm-radius-lg;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
}

.nm-search__icon {
  margin-right: 16rpx;
}

.nm-search__clear {
  margin-left: 16rpx;
}

.nm-search__input {
  flex: 1;
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-search__placeholder {
  color: $nm-text-secondary;
}

.nm-sort {
  flex-direction: row;
  margin-top: 20rpx;
}

.nm-sort__item {
  margin-right: 24rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  padding: 8rpx 12rpx;
  border-bottom: 4rpx solid transparent;
}

.nm-sort__item--active {
  color: $nm-accent-blue;
  border-bottom-color: $nm-accent-blue;
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
  display: flex;
  flex-direction: row;
  align-items: center;
  border-bottom: 1rpx solid $nm-border;
}

.nm-avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
  margin-right: 20rpx;
}

.nm-info {
  flex: 1;
  margin-right: 16rpx;
}

.nm-name-row {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.nm-name {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-city {
  margin-left: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-meta {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-unfollow {
  padding: 8rpx 20rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-loading {
  margin-top: $nm-space-md;
}

.nm-list {
  margin-top: $nm-space-md;
}
</style>
