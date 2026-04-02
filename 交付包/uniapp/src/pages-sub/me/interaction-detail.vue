<template>
  <Screen :safeTop="true">
    <AppHeader title="互动详情" />

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
            <text class="nm-card__title">{{ detail.title }}</text>
            <text class="nm-card__subtitle">类型：{{ actionLabel }}</text>
          </view>
          <view :class="['nm-pill', statusTone]">
            <text class="nm-pill__text">{{ detail.status || '处理中' }}</text>
          </view>
        </view>
        <text class="nm-card__desc">{{ detail.desc }}</text>
        <view class="nm-card__meta">
          <text class="nm-card__meta-text">类型：{{ detail.type }}</text>
          <text class="nm-card__meta-text">时间：{{ detail.time }}</text>
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
        <text class="nm-section__title">互动类型信息</text>
        <view class="nm-info">
          <text class="nm-info__label">类型</text>
          <text class="nm-info__value">{{ actionLabel }}</text>
        </view>
        <view class="nm-info">
          <text class="nm-info__label">说明</text>
          <text class="nm-info__value">{{ actionDesc }}</text>
        </view>
      </view>

      <view class="nm-card">
        <text class="nm-section__title">结果回执</text>
        <text class="nm-result__title">{{ resultTitle }}</text>
        <text class="nm-result__desc">{{ resultDesc }}</text>
        <view v-if="resultActionLabel" class="nm-result__action" @click="handleAction">{{ resultActionLabel }}</view>
        <view v-if="detail.actionType === 'expert'" class="nm-result__extra">
          <text class="nm-result__extra-title">专家回复（占位）</text>
          <text class="nm-result__extra-desc">建议先关注温室湿度与光照，适当调整采收时间。</text>
          <view class="nm-result__link" @click="goExpertDetail">查看完整回复</view>
        </view>
        <view v-else-if="detail.actionType === 'reward'" class="nm-result__extra">
          <text class="nm-result__extra-title">打赏记录（占位）</text>
          <text class="nm-result__extra-desc">金额：¥{{ rewardAmount }} · 订单号：RWD-{{ detail.id }}</text>
          <view class="nm-result__link" @click="goRewardDetail">查看记录</view>
        </view>
        <view v-else-if="detail.actionType === 'coop'" class="nm-result__extra">
          <text class="nm-result__extra-title">合作进展（占位）</text>
          <text class="nm-result__extra-desc">企业已确认意向，等待进一步沟通。</text>
          <view class="nm-result__link" @click="goCoopDetail">查看详情</view>
        </view>
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
import { navTo, navBack } from '@/utils/nav';
import { reactive, computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Screen, AppHeader } from '@/components';
import { InboxRepo } from '@/services/repos';
import {
  ACTION_DESCS,
  ACTION_LABELS,
  ACTION_STEPS,
  getActiveStep,
  getResultActionLabel,
  getResultDesc,
  getResultTitle,
  type InteractionAction,
} from '@/services/constants/interaction';

const detail = reactive({
  id: '',
  title: '互动记录',
  desc: '等待处理中',
  time: '刚刚',
  type: '互动',
  status: '',
  actionType: 'system' as InteractionAction,
});

const refreshing = ref(false);

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  setTimeout(() => {
    refreshing.value = false;
  }, 300);
};

const isAction = (value: string): value is InteractionAction => {
  return Object.prototype.hasOwnProperty.call(ACTION_LABELS, value);
};

const actionLabel = computed(() => {
  return ACTION_LABELS[detail.actionType];
});

const actionDesc = computed(() => {
  return ACTION_DESCS[detail.actionType];
});

const steps = computed(() => {
  return ACTION_STEPS[detail.actionType];
});

const activeStep = computed(() => {
  return getActiveStep(detail.actionType, detail.status || '');
});

const statusTone = computed(() => {
  const status = detail.status || '处理中';
  if (status.includes('已完成') || status.includes('已回复') || status.includes('已达成')) {
    return 'nm-pill--brand';
  }
  if (status.includes('失败') || status.includes('驳回')) {
    return 'nm-pill--danger';
  }
  return 'nm-pill--neutral';
});

const resultTitle = computed(() => {
  return getResultTitle(detail.actionType, detail.status || '');
});

const resultDesc = computed(() => {
  return getResultDesc(detail.actionType);
});

const resultActionLabel = computed(() => {
  return getResultActionLabel(detail.actionType);
});

const handleAction = () => {
  if (detail.actionType === 'group') {
    navTo({ url: '/pages-sub/order/checkout?source=group' });
    return;
  }
  if (detail.actionType === 'reward') {
    navTo({ url: '/pages-sub/order/orders' });
    return;
  }
  if (detail.actionType === 'expert') {
    goExpertDetail();
  }
};

const rewardAmount = computed(() => '20');

const goExpertDetail = () => {
  navTo({ url: `/pages-sub/me/interaction-expert?id=${detail.id}` });
};

const goRewardDetail = () => {
  navTo({ url: `/pages-sub/me/interaction-reward?id=${detail.id}` });
};

const goCoopDetail = () => {
  navTo({ url: `/pages-sub/me/interaction-coop?id=${detail.id}` });
};

const openChat = () => {
  uni.showToast({ title: '进入沟通（占位）', icon: 'none' });
};

const backToInbox = () => {
  navBack();
};

onLoad(async (query) => {
  if (query?.id) {
    const res = await InboxRepo.getById(String(query.id));
    if (res.ok && res.data) {
      detail.id = res.data.id;
      detail.title = res.data.title;
      detail.desc = res.data.desc;
      detail.time = res.data.time;
      detail.type = res.data.type;
      detail.status = res.data.status || '';
      detail.actionType = res.data.actionType ? res.data.actionType : 'system';
      return;
    }
  }
  if (query?.title) detail.title = decodeURIComponent(String(query.title));
  if (query?.desc) detail.desc = decodeURIComponent(String(query.desc));
  if (query?.time) detail.time = decodeURIComponent(String(query.time));
  if (query?.type) detail.type = decodeURIComponent(String(query.type));
  if (query?.status) detail.status = decodeURIComponent(String(query.status));
  if (query?.actionType) {
    const action = decodeURIComponent(String(query.actionType));
    if (isAction(action)) detail.actionType = action;
  }
});
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
  align-items: center;
  justify-content: space-between;
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
  font-size: $nm-font-body;
  color: $nm-text-secondary;
}

.nm-card__meta {
  margin-top: $nm-space-sm;
  flex-direction: row;
  justify-content: space-between;
}

.nm-card__meta-text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-section__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
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

.nm-info {
  margin-top: $nm-space-sm;
  flex-direction: row;
  justify-content: space-between;
}

.nm-info__label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-info__value {
  font-size: $nm-font-caption;
  color: $nm-text-primary;
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

.nm-result__title {
  margin-top: $nm-space-sm;
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-result__desc {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-result__action {
  margin-top: $nm-space-sm;
  padding: 12rpx 20rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  font-size: $nm-font-caption;
  text-align: center;
}

.nm-result__extra {
  margin-top: $nm-space-md;
  padding: $nm-space-md;
  border-radius: $nm-radius-md;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
}

.nm-result__extra-title {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-result__extra-desc {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-text-primary;
}

.nm-result__link {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}
</style>
