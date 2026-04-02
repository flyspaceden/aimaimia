<template>
  <view class="nm-skeleton">
    <view
      v-for="index in count"
      :key="index"
      :class="['nm-skeleton__block', type === 'card' ? 'nm-skeleton__block--card' : '']"
      :style="blockStyle"
    />
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{ count?: number; type?: 'line' | 'card'; height?: number }>(),
  {
    count: 3,
    type: 'line',
    height: 0,
  }
);

const blockStyle = computed(() => {
  if (!props.height) return {};
  return { height: `${props.height}rpx` };
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-skeleton {
  margin-top: $nm-space-md;
}

.nm-skeleton__block {
  height: 48rpx;
  border-radius: $nm-radius-md;
  background-color: $nm-skeleton;
  margin-bottom: $nm-space-sm;
}

.nm-skeleton__block--card {
  height: 240rpx;
  border-radius: $nm-radius-lg;
}
</style>
