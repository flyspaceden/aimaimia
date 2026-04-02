<template>
  <Screen :safeTop="false">
    <view class="nm-splash">
      <view class="nm-atmosphere">
        <view class="nm-pulse-ring" />
        <view class="nm-glow nm-glow--primary" />
        <view class="nm-glow nm-glow--secondary" />
      </view>

      <view class="nm-skip" @click="skip">
        <text class="nm-skip__text">跳过</text>
      </view>

      <text class="nm-brand">农脉</text>
      <view class="nm-underline-wrap">
        <view class="nm-underline" />
      </view>
      <view class="nm-seed-dot" />
      <text class="nm-subtitle">AI赋能农业，夯实健康之路</text>
    </view>
  </Screen>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { Screen } from '@/components';
import { navTab } from '@/utils/nav';

let timer: ReturnType<typeof setTimeout> | null = null;
let navigated = false;

const goHome = () => {
  if (navigated) return;
  navigated = true;
  navTab({ url: '/pages/tabbar/home/home' });
};

const skip = () => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  goHome();
};

onMounted(() => {
  timer = setTimeout(() => {
    goHome();
  }, 1600);
});

onBeforeUnmount(() => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-splash {
  position: relative;
  min-height: 100vh;
  background-color: $nm-brand-primary-dark;
  align-items: center;
  justify-content: center;
}

.nm-atmosphere {
  position: absolute;
  inset: 0;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.nm-pulse-ring {
  width: 440rpx;
  height: 440rpx;
  border-radius: 220rpx;
  border: 3rpx solid $nm-accent-blue;
  opacity: 0.28;
  animation: nm-pulse 1.4s ease-in-out infinite;
}

.nm-glow {
  position: absolute;
  border-radius: 999rpx;
}

.nm-glow--primary {
  width: 320rpx;
  height: 320rpx;
  background-color: $nm-accent-blue-soft;
  opacity: 0.18;
  top: 22%;
  right: 12%;
}

.nm-glow--secondary {
  width: 400rpx;
  height: 400rpx;
  background-color: $nm-brand-primary-soft;
  opacity: 0.16;
  bottom: 18%;
  left: 10%;
}

.nm-skip {
  position: absolute;
  top: calc(24rpx + env(safe-area-inset-top));
  right: 32rpx;
  padding: 12rpx 16rpx;
}

.nm-skip__text {
  font-size: $nm-font-caption;
  color: $nm-text-inverse;
}

.nm-brand {
  font-size: 72rpx;
  font-weight: 700;
  letter-spacing: 16rpx;
  color: $nm-text-inverse;
  opacity: 0;
  transform: translateY(20rpx) scale(0.84);
  animation: nm-brand-in 0.42s ease-out forwards;
}

.nm-underline-wrap {
  width: 320rpx;
  align-items: center;
  margin-top: 24rpx;
  transform: scaleX(0);
  transform-origin: center;
  animation: nm-line-in 0.26s ease-out forwards;
  animation-delay: 0.54s;
}

.nm-underline {
  height: 6rpx;
  width: 100%;
  border-radius: 999rpx;
  background-color: $nm-accent-blue;
}

.nm-seed-dot {
  width: 20rpx;
  height: 20rpx;
  border-radius: 999rpx;
  margin-top: 20rpx;
  background-color: $nm-accent-blue-soft;
  opacity: 0;
  transform: scale(0);
  animation: nm-dot-in 0.24s ease-out forwards;
  animation-delay: 0.54s;
}

.nm-subtitle {
  margin-top: 24rpx;
  font-size: $nm-font-body;
  letter-spacing: 2rpx;
  color: $nm-text-inverse;
  opacity: 0;
  transform: translateY(24rpx);
  animation: nm-subtitle-in 0.28s ease-out forwards;
  animation-delay: 0.92s;
}

@keyframes nm-brand-in {
  0% {
    opacity: 0;
    transform: translateY(20rpx) scale(0.84);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes nm-line-in {
  0% {
    transform: scaleX(0);
  }
  100% {
    transform: scaleX(1);
  }
}

@keyframes nm-dot-in {
  0% {
    opacity: 0;
    transform: scale(0);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes nm-subtitle-in {
  0% {
    opacity: 0;
    transform: translateY(24rpx);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes nm-pulse {
  0% {
    transform: scale(0.75);
    opacity: 0.28;
  }
  100% {
    transform: scale(1.25);
    opacity: 0;
  }
}
</style>
