<template>
  <view class="nm-stepper">
    <view class="nm-stepper__btn" @click="decrease">-</view>
    <text class="nm-stepper__value">{{ value }}</text>
    <view class="nm-stepper__btn" @click="increase">+</view>
  </view>
</template>

<script setup lang="ts">
// 数量步进器：购物车/加购用（公共组件需中文注释）
const props = withDefaults(
  defineProps<{
    value: number;
    min?: number;
    max?: number;
  }>(),
  {
    min: 1,
    max: 99,
  }
);

const emit = defineEmits(['change']);

const decrease = () => {
  const next = Math.max(props.min, props.value - 1);
  emit('change', next);
};

const increase = () => {
  const next = Math.min(props.max, props.value + 1);
  emit('change', next);
};
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-stepper {
  flex-direction: row;
  align-items: center;
  border: 1rpx solid $nm-border;
  border-radius: $nm-radius-pill;
  overflow: hidden;
}

.nm-stepper__btn {
  width: 56rpx;
  height: 56rpx;
  align-items: center;
  justify-content: center;
  background-color: $nm-background;
  font-size: $nm-font-body;
  color: $nm-text-secondary;
}

.nm-stepper__value {
  width: 56rpx;
  text-align: center;
  font-size: $nm-font-caption;
  color: $nm-text-primary;
}
</style>
