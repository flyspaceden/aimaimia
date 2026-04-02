<template>
  <Screen :safeTop="true">
    <AppHeader title="隐私政策" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view class="nm-card">
        <text class="nm-section-title">隐私摘要</text>
        <text class="nm-body nm-body--summary">我们会在你授权的情况下收集必要信息，用于账号服务与体验优化。当前为前端占位文案。</text>
      </view>

      <view class="nm-section">
        <text class="nm-section-title">信息收集</text>
        <view class="nm-card">
          <text class="nm-body nm-body--list">· 基础账号信息：昵称、头像、联系方式（占位）</text>
          <text class="nm-body nm-body--list">· 使用日志：用于改进推荐与稳定性（占位）</text>
        </view>
      </view>

      <view class="nm-section">
        <text class="nm-section-title">权限说明</text>
        <view class="nm-card">
          <text class="nm-body nm-body--list">· 相机/相册：用于发布内容或更换头像（占位）</text>
          <text class="nm-body nm-body--list">· 通知：用于提醒订单/活动与互动（占位）</text>
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

.nm-section {
  margin-top: $nm-space-lg;
}

.nm-section-title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
  margin-bottom: 0;
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
</style>
