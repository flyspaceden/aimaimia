<template>
  <Screen :safeTop="true">
    <AppHeader title="榜单与贡献值" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <text class="nm-note">贡献值榜单（占位）</text>

      <Skeleton v-if="loading" :count="2" type="card" class="nm-skeleton" />
      <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="onRefresh" />
      <view v-else-if="ranks.length === 0" class="nm-empty">
        <EmptyState text="暂无榜单数据" hint="贡献值将用于激励优质创作者" />
      </view>
      <view v-else>
        <view v-for="(item, index) in ranks" :key="item.id" class="nm-row">
          <text class="nm-rank">{{ index + 1 }}</text>
          <image v-if="item.avatar" class="nm-avatar" :src="item.avatar" mode="aspectFill" />
          <view v-else class="nm-avatar nm-avatar--empty" />
          <view class="nm-info">
            <text class="nm-title" number-of-lines="1">{{ item.name }}</text>
            <text class="nm-meta">{{ item.role === 'company' ? '企业' : '用户' }} · {{ item.badge || '贡献值' }}</text>
          </view>
          <view class="nm-score">
            <text class="nm-score__value">{{ item.score }}</text>
            <text class="nm-score__label">贡献值</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Screen, AppHeader, EmptyState, ErrorState, Skeleton } from '@/components';
import { ContentOpsRepo, type ContributionRankItem } from '@/services/repos';

const ranks = ref<ContributionRankItem[]>([]);
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');

const fetchRanks = async () => {
  loading.value = true;
  const res = await ContentOpsRepo.listContributionRankings();
  if (res.ok) {
    ranks.value = res.data;
    errorMessage.value = '';
  } else {
    errorMessage.value = res.error.message || '加载失败';
  }
  loading.value = false;
  refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  fetchRanks();
};

onMounted(() => {
  fetchRanks();
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-note {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-row {
  flex-direction: row;
  align-items: center;
  padding: $nm-space-md 0;
  border-bottom: 1rpx solid $nm-border;
}

.nm-rank {
  width: 48rpx;
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: $nm-radius-pill;
  margin-left: 12rpx;
  margin-right: 20rpx;
}

.nm-avatar--empty {
  background-color: $nm-brand-primary-soft;
}

.nm-info {
  flex: 1;
}

.nm-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-meta {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-score {
  align-items: flex-end;
}

.nm-score__value {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-score__label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-skeleton {
  margin-top: $nm-space-md;
}

.nm-empty {
  margin-top: $nm-space-md;
}
</style>
