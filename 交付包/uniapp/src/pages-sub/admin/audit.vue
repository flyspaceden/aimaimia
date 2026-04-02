<template>
  <Screen :safeTop="true">
    <AppHeader title="运营审核中心">
      <template #right>
        <view class="nm-refresh" @click="onRefresh">
          <Icon name="refresh" :size="36" :color="textSecondary" />
        </view>
      </template>
    </AppHeader>

    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <text class="nm-subtitle">预约审核 · 组团管理</text>

      <view class="nm-stats">
        <view v-for="item in stats" :key="item.label" class="nm-stat-card">
          <text class="nm-stat-label">{{ item.label }}</text>
          <text class="nm-stat-value">{{ item.value }}</text>
        </view>
      </view>

      <view class="nm-filters">
        <view
          v-for="item in filters"
          :key="item.id"
          :class="['nm-filter', statusFilter === item.id ? 'nm-filter--active' : '']"
          @click="setFilter(item.id)"
        >
          <text :class="['nm-filter__text', statusFilter === item.id ? 'nm-filter__text--active' : '']">
            {{ item.label }}
          </text>
        </view>
      </view>

      <view class="nm-panel">
        <text class="nm-panel__title">手动发起组团</text>
        <view v-if="companies.length === 0" class="nm-panel__empty">暂无可用企业</view>
        <view v-else>
          <view v-for="company in companies" :key="company.id" class="nm-panel__row">
            <text class="nm-panel__name">{{ company.name }}</text>
            <view class="nm-panel__button" @click="handleManualCreate(company)">发起</view>
          </view>
        </view>
      </view>

      <view class="nm-list">
        <Skeleton v-if="loading" :count="2" type="card" />
        <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="onRefresh" />
        <EmptyState v-else-if="filteredBookings.length === 0" text="暂无预约记录" hint="稍后再来看看" />
          <view v-else>
            <view v-for="item in filteredBookings" :key="item.id" class="nm-card">
              <view class="nm-card__header">
                <text class="nm-card__title">{{ item.companyName }}</text>
                <view :class="['nm-pill', statusTone(item.status)]">
                  <text class="nm-pill__text">{{ item.status }}</text>
                </view>
              </view>
              <text class="nm-card__meta">日期 {{ item.date }} · 人数 {{ item.people }}</text>
              <text class="nm-card__meta">备注：{{ item.note || '无' }}</text>
              <text v-if="item.auditNote" class="nm-card__meta nm-card__meta--muted">审核备注：{{ item.auditNote }}</text>
              <view v-if="item.status === '待审核'" class="nm-card__actions">
                <view class="nm-btn nm-btn--primary" @click="openReview(item, 'approve')">通过</view>
                <view class="nm-btn nm-btn--ghost" @click="openReview(item, 'reject')">驳回</view>
              </view>
            </view>
          </view>
      </view>
    </scroll-view>

    <BottomSheet :open="sheetOpen" mode="half" title="审核处理" :scrollable="true" @close="sheetOpen = false">
      <view class="nm-sheet">
        <view class="nm-status-row">
          <view
            :class="['nm-status-chip', reviewStatus === 'approve' ? 'nm-status-chip--active' : '']"
            @click="reviewStatus = 'approve'"
          >
            通过
          </view>
          <view
            :class="['nm-status-chip', reviewStatus === 'reject' ? 'nm-status-chip--active' : '']"
            @click="reviewStatus = 'reject'"
          >
            驳回
          </view>
        </view>
        <text class="nm-label">审核备注</text>
        <textarea
          v-model="reviewNote"
          class="nm-input"
          placeholder="填写审核备注（可选）"
          placeholder-class="nm-placeholder"
        />
        <view class="nm-primary" @click="submitReview">确认提交</view>
      </view>
    </BottomSheet>
  </Screen>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import Screen from '@/components/layout/Screen.vue';
import AppHeader from '@/components/layout/AppHeader.vue';
import BottomSheet from '@/components/overlay/BottomSheet.vue';
import { EmptyState, ErrorState, Skeleton, Icon } from '@/components';
import { EventRepo, CompanyRepo, type BookingRequest, type BookingStatus, type Company } from '@/services/repos';
import { useToast } from '@/components/feedback/useToast';

const textSecondary = '#4B5B53';
const toast = useToast();
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');
const bookings = ref<BookingRequest[]>([]);
const companies = ref<Company[]>([]);
const statusFilter = ref<'all' | BookingStatus>('all');
const sheetOpen = ref(false);
const reviewStatus = ref<'approve' | 'reject'>('approve');
const reviewNote = ref('');
const activeBooking = ref<BookingRequest | null>(null);

const filters: Array<{ id: 'all' | BookingStatus; label: string }> = [
  { id: 'all', label: '全部' },
  { id: '待审核', label: '待审核' },
  { id: '已通过', label: '已通过' },
  { id: '已驳回', label: '已驳回' },
];

const stats = computed(() => {
  const pending = bookings.value.filter((item) => item.status === '待审核').length;
  const approved = bookings.value.filter((item) => item.status === '已通过').length;
  const rejected = bookings.value.filter((item) => item.status === '已驳回').length;
  return [
    { label: '待审核', value: pending },
    { label: '已通过', value: approved },
    { label: '已驳回', value: rejected },
  ];
});

const sortedBookings = computed(() => {
  const order: BookingStatus[] = ['待审核', '已通过', '已驳回'];
  return [...bookings.value].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
});

