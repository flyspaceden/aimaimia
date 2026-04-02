<template>
  <view class="nm-icon-button" @click="handleClick">
    <slot />
  </view>
</template>

<script setup lang="ts">
// 图标按钮：统一可点击区域（公共组件需中文注释）
const emit = defineEmits(['click']);
const handleClick = () => emit('click');
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-icon-button {
  width: 64rpx;
  height: 64rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
