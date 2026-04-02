<template>
  <Screen :safeTop="true">
    <AppHeader title="精华专区" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <text class="nm-note">精选内容合集（占位）</text>

      <view v-if="loading" class="nm-state">
        <Skeleton :count="1" type="card" :height="440" />
        <view class="nm-skeleton__gap" />
        <Skeleton :count="1" type="card" :height="440" />
      </view>
      <view v-else-if="errorMessage" class="nm-state">
        <ErrorState :text="errorMessage" @retry="onRefresh" />
      </view>
      <view v-else-if="posts.length === 0" class="nm-state">
        <EmptyState text="暂无精华内容" hint="优质内容会出现在这里" />
      </view>
      <view v-else>
        <view v-for="post in posts" :key="post.id" class="nm-item">
          <PostCard
            :item="post"
            :currentUserId="currentUserId"
            @press="openPost"
          />
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { onMounted, ref } from 'vue';
import { Screen, AppHeader, EmptyState, ErrorState, Skeleton } from '@/components';
import PostCard from '@/components/cards/PostCard.vue';
import { ContentOpsRepo, type Post } from '@/services/repos';

const posts = ref<Post[]>([]);
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');
const currentUserId = 'u_mock';

const fetchPosts = async () => {
  loading.value = true;
  const res = await ContentOpsRepo.listFeaturedPosts();
  if (res.ok) {
    posts.value = res.data;
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
  fetchPosts();
};

const openPost = (post: Post) => {
  navTo({ url: `/pages-sub/circle/post-detail?id=${post.id}` });
};

onMounted(() => {
  fetchPosts();
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
  margin-bottom: 0;
}

.nm-item {
  margin-top: $nm-space-md;
}

.nm-state {
  margin-top: $nm-space-md;
}

.nm-skeleton__gap {
  height: $nm-space-md;
}
</style>
