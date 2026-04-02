<template>
  <Screen :safeTop="true">
    <AppHeader title="考察团详情" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view v-if="loading" class="nm-skeleton-wrap">
        <Skeleton :count="2" type="card" />
      </view>
      <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="onRefresh" />
      <EmptyState v-else-if="!group" text="未找到考察团" />
      <view v-else>
        <view class="nm-card">
          <text class="nm-title nm-title--hero">{{ group.title }}</text>
          <text class="nm-sub">{{ companyName }} · {{ group.destination }}</text>
          <view class="nm-row nm-row--between">
            <text class="nm-sub">进度 {{ group.memberCount }}/{{ group.targetSize }}</text>
            <view class="nm-pill" :class="statusToneClass(group.status)">
              <text class="nm-pill__text">{{ groupStatusLabels[group.status] }}</text>
            </view>
          </view>
          <view class="nm-progress">
            <view class="nm-progress__fill" :style="{ width: progressWidth }" />
          </view>
          <text class="nm-sub nm-sub--muted">截止日期：{{ group.deadline }}</text>
          <view class="nm-info-row">
            <view class="nm-info-card">
              <text class="nm-info-label">目标人数</text>
              <text class="nm-info-value">{{ group.targetSize }}</text>
            </view>
            <view class="nm-info-card">
              <text class="nm-info-label">当前报名</text>
              <text class="nm-info-value">{{ group.memberCount }}</text>
            </view>
          </view>
        </view>

        <view class="nm-card">
          <text class="nm-title">参团成员</text>
          <view v-if="bookings.length === 0" class="nm-empty">
            <EmptyState text="暂无成员" hint="成团邀请发送后会展示成员信息" />
          </view>
          <view v-else class="nm-member" v-for="item in bookings" :key="item.id">
            <text class="nm-member__name">{{ item.contactName || '匿名' }}</text>
            <text class="nm-member__meta">{{ item.identity }} · {{ item.headcount }} 人</text>
            <view class="nm-pill" :class="bookingToneClass(item.status)">
              <text class="nm-pill__text">{{ bookingStatusLabels[item.status] }}</text>
            </view>
          </view>
        </view>

        <view class="nm-card">
          <text class="nm-title">支付方式</text>
          <text class="nm-sub">支付入口占位，可后续接入微信/支付宝</text>
          <view class="nm-methods">
            <view
              v-for="method in paymentMethods"
              :key="method.value"
              :class="['nm-method', paymentMethod === method.value ? 'nm-method--active' : '']"
              @click="paymentMethod = method.value"
            >
              <Icon
                class="nm-method__icon"
                :name="paymentMethod === method.value ? 'check-circle' : 'circle-outline'"
                :size="28"
                :color="paymentMethod === method.value ? textInverse : textSecondary"
              />
              <text class="nm-method__text">{{ method.label }}</text>
            </view>
          </view>
          <view class="nm-btn" @click="joinAndPay">确认参团并支付</view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Screen, AppHeader, EmptyState, ErrorState, Skeleton, Icon } from '@/components';
import { useToast } from '@/components/feedback/useToast';
import { BookingRepo, CompanyRepo, GroupRepo } from '@/services/repos';
import type { Booking } from '@/services/repos/booking';
import type { Group, GroupStatus } from '@/services/repos/group';

const textSecondary = '#4B5B53';
const textInverse = '#FFFFFF';
const toast = useToast();
const groupId = ref('');
const group = ref<Group | null>(null);
const bookings = ref<Booking[]>([]);
const companyName = ref('企业');
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');
const paymentMethod = ref<'wechat' | 'alipay'>('wechat');

const groupStatusLabels: Record<GroupStatus, string> = {
  forming: '组团中',
  inviting: '邀请中',
  confirmed: '待支付',
  paid: '已支付',
  completed: '已完成',
};

const bookingStatusLabels: Record<Booking['status'], string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  invited: '已邀请',
  joined: '已参团',
  paid: '已支付',
};

const paymentMethods: Array<{ value: 'wechat' | 'alipay'; label: string }> = [
  { value: 'wechat', label: '微信支付' },
  { value: 'alipay', label: '支付宝' },
];

const progressWidth = computed(() => {
  if (!group.value) return '0%';
  const ratio = (group.value.memberCount / group.value.targetSize) * 100;
  return `${Math.min(100, Math.max(0, ratio)).toFixed(0)}%`;
});

const statusToneClass = (status: GroupStatus) => {
  if (status === 'inviting' || status === 'confirmed') return 'nm-pill--blue';
  if (status === 'completed') return 'nm-pill--muted';
  return 'nm-pill--primary';
};

const bookingToneClass = (status: Booking['status']) => {
  if (status === 'approved' || status === 'invited') return 'nm-pill--blue';
  if (status === 'rejected') return 'nm-pill--muted';
  return 'nm-pill--primary';
};

