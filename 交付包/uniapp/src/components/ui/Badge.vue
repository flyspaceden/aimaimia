<template>
  <view class="nm-badge">
    <text class="nm-badge__text">{{ text }}</text>
  </view>
</template>

<script setup lang="ts">
// 角标组件：数量/状态提示（公共组件需中文注释）
withDefaults(
  defineProps<{
    text: string;
  }>(),
  {
    text: '0',
  }
);
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-badge {
  min-width: 32rpx;
  height: 32rpx;
  padding: 0 8rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-danger;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-badge__text {
  font-size: $nm-font-caption;
  line-height: $nm-font-caption;
  color: $nm-text-inverse;
}
</style>
