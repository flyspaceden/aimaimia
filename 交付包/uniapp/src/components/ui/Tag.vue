<template>
  <view :class="['nm-tag', toneClass]">
    <text class="nm-tag__text">{{ label }}</text>
  </view>
</template>

<script setup lang="ts">
// 标签组件：展示轻量标签（公共组件需中文注释）
const props = withDefaults(
  defineProps<{
    label: string;
    tone?: 'neutral' | 'accent' | 'success' | 'brand';
  }>(),
  {
    tone: 'neutral',
  }
);

const toneClass = `nm-tag--${props.tone}`;
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-tag {
  padding: 8rpx 16rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
}

.nm-tag__text {
  font-size: $nm-font-caption;
  line-height: $nm-line-caption;
  color: $nm-text-secondary;
}

.nm-tag--accent {
  background-color: $nm-accent-blue-soft;
  border-color: transparent;
}

.nm-tag--accent .nm-tag__text {
  color: $nm-accent-blue;
}

.nm-tag--success {
  background-color: $nm-brand-primary-soft;
  border-color: transparent;
}

.nm-tag--success .nm-tag__text {
  color: $nm-brand-primary;
}

.nm-tag--brand {
  background-color: $nm-brand-primary-soft;
  border-color: transparent;
}

.nm-tag--brand .nm-tag__text {
  color: $nm-brand-primary;
}
</style>
