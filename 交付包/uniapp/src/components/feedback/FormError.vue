<template>
  <text v-if="text" class="nm-form-error">{{ text }}</text>
</template>

<script setup lang="ts">
// 表单错误提示：统一校验文案样式（公共组件需中文注释）
const props = withDefaults(
  defineProps<{ text?: string }>(),
  {
    text: '',
  }
);
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-form-error {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-danger;
}
</style>
