<template>
  <Screen :safeTop="true">
    <AppHeader title="个人资料" />
    <view v-if="loading" class="nm-loading">
      <Skeleton :count="2" type="card" />
    </view>
    <view v-else-if="errorMessage" class="nm-loading">
      <ErrorState :text="errorMessage" @retry="fetchProfile" />
    </view>
    <view v-else-if="!profile" class="nm-loading">
      <EmptyState text="暂无资料" hint="请稍后再试" />
    </view>
    <scroll-view
      v-else
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view class="nm-card">
        <view class="nm-row">
          <view @click="goAppearance">
            <AvatarFrame :uri="profile?.avatar" :frame="profile?.avatarFrame" :size="72" />
          </view>
          <view class="nm-user-info">
            <text class="nm-user-name">{{ profile?.name }}</text>
            <text class="nm-user-meta">{{ profile?.location }}</text>
            <view class="nm-tag-row">
              <view v-for="tag in (profile?.interests || []).slice(0, 3)" :key="tag" class="nm-tag-wrap">
                <Tag :label="tag" tone="neutral" />
              </view>
            </view>
          </view>
          <view class="nm-action" @click="goAppearance">装扮</view>
        </view>
      </view>

      <view class="nm-section">
        <text class="nm-section-title">偏好与信息</text>
        <view class="nm-card">
          <view class="nm-field">
            <text class="nm-label">昵称</text>
            <input
              class="nm-input"
              v-model="form.name"
              placeholder="请输入昵称"
              placeholder-class="nm-placeholder"
              @input="clearError('name')"
            />
            <text v-if="errors.name" class="nm-error">{{ errors.name }}</text>
          </view>
          <view class="nm-field">
            <text class="nm-label">所在地</text>
            <input
              class="nm-input"
              v-model="form.location"
              placeholder="例如：上海"
              placeholder-class="nm-placeholder"
              @input="clearError('location')"
            />
            <text v-if="errors.location" class="nm-error">{{ errors.location }}</text>
          </view>
          <view class="nm-field">
            <text class="nm-label">兴趣标签</text>
            <input
              class="nm-input"
              v-model="form.interests"
              placeholder="用逗号分隔，例如：有机蔬菜、蓝莓"
              placeholder-class="nm-placeholder"
              @input="clearError('interests')"
            />
            <view class="nm-tag-row">
              <view v-for="tag in interestTags" :key="tag" class="nm-tag-wrap">
                <Tag :label="tag" tone="neutral" />
              </view>
            </view>
            <text class="nm-tip">最多展示 6 个标签</text>
          </view>
          <view
            :class="['nm-primary', !isDirty || saving ? 'nm-primary--disabled' : '']"
            @click="saveProfile"
          >
            {{ saving ? '保存中...' : '保存修改' }}
          </view>
          <view class="nm-secondary" @click="resetProfile">重置</view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { reactive, ref, computed } from 'vue';
import { Screen, AppHeader, Skeleton, ErrorState, EmptyState, AvatarFrame, Tag } from '@/components';
import { UserRepo, type UserProfile } from '@/services/repos';

const profile = ref<UserProfile | null>(null);
const loading = ref(true);
const saving = ref(false);
const errorMessage = ref('');
const refreshing = ref(false);
const initialSnapshot = ref({ name: '', location: '', interests: '' });

const form = reactive({
  name: '',
  location: '',
  interests: '',
});

const errors = reactive({
  name: '',
  location: '',
  interests: '',
});

const parseInterests = (value: string) =>
  value
    .split(/[,，、/\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 6);

const interestTags = computed(() => parseInterests(form.interests));

const isDirty = computed(() => {
  return (
    form.name.trim() !== initialSnapshot.value.name ||
    form.location.trim() !== initialSnapshot.value.location ||
    form.interests.trim() !== initialSnapshot.value.interests
  );
});

const clearError = (field: 'name' | 'location' | 'interests') => {
  errors[field] = '';
};

const applyProfile = (data: UserProfile) => {
  profile.value = data;
  form.name = data.name || '';
  form.location = data.location || '';
  form.interests = (data.interests || []).join('、');
  initialSnapshot.value = {
    name: form.name,
    location: form.location,
    interests: form.interests,
  };
};

const fetchProfile = async () => {
  loading.value = true;
  const res = await UserRepo.profile();
  if (res.ok) {
    errorMessage.value = '';
    applyProfile(res.data);
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

const validate = () => {
  errors.name = '';
  errors.location = '';
  errors.interests = '';
  if (form.name.trim().length < 2) {
    errors.name = '昵称至少 2 个字';
  } else if (form.name.trim().length > 12) {
    errors.name = '昵称不超过 12 个字';
  }
  if (form.location.trim().length < 2) {
    errors.location = '请填写所在地';
  } else if (form.location.trim().length > 20) {
    errors.location = '所在地不超过 20 个字';
  }
  return !errors.name && !errors.location;
};

const saveProfile = async () => {
  if (!isDirty.value || saving.value) return;
  if (!validate()) return;
  saving.value = true;
  const res = await UserRepo.updateProfile({
    name: form.name.trim(),
    location: form.location.trim(),
    interests: parseInterests(form.interests),
  });
  saving.value = false;
  if (res.ok) {
    applyProfile(res.data);
    uni.showToast({ title: '资料已更新', icon: 'success' });
  } else {
    uni.showToast({ title: res.error.message || '保存失败', icon: 'none' });
  }
};

const resetProfile = () => {
  if (!profile.value) return;
  form.name = initialSnapshot.value.name;
  form.location = initialSnapshot.value.location;
  form.interests = initialSnapshot.value.interests;
  errors.name = '';
  errors.location = '';
  errors.interests = '';
};

const goAppearance = () => {
  navTo({ url: '/pages-sub/me/appearance' });
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
  padding: $nm-space-xl;
}

.nm-card {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
}

.nm-section {
  margin-top: $nm-space-lg;
}

.nm-row {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.nm-user-info {
  flex: 1;
  margin-left: $nm-space-sm;
}

.nm-user-name {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-user-meta {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-tag-row {
  margin-top: 12rpx;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-tag-wrap {
  margin-right: 12rpx;
  margin-top: 12rpx;
}

.nm-action {
  padding: 12rpx 20rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-section-title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
  margin-bottom: 0;
}

.nm-field {
  margin-bottom: 28rpx;
}

.nm-label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-input {
  margin-top: 6rpx;
  border-radius: $nm-radius-md;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
  padding: 20rpx 24rpx;
  color: $nm-text-primary;
}

.nm-placeholder {
  color: $nm-muted;
}

.nm-error {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-danger;
}

.nm-tip {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-primary {
  margin-top: 28rpx;
  padding: 20rpx 0;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  text-align: center;
  color: $nm-text-inverse;
  font-weight: 600;
}

.nm-primary--disabled {
  background-color: $nm-border;
  color: $nm-text-secondary;
}

.nm-secondary {
  margin-top: 20rpx;
  padding: 20rpx 0;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  text-align: center;
  color: $nm-text-secondary;
  font-weight: 600;
}
</style>
