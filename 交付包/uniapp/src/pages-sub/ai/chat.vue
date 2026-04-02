<template>
  <Screen :safeTop="true">
    <AppHeader title="AI 农管家" />
    <view class="nm-container">
      <scroll-view
        class="nm-page"
        scroll-y
        scroll-with-animation
        :scroll-into-view="scrollIntoView"
        refresher-enabled
        :refresher-triggered="refreshing"
        @refresherrefresh="onRefresh"
      >
        <view class="nm-shortcuts">
          <view v-for="item in shortcuts" :key="item.id" class="nm-shortcut" @click="send(item.prompt)">
            <text class="nm-shortcut__text">{{ item.title }}</text>
          </view>
        </view>

        <view v-for="message in messages" :key="message.id" :id="message.id" class="nm-msg">
          <view :class="['nm-msg__bubble', message.role === 'user' ? 'nm-msg__bubble--user' : '']">
            <text class="nm-msg__text">{{ message.content }}</text>
          </view>
        </view>

        <view v-if="sending" id="ai-thinking" class="nm-msg">
          <view class="nm-msg__bubble">
            <text class="nm-msg__hint">AI 正在思考...</text>
          </view>
        </view>
      </scroll-view>

      <view class="nm-input-bar">
        <input
          v-model="input"
          class="nm-input"
          placeholder="向 AI 农管家提问"
          placeholder-class="nm-placeholder"
          confirm-type="send"
          @confirm="send()"
        />
        <view class="nm-send" @click="send()">
          <Icon name="send" :size="32" :color="textInverse" />
        </view>
      </view>
    </view>
  </Screen>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Screen, AppHeader, Icon } from '@/components';
import { AiAssistantRepo } from '@/services/repos';
import type { AiChatMessage, AiShortcut } from '@/services/repos/ai-assistant';
import { useToast } from '@/components/feedback/useToast';

const textInverse = '#FFFFFF';
const input = ref('');
const messages = ref<AiChatMessage[]>([
  {
    id: 'ai-greeting',
    role: 'assistant',
    content: '你好，我是 AI 农管家。',
    createdAt: new Date().toISOString(),
  },
]);
const shortcuts = ref<AiShortcut[]>([]);
const refreshing = ref(false);
const sending = ref(false);
const scrollIntoView = ref('ai-greeting');
const toast = useToast();

const fetchShortcuts = async () => {
  const res = await AiAssistantRepo.listShortcuts();
  if (res.ok) {
    shortcuts.value = res.data;
  }
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  fetchShortcuts().finally(() => {
    refreshing.value = false;
  });
};

const send = async (text?: string) => {
  const value = (text ?? input.value).trim();
  if (!value) return;
  const userMsg: AiChatMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    content: value,
    createdAt: new Date().toISOString(),
  };
  messages.value = messages.value.concat(userMsg);
  input.value = '';
  scrollIntoView.value = userMsg.id;
  sending.value = true;
  const res = await AiAssistantRepo.chat(value);
  sending.value = false;
  if (res.ok) {
    messages.value = messages.value.concat(res.data);
    scrollIntoView.value = res.data.id;
  } else {
    toast.show({ message: res.error.message || '发送失败', type: 'error' });
    scrollIntoView.value = 'ai-thinking';
  }
};

onLoad((options?: Record<string, string>) => {
  fetchShortcuts();
  if (options?.prompt) {
    send(options.prompt);
  }
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-container {
  flex: 1;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.nm-page {
  flex: 1;
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-shortcuts {
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: $nm-space-md;
}

.nm-shortcut {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
  margin-right: 16rpx;
  margin-bottom: 16rpx;
}

.nm-shortcut__text {
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
}

.nm-msg {
  margin-bottom: 20rpx;
  flex-direction: row;
}

.nm-msg__bubble {
  max-width: 78%;
  padding: 20rpx 24rpx;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
}

.nm-msg__bubble--user {
  margin-left: auto;
  background-color: $nm-brand-primary;
  border-color: $nm-brand-primary;
}

.nm-msg__text {
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-msg__bubble--user .nm-msg__text {
  color: $nm-text-inverse;
}

.nm-msg__hint {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-input-bar {
  flex-direction: row;
  align-items: center;
  padding: 16rpx 24rpx;
  border-top: 1rpx solid $nm-border;
  background-color: $nm-background;
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
}

.nm-input {
  flex: 1;
  padding: 16rpx 24rpx;
  border-width: 0;
  background-color: transparent;
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-placeholder {
  color: $nm-text-secondary;
}

.nm-send {
  margin-left: 16rpx;
  padding: 16rpx 24rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  align-items: center;
  justify-content: center;
}

</style>
