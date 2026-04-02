<template>
  <Screen :safeTop="true">
    <AppHeader title="为你推荐" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <EmptyState text="推荐列表待接入" hint="后续展示完整个性推荐列表" />
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Screen, AppHeader, EmptyState } from '@/components';

const refreshing = ref(false);

const onRefresh = async () => {
  if (refreshing.value) return;
  refreshing.value = true;
  setTimeout(() => {
    refreshing.value = false;
  }, 300);
};
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}
</style>