const fetchData = async () => {
  if (!groupId.value) return;
  loading.value = true;
  const [groupRes, bookingRes, companyRes] = await Promise.all([
    GroupRepo.getById(groupId.value),
    BookingRepo.listByGroup({ groupId: groupId.value, page: 1, pageSize: 20 }),
    CompanyRepo.list({ page: 1, pageSize: 50 }),
  ]);
  if (groupRes.ok) {
    group.value = groupRes.data;
    errorMessage.value = '';
  } else {
    errorMessage.value = groupRes.error.message || '加载失败';
  }
  if (bookingRes.ok) {
    bookings.value = bookingRes.data.items;
  }
  if (companyRes.ok && groupRes.ok) {
    const found = companyRes.data.items.find((item) => item.id === groupRes.data.companyId);
    companyName.value = found?.name || '企业';
  }
  loading.value = false;
  refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  fetchData();
};

const joinAndPay = async () => {
  if (!group.value) return;
  // 参团 + 支付入口占位：后端需创建参团记录并返回支付参数
  const bookingRes = await BookingRepo.joinGroup({
    groupId: group.value.id,
    companyId: group.value.companyId,
    identity: '消费者',
    headcount: 1,
    contactName: '当前用户',
  });
  if (!bookingRes.ok) {
    toast.show({ message: bookingRes.error.message || '参团失败', type: 'error' });
    return;
  }
  const joinRes = await GroupRepo.join({ groupId: group.value.id, headcount: 1 });
  if (!joinRes.ok) {
    toast.show({ message: joinRes.error.message || '参团失败', type: 'error' });
    return;
  }
  toast.show({
    message: `已选择${paymentMethod.value === 'wechat' ? '微信' : '支付宝'}支付（占位）`,
    type: 'info',
  });
  fetchData();
};

onLoad((options?: Record<string, string>) => {
  groupId.value = options?.id || '';
  fetchData();
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
  background-color: $nm-background;
}

.nm-card {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  margin-bottom: $nm-space-lg;
  border: 1rpx solid transparent;
}

.nm-title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-title--hero {
  font-size: $nm-font-title2;
}

.nm-sub {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-sub--muted {
  color: $nm-muted;
}

.nm-row {
  margin-top: 20rpx;
  flex-direction: row;
  align-items: center;
}

.nm-row--between {
  justify-content: space-between;
}

.nm-pill {
  padding: 8rpx 20rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
  align-self: flex-start;
}

.nm-pill__text {
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
}

.nm-pill--primary {
  background-color: $nm-brand-primary-soft;
}

.nm-pill--primary .nm-pill__text {
  color: $nm-brand-primary;
}

.nm-pill--blue {
  background-color: $nm-accent-blue-soft;
}

.nm-pill--blue .nm-pill__text {
  color: $nm-accent-blue;
}

.nm-pill--muted {
  background-color: $nm-border;
}

.nm-pill--muted .nm-pill__text {
  color: $nm-text-secondary;
}

.nm-progress {
  height: 12rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
  margin-top: 20rpx;
  overflow: hidden;
}

.nm-progress__fill {
  height: 100%;
  background-color: $nm-brand-primary;
}

.nm-info-row {
  flex-direction: row;
  margin-top: $nm-space-md;
  gap: $nm-space-sm;
}

.nm-info-card {
  flex: 1;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  padding: $nm-space-md;
  margin-right: 20rpx;
}

.nm-info-card:last-child {
  margin-right: 0;
}

.nm-info-label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-info-value {
  margin-top: 8rpx;
  font-size: $nm-font-title3;
  color: $nm-text-primary;
  font-weight: 600;
}

.nm-member {
  padding: 20rpx 0;
  border-bottom: 1rpx solid $nm-border;
}

.nm-member:last-child {
  border-bottom: none;
}

.nm-member__name {
  font-size: $nm-font-body;
  color: $nm-text-primary;
  font-weight: 600;
}

.nm-member__meta {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-member .nm-pill {
  margin-top: 12rpx;
}

.nm-methods {
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: $nm-space-sm;
}

.nm-method {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  margin-right: $nm-space-sm;
  margin-bottom: $nm-space-sm;
  background-color: $nm-surface;
  flex-direction: row;
  align-items: center;
}

.nm-method--active {
  background-color: $nm-brand-primary;
  border-color: $nm-brand-primary;
}

.nm-method__icon {
  margin-right: 8rpx;
}

.nm-method__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-method--active .nm-method__text {
  color: $nm-text-inverse;
}


.nm-btn {
  margin-top: 16rpx;
  padding: 24rpx 0;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  font-size: $nm-font-body;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-empty {
  margin-top: $nm-space-sm;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-skeleton-wrap {
  margin-top: $nm-space-sm;
}
</style>
