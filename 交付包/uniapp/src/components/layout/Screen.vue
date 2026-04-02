<template>
  <view :class="['nm-screen', safeTop ? 'nm-safe-top' : '', safeBottom ? 'nm-safe-bottom' : '']">
    <slot />
  </view>
</template>

<script setup lang="ts">
// 页面容器：处理背景色与安全区（公共组件需中文注释）
withDefaults(
  defineProps<{
    safeTop?: boolean;
    safeBottom?: boolean;
  }>(),
  {
    safeTop: true,
    safeBottom: false,
  }
);
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-screen {
  min-height: 100vh;
  background-color: $nm-background;
  color: $nm-text-primary;
}

.nm-safe-top {
  padding-top: env(safe-area-inset-top);
  padding-top: constant(safe-area-inset-top);
}

.nm-safe-bottom {
  padding-bottom: env(safe-area-inset-bottom);
  padding-bottom: constant(safe-area-inset-bottom);
}
</style>
