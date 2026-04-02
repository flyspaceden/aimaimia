<template>
  <view class="nm-load">
    <text class="nm-load__text">{{ text }}</text>
  </view>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{ text?: string }>(),
  {
    text: '加载中...',
  }
);
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-load {
  height: 80rpx;
  align-items: center;
  justify-content: center;
}

.nm-load__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}
</style>
