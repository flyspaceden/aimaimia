<template>
  <view class="nm-header">
    <view class="nm-header__left">
      <slot name="left">
        <view class="nm-header__spacer" />
      </slot>
    </view>
    <view class="nm-header__center">
      <slot>
        <view class="nm-header__center-inner">
          <text class="nm-header__title">{{ title }}</text>
          <text v-if="subtitle" class="nm-header__subtitle">{{ subtitle }}</text>
        </view>
      </slot>
    </view>
    <view class="nm-header__right">
      <slot name="right" />
    </view>
  </view>
</template>

<script setup lang="ts">
// 统一页头：返回/标题/右侧操作（公共组件需中文注释）
const props = withDefaults(
  defineProps<{
    title?: string;
    subtitle?: string;
  }>(),
  {
    title: '',
    subtitle: '',
  }
);
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-header {
  height: 96rpx;
  padding: 0 $nm-space-xl;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: $nm-background;
  border-bottom: 1rpx solid $nm-border;
}

.nm-header__left,
.nm-header__right {
  width: 180rpx;
  display: flex;
  align-items: center;
}

.nm-header__center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.nm-header__right {
  justify-content: flex-end;
}

.nm-header__center-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.nm-header__title {
  font-size: $nm-font-title3;
  line-height: $nm-line-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-header__subtitle {
  margin-top: 2rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-header__spacer {
  width: 64rpx;
  height: 64rpx;
}
</style>
