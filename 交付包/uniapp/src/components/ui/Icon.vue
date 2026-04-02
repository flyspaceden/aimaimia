<template>
  <text class="nm-icon" :style="iconStyle">{{ glyph }}</text>
</template>

<script setup lang="ts">
// 图标：MaterialCommunityIcons 映射（公共组件需中文注释）
import { computed } from 'vue';
import { MATERIAL_ICONS } from '@/utils/material-community-icons';

const props = withDefaults(
  defineProps<{
    name: string;
    size?: number;
    color?: string;
  }>(),
  {
    size: 32,
    color: '',
  }
);

const glyph = computed(() => {
  const code = MATERIAL_ICONS[props.name];
  return typeof code === 'number' ? String.fromCodePoint(code) : '';
});

const iconStyle = computed(() => ({
  fontFamily: 'MaterialCommunityIcons',
  fontSize: `${props.size}rpx`,
  lineHeight: `${props.size}rpx`,
  width: `${props.size}rpx`,
  height: `${props.size}rpx`,
  display: 'inline-block',
  textAlign: 'center',
  color: props.color || undefined,
}));
</script>

<style scoped lang="scss">
.nm-icon {
  text-align: center;
}
</style>
