<template>
  <Screen :safeTop="true">
    <AppHeader title="草稿箱" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <Skeleton v-if="loading && drafts.length === 0" :count="2" type="card" class="nm-skeleton-wrap" />
      <view v-else-if="errorMessage" class="nm-state">
        <ErrorState :text="errorMessage" @retry="onRefresh" />
      </view>
      <view v-else-if="!loading && drafts.length === 0" class="nm-state">
        <EmptyState text="暂无草稿" hint="去发布页保存第一条草稿吧" />
      </view>
      <view v-else>
        <view v-for="draft in drafts" :key="draft.id" class="nm-card" @click="openDraft(draft.id)">
          <view class="nm-row">
            <image v-if="draft.images.length" class="nm-cover" :src="draft.images[0]" mode="aspectFill" />
            <view v-else class="nm-cover nm-cover--empty" />
            <view class="nm-body">
              <view class="nm-row nm-row--between">
              <text class="nm-title" number-of-lines="1">{{ draft.title || '未命名草稿' }}</text>
                <view class="nm-delete" @click.stop="removeDraft(draft.id)">
                  <Icon name="trash-can-outline" :size="36" :color="textSecondary" />
                </view>
              </view>
              <text class="nm-sub" number-of-lines="2">{{ draft.content || '暂无内容' }}</text>
              <view class="nm-meta">
                <view class="nm-chip">
                  <text class="nm-chip__text">{{ templateLabels[draft.template] || '自定义' }}</text>
                </view>
                <text class="nm-meta__time">{{ draft.updatedAt }}</text>
              </view>
            </view>
          </view>
          <view class="nm-footer">
            <text class="nm-footer__text">图片 {{ draft.images.length }} · 标签 {{ draft.tags.length }}</text>
            <text class="nm-footer__link">继续编辑</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Screen, AppHeader, EmptyState, ErrorState, Skeleton, Icon } from '@/components';
import { DraftRepo, type Draft } from '@/services/repos';
import { useToast } from '@/components/feedback/useToast';

const textSecondary = '#4B5B53';
const toast = useToast();
const drafts = ref<Draft[]>([]);
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');
const templateLabels: Record<Draft['template'], string> = {
  story: '产品故事',
  diary: '种植日志',
  recipe: '食谱教程',
  general: '随手记录',
};

const fetchDrafts = async () => {
  loading.value = true;
  const res = await DraftRepo.list({ page: 1, pageSize: 20 });
  if (res.ok) {
    drafts.value = res.data.items;
    errorMessage.value = '';
  } else {
    errorMessage.value = res.error.message || '草稿加载失败';
  }
  loading.value = false;
  refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  fetchDrafts();
};

const openDraft = (id: string) => {
  navTo({ url: `/pages-sub/circle/post-create?draftId=${id}` });
};

const removeDraft = async (id: string) => {
  const res = await DraftRepo.remove(id);
  if (!res.ok) {
    toast.show({ message: res.error.message || '删除失败', type: 'error' });
    return;
  }
  toast.show({ message: '已删除草稿', type: 'success' });
  fetchDrafts();
};

onLoad(() => {
  fetchDrafts();
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

.nm-row {
  flex-direction: row;
  align-items: flex-start;
}

.nm-row--between {
  justify-content: space-between;
  align-items: center;
}

.nm-cover {
  width: 172rpx;
  height: 172rpx;
  border-radius: $nm-radius-md;
  background-color: transparent;
  flex-shrink: 0;
}

.nm-cover--empty {
  background-color: $nm-brand-primary-soft;
}

.nm-body {
  flex: 1;
  margin-left: $nm-space-md;
}

.nm-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-delete {
  padding: 8rpx;
  flex-direction: row;
  align-items: center;
  justify-content: center;
}

.nm-sub {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-meta {
  margin-top: $nm-space-sm;
  flex-direction: row;
  align-items: center;
}

.nm-chip {
  padding: 8rpx 16rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
}

.nm-chip__text {
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
}

.nm-meta__time {
  margin-left: $nm-space-sm;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-footer {
  margin-top: $nm-space-md;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-footer__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-footer__link {
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-skeleton-wrap {
  margin-top: $nm-space-md;
}

.nm-state {
  margin-top: $nm-space-md;
}
</style>
