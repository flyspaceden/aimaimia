<template>
  <view :class="['nm-avatar-frame', frameClass]" :style="frameStyle">
    <image v-if="uri" :src="uri" class="nm-avatar" mode="aspectFill" />
    <view v-else class="nm-avatar nm-avatar--empty" />
  </view>
</template>

<script setup lang="ts">
// 头像框组件：展示头像与等级框（公共组件需中文注释）
const props = withDefaults(
  defineProps<{
    uri?: string;
    size?: number;
    frame?: { id?: string; type?: 'vip' | 'task' | 'limited'; expireAt?: string } | null;
  }>(),
  {
    size: 72,
    frame: null,
  }
);

const frameClass = props.frame?.type ? `nm-avatar-frame--${props.frame.type}` : 'nm-avatar-frame--normal';
const frameStyle = {
  width: `${props.size}px`,
  height: `${props.size}px`,
};
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-avatar-frame {
  border-radius: 50%;
  padding: 4rpx;
  align-items: center;
  justify-content: center;
}

.nm-avatar-frame--normal {
  background-color: $nm-border;
}

.nm-avatar-frame--vip {
  background-color: $nm-brand-primary;
}

.nm-avatar-frame--task {
  background-color: $nm-accent-blue;
}

.nm-avatar-frame--limited {
  background-color: $nm-brand-primary-soft;
}

.nm-avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background-color: $nm-surface;
}

.nm-avatar--empty {
  background-color: $nm-brand-primary-soft;
}
</style>
