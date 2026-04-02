<template>
  <Screen :safeTop="true">
    <AppHeader title="企业内容分析" />
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
        <Skeleton :count="1" type="card" :height="440" />
      </view>
      <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="onRefresh" />
      <view v-else-if="stats">
        <view class="nm-card nm-hero">
          <text class="nm-title">{{ stats.companyName }}</text>
          <text class="nm-sub">内容表现概览（Mock）</text>
          <view class="nm-metrics">
            <view class="nm-metric">
              <text class="nm-metric__value">{{ stats.totalPosts }}</text>
              <text class="nm-metric__label">帖子数</text>
            </view>
            <view class="nm-metric">
              <text class="nm-metric__value">{{ stats.totalLikes }}</text>
              <text class="nm-metric__label">点赞</text>
            </view>
            <view class="nm-metric">
              <text class="nm-metric__value">{{ stats.totalComments }}</text>
              <text class="nm-metric__label">评论</text>
            </view>
            <view class="nm-metric">
              <text class="nm-metric__value">{{ stats.totalShares }}</text>
              <text class="nm-metric__label">转发</text>
            </view>
          </view>
          <text class="nm-sub nm-sub--muted">互动率 {{ stats.engagementRate }}</text>
        </view>

        <view class="nm-section">
          <text class="nm-section-title">近 7 日互动趋势</text>
          <view class="nm-card nm-card--outline">
            <view v-for="point in stats.weeklyTrend" :key="point.label" class="nm-trend">
              <text class="nm-trend__label">{{ point.label }}</text>
              <view class="nm-trend__track">
                <view class="nm-trend__fill" :style="{ width: `${Math.min(100, point.value)}%` }" />
              </view>
              <text class="nm-trend__value">{{ point.value }}</text>
            </view>
          </view>
        </view>

        <view class="nm-section">
          <text class="nm-section-title">高频标签</text>
          <view class="nm-tags">
            <view v-for="tag in stats.topTags" :key="tag" class="nm-tag">
              <text class="nm-tag__text">{{ tag }}</text>
            </view>
          </view>
        </view>

        <view class="nm-section">
          <text class="nm-section-title">表现最佳内容</text>
          <view v-if="stats.topPosts.length === 0" class="nm-empty">
            <EmptyState text="暂无内容" hint="发布内容后将显示数据" />
          </view>
          <view v-else>
            <view v-for="post in stats.topPosts" :key="post.id" class="nm-item">
              <PostCard :item="post" :currentUserId="currentUserId" @press="openPost" />
            </view>
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
import PostCard from '@/components/cards/PostCard.vue';
import { AnalyticsRepo, type CompanyContentStats, type Post } from '@/services/repos';

const stats = ref<CompanyContentStats | null>(null);
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');
const companyId = 'c-002';
const currentUserId = 'u_mock';

const fetchStats = async () => {
  loading.value = true;
  const res = await AnalyticsRepo.getCompanyContentStats(companyId);
  if (res.ok) {
    stats.value = res.data;
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
  fetchStats();
};

const openPost = (post: Post) => {
  navTo({ url: `/pages-sub/circle/post-detail?id=${post.id}` });
};

onMounted(() => {
  fetchStats();
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-card {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
}

.nm-card--outline {
  border: 1rpx solid $nm-border;
  box-shadow: none;
  padding: 24rpx;
  margin-top: 20rpx;
}

.nm-hero {
  border: 1rpx solid transparent;
}

.nm-title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-sub {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-sub--muted {
  margin-top: $nm-space-sm;
  color: $nm-text-secondary;
}

.nm-metrics {
  flex-direction: row;
  justify-content: space-between;
  margin-top: 24rpx;
}

.nm-metric {
  flex: 1;
  align-items: center;
}

.nm-metric__value {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-metric__label {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-section {
  margin-top: $nm-space-lg;
}

.nm-section-title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-trend {
  flex-direction: row;
  align-items: center;
  margin-bottom: $nm-space-sm;
}

.nm-trend__label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-trend__track {
  flex: 1;
  height: 12rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
  margin: 0 $nm-space-sm;
  overflow: hidden;
}

.nm-trend__fill {
  height: 100%;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
}

.nm-trend__value {
  font-size: $nm-font-caption;
  color: $nm-text-primary;
}

.nm-tags {
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: $nm-space-sm;
}

.nm-tag {
  padding: 8rpx 20rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
  margin-right: 16rpx;
  margin-bottom: 16rpx;
}

.nm-tag__text {
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
}

.nm-item {
  margin-top: $nm-space-md;
}

.nm-skeleton {
  margin-top: $nm-space-md;
}

.nm-skeleton__gap {
  height: $nm-space-md;
}

.nm-empty {
  margin-top: $nm-space-md;
}
</style>
