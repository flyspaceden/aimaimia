<template>
  <Screen :safeTop="true">
    <AppHeader title="AI 金融" />
    <scroll-view class="nm-page" scroll-y refresher-enabled :refresher-triggered="refreshing" @refresherrefresh="onRefresh">
      <view v-if="loading" class="nm-loading">
        <Skeleton :count="2" type="card" />
      </view>
      <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="fetchFinance" />
      <EmptyState v-else-if="offers.length === 0" text="暂无金融服务" hint="稍后再试或联系客服" />
      <view v-else>
        <view class="nm-card nm-card--hero">
          <view class="nm-icon">
            <Icon name="cash-multiple" :size="40" :color="textSecondary" />
          </view>
          <text class="nm-title">金融服务入口</text>
          <text class="nm-sub">额度评估、分期与保障服务的统一入口</text>
        </view>

        <view class="nm-section">
          <text class="nm-section__title">可用服务</text>
          <view v-for="offer in offers" :key="offer.id" class="nm-card nm-card--service">
            <view class="nm-card__row">
              <view class="nm-card__info">
                <text class="nm-card__title">{{ offer.title }}</text>
                <text class="nm-sub">{{ offer.desc }}</text>
              </view>
              <Tag :label="statusConfig[offer.status].label" :tone="statusConfig[offer.status].tone" />
            </view>
            <view class="nm-card__footer">
              <text class="nm-badge">{{ offer.badge || 'AI 风控评估' }}</text>
              <view :class="['nm-action', `nm-action--${offer.status}`]" @click="applyOffer(offer)">
                {{ statusConfig[offer.status].cta }}
              </view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Screen, AppHeader, Skeleton, ErrorState, EmptyState, Tag, Icon } from '@/components';
import { AiFeatureRepo, type FinanceOffer } from '@/services/repos';

const textSecondary = '#4B5B53';
type DisplayOffer = FinanceOffer & { badge?: string };
const offers = ref<DisplayOffer[]>([]);
const loading = ref(true);
const refreshing = ref(false);
const errorMessage = ref('');

const statusConfig: Record<FinanceOffer['status'], { label: string; tone: 'brand' | 'accent' | 'neutral'; cta: string }> = {
  available: { label: '可申请', tone: 'brand', cta: '立即申请' },
  soon: { label: '即将上线', tone: 'accent', cta: '预约提醒' },
  locked: { label: '需认证', tone: 'neutral', cta: '了解门槛' },
};

const fetchFinance = async () => {
  loading.value = true;
  const res = await AiFeatureRepo.getFinanceOverview();
  if (res.ok) {
    offers.value = res.data.offers.map((item) => ({
      ...item,
      badge: item.status === 'available' ? '额度已评估' : item.status === 'soon' ? '即将开放' : '需完成认证',
    }));
    errorMessage.value = '';
  } else {
    errorMessage.value = res.error.message || '加载失败';
  }
  loading.value = false;
  if (refreshing.value) refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  fetchFinance();
};

const applyOffer = (offer: FinanceOffer) => {
  const config = statusConfig[offer.status];
  uni.showToast({ title: `${offer.title} ${config.cta}`, icon: offer.status === 'available' ? 'success' : 'none' });
};

fetchFinance();
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-loading {
  padding: $nm-space-xl 0;
}

.nm-card {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid transparent;
  box-shadow: $nm-shadow-sm;
}

.nm-icon {
  width: 80rpx;
  height: 80rpx;
  border-radius: $nm-radius-md;
  align-items: center;
  justify-content: center;
  background-color: $nm-skeleton;
}

.nm-title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
  margin-top: $nm-space-sm;
}

.nm-sub {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  line-height: 1.6;
}

.nm-section {
  margin-top: $nm-space-lg;
}

.nm-section__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
  margin-bottom: 0;
}

.nm-card__row {
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-start;
}

.nm-card__info {
  flex: 1;
  margin-right: $nm-space-sm;
}

.nm-card__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-card__footer {
  margin-top: 24rpx;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-badge {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-action {
  margin-top: 0;
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  align-self: flex-start;
}

.nm-action--available {
  border-color: $nm-brand-primary;
  color: $nm-brand-primary;
}

.nm-action--soon {
  border-color: $nm-accent-blue;
  color: $nm-accent-blue;
}

.nm-action--locked {
  border-color: $nm-border;
  color: $nm-text-secondary;
}

.nm-card--hero {
  margin-bottom: 0;
}

.nm-card--service {
  padding: 28rpx;
  margin-top: 24rpx;
}
</style>
