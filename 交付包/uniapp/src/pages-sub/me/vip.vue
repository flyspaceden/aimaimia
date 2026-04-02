<template>
  <Screen :safeTop="true">
    <AppHeader title="会员权益" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view v-if="loading" class="nm-loading">
        <Skeleton :count="2" type="card" />
      </view>
      <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="fetchProfile" />
      <view v-else-if="!profile" class="nm-loading">
        <EmptyState text="暂无会员信息" hint="请稍后再试" />
      </view>
      <view v-else>
        <view class="nm-hero">
          <view class="nm-hero__row">
            <view>
              <text class="nm-hero__title">{{ profile.level }}</text>
              <text class="nm-hero__meta">成长值 {{ profile.growthPoints }} / {{ profile.nextLevelPoints }}</text>
            </view>
            <Tag label="会员体系" tone="accent" />
          </view>
          <view class="nm-progress">
            <view class="nm-progress__track">
              <view class="nm-progress__fill" :style="{ width: `${Math.min(100, profile.levelProgress * 100)}%` }" />
            </view>
          </view>
          <text class="nm-hero__hint">
            {{ nextTierLabel }}
          </text>
          <view class="nm-hero__action" @click="showRules">成长值规则</view>
        </view>

        <view class="nm-section">
          <text class="nm-section__title">等级权益</text>
          <view
            v-for="(tier, index) in tiers"
            :key="tier.id"
            :class="['nm-tier', tier.id === profile.level ? 'nm-tier--active' : '']"
          >
            <view class="nm-tier__header">
              <text class="nm-tier__title">{{ tier.label }}</text>
              <Tag :label="tier.id === profile.level ? '当前等级' : `Lv.${index + 1}`" :tone="tier.id === profile.level ? 'brand' : 'neutral'" />
            </view>
            <view class="nm-tier__perks">
              <view v-for="perk in tier.perks" :key="perk" class="nm-perk">
                <text class="nm-perk__text">{{ perk }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Screen, AppHeader, Skeleton, ErrorState, EmptyState, Tag } from '@/components';
import { UserRepo, type UserProfile } from '@/services/repos';

const profile = ref<UserProfile | null>(null);
const loading = ref(true);
const refreshing = ref(false);
const errorMessage = ref('');

const tiers = [
  { id: '种子会员', label: '种子会员', perks: ['运费减免', '会员价', '专属内容'] },
  { id: '生长会员', label: '生长会员', perks: ['更高折扣', '生日礼包', '优先客服', '活动名额'] },
  { id: '丰收会员', label: '丰收会员', perks: ['全年免邮', '新品尝鲜', '一对一顾问', '年度礼盒'] },
];

const nextTierLabel = computed(() => {
  if (!profile.value) return '';
  const currentIndex = tiers.findIndex((tier) => tier.id === profile.value?.level);
  const nextTier = currentIndex >= 0 && currentIndex < tiers.length - 1 ? tiers[currentIndex + 1] : null;
  if (!nextTier) return '已达最高等级';
  return `距离 ${nextTier.label} 还差 ${Math.max(0, profile.value.nextLevelPoints - profile.value.growthPoints)} 成长值`;
});

const fetchProfile = async () => {
  loading.value = true;
  const res = await UserRepo.profile();
  if (res.ok) {
    errorMessage.value = '';
    profile.value = res.data;
  } else {
    errorMessage.value = res.error.message || '加载失败';
  }
  loading.value = false;
};

const onRefresh = async () => {
  if (refreshing.value) return;
  refreshing.value = true;
  await fetchProfile();
  refreshing.value = false;
};

const showRules = () => {
  uni.showToast({ title: '成长值来源：消费 / 互动 / 创作（占位）', icon: 'none' });
};

fetchProfile();
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

.nm-hero {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
}

.nm-hero__row {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-hero__title {
  font-size: $nm-font-title2;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-hero__meta {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-progress {
  margin-top: 24rpx;
}

.nm-progress__track {
  height: 12rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
  overflow: hidden;
}

.nm-progress__fill {
  height: 100%;
  background-color: $nm-brand-primary;
}

.nm-hero__hint {
  margin-top: 16rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-hero__action {
  margin-top: 20rpx;
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  align-self: flex-start;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-section {
  margin-top: $nm-space-lg;
}

.nm-section__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-tier {
  margin-top: 24rpx;
  padding: 28rpx;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
}

.nm-tier--active {
  border-color: $nm-brand-primary;
}

.nm-tier__header {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-tier__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-tier__perks {
  margin-top: $nm-space-sm;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-perk {
  padding: 8rpx 20rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
  margin-right: 8rpx;
  margin-bottom: 8rpx;
}

.nm-perk__text {
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
}
</style>
