<template>
  <view class="nm-empty">
    <view class="nm-empty__icon" />
    <text class="nm-empty__text">{{ text }}</text>
    <text v-if="hint" class="nm-empty__hint">{{ hint }}</text>
  </view>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{ text?: string; hint?: string }>(),
  {
    text: '暂无内容',
    hint: '',
  }
);
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-empty {
  padding: $nm-space-2xl $nm-space-xl;
  align-items: center;
}

.nm-empty__icon {
  width: 72rpx;
  height: 72rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-skeleton;
  margin-bottom: $nm-space-sm;
}

.nm-empty__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-empty__hint {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}
</style>
