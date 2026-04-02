<template>
  <Screen :safeTop="true">
    <AppHeader title="运营中心" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <text class="nm-section-title">数据与运营</text>
      <view class="nm-section">
        <view class="nm-card" @click="goAnalytics">
          <view class="nm-card__row">
            <Icon class="nm-card__icon" name="chart-box-outline" :size="40" :color="brandPrimary" />
            <view class="nm-card__info">
              <text class="nm-card__title">企业内容分析面板</text>
              <text class="nm-card__desc">内容表现、互动结构、趋势概览</text>
            </view>
          </view>
        </view>
        <view class="nm-card" @click="goInterests">
          <view class="nm-card__row">
            <Icon class="nm-card__icon" name="brain" :size="40" :color="accentBlue" />
            <view class="nm-card__info">
              <text class="nm-card__title">用户兴趣图谱</text>
              <text class="nm-card__desc">兴趣标签、行为信号、推荐依据</text>
            </view>
          </view>
        </view>
      </view>

      <text class="nm-section-title nm-section-title--spaced">风控与精华</text>
      <view class="nm-section">
        <view class="nm-card" @click="goFeatured">
          <view class="nm-card__row">
            <Icon class="nm-card__icon" name="star-four-points" :size="40" :color="accentBlue" />
            <view class="nm-card__info">
              <text class="nm-card__title">精华专区</text>
              <text class="nm-card__desc">精选内容集合，提升曝光</text>
            </view>
          </view>
        </view>
        <view class="nm-card" @click="goRankings">
          <view class="nm-card__row">
            <Icon class="nm-card__icon" name="trophy-outline" :size="40" :color="brandPrimary" />
            <view class="nm-card__info">
              <text class="nm-card__title">榜单与贡献值</text>
              <text class="nm-card__desc">创作者排行与贡献值激励</text>
            </view>
          </view>
        </view>
        <view class="nm-card" @click="goModeration">
          <view class="nm-card__row">
            <Icon class="nm-card__icon" name="shield-check-outline" :size="40" :color="accentBlue" />
            <view class="nm-card__info">
              <text class="nm-card__title">举报与审核</text>
              <text class="nm-card__desc">举报记录与审核状态追踪</text>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { ref } from 'vue';
import { Screen, AppHeader, Icon } from '@/components';

const brandPrimary = '#2F8F4E';
const accentBlue = '#2B6CB0';
const refreshing = ref(false);

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  setTimeout(() => {
    refreshing.value = false;
  }, 300);
};

const goAnalytics = () => navTo({ url: '/pages-sub/circle/analytics' });
const goInterests = () => navTo({ url: '/pages-sub/circle/interests' });
const goFeatured = () => navTo({ url: '/pages-sub/circle/featured' });
const goRankings = () => navTo({ url: '/pages-sub/circle/rankings' });
const goModeration = () => navTo({ url: '/pages-sub/circle/moderation' });
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-section {
  margin-top: $nm-space-sm;
}

.nm-section-title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-section-title--spaced {
  margin-top: $nm-space-xl;
}

.nm-card {
  padding: 28rpx;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
  margin-bottom: $nm-space-md;
}

.nm-card__row {
  flex-direction: row;
  align-items: center;
}

.nm-card__icon {
}

.nm-card__info {
  margin-left: $nm-space-sm;
}

.nm-card__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-card__desc {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}
</style>
