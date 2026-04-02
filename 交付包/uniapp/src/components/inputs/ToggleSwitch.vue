<template>
  <view class="nm-toggle" :class="modelValue ? 'nm-toggle--on' : ''" @click="toggle">
    <view class="nm-toggle__dot" />
  </view>
</template>

<script setup lang="ts">
// 开关组件：发布设置等场景使用（公共组件需中文注释）
const props = withDefaults(
  defineProps<{ modelValue: boolean }>(),
  {
    modelValue: false,
  }
);

const emit = defineEmits(['update:modelValue']);

const toggle = () => {
  emit('update:modelValue', !props.modelValue);
};
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-toggle {
  width: 88rpx;
  height: 48rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
  padding: 4rpx;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
}

.nm-toggle__dot {
  width: 40rpx;
  height: 40rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-surface;
}

.nm-toggle--on {
  background-color: $nm-brand-primary;
  justify-content: flex-end;
}
</style>
