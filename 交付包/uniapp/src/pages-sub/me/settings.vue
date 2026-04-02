<template>
  <Screen :safeTop="true">
    <AppHeader title="设置" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view class="nm-section">
        <view class="nm-card">
          <text class="nm-card__title">账号与安全</text>
          <view class="nm-row" @click="showInfo('账号与安全功能待接入')">
            <Icon class="nm-row__icon" name="account-lock-outline" :size="36" :color="textSecondary" />
            <text class="nm-row__label">账号与安全</text>
            <Icon class="nm-row__arrow" name="chevron-right" :size="36" :color="textSecondary" />
          </view>
          <view class="nm-row" @click="showInfo('通知设置待接入')">
            <Icon class="nm-row__icon" name="bell-outline" :size="36" :color="textSecondary" />
            <text class="nm-row__label">通知设置</text>
            <Icon class="nm-row__arrow" name="chevron-right" :size="36" :color="textSecondary" />
          </view>
        </view>
      </view>

      <view class="nm-section">
        <view class="nm-card">
          <text class="nm-card__title">隐私与合规</text>
          <view class="nm-row" @click="goPrivacy">
            <Icon class="nm-row__icon" name="shield-lock-outline" :size="36" :color="textSecondary" />
            <text class="nm-row__label">隐私政策</text>
            <Icon class="nm-row__arrow" name="chevron-right" :size="36" :color="textSecondary" />
          </view>
          <view class="nm-row" @click="goAbout">
            <Icon class="nm-row__icon" name="information-outline" :size="36" :color="textSecondary" />
            <text class="nm-row__label">关于农脉</text>
            <Icon class="nm-row__arrow" name="chevron-right" :size="36" :color="textSecondary" />
          </view>
        </view>
      </view>

      <view class="nm-help" @click="goHelp">
        <Icon class="nm-help__icon" name="lifebuoy" :size="36" :color="textSecondary" />
        <text class="nm-help__text">帮助与反馈</text>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { ref } from 'vue';
import { Screen, AppHeader, Icon } from '@/components';

const textSecondary = '#4B5B53';
const refreshing = ref(false);

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  setTimeout(() => {
    refreshing.value = false;
  }, 300);
};

const showInfo = (message: string) => {
  uni.showToast({ title: message, icon: 'none' });
};

const goPrivacy = () => {
  navTo({ url: '/pages-sub/me/privacy' });
};

const goAbout = () => {
  navTo({ url: '/pages-sub/me/about' });
};

const goHelp = () => {
  navTo({ url: '/pages-sub/me/help' });
};
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-section {
  margin-bottom: $nm-space-lg;
}

.nm-card {
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
  padding: 28rpx;
}

.nm-card__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 1rpx solid $nm-border;
}

.nm-row__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: $nm-space-sm;
}

.nm-row:last-child {
  border-bottom: none;
}

.nm-row__label {
  font-size: $nm-font-body;
  line-height: $nm-line-body;
  color: $nm-text-primary;
  flex: 1;
}

.nm-row__arrow {
  color: $nm-text-secondary;
  margin-left: auto;
  flex-shrink: 0;
}

.nm-help {
  padding: 24rpx 28rpx;
  border-radius: $nm-radius-lg;
  border: 1rpx solid $nm-border;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  margin-top: $nm-space-lg;
}

.nm-help__icon {
  margin-right: $nm-space-sm;
}

.nm-help__text {
  font-size: $nm-font-body;
  color: $nm-text-secondary;
}
</style>
