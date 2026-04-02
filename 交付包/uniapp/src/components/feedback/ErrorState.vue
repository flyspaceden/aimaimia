<template>
  <view class="nm-error" @click="onRetry">
    <text class="nm-error__text">{{ text }}</text>
    <text class="nm-error__btn">点击重试</text>
  </view>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{ text?: string }>(),
  {
    text: '加载失败',
  }
);

const emit = defineEmits(['retry']);
const onRetry = () => emit('retry');
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-error {
  padding: $nm-space-2xl $nm-space-xl;
  align-items: center;
}

.nm-error__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-error__btn {
  margin-top: $nm-space-sm;
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}
</style>
