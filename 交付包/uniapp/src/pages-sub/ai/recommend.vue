<template>
  <Screen :safeTop="true">
    <AppHeader title="AI 推荐" />
    <scroll-view class="nm-page" scroll-y refresher-enabled :refresher-triggered="refreshing" @refresherrefresh="onRefresh">
      <view v-if="loading" class="nm-loading">
        <Skeleton :count="2" type="card" />
      </view>
      <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="fetchInsights" />
      <EmptyState v-else-if="insights.length === 0" text="暂无推荐画像" hint="稍后再试或完善偏好" />
      <view v-else>
        <view class="nm-card">
          <view class="nm-icon">
            <Icon name="brain" :size="40" :color="brandPrimary" />
          </view>
          <text class="nm-title">AI 推荐画像</text>
          <text class="nm-sub">基于浏览、收藏与互动构建的偏好标签</text>
          <view class="nm-tag-row">
            <Tag v-for="tag in topTags" :key="tag" :label="tag" tone="accent" class="nm-tag" />
          </view>
          <view class="nm-action" @click="goSearch">查看推荐商品</view>
        </view>

        <view class="nm-section">
          <text class="nm-section__title">推荐理由</text>
          <view v-for="item in insights" :key="item.id" class="nm-card nm-card--reason">
            <view class="nm-card__row">
              <text class="nm-card__title">{{ item.title }}</text>
              <text class="nm-card__weight">权重 {{ Math.round(item.weight * 100) }}%</text>
            </view>
            <text class="nm-sub">{{ item.description }}</text>
            <view class="nm-tag-row">
              <Tag v-for="tag in item.tags" :key="`${item.id}-${tag}`" :label="tag" tone="brand" class="nm-tag" />
            </view>
          </view>
        </view>

        <view class="nm-section">
          <text class="nm-section__title">推荐策略</text>
          <view class="nm-card">
            <text class="nm-sub">当前策略：健康轻食优先 / 附近产地加权 / 认证标签加分</text>
            <view class="nm-action nm-action--ghost" @click="optimizeStrategy">一键优化策略</view>
          </view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { computed, ref } from 'vue';
import { Screen, AppHeader, Skeleton, ErrorState, EmptyState, Tag, Icon } from '@/components';
import { AiFeatureRepo, type RecommendInsight } from '@/services/repos';

const brandPrimary = '#2F8F4E';
const insights = ref<RecommendInsight[]>([]);
const loading = ref(true);
const refreshing = ref(false);
const errorMessage = ref('');

const topTags = computed(() => {
  const tags = insights.value.flatMap((item) => item.tags);
  return tags.filter((tag, index) => tags.indexOf(tag) === index).slice(0, 6);
});

const fetchInsights = async () => {
  loading.value = true;
  const res = await AiFeatureRepo.getRecommendInsights();
  if (res.ok) {
    insights.value = res.data;
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
  fetchInsights();
};

const goSearch = () => {
  navTo({ url: '/pages-sub/common/search' });
};

const optimizeStrategy = () => {
  uni.showToast({ title: '推荐策略已更新', icon: 'success' });
};

fetchInsights();
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
  background-color: $nm-brand-primary-soft;
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

.nm-tag-row {
  margin-top: 20rpx;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-tag {
  margin-right: 12rpx;
  margin-bottom: 12rpx;
}

.nm-action {
  margin-top: 24rpx;
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-brand-primary;
  color: $nm-brand-primary;
  font-size: $nm-font-caption;
  align-self: flex-start;
}

.nm-action--ghost {
  border-color: $nm-border;
  color: $nm-text-secondary;
}

.nm-action--ghost {
  border-color: $nm-border;
  color: $nm-text-secondary;
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
  align-items: center;
}

.nm-card--reason {
  padding: 28rpx;
  margin-top: 24rpx;
}

.nm-card__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-card__weight {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}
</style>
