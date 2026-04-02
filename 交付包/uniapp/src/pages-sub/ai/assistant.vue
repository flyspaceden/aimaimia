<template>
  <Screen :safeTop="true">
    <AppHeader title="AI 农管家" />
    <scroll-view class="nm-page" scroll-y refresher-enabled :refresher-triggered="refreshing" @refresherrefresh="onRefresh">
      <view class="nm-hero">
        <view class="nm-hero__header">
          <view>
            <text class="nm-hero__title">你的专属 AI 农管家</text>
            <text class="nm-hero__sub">连接订单、健康、农事与内容的智能助手</text>
          </view>
          <Tag label="占位" tone="accent" />
        </view>
        <view class="nm-hero__actions">
          <view class="nm-hero__btn nm-hero__btn--primary" @click="goChat">
            <Icon class="nm-hero__icon" name="message-text-outline" :size="32" :color="textInverse" />
            <text>文本咨询</text>
          </view>
          <view class="nm-hero__btn nm-hero__btn--ghost" @click="goVoice">
            <Icon class="nm-hero__icon" name="microphone-outline" :size="32" :color="textSecondary" />
            <text>语音入口</text>
          </view>
        </view>
      </view>

      <view class="nm-section">
        <view class="nm-section__header">
          <text class="nm-section__title">快捷问题</text>
          <view class="nm-section__actions">
            <view v-if="editing" class="nm-section__btn" @click="resetPrompts">重置</view>
            <view :class="['nm-section__btn', editing ? 'nm-section__btn--accent' : '']" @click="toggleEditing">
              {{ editing ? '完成' : '编辑' }}
            </view>
          </view>
        </view>
        <view v-if="editing" class="nm-prompt-input">
          <input v-model="promptInput" class="nm-input" placeholder="添加一个常用问题" placeholder-class="nm-placeholder" />
          <view class="nm-primary" @click="addPrompt">添加</view>
        </view>
        <view class="nm-prompt-row">
          <view
            v-for="item in quickPrompts"
            :key="item"
            :class="['nm-prompt-chip', editing ? 'nm-prompt-chip--editing' : '']"
            @click="handlePrompt(item)"
          >
            <text class="nm-prompt-text">{{ item }}</text>
            <Icon v-if="editing" class="nm-prompt-remove-icon" name="close-circle" :size="28" :color="brandPrimary" />
          </view>
        </view>
        <text v-if="editing" class="nm-prompt-hint">点击问题即可移除</text>
      </view>

      <view class="nm-section">
        <text class="nm-section__title">核心场景</text>
        <view class="nm-scenarios">
          <view v-for="item in scenarios" :key="item.id" class="nm-card">
            <view class="nm-card__row">
              <view class="nm-card__icon" :class="item.tone === 'accent' ? 'nm-card__icon--accent' : ''">
                <Icon
                  class="nm-card__icon-text"
                  :name="item.icon"
                  :size="36"
                  :color="item.tone === 'accent' ? accentBlue : brandPrimary"
                />
              </view>
              <view class="nm-card__info">
                <text class="nm-card__title">{{ item.title }}</text>
                <text class="nm-card__subtitle">{{ item.subtitle }}</text>
              </view>
              <Tag label="占位" :tone="item.tone === 'accent' ? 'accent' : 'brand'" />
            </view>
            <text class="nm-card__desc">{{ item.description }}</text>
            <view :class="['nm-card__cta', item.tone === 'accent' ? 'nm-card__cta--accent' : '']" @click="showPlaceholder(item.cta)">
              {{ item.cta }}
            </view>
          </view>
        </view>
      </view>

      <view class="nm-notice">
        <Icon class="nm-notice__icon" name="star-four-points" :size="36" :color="accentBlue" />
        <text class="nm-notice__text">AI 农管家当前为前端占位，后续接入后端可实现智能对话与自动化服务。</text>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { ref } from 'vue';
import { Screen, AppHeader, Tag, Icon } from '@/components';
import { useToast } from '@/components/feedback/useToast';

const brandPrimary = '#2F8F4E';
const accentBlue = '#2B6CB0';
const textSecondary = '#4B5B53';
const textInverse = '#FFFFFF';
const refreshing = ref(false);
const editing = ref(false);
const promptInput = ref('');
const toast = useToast();

const defaultPrompts = ['我的订单到哪了', '推荐低糖水果', '本周适合补货什么', '查看考察进度'];
const quickPrompts = ref<string[]>([...defaultPrompts]);

const scenarios = [
  {
    id: 'support',
    title: '智能客服',
    subtitle: '查物流 / 退款售后 / 订单问题',
    description: '连接订单与消息中心，快速定位最近问题订单。',
    cta: '去咨询',
    icon: 'headset',
    tone: 'brand',
  },
  {
    id: 'health',
    title: '健康饮食顾问',
    subtitle: '家庭健康摄入报告',
    description: '基于购买记录与偏好，生成可解释饮食建议。',
    cta: '生成报告',
    icon: 'food-apple-outline',
    tone: 'accent',
  },
  {
    id: 'restock',
    title: '补货提醒',
    subtitle: '常购商品消耗预测',
    description: '学习你的消耗周期，提前提醒补货并推送优惠。',
    cta: '设置提醒',
    icon: 'bell-ring-outline',
    tone: 'brand',
  },
  {
    id: 'calendar',
    title: '农事日历订阅',
    subtitle: '关注农户种植/收获节奏',
    description: '将农户动态转成日历订阅，感知食物生长节奏。',
    cta: '订阅日历',
    icon: 'calendar-month-outline',
    tone: 'accent',
  },
];

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  setTimeout(() => {
    refreshing.value = false;
  }, 300);
};

