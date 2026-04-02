<template>
  <Screen :safeTop="true">
    <AppHeader title="AI 溯源" />
    <scroll-view class="nm-page" scroll-y refresher-enabled :refresher-triggered="refreshing" @refresherrefresh="onRefresh">
      <view v-if="loading" class="nm-loading">
        <Skeleton :count="3" type="card" />
      </view>
      <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="fetchOverview" />
      <EmptyState v-else-if="!overview" text="暂无溯源数据" hint="稍后再试或切换商品" />
      <view v-else>
        <view class="nm-card">
          <view class="nm-icon">
            <Icon name="timeline-text" :size="40" :color="accentBlue" />
          </view>
          <text class="nm-card__title">{{ overview.productName }}</text>
          <text class="nm-card__meta">批次：{{ overview.batchId }} · 基地：{{ overview.farmName }}</text>
          <text class="nm-card__status">{{ overview.statusLabel }}</text>
          <view class="nm-tag-row">
            <Tag v-for="tag in overview.tags" :key="tag" :label="tag" tone="accent" class="nm-tag" />
          </view>
          <view class="nm-card__actions">
            <view class="nm-action" @click="goProduct">查看商品</view>
            <view class="nm-action nm-action--ghost" @click="downloadReport">下载报告</view>
          </view>
        </view>

        <view class="nm-section">
          <text class="nm-section__title">溯源节点</text>
          <view v-for="(step, index) in overview.steps" :key="step.id" class="nm-step-card">
            <view class="nm-step__left">
              <view :class="['nm-step__dot', `nm-step__dot--${step.status}`]" />
              <view v-if="index !== overview.steps.length - 1" class="nm-step__line" />
            </view>
            <view class="nm-step__body">
              <text class="nm-step__title">{{ step.title }}</text>
              <text class="nm-step__desc">{{ step.description }}</text>
              <view v-if="step.time || step.location" class="nm-step__meta">
                <text v-if="step.time" class="nm-step__meta-text">{{ step.time }}</text>
                <text v-if="step.location" class="nm-step__meta-text">{{ step.location }}</text>
              </view>
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
import { Screen, AppHeader, ErrorState, Skeleton, EmptyState, Tag, Icon } from '@/components';
import { AiFeatureRepo, type TraceOverview } from '@/services/repos';

const accentBlue = '#2B6CB0';
const overview = ref<TraceOverview | null>(null);
const loading = ref(true);
const refreshing = ref(false);
const errorMessage = ref('');

const fetchOverview = async () => {
  loading.value = true;
  const res = await AiFeatureRepo.getTraceOverview();
  if (res.ok) {
    overview.value = res.data;
    errorMessage.value = '';
  } else {
    errorMessage.value = res.error.message || '加载失败';
  }
  loading.value = false;
  if (refreshing.value) refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  fetchOverview();
};

const goProduct = () => {
  if (!overview.value) return;
  navTo({ url: `/pages-sub/home/product-detail?id=${overview.value.productId}` });
};

const downloadReport = () => {
  uni.showToast({ title: '检测报告生成中', icon: 'none' });
};

fetchOverview();
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-loading {
  padding: $nm-space-xl 0;
}

.nm-card {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
}

.nm-icon {
  width: 80rpx;
  height: 80rpx;
  border-radius: $nm-radius-md;
  align-items: center;
  justify-content: center;
  background-color: $nm-accent-blue-soft;
}

.nm-card__title {
  margin-top: $nm-space-sm;
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-card__meta {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-card__status {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
}

.nm-tag-row {
  margin-top: 20rpx;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-tag {
  margin-right: 12rpx;
  margin-bottom: 12rpx;
}

.nm-card__actions {
  margin-top: 24rpx;
  flex-direction: row;
  align-items: center;
}

.nm-action {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-brand-primary;
  color: $nm-brand-primary;
  font-size: $nm-font-caption;
}

.nm-action--ghost {
  border-color: $nm-border;
  color: $nm-text-secondary;
  margin-left: 20rpx;
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

.nm-step-card {
  flex-direction: row;
  margin-top: 24rpx;
  padding: 28rpx;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid transparent;
  box-shadow: $nm-shadow-sm;
}

.nm-step__left {
  align-items: center;
  margin-right: 20rpx;
  width: 48rpx;
}

.nm-step__dot {
  width: 20rpx;
  height: 20rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
}

.nm-step__dot--done {
  background-color: $nm-brand-primary;
}

.nm-step__dot--doing {
  background-color: $nm-accent-blue;
}

.nm-step__dot--pending {
  background-color: $nm-border;
}

.nm-step__line {
  width: 2rpx;
  flex: 1;
  background-color: $nm-border;
  margin-top: 8rpx;
}

.nm-step__body {
  flex: 1;
}

.nm-step__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-step__desc {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-step__meta {
  margin-top: 12rpx;
  flex-direction: row;
  justify-content: space-between;
}

.nm-step__meta-text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}
</style>
