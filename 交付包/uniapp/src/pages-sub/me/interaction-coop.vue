<template>
  <Screen :safeTop="true">
    <AppHeader title="合作意向" />

    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view class="nm-card">
        <view class="nm-card__header">
          <view>
            <text class="nm-card__title">合作意向单</text>
            <text class="nm-card__subtitle">提交时间：{{ detail.time }}</text>
          </view>
          <view :class="['nm-pill', statusTone]">
            <text class="nm-pill__text">{{ detail.status }}</text>
          </view>
        </view>
        <text class="nm-card__desc">意向：{{ detail.intention }}</text>
        <view class="nm-meta-row">
          <text class="nm-meta__item">联系方式：{{ detail.contact }}</text>
          <text class="nm-meta__item">企业：{{ detail.company }}</text>
        </view>
      </view>

      <view class="nm-card">
        <text class="nm-section__title">处理进度</text>
        <view class="nm-steps">
          <view v-for="(step, index) in steps" :key="step.title" class="nm-step">
            <view :class="['nm-step__dot', index <= activeStep ? 'nm-step__dot--active' : '']" />
            <view class="nm-step__content">
              <text class="nm-step__title">{{ step.title }}</text>
              <text class="nm-step__desc">{{ step.desc }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="nm-card">
        <text class="nm-section__title">下一步</text>
        <text class="nm-card__desc">平台将安排对接人联系双方（占位）。</text>
      </view>

      <view class="nm-card">
        <text class="nm-section__title">可用操作</text>
        <view class="nm-actions">
          <view class="nm-action" @click="openChat">继续沟通</view>
          <view class="nm-action nm-action--ghost" @click="backToInbox">返回消息中心</view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navBack } from '@/utils/nav';
import { reactive, ref, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Screen, AppHeader } from '@/components';
import { InboxRepo } from '@/services/repos';
import { ACTION_STEPS, getActiveStep } from '@/services/constants/interaction';

const detail = reactive({
  intention: '采购有机蔬菜礼盒，长期合作。',
  contact: '微信 A12345',
  status: '企业已确认意向，等待进一步沟通。',
  time: '2024-12-05 11:40',
  company: '高山农场',
});

const refreshing = ref(false);

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  setTimeout(() => {
    refreshing.value = false;
  }, 300);
};

onLoad(async (query) => {
  if (query?.id) {
    const res = await InboxRepo.getById(String(query.id));
    if (res.ok && res.data) {
      detail.status = res.data.status || detail.status;
      detail.time = res.data.time || detail.time;
    }
  }
});

const steps = computed(() => ACTION_STEPS.coop);

const activeStep = computed(() => getActiveStep('coop', detail.status || '处理中'));

const statusTone = computed(() => {
  if (detail.status.includes('已达成') || detail.status.includes('已确认')) return 'nm-pill--brand';
  if (detail.status.includes('失败') || detail.status.includes('驳回')) return 'nm-pill--danger';
  return 'nm-pill--neutral';
});

const openChat = () => {
  uni.showToast({ title: '进入沟通（占位）', icon: 'none' });
};

const backToInbox = () => {
  navBack();
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
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
  margin-bottom: $nm-space-md;
}

.nm-card__header {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-card__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-card__subtitle {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-card__desc {
  margin-top: $nm-space-sm;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-section__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-meta-row {
  margin-top: $nm-space-sm;
  flex-direction: row;
  justify-content: space-between;
}

.nm-meta__item {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-steps {
  margin-top: $nm-space-sm;
}

.nm-step {
  flex-direction: row;
  align-items: flex-start;
  margin-bottom: $nm-space-sm;
}

.nm-step__dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
  margin-top: 6rpx;
}

.nm-step__dot--active {
  background-color: $nm-brand-primary;
}

.nm-step__content {
  margin-left: $nm-space-sm;
}

.nm-step__title {
  font-size: $nm-font-caption;
  color: $nm-text-primary;
}

.nm-step__desc {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-actions {
  margin-top: $nm-space-sm;
  flex-direction: row;
  justify-content: space-between;
}

.nm-action {
  flex: 1;
  padding: 14rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  text-align: center;
  font-size: $nm-font-caption;
}

.nm-action--ghost {
  margin-left: $nm-space-sm;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
  color: $nm-text-secondary;
}

.nm-pill {
  padding: 8rpx 20rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
}

.nm-pill__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-pill--brand {
  background-color: $nm-brand-primary-soft;
}

.nm-pill--brand .nm-pill__text {
  color: $nm-brand-primary;
}

.nm-pill--neutral {
  background-color: $nm-border;
}

.nm-pill--neutral .nm-pill__text {
  color: $nm-text-secondary;
}

.nm-pill--danger {
  background-color: rgba(192, 57, 43, 0.12);
}

.nm-pill--danger .nm-pill__text {
  color: $nm-danger;
}
</style>
