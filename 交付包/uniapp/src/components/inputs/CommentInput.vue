<template>
  <view class="nm-input-bar">
    <view v-if="replyTo" class="nm-reply">
      <text class="nm-reply__text">回复 @{{ replyTo }}</text>
      <text class="nm-reply__cancel" @click="emit('cancel')">取消</text>
    </view>
    <view class="nm-input-shell">
      <textarea
        class="nm-input"
        :placeholder="placeholder"
        placeholder-class="nm-placeholder"
        :value="modelValue"
        auto-height
        :adjust-position="false"
        @input="onInput"
      />
      <view :class="['nm-send', canSend ? '' : 'nm-send--disabled']" @click="onSend">
        <Icon class="nm-send__icon" name="send" :size="36" :color="sendColor" />
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
// 评论输入框：帖子/心愿详情复用（公共组件需中文注释）
import { computed } from 'vue';
import Icon from '@/components/ui/Icon.vue';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    disabled?: boolean;
    replyTo?: string;
  }>(),
  {
    modelValue: '',
    placeholder: '写评论...',
    disabled: false,
    replyTo: '',
  }
);

const emit = defineEmits(['update:modelValue', 'send', 'cancel']);

const canSend = computed(() => !props.disabled && props.modelValue.trim().length > 0);
const sendColor = computed(() => (canSend.value ? '#2F8F4E' : '#8A9B90'));

const onInput = (e: any) => {
  const value = e?.detail?.value ?? e?.target?.value ?? '';
  emit('update:modelValue', value);
};

const onSend = () => {
  if (!canSend.value) return;
  const trimmed = props.modelValue.trim();
  if (!trimmed) return;
  emit('send', trimmed);
};
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-input-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: $nm-space-sm $nm-space-md calc(#{$nm-space-sm} + env(safe-area-inset-bottom));
  background-color: $nm-background;
  border-top: 1rpx solid $nm-border;
  flex-direction: column;
}

.nm-reply {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: $nm-space-sm;
}

.nm-reply__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-reply__cancel {
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-input-shell {
  flex-direction: row;
  align-items: center;
  padding: 12rpx 16rpx;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
}

.nm-input {
  flex: 1;
  min-height: 88rpx;
  max-height: 240rpx;
  background-color: transparent;
  padding: 12rpx 16rpx;
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-send {
  width: 64rpx;
  height: 64rpx;
  margin-left: 12rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
  align-items: center;
  justify-content: center;
}

.nm-send--disabled {
  opacity: 0.4;
}

.nm-send__icon {
  font-size: $nm-font-caption;
}

.nm-placeholder {
  color: $nm-text-secondary;
}
</style>
