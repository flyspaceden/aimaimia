<template>
  <Screen :safeTop="true">
    <AppHeader title="用户兴趣图谱" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view v-if="loading" class="nm-skeleton">
        <Skeleton :count="1" type="card" :height="360" />
        <view class="nm-skeleton__gap" />
        <Skeleton :count="1" type="card" :height="280" />
      </view>
      <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="onRefresh" />
      <view v-else-if="profile">
        <text class="nm-section-title">兴趣摘要</text>
        <view class="nm-card nm-card--summary">
          <text v-for="item in profile.summary" :key="item" class="nm-summary">· {{ item }}</text>
        </view>

        <view class="nm-section">
          <text class="nm-section-title">兴趣标签</text>
          <view class="nm-card nm-card--tag">
            <view v-if="profile.tags.length === 0" class="nm-empty">
              <EmptyState text="暂无数据" hint="互动后将生成兴趣标签" />
            </view>
            <view v-else>
              <view v-for="tag in profile.tags" :key="tag.label" class="nm-tag-row">
                <text class="nm-tag-label">{{ tag.label }}</text>
                <view class="nm-tag-track">
                  <view class="nm-tag-fill" :style="{ width: `${Math.min(100, tag.weight)}%` }" />
                </view>
                <text class="nm-tag-value">{{ tag.weight }}%</text>
              </view>
            </view>
          </view>
        </view>

        <view class="nm-section">
          <text class="nm-section-title">行为信号</text>
          <view class="nm-card nm-card--summary">
            <text v-for="item in profile.behaviors" :key="item" class="nm-summary">· {{ item }}</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Screen, AppHeader, EmptyState, ErrorState, Skeleton } from '@/components';
import { AnalyticsRepo, type UserInterestProfile } from '@/services/repos';

const profile = ref<UserInterestProfile | null>(null);
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');
const userId = 'u_mock';

const fetchProfile = async () => {
  loading.value = true;
  const res = await AnalyticsRepo.getUserInterestProfile(userId);
  if (res.ok) {
    profile.value = res.data;
    errorMessage.value = '';
  } else {
    errorMessage.value = res.error.message || '数据加载失败';
  }
  loading.value = false;
  refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  fetchProfile();
};

onMounted(() => {
  fetchProfile();
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-section {
  margin-top: $nm-space-lg;
}

.nm-section-title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-card {
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
}

.nm-card--summary {
  margin-top: 20rpx;
  padding: 28rpx;
  border: 1rpx solid $nm-border;
  box-shadow: none;
}

.nm-card--tag {
  margin-top: 20rpx;
  padding: 24rpx;
  border: 1rpx solid $nm-border;
  box-shadow: none;
}

.nm-summary {
  font-size: $nm-font-body;
  color: $nm-text-secondary;
  margin-bottom: 12rpx;
}

.nm-tag-row {
  flex-direction: row;
  align-items: center;
  margin-bottom: 20rpx;
}

.nm-tag-label {
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-tag-track {
  flex: 1;
  height: 12rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
  margin: 0 16rpx;
  overflow: hidden;
}

.nm-tag-fill {
  height: 100%;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
}

.nm-tag-value {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-skeleton {
  margin-top: $nm-space-md;
}

.nm-skeleton__gap {
  height: $nm-space-md;
}

.nm-empty {
  margin-top: $nm-space-sm;
}
</style>
