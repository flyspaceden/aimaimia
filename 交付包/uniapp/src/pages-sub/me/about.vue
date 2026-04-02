<template>
  <Screen :safeTop="true">
    <AppHeader title="关于农脉" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view class="nm-card">
        <text class="nm-title">农脉</text>
        <text class="nm-sub">AI 赋能农业，夯实健康之路</text>
        <text class="nm-body nm-body--summary">我们致力于连接消费者与生产者，打造可信赖的农业内容与电商生态。当前为前端占位内容。</text>
      </view>

      <view class="nm-section">
        <text class="nm-section__title">版本信息</text>
        <view class="nm-card">
          <text class="nm-body nm-body--list">App 版本：0.1.0 (Mock)</text>
          <text class="nm-body nm-body--list">构建版本：2025.01</text>
        </view>
      </view>

      <view class="nm-section">
        <text class="nm-section__title">联系我们</text>
        <view class="nm-card">
          <text class="nm-body nm-body--list">邮箱：support@nongmai.ai</text>
          <text class="nm-body nm-body--list">微信客服：农脉助手（占位）</text>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Screen, AppHeader } from '@/components';

const refreshing = ref(false);

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
  border: 1rpx solid transparent;
}

.nm-title {
  font-size: $nm-font-title2;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-sub {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-body {
  font-size: $nm-font-body;
  color: $nm-text-secondary;
  line-height: 1.6;
}

.nm-body--summary {
  margin-top: $nm-space-sm;
}

.nm-body--list {
  margin-top: 0;
}

.nm-body--list + .nm-body--list {
  margin-top: 12rpx;
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
</style>
