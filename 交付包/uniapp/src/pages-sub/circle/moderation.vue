<template>
  <Screen :safeTop="true">
    <AppHeader title="举报与审核" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <text class="nm-note">审核队列（占位）</text>

      <view v-if="loading" class="nm-state">
        <Skeleton :count="2" type="card" />
      </view>
      <view v-else-if="errorMessage" class="nm-state">
        <ErrorState :text="errorMessage" @retry="onRefresh" />
      </view>
      <view v-else-if="items.length === 0" class="nm-state">
        <EmptyState text="暂无举报" hint="待审核内容会出现在这里" />
      </view>
      <view v-else>
        <view
          v-for="item in items"
          :key="item.postId"
          class="nm-row"
          @click="openPost(item.postId)"
        >
          <view class="nm-info">
            <text class="nm-title" number-of-lines="1">{{ item.title }}</text>
            <text class="nm-meta">{{ item.authorName }} · 举报 {{ item.reportCount }} 条</text>
            <text v-if="item.lastReviewedAt" class="nm-meta">最近审核：{{ item.lastReviewedAt }}</text>
          </view>
          <view :class="['nm-pill', toneClass(item.status)]">
            <text class="nm-pill__text">{{ moderationLabel(item.status) }}</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { onMounted, ref } from 'vue';
import { Screen, AppHeader, EmptyState, ErrorState, Skeleton } from '@/components';
import { ContentOpsRepo, type ModerationQueueItem, type ModerationStatus } from '@/services/repos';

const items = ref<ModerationQueueItem[]>([]);
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');

const fetchQueue = async () => {
  loading.value = true;
  const res = await ContentOpsRepo.listModerationQueue();
  if (res.ok) {
    items.value = res.data;
    errorMessage.value = '';
  } else {
    errorMessage.value = res.error.message || '加载失败';
  }
  loading.value = false;
  refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  fetchQueue();
};

const openPost = (postId: string) => {
  navTo({ url: `/pages-sub/circle/post-detail?id=${postId}` });
};

const toneClass = (status: ModerationStatus) => {
  if (status === 'flagged') return 'nm-pill--accent';
  if (status === 'approved') return 'nm-pill--brand';
  return 'nm-pill--neutral';
};

const moderationLabel = (status: ModerationStatus) => ContentOpsRepo.getModerationLabel(status);

onMounted(() => {
  fetchQueue();
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-note {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  margin-bottom: 0;
}

.nm-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: $nm-space-md 0;
  border-bottom: 1rpx solid $nm-border;
}

.nm-info {
  flex: 1;
  margin-right: 24rpx;
}

.nm-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-meta {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-pill {
  padding: 8rpx 20rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
}

.nm-pill__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-pill--brand {
  background-color: $nm-brand-primary-soft;
}

.nm-pill--brand .nm-pill__text {
  color: $nm-brand-primary;
}

.nm-pill--accent {
  background-color: $nm-accent-blue-soft;
}

.nm-pill--accent .nm-pill__text {
  color: $nm-accent-blue;
}

.nm-pill--neutral {
  background-color: $nm-border;
}

.nm-pill--neutral .nm-pill__text {
  color: $nm-text-secondary;
}

.nm-state {
  margin-top: $nm-space-md;
}
</style>
