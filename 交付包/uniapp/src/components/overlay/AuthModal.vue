<template>
  <view v-if="open" class="nm-auth">
    <view class="nm-auth__mask" @click="handleClose" />
    <view class="nm-auth__card">
      <view class="nm-auth__header">
        <text class="nm-auth__title">{{ tab === 'login' ? '登录/注册' : '注册' }}</text>
        <text class="nm-auth__close" @click="handleClose">×</text>
      </view>

      <view class="nm-auth__tabs">
        <view
          v-for="item in tabs"
          :key="item"
          :class="['nm-auth__tab', tab === item ? 'nm-auth__tab--active' : '']"
          @click="tab = item"
        >
          <text :class="tab === item ? 'nm-auth__tab-text--active' : 'nm-auth__tab-text'">
            {{ item === 'login' ? '登录' : '注册' }}
          </text>
        </view>
      </view>

      <view class="nm-auth__switch">
        <view
          v-for="item in modes"
          :key="item"
          :class="['nm-auth__chip', mode === item ? 'nm-auth__chip--active' : '']"
          @click="mode = item"
        >
          <text :class="mode === item ? 'nm-auth__chip-text--active' : 'nm-auth__chip-text'">
            {{ item === 'code' ? '验证码' : '密码' }}
          </text>
        </view>
      </view>

      <view class="nm-auth__field">
        <text class="nm-auth__label">手机号</text>
        <input v-model="phone" class="nm-auth__input" type="number" placeholder="请输入手机号" />
      </view>

      <view class="nm-auth__field">
        <text class="nm-auth__label">{{ mode === 'code' ? '验证码' : '密码' }}</text>
        <view class="nm-auth__row">
          <input
            v-if="mode === 'code'"
            v-model="code"
            class="nm-auth__input"
            :password="false"
            placeholder="请输入验证码"
          />
          <input
            v-else
            v-model="password"
            class="nm-auth__input"
            :password="true"
            placeholder="请输入密码"
          />
          <view v-if="mode === 'code'" class="nm-auth__code" @click="sendCode">获取验证码</view>
        </view>
      </view>

      <view class="nm-auth__primary" @click="submit">{{ tab === 'login' ? '登录' : '注册' }}</view>

      <view class="nm-auth__divider">
        <view class="nm-auth__line" />
        <text class="nm-auth__divider-text">其他方式</text>
        <view class="nm-auth__line" />
      </view>

      <view class="nm-auth__third">
        <view class="nm-auth__third-btn" @click="loginWeChat">微信登录</view>
        <view class="nm-auth__third-btn" @click="loginApple">Apple</view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { AuthState } from '@/services/state';
import { useToast } from '@/components/feedback/useToast';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits(['close', 'success']);

const tabs = ['login', 'register'] as const;
const modes = ['code', 'password'] as const;

const tab = ref<(typeof tabs)[number]>('login');
const mode = ref<(typeof modes)[number]>('code');
const phone = ref('');
const code = ref('');
const password = ref('');
const toast = useToast();

watch(
  () => props.open,
  (value) => {
    if (!value) {
      tab.value = 'login';
      mode.value = 'code';
      phone.value = '';
      code.value = '';
      password.value = '';
    }
  }
);

const handleClose = () => emit('close');

const sendCode = () => {
  // TODO(后端)：调用 AuthRepo.sendSmsCode(phone)，返回 requestId（防刷/风控）并进入倒计时
  if (phone.value.trim().length < 8) {
    toast.show({ message: '请输入正确手机号', type: 'error' });
    return;
  }
  toast.show({ message: '验证码已发送（占位）', type: 'success' });
};

const submit = async () => {
  if (mode.value === 'code') {
    const res = await AuthState.loginByCode({ phone: phone.value, code: code.value });
    if (!res.ok) {
      toast.show({ message: res.message, type: 'error' });
      return;
    }
  } else {
    const res = await AuthState.loginByPassword({ phone: phone.value, password: password.value });
    if (!res.ok) {
      toast.show({ message: res.message, type: 'error' });
      return;
    }
  }

  toast.show({ message: '登录成功（占位）', type: 'success' });
  emit('success');
  handleClose();
};

const loginWeChat = () => {
  // TODO(后端)：接入微信登录（需要 App 原生 SDK + 后端换 token）
  toast.show({ message: '微信登录（占位）', type: 'info' });
};

const loginApple = () => {
  // TODO(后端)：接入 Apple 登录（需要 iOS 原生能力 + 后端换 token）
  toast.show({ message: 'Apple 登录（占位）', type: 'info' });
};
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-auth {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 999;
}

.nm-auth__mask {
  position: absolute;
  inset: 0;
  background-color: $nm-overlay;
}

.nm-auth__card {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 640rpx;
  max-width: 86%;
  background-color: $nm-surface;
  border-radius: $nm-radius-xl;
  padding: $nm-space-lg;
}

.nm-auth__header {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-auth__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-auth__close {
  font-size: 36rpx;
  color: $nm-text-secondary;
}

.nm-auth__tabs {
  margin-top: $nm-space-md;
  flex-direction: row;
  background-color: $nm-background;
  border-radius: $nm-radius-pill;
  padding: 6rpx;
}

.nm-auth__tab {
  flex: 1;
  align-items: center;
  padding: 8rpx 0;
  border-radius: $nm-radius-pill;
}

.nm-auth__tab--active {
  background-color: $nm-brand-primary-soft;
}

.nm-auth__tab-text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-auth__tab-text--active {
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
  font-weight: 600;
}

.nm-auth__switch {
  margin-top: $nm-space-sm;
  flex-direction: row;
}

.nm-auth__chip {
  margin-right: $nm-space-sm;
  padding: 8rpx 16rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
}

.nm-auth__chip--active {
  background-color: $nm-accent-blue-soft;
  border-color: transparent;
}

.nm-auth__chip-text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-auth__chip-text--active {
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
  font-weight: 600;
}

.nm-auth__field {
  margin-top: $nm-space-md;
}

.nm-auth__label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-auth__row {
  margin-top: 6rpx;
  flex-direction: row;
  align-items: center;
}

.nm-auth__input {
  flex: 1;
  min-width: 0;
  height: 72rpx;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  background-color: $nm-background;
  padding: 0 20rpx;
}

.nm-auth__code {
  margin-left: $nm-space-sm;
  width: 176rpx;
  flex-shrink: 0;
  padding: 12rpx 16rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  text-align: center;
}

.nm-auth__primary {
  margin-top: $nm-space-lg;
  padding: 16rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  text-align: center;
  color: $nm-text-inverse;
}

.nm-auth__divider {
  margin-top: $nm-space-lg;
  flex-direction: row;
  align-items: center;
}

.nm-auth__line {
  flex: 1;
  height: 1rpx;
  background-color: $nm-border;
}

.nm-auth__divider-text {
  margin: 0 $nm-space-sm;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-auth__third {
  margin-top: $nm-space-sm;
  flex-direction: row;
  justify-content: space-between;
}

.nm-auth__third-btn {
  flex: 1;
  margin-right: $nm-space-sm;
  padding: 12rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  text-align: center;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-auth__third-btn:last-child {
  margin-right: 0;
}
</style>
