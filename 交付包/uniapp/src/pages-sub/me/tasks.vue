<template>
  <Screen :safeTop="true">
    <AppHeader title="我的任务" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view class="nm-summary">
        <text class="nm-summary__title">任务概览</text>
        <view class="nm-summary__row">
          <view class="nm-summary__item">
            <text class="nm-summary__label">总任务</text>
            <text class="nm-summary__value">{{ stats.total }}</text>
          </view>
          <view class="nm-summary__item">
            <text class="nm-summary__label">已完成</text>
            <text class="nm-summary__value">{{ stats.done }}</text>
          </view>
          <view class="nm-summary__item">
            <text class="nm-summary__label">待完成</text>
            <text class="nm-summary__value">{{ stats.pending }}</text>
          </view>
        </view>
        <text class="nm-summary__hint">完成任务可获得成长值/积分奖励，解锁头像框与等级</text>
      </view>

      <view class="nm-section">
        <text class="nm-section__title">任务列表</text>
        <view v-if="loading" class="nm-loading">
          <Skeleton :count="2" type="card" />
        </view>
        <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="fetchTasks" />
        <view v-else-if="tasks.length === 0" class="nm-loading">
          <EmptyState text="暂无任务" />
        </view>
        <view v-else class="nm-list">
          <view v-for="task in tasks" :key="task.id" class="nm-task" @click="goTask(task)">
            <view class="nm-task__row">
              <view class="nm-task__info">
                <text class="nm-task__title">{{ task.title }}</text>
                <text class="nm-task__desc">{{ task.rewardLabel }}</text>
              </view>
              <Tag :label="statusLabel(task)" :tone="statusTone(task)" />
            </view>
            <view
              :class="['nm-task__action', task.status === 'done' ? 'nm-task__action--done' : '']"
              @click.stop="completeTask(task)"
            >
              {{ task.status === 'done' ? '查看' : '立即去完成' }}
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { ref, computed } from 'vue';
import { Screen, AppHeader, Skeleton, ErrorState, EmptyState, Tag } from '@/components';
import { TaskRepo, UserRepo, type TaskItem } from '@/services/repos';

const tasks = ref<TaskItem[]>([]);
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');

const stats = computed(() => {
  const done = tasks.value.filter((task) => task.status === 'done').length;
  return {
    total: tasks.value.length,
    done,
    pending: Math.max(0, tasks.value.length - done),
  };
});

const statusLabel = (task: TaskItem) => {
  if (task.status === 'done') return '已完成';
  if (task.status === 'inProgress') return '进行中';
  return '去完成';
};

const statusTone = (task: TaskItem) => {
  if (task.status === 'done') return 'brand';
  if (task.status === 'inProgress') return 'accent';
  return 'neutral';
};

const fetchTasks = async () => {
  loading.value = true;
  const res = await TaskRepo.list();
  if (res.ok) {
    errorMessage.value = '';
    tasks.value = res.data;
  } else {
    errorMessage.value = res.error.message || '加载失败';
  }
  loading.value = false;
};

const onRefresh = async () => {
  if (refreshing.value) return;
  refreshing.value = true;
  await fetchTasks();
  refreshing.value = false;
};

const goTask = (task: TaskItem) => {
  if (task.targetRoute) {
    navTo({ url: task.targetRoute });
  }
};

const completeTask = async (task: TaskItem) => {
  if (task.status === 'done') {
    uni.showToast({ title: '任务已完成', icon: 'none' });
    return;
  }
  const res = await TaskRepo.complete(task.id);
  if (!res.ok) {
    uni.showToast({ title: res.error.message || '任务更新失败', icon: 'none' });
    return;
  }
  await UserRepo.applyRewards({ points: task.rewardPoints || 0, growthPoints: task.rewardGrowth || 0 });
  await fetchTasks();
  uni.showToast({ title: `任务已完成，${task.rewardLabel}`, icon: 'success' });
};

fetchTasks();
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-summary {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
}

.nm-summary__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-summary__row {
  margin-top: 24rpx;
  flex-direction: row;
  justify-content: space-between;
}

.nm-summary__item {
  flex: 1;
  align-items: center;
}

.nm-summary__label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-summary__value {
  margin-top: 0;
  font-size: $nm-font-title3;
  color: $nm-text-primary;
}

.nm-summary__hint {
  margin-top: $nm-space-sm;
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

.nm-loading {
  margin-top: $nm-space-md;
}

.nm-list {
  margin-top: $nm-space-md;
}

.nm-task {
  margin-bottom: 24rpx;
  padding: 28rpx;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
}

.nm-task__row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-task__info {
  flex: 1;
  margin-right: $nm-space-sm;
}

.nm-task__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-task__desc {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-task__action {
  margin-top: 20rpx;
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-brand-primary;
  background-color: $nm-brand-primary-soft;
  color: $nm-brand-primary;
  text-align: center;
  font-size: $nm-font-caption;
}

.nm-task__action--done {
  border-color: $nm-border;
  background-color: $nm-surface;
  color: $nm-text-secondary;
}
</style>
