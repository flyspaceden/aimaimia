<template>
  <view v-if="visible" class="nm-sheet">
    <view class="nm-sheet__mask" :style="maskStyle" @click="handleClose" @touchmove.stop.prevent />
    <view
      ref="panelRef"
      class="nm-sheet__panel"
      :class="panelClass"
      :style="[panelStyle, panelTransformStyle, panelTransitionStyle]"
      @touchstart="onTouchStart"
      @touchmove.stop="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <view
        class="nm-sheet__handle"
        @touchstart="(e) => onTouchStart(e, true)"
        @touchmove.stop="(e) => onTouchMove(e, true)"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      />
      <text v-if="title" class="nm-sheet__title">{{ title }}</text>
      <scroll-view
        v-if="scrollable"
        class="nm-sheet__content nm-sheet__content--scroll"
        scroll-y
        @scroll="onScroll"
      >
        <slot />
      </scroll-view>
      <view v-else class="nm-sheet__content">
        <slot />
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
// BottomSheet：对齐 Expo/React Native 抽屉交互（拖拽/吸附/遮罩联动）
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, ref, watch } from 'vue';

const emit = defineEmits(['close']);
const props = withDefaults(
  defineProps<{
    open: boolean;
    mode?: 'auto' | 'half';
    title?: string;
    scrollable?: boolean;
  }>(),
  {
    mode: 'auto',
    title: '',
    scrollable: false,
  }
);

const TRANSITION_MS = 250;
const OVERLAY_ALPHA = 0.35;
const OVERLAY_TARGET = 0.25;
const OVERLAY_SCALE = OVERLAY_TARGET / OVERLAY_ALPHA;

const instance = getCurrentInstance();
const panelRef = ref();
const visible = ref(false);
const closing = ref(false);
const dragging = ref(false);
const translateY = ref(0);
const panelHeight = ref(0);
const contentScrollTop = ref(0);
const dragState = ref({ startY: 0, startTime: 0, lastY: 0, lastTime: 0, startTranslate: 0 });
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const panelClass = computed(() => `nm-sheet__panel--${props.mode}`);
const panelStyle = computed(() =>
  props.mode === 'auto'
    ? { maxHeight: '92vh' }
    : { height: '52vh' }
);
const panelTransformStyle = computed(() => ({
  transform: `translateY(${Math.max(0, translateY.value)}px)`,
}));
const panelTransitionStyle = computed(() => ({
  transition: dragging.value ? 'none' : `transform ${TRANSITION_MS}ms ease-out`,
}));
const maskStyle = computed(() => {
  const height = panelHeight.value || 1;
  const progress = Math.min(1, Math.max(0, 1 - translateY.value / height));
  return {
    opacity: progress * OVERLAY_SCALE,
    transition: dragging.value ? 'none' : `opacity ${TRANSITION_MS}ms ease-out`,
  };
});

const getFallbackHeight = () => {
  const { windowHeight = 0 } = uni.getSystemInfoSync();
  if (props.mode === 'half') {
    return Math.round(windowHeight * 0.52);
  }
  return Math.round(windowHeight * 0.92);
};

const measurePanel = async () => {
  await nextTick();
  if (!instance) {
    panelHeight.value = getFallbackHeight();
    return;
  }
  uni
    .createSelectorQuery()
    .in(instance)
    .select('.nm-sheet__panel')
    .boundingClientRect((rect) => {
      panelHeight.value = rect?.height ? rect.height : getFallbackHeight();
    })
    .exec();
};

const clearCloseTimer = () => {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
};

const openSheet = async () => {
  clearCloseTimer();
  visible.value = true;
  closing.value = false;
  await measurePanel();
  translateY.value = panelHeight.value || getFallbackHeight();
  await nextTick();
  requestAnimationFrame(() => {
    translateY.value = 0;
  });
};

const closeSheet = () => {
  if (!visible.value) return;
  closing.value = true;
  translateY.value = panelHeight.value || getFallbackHeight();
  clearCloseTimer();
  closeTimer = setTimeout(() => {
    visible.value = false;
    closing.value = false;
  }, TRANSITION_MS);
};

watch(
  () => props.open,
  (value) => {
    if (value) {
      openSheet();
      return;
    }
    closeSheet();
  },
  { immediate: true }
);

watch(
  () => props.mode,
  () => {
    if (props.open) {
      measurePanel();
    }
  }
);

const onScroll = (e: any) => {
  contentScrollTop.value = e?.detail?.scrollTop ?? 0;
};

const canDrag = (force: boolean) => {
  if (!props.open || closing.value) return false;
  if (force) return true;
  if (!props.scrollable) return true;
  return contentScrollTop.value <= 0;
};

const onTouchStart = (e: any, force = false) => {
  if (!canDrag(force)) return;
  const touch = e?.touches?.[0];
  if (!touch) return;
  dragging.value = true;
  dragState.value = {
    startY: touch.clientY,
    startTime: Date.now(),
    lastY: touch.clientY,
    lastTime: Date.now(),
    startTranslate: translateY.value,
  };
};

const onTouchMove = (e: any, force = false) => {
  if (!dragging.value || !canDrag(force)) return;
  const touch = e?.touches?.[0];
  if (!touch) return;
  e?.preventDefault?.();
  const delta = touch.clientY - dragState.value.startY;
  const nextTranslate = Math.min(
    Math.max(0, dragState.value.startTranslate + delta),
    panelHeight.value || getFallbackHeight()
  );
  translateY.value = nextTranslate;
  dragState.value.lastY = touch.clientY;
  dragState.value.lastTime = Date.now();
};

const onTouchEnd = () => {
  if (!dragging.value) return;
  dragging.value = false;
  const height = panelHeight.value || getFallbackHeight();
  const progress = translateY.value / height;
  const elapsed = Math.max(1, dragState.value.lastTime - dragState.value.startTime);
  const velocity = (dragState.value.lastY - dragState.value.startY) / elapsed;
  const shouldClose = progress > 0.33 || velocity > 0.6;
  if (shouldClose) {
    emit('close');
    translateY.value = height;
    return;
  }
  translateY.value = 0;
};

const handleClose = () => emit('close');

onBeforeUnmount(() => {
  clearCloseTimer();
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-sheet {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 999;
}

.nm-sheet__mask {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-color: $nm-overlay;
}

.nm-sheet__panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: $nm-surface;
  border-top-left-radius: $nm-radius-xl;
  border-top-right-radius: $nm-radius-xl;
  padding: $nm-space-lg;
  padding-bottom: calc(#{$nm-space-lg} + env(safe-area-inset-bottom));
  flex-direction: column;
  overflow: hidden;
  will-change: transform;
}

.nm-sheet__panel--half {
  height: 52vh;
}

.nm-sheet__panel--auto {
  height: auto;
  max-height: 92vh;
}

.nm-sheet__handle {
  width: 80rpx;
  height: 8rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
  margin: 0 auto $nm-space-md;
}

.nm-sheet__title {
  font-size: $nm-font-title3;
  line-height: $nm-line-title3;
  font-weight: 600;
  color: $nm-text-primary;
  margin-bottom: $nm-space-md;
}

.nm-sheet__content {
  width: 100%;
}

.nm-sheet__content--scroll {
  flex: 1;
  min-height: 0;
}

</style>
