<template>
  <Screen :safeTop="true">
    <AppHeader title="物流追踪" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view class="nm-card nm-hero">
        <text class="nm-title">订单#20250112</text>
        <text class="nm-sub">当前状态：运输中（占位）</text>
        <view class="nm-map">
          <Icon class="nm-map__icon" name="map-outline" :size="44" :color="textSecondary" />
          <text class="nm-map__text">物流轨迹地图占位</text>
        </view>
      </view>

      <view class="nm-section">
        <text class="nm-section__title">物流节点</text>
        <view v-for="(item, index) in timeline" :key="item.id" class="nm-card nm-timeline">
          <view class="nm-timeline__left">
            <view class="nm-timeline__dot" :class="index === 0 ? 'nm-timeline__dot--active' : ''" />
            <view v-if="index !== timeline.length - 1" class="nm-timeline__line" />
          </view>
          <view class="nm-timeline__body">
            <text class="nm-timeline__title">{{ item.status }}</text>
            <text class="nm-timeline__meta">{{ item.location }}</text>
            <text class="nm-timeline__time">{{ item.time }}</text>
          </view>
        </view>
      </view>

      <view class="nm-section">
        <text class="nm-section__title">产地实景联动</text>
        <view class="nm-card">
          <text class="nm-sub">未来将展示企业展览馆的产地实景与检验报告（占位）。</text>
          <view class="nm-link">查看企业展览馆</view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Screen, AppHeader, Icon } from '@/components';

const textSecondary = '#4B5B53';
const refreshing = ref(false);

const timeline = [
  { id: 't1', time: '今天 09:20', status: '包裹已揽收', location: '上海转运中心' },
  { id: 't2', time: '昨天 18:40', status: '已发货', location: '青禾农场仓库' },
  { id: 't3', time: '昨天 10:10', status: '订单已出库', location: '青禾农场' },
];

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  setTimeout(() => {
    refreshing.value = false;
  }, 300);
};
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
  margin-bottom: $nm-space-md;
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

.nm-map {
  margin-top: 24rpx;
  padding: 36rpx 0;
  border-radius: 24rpx;
  background-color: $nm-border;
  align-items: center;
  justify-content: center;
  flex-direction: row;
}

.nm-map__icon {
  margin-right: 12rpx;
}

.nm-map__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-section {
  margin-top: $nm-space-lg;
}

.nm-section__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
  margin-bottom: 0;
}

.nm-timeline {
  flex-direction: row;
  padding: 28rpx;
  margin-top: 24rpx;
  margin-bottom: 0;
}

.nm-timeline__left {
  width: 24rpx;
  align-items: center;
  margin-right: 20rpx;
}

.nm-timeline__dot {
  width: 20rpx;
  height: 20rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
}

.nm-timeline__dot--active {
  background-color: $nm-brand-primary;
}

.nm-timeline__line {
  width: 2rpx;
  flex: 1;
  background-color: $nm-border;
  margin-top: 12rpx;
}

.nm-timeline__body {
  flex: 1;
}

.nm-timeline__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-timeline__meta {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-timeline__time {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-link {
  margin-top: $nm-space-sm;
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-brand-primary;
  color: $nm-brand-primary;
  font-size: $nm-font-caption;
  align-self: flex-start;
}
</style>