const filteredBookings = computed(() => {
  if (statusFilter.value === 'all') return sortedBookings.value;
  return sortedBookings.value.filter((item) => item.status === statusFilter.value);
});

const statusTone = (status: BookingStatus) => {
  if (status === '已通过') return 'nm-pill--approved';
  if (status === '已驳回') return 'nm-pill--rejected';
  return 'nm-pill--pending';
};

const fetchBookings = async () => {
  loading.value = true;
  const [bookingRes, companyRes] = await Promise.all([
    EventRepo.listBookings({ page: 1, pageSize: 20 }),
    CompanyRepo.list({ page: 1, pageSize: 10 }),
  ]);
  if (bookingRes.ok) {
    bookings.value = bookingRes.data.items;
    errorMessage.value = '';
  } else {
    errorMessage.value = bookingRes.error.message || '加载失败';
  }
  if (companyRes.ok) {
    companies.value = companyRes.data.items;
  } else {
    companies.value = [];
  }
  loading.value = false;
  refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  fetchBookings();
};

const setFilter = (value: 'all' | BookingStatus) => {
  statusFilter.value = value;
};

const openReview = (item: BookingRequest, status: 'approve' | 'reject') => {
  activeBooking.value = item;
  reviewStatus.value = status;
  reviewNote.value = '';
  sheetOpen.value = true;
};

const handleManualCreate = (company: Company) => {
  toast.show({ message: `已发起${company.name}考察团（占位）`, type: 'success' });
};

const submitReview = async () => {
  if (!activeBooking.value) return;
  const res = await EventRepo.auditBooking({
    bookingId: activeBooking.value.id,
    action: reviewStatus.value,
    note: reviewNote.value.trim() || undefined,
  });
  if (res.ok) {
    toast.show({ message: reviewStatus.value === 'approve' ? '已通过（占位）' : '已驳回（占位）', type: 'success' });
    sheetOpen.value = false;
    fetchBookings();
  } else {
    toast.show({ message: res.error.message || '操作失败', type: 'error' });
  }
};

fetchBookings();
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-subtitle {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-stats {
  margin-top: $nm-space-lg;
  flex-direction: row;
}

.nm-stat-card {
  flex: 1;
  margin-right: $nm-space-sm;
  padding: $nm-space-md;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid transparent;
  box-shadow: $nm-shadow-sm;
}

.nm-stat-card:last-child {
  margin-right: 0;
}

.nm-stat-label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-stat-value {
  margin-top: $nm-space-xs;
  font-size: $nm-font-title3;
  color: $nm-text-primary;
}

.nm-filters {
  margin-top: $nm-space-md;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-filter {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  margin-right: $nm-space-sm;
  margin-bottom: $nm-space-sm;
  background-color: $nm-surface;
}

.nm-filter--active {
  border-color: $nm-brand-primary;
  background-color: $nm-brand-primary;
}

.nm-filter__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-filter__text--active {
  color: $nm-text-inverse;
  font-weight: 600;
}

.nm-panel {
  margin-top: $nm-space-md;
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid transparent;
  box-shadow: $nm-shadow-sm;
}

.nm-panel__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-panel__row {
  margin-top: 20rpx;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-panel__name {
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-panel__button {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  font-size: $nm-font-caption;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-panel__empty {
  margin-top: $nm-space-sm;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-list {
  margin-top: $nm-space-lg;
}

.nm-card {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid transparent;
  box-shadow: $nm-shadow-sm;
  margin-bottom: $nm-space-md;
}

.nm-card__header {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-card__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-card__meta {
  margin-top: $nm-space-xs;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-card__meta--muted {
  color: $nm-muted;
}

.nm-card__actions {
  flex-direction: row;
  justify-content: flex-end;
  margin-top: $nm-space-sm;
}

.nm-btn {
  padding: 20rpx 0;
  border-radius: $nm-radius-pill;
  font-size: $nm-font-caption;
  flex: 1;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-btn--ghost {
  border: 1rpx solid $nm-border;
  color: $nm-text-primary;
  margin-left: $nm-space-sm;
}

.nm-btn--primary {
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  font-weight: 600;
}

.nm-pill {
  padding: 8rpx 20rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-background;
  border: 1rpx solid transparent;
}

.nm-pill--pending {
  background-color: $nm-brand-primary-soft;
}

.nm-pill--pending .nm-pill__text {
  color: $nm-brand-primary;
}

.nm-pill--approved {
  background-color: $nm-accent-blue-soft;
}

.nm-pill--approved .nm-pill__text {
  color: $nm-accent-blue;
}

.nm-pill--rejected {
  background-color: $nm-border;
}

.nm-pill--rejected .nm-pill__text {
  color: $nm-text-secondary;
}

.nm-pill__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-refresh {
  padding: 8rpx;
}

.nm-label {
  margin-top: $nm-space-md;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-status-row {
  margin-bottom: $nm-space-md;
  flex-direction: row;
}

.nm-status-chip {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  margin-right: $nm-space-sm;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  background-color: $nm-surface;
}

.nm-status-chip--active {
  border-color: $nm-brand-primary;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
}

.nm-input {
  margin-top: 6rpx;
  padding: 20rpx 24rpx;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  font-size: $nm-font-body;
  color: $nm-text-primary;
  min-height: 180rpx;
}

.nm-placeholder {
  color: $nm-muted;
}

.nm-primary {
  margin-top: $nm-space-md;
  padding: 24rpx 0;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  text-align: center;
  font-size: $nm-font-body;
  font-weight: 600;
}
</style>