const goChat = () => {
  navTo({ url: '/pages-sub/ai/chat' });
};

const goVoice = () => {
  toast.show({ message: '语音入口待接入', type: 'info' });
};

const toggleEditing = () => {
  editing.value = !editing.value;
};

const resetPrompts = () => {
  quickPrompts.value = [...defaultPrompts];
};

const addPrompt = () => {
  const value = promptInput.value.trim();
  if (!value) {
    toast.show({ message: '请输入问题内容', type: 'info' });
    return;
  }
  if (quickPrompts.value.includes(value)) {
    toast.show({ message: '该问题已存在', type: 'info' });
    return;
  }
  if (quickPrompts.value.length >= 8) {
    toast.show({ message: '最多保留 8 条快捷问题', type: 'info' });
    return;
  }
  quickPrompts.value.push(value);
  promptInput.value = '';
};

const handlePrompt = (prompt: string) => {
  if (editing.value) {
    quickPrompts.value = quickPrompts.value.filter((item) => item !== prompt);
    return;
  }
  navTo({ url: `/pages-sub/ai/chat?prompt=${encodeURIComponent(prompt)}` });
};

const showPlaceholder = (label: string) => {
  toast.show({ message: `${label}（占位）`, type: 'info' });
};
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-hero {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid transparent;
  box-shadow: $nm-shadow-sm;
}

.nm-hero__header {
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-start;
}

.nm-hero__title {
  font-size: $nm-font-title2;
  font-weight: 700;
  color: $nm-text-primary;
}

.nm-hero__sub {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-hero__actions {
  margin-top: 32rpx;
  flex-direction: row;
  align-items: center;
}

.nm-hero__btn {
  padding: 20rpx 28rpx;
  border-radius: $nm-radius-pill;
  font-size: $nm-font-caption;
  text-align: center;
  flex-direction: row;
  align-items: center;
  justify-content: center;
}

.nm-hero__btn + .nm-hero__btn {
  margin-left: 20rpx;
}

.nm-hero__icon {
  margin-right: 8rpx;
}

.nm-hero__btn--primary {
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
}

.nm-hero__btn--ghost {
  border: 1rpx solid $nm-border;
  color: $nm-text-secondary;
  background-color: $nm-surface;
}

.nm-section {
  margin-top: $nm-space-lg;
}

.nm-section__header {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-section__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-section__actions {
  flex-direction: row;
  align-items: center;
}

.nm-section__btn {
  padding: 8rpx 20rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  margin-left: 16rpx;
}

.nm-section__btn--accent {
  border-color: $nm-accent-blue;
  color: $nm-accent-blue;
}

.nm-prompt-input {
  margin-top: 20rpx;
  flex-direction: row;
  align-items: center;
}

.nm-input {
  flex: 1;
  height: 72rpx;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  padding: 16rpx 24rpx;
  background-color: $nm-surface;
}

.nm-primary {
  padding: 16rpx 24rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  font-size: $nm-font-caption;
  margin-left: 16rpx;
}

.nm-placeholder {
  color: $nm-text-secondary;
}

.nm-prompt-row {
  margin-top: 20rpx;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-prompt-chip {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
  flex-direction: row;
  align-items: center;
  margin-right: 16rpx;
  margin-bottom: 16rpx;
}

.nm-prompt-chip--editing {
  padding-right: 12rpx;
}

.nm-prompt-text {
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
}

.nm-prompt-remove-icon {
  margin-left: 6rpx;
}

.nm-prompt-hint {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-scenarios {
  margin-top: 0;
}

.nm-card {
  padding: 28rpx;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid transparent;
  box-shadow: $nm-shadow-sm;
  margin-top: 24rpx;
}

.nm-card__row {
  flex-direction: row;
  align-items: center;
}

.nm-card__icon {
  width: 72rpx;
  height: 72rpx;
  border-radius: 36rpx;
  background-color: $nm-brand-primary-soft;
  align-items: center;
  justify-content: center;
  margin-right: 20rpx;
}

.nm-card__icon--accent {
  background-color: $nm-accent-blue-soft;
}


.nm-card__info {
  flex: 1;
}

.nm-card__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-card__subtitle {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-card__desc {
  margin-top: 16rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  line-height: 1.6;
}

.nm-card__cta {
  margin-top: 24rpx;
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-brand-primary;
  color: $nm-brand-primary;
  font-size: $nm-font-caption;
  align-self: flex-start;
}

.nm-card__cta--accent {
  border-color: $nm-accent-blue;
  color: $nm-accent-blue;
}

.nm-notice {
  margin-top: $nm-space-lg;
  padding: $nm-space-md;
  border-radius: $nm-radius-lg;
  background-color: $nm-accent-blue-soft;
  flex-direction: row;
  align-items: center;
}

.nm-notice__icon {
  margin-right: $nm-space-sm;
}

.nm-notice__text {
  flex: 1;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}
</style>
