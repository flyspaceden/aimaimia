<template>
  <Screen :safeTop="true">
    <AppHeader title="帮助与反馈" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view class="nm-card">
        <text class="nm-title">常见问题</text>
        <view class="nm-row" @click="showInfo('订单问题说明待接入')">
          <view>
            <text class="nm-row__label">订单相关</text>
            <text class="nm-row__desc">支付失败/订单异常/订单查询</text>
          </view>
          <Icon class="nm-row__arrow" name="chevron-right" :size="36" :color="textSecondary" />
        </view>
        <view class="nm-row" @click="showInfo('售后规则说明待接入')">
          <view>
            <text class="nm-row__label">售后与退款</text>
            <text class="nm-row__desc">退款流程、售后进度与注意事项</text>
          </view>
          <Icon class="nm-row__arrow" name="chevron-right" :size="36" :color="textSecondary" />
        </view>
        <view class="nm-row" @click="showInfo('账号问题说明待接入')">
          <view>
            <text class="nm-row__label">账号与安全</text>
            <text class="nm-row__desc">登录异常、隐私设置、账号保护</text>
          </view>
          <Icon class="nm-row__arrow" name="chevron-right" :size="36" :color="textSecondary" />
        </view>
      </view>

      <view class="nm-card">
        <text class="nm-title">意见反馈</text>
        <text class="nm-sub">后续接入反馈表单、图片上传与处理进度。</text>
        <view class="nm-actions">
          <view class="nm-action" @click="showInfo('反馈表单待接入')">提交反馈</view>
          <view class="nm-action nm-action--ghost" @click="showInfo('反馈记录待接入')">反馈记录</view>
        </view>
      </view>

      <view class="nm-card">
        <text class="nm-title">联系客服</text>
        <view class="nm-row" @click="showInfo('在线客服待接入')">
          <text class="nm-row__label">在线客服</text>
          <Icon class="nm-row__arrow" name="chevron-right" :size="36" :color="textSecondary" />
        </view>
        <view class="nm-row" @click="showInfo('客服电话待接入')">
          <text class="nm-row__label">客服电话 400-000-0000</text>
          <Icon class="nm-row__arrow" name="chevron-right" :size="36" :color="textSecondary" />
        </view>
        <view class="nm-row" @click="showInfo('微信客服待接入')">
          <text class="nm-row__label">微信客服：农脉客服</text>
          <Icon class="nm-row__arrow" name="chevron-right" :size="36" :color="textSecondary" />
        </view>
        <text class="nm-sub">服务时间：工作日 9:00-18:00</text>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
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
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-card {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid transparent;
  box-shadow: $nm-shadow-sm;
  margin-bottom: $nm-space-md;
}

.nm-title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-sub {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  line-height: 1.6;
}

.nm-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: $nm-space-md 0;
  border-bottom: 1rpx solid $nm-border;
}

.nm-row:last-child {
  border-bottom: none;
}

.nm-row__label {
  font-size: $nm-font-body;
  line-height: $nm-line-body;
  color: $nm-text-primary;
}

.nm-row__desc {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  line-height: $nm-line-caption;
  color: $nm-text-secondary;
}

.nm-row__arrow {
}

.nm-actions {
  margin-top: 24rpx;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
}

.nm-action {
  flex: 1;
  padding: 20rpx 0;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  text-align: center;
  font-size: $nm-font-caption;
  font-weight: 600;
}

.nm-action--ghost {
  margin-left: $nm-space-sm;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
  color: $nm-text-secondary;
}
</style>
