<template>
  <Screen :safeTop="true">
    <AppHeader title="头像框与装扮" />
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
        <EmptyState text="暂无资料" />
      </view>
      <view v-else>
        <view class="nm-preview">
          <view class="nm-preview__center">
            <AvatarFrame :uri="selectedAvatar || profile.avatar" :frame="selectedFrame" :size="92" />
            <text class="nm-preview__name">{{ profile.name }}</text>
            <text class="nm-preview__hint">预览头像框效果（占位）</text>
            <view v-if="selectedFrame?.expireAt" class="nm-preview__tag">
              <Tag :label="`有效期至 ${selectedFrame.expireAt}`" tone="neutral" />
            </view>
          </view>
        </view>

        <view class="nm-section">
          <text class="nm-section__title">选择头像</text>
          <view class="nm-avatar-row">
            <view
              v-for="avatar in avatarOptions"
              :key="avatar"
              :class="['nm-avatar-option', selectedAvatar === avatar ? 'nm-avatar-option--active' : '']"
              @click="selectedAvatar = avatar"
            >
              <AvatarFrame :uri="avatar" :frame="selectedAvatar === avatar ? selectedFrame : null" :size="54" />
              <text
                :class="['nm-avatar-option__text', selectedAvatar === avatar ? 'nm-avatar-option__text--active' : '']"
              >{{ selectedAvatar === avatar ? '已选' : '选择' }}</text>
            </view>
          </view>
          <text class="nm-section__hint">当前为前端占位头像库，后续可接入上传/拍照能力</text>
        </view>

        <view class="nm-section">
          <text class="nm-section__title">选择头像框</text>
          <view class="nm-frame-list">
            <view
              v-for="option in frameOptions"
              :key="option.id"
              :class="['nm-frame-row', selectedFrameId === option.id ? 'nm-frame-row--active' : '']"
              @click="selectedFrameId = option.id"
            >
              <AvatarFrame :uri="profile.avatar" :frame="option.frame" :size="56" />
              <view class="nm-frame-info">
                <text class="nm-frame-title">{{ option.label }}</text>
                <text class="nm-frame-hint">{{ option.hint }}</text>
              </view>
              <Tag v-if="selectedFrameId === option.id" label="已选" tone="brand" />
              <text v-else class="nm-frame-select">选择</text>
            </view>
          </view>
        </view>

        <view class="nm-primary" @click="saveAppearance">保存（占位）</view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Screen, AppHeader, Skeleton, ErrorState, EmptyState, AvatarFrame, Tag } from '@/components';
import { UserRepo, type UserProfile } from '@/services/repos';

const loading = ref(true);
const refreshing = ref(false);
const errorMessage = ref('');
const profile = ref<UserProfile | null>(null);

type FrameOption = {
  id: string;
  label: string;
  frame: { id: string; type: 'vip' | 'task' | 'limited'; expireAt?: string } | null;
  hint: string;
};

const frameOptions: FrameOption[] = [
  { id: 'default', label: '默认', frame: null, hint: '所有用户可用' },
  { id: 'vip', label: 'VIP 动态框', frame: { id: 'frame-vip', type: 'vip' }, hint: '会员专属（占位）' },
  { id: 'task', label: '任务奖励框', frame: { id: 'frame-task', type: 'task', expireAt: '2026-12-31' }, hint: '完成任务解锁（占位）' },
  { id: 'limited', label: '限时框', frame: { id: 'frame-limited', type: 'limited', expireAt: '2026-06-30' }, hint: '限时活动/福利（占位）' },
];

const avatarOptions = [
  'https://placehold.co/200x200/png?text=Farm',
  'https://placehold.co/200x200/png?text=Leaf',
  'https://placehold.co/200x200/png?text=AI',
  'https://placehold.co/200x200/png?text=Grow',
];

const selectedFrameId = ref('default');
const selectedAvatar = ref<string | null>(null);

const selectedFrame = computed(() => {
  const option = frameOptions.find((item) => item.id === selectedFrameId.value);
  return option ? option.frame : null;
});

const fetchProfile = async () => {
  loading.value = true;
  const res = await UserRepo.profile();
  if (res.ok) {
    errorMessage.value = '';
    profile.value = res.data;
    selectedAvatar.value = res.data.avatar || null;
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

const saveAppearance = async () => {
  if (!profile.value) return;
  const res = await UserRepo.updateProfile({
    avatar: selectedAvatar.value || profile.value.avatar,
    avatarFrame: selectedFrame.value || undefined,
  });
  if (res.ok) {
    uni.showToast({ title: '头像设置已保存', icon: 'success' });
  } else {
    uni.showToast({ title: res.error.message || '保存失败', icon: 'none' });
  }
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

.nm-preview {
  padding: 36rpx;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
}

.nm-preview__center {
  align-items: center;
}

.nm-preview__name {
  margin-top: 20rpx;
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-preview__hint {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-preview__tag {
  margin-top: 20rpx;
}

.nm-section {
  margin-top: $nm-space-lg;
}

.nm-section__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-section__hint {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-avatar-row {
  margin-top: 20rpx;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-avatar-option {
  padding: 20rpx;
  margin-right: 20rpx;
  margin-bottom: 20rpx;
  border-radius: $nm-radius-lg;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  align-items: center;
}

.nm-avatar-option--active {
  border-color: $nm-brand-primary;
}

.nm-avatar-option__text {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-avatar-option__text--active {
  color: $nm-brand-primary;
}

.nm-frame-list {
  margin-top: $nm-space-sm;
}

.nm-frame-row {
  padding: 28rpx;
  border-radius: $nm-radius-lg;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  flex-direction: row;
  align-items: center;
  margin-bottom: 24rpx;
}

.nm-frame-row--active {
  border-color: $nm-brand-primary;
}

.nm-frame-info {
  flex: 1;
  margin-left: $nm-space-sm;
}

.nm-frame-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-frame-hint {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-primary {
  margin-top: $nm-space-lg;
  padding: 24rpx 0;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  text-align: center;
  color: $nm-text-inverse;
  font-weight: 600;
}

.nm-frame-select {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}
</style>
