<template>
  <BottomSheet :open="open" mode="auto" title="分享卡片" :scrollable="true" @close="handleClose">
    <view class="nm-share">
    <view class="nm-share__card">
      <view class="nm-share__header">
        <view class="nm-share__brand">
          <text class="nm-share__brand-text">农脉</text>
          <view class="nm-share__ai">AI</view>
        </view>
        <view class="nm-share__badge">农脉圈分享</view>
      </view>
      <image v-if="cover" :src="cover" class="nm-share__image" mode="aspectFill" />
      <view v-else class="nm-share__image nm-share__image--placeholder" />
      <text class="nm-share__title">{{ title }}</text>
      <text class="nm-share__content" number-of-lines="2">{{ content }}</text>
      <view v-if="tags && tags.length" class="nm-share__tags">
        <view v-for="tag in tags.slice(0, 3)" :key="`share-${tag}`" class="nm-share__tag">
          <text class="nm-share__tag-text">{{ tag }}</text>
        </view>
      </view>
      <view class="nm-share__footer">
        <view class="nm-share__author-row">
          <image v-if="authorAvatar" :src="authorAvatar" class="nm-share__avatar" mode="aspectFill" />
          <view v-else class="nm-share__avatar" />
          <view>
            <text class="nm-share__author">{{ author }}</text>
            <text class="nm-share__time">{{ createdAt || '刚刚' }}</text>
          </view>
        </view>
        <view class="nm-share__qr">
          <Icon name="qrcode" :size="40" :color="textSecondary" />
          <text class="nm-share__qr-text">扫码查看</text>
        </view>
      </view>
    </view>

      <text class="nm-share__note">分享卡片为前端占位，后续可接入微信/系统分享能力</text>

      <text class="nm-share__label">分享到</text>
      <view class="nm-share__actions">
        <view
          class="nm-share__action"
          v-for="item in actions"
          :key="item.id"
          @click="toast.show({ message: item.message, type: 'info' })"
        >
          <view class="nm-share__action-icon">
            <Icon :name="item.icon" :size="36" :color="textSecondary" />
          </view>
          <text class="nm-share__action-text">{{ item.label }}</text>
        </view>
      </view>
    </view>
  </BottomSheet>
</template>

<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue';
import { BottomSheet } from '@/components';
import { useToast } from '@/components/feedback/useToast';

withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    content?: string;
    author?: string;
    cover?: string;
    tags?: string[];
    authorAvatar?: string;
    createdAt?: string;
  }>(),
  {
    title: '高山小番茄的 7 天养护日记',
    content: '记录清晨雾气与温度对口感的影响，欢迎交流。',
    author: '江晴',
    cover: '',
    tags: () => [],
    authorAvatar: '',
    createdAt: '',
  }
);

const toast = useToast();
const emit = defineEmits(['close']);
const handleClose = () => emit('close');

const textSecondary = '#4B5B53';
const actions = [
  { id: 'wechat', label: '微信好友', icon: 'wechat', message: '已生成微信分享卡片（占位）' },
  { id: 'moments', label: '朋友圈', icon: 'wechat', message: '已生成朋友圈卡片（占位）' },
  { id: 'xhs', label: '小红书', icon: 'notebook-outline', message: '已生成小红书分享卡片（占位）' },
  { id: 'douyin', label: '抖音', icon: 'music-note', message: '已生成抖音分享卡片（占位）' },
  { id: 'link', label: '复制链接', icon: 'link-variant', message: '链接已复制（占位）' },
];
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-share {
  padding-bottom: $nm-space-xl;
}

.nm-share__card {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
}

.nm-share__header {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-share__brand {
  flex-direction: row;
  align-items: center;
}

.nm-share__brand-text {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-brand-primary;
}

.nm-share__ai {
  margin-left: 10rpx;
  padding: 4rpx 10rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-accent-blue-soft;
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-share__badge {
  padding: 6rpx 12rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
}

.nm-share__image {
  margin-top: $nm-space-md;
  height: 240rpx;
  border-radius: $nm-radius-md;
  background-color: $nm-skeleton;
}

.nm-share__image--placeholder {
  border: 1rpx solid $nm-border;
}

.nm-share__title {
  margin-top: $nm-space-sm;
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-share__content {
  margin-top: 6rpx;
  font-size: $nm-font-body;
  color: $nm-text-secondary;
}

.nm-share__tags {
  margin-top: $nm-space-sm;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-share__tag {
  padding: 6rpx 14rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-background;
  border: 1rpx solid $nm-border;
  margin-right: 8rpx;
  margin-bottom: 8rpx;
}

.nm-share__tag-text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-share__footer {
  margin-top: $nm-space-md;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-share__author-row {
  flex-direction: row;
  align-items: center;
}

.nm-share__avatar {
  width: 56rpx;
  height: 56rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
  margin-right: 12rpx;
}

.nm-share__author {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-share__time {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-share__qr {
  padding: 10rpx 12rpx;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  align-items: center;
  justify-content: center;
}

.nm-share__qr-text {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-share__note {
  margin-top: $nm-space-sm;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-share__label {
  margin-top: $nm-space-lg;
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-share__actions {
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: $nm-space-sm;
}

.nm-share__action {
  width: 25%;
  align-items: center;
  margin-bottom: $nm-space-md;
}

.nm-share__action-icon {
  width: 72rpx;
  height: 72rpx;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  align-items: center;
  justify-content: center;
}

.nm-share__action-text {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}
</style>
