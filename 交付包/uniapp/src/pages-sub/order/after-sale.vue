<template>
  <Screen :safeTop="true">
    <AppHeader title="申请售后" />

    <scroll-view
      class="nm-after"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <Skeleton v-if="loading && !order" :count="2" type="card" class="nm-skeleton-wrap" />
      <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="onRefresh" />
      <EmptyState v-else-if="!order" text="订单不存在" />
      <view v-else>
        <view class="nm-card">
          <text class="nm-card__title">订单信息</text>
          <text class="nm-card__meta">{{ order.id }}</text>
          <view v-if="order.items.length === 0" class="nm-empty">
            <EmptyState text="暂无商品" hint="订单中没有商品记录" />
          </view>
          <view v-else class="nm-item" v-for="item in order.items" :key="item.id">
            <image class="nm-item__cover" :src="item.image" mode="aspectFill" />
            <view class="nm-item__body">
              <text class="nm-item__title">{{ item.title }}</text>
              <text class="nm-item__meta">数量 x{{ item.quantity }}</text>
            </view>
            <text class="nm-item__price">¥{{ item.price.toFixed(2) }}</text>
          </view>
        </view>

        <view class="nm-card">
          <text class="nm-card__title">售后原因</text>
          <view class="nm-reasons">
            <view
              v-for="item in reasons"
              :key="item"
              :class="['nm-reason', selectedReason === item ? 'nm-reason--active' : '']"
              @click="selectedReason = item"
            >
              <text class="nm-reason__text">{{ item }}</text>
            </view>
          </view>
          <text class="nm-card__hint">详情说明（可选）</text>
          <textarea
            v-model="note"
            class="nm-textarea"
            placeholder="补充说明有助于更快处理"
            placeholder-class="nm-placeholder"
          />
        </view>

        <view class="nm-actions">
          <view class="nm-btn nm-btn--primary" @click="submit">提交售后申请</view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navReplace } from '@/utils/nav';
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Screen, AppHeader, EmptyState, ErrorState, Skeleton } from '@/components';
import { useToast } from '@/components/feedback/useToast';
import { OrderRepo, type OrderDetail } from '@/services/repos';

const toast = useToast();
const reasons = ['商品破损', '质量问题', '少件/错发', '不想要了', '其他'];
const refreshing = ref(false);
const loading = ref(false);
const errorMessage = ref('');
const orderId = ref('');
const order = ref<OrderDetail | null>(null);
const selectedReason = ref(reasons[0]);
const note = ref('');

const fetchOrder = async () => {
  if (!orderId.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  const res = await OrderRepo.getById(orderId.value);
  if (res.ok) {
    order.value = res.data;
    errorMessage.value = '';
  } else {
    errorMessage.value = res.error.message || '订单加载失败';
  }
  loading.value = false;
  refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  fetchOrder();
};

const submit = async () => {
  if (!order.value) return;
  const res = await OrderRepo.applyAfterSale({
    orderId: order.value.id,
    reason: selectedReason.value,
    note: note.value,
  });
  if (!res.ok) {
    toast.show({ message: res.error.message || '售后申请失败', type: 'error' });
    return;
  }
  toast.show({ message: '售后申请已提交（占位）', type: 'success' });
  navReplace({ url: `/pages-sub/order/order-detail?id=${order.value.id}` });
};

onLoad((options?: Record<string, string>) => {
  orderId.value = options?.id || '';
  fetchOrder();
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-after {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-card {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
  margin-bottom: 32rpx;
}

.nm-card__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-card__meta {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-card__hint {
  margin-top: $nm-space-sm;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-reasons {
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 20rpx;
}

.nm-reason {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  margin-right: 16rpx;
  margin-bottom: 16rpx;
  background-color: $nm-surface;
}

.nm-reason--active {
  border-color: $nm-brand-primary;
  background-color: $nm-brand-primary-soft;
}

.nm-reason__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-reason--active .nm-reason__text {
  color: $nm-brand-primary;
}

.nm-textarea {
  min-height: 180rpx;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  margin-top: $nm-space-sm;
  padding: 20rpx $nm-space-md;
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-placeholder {
  color: $nm-muted;
}

.nm-actions {
  margin-top: 0;
  align-items: center;
  width: 100%;
}

.nm-btn {
  width: 100%;
  padding: 24rpx 0;
  border-radius: $nm-radius-pill;
  font-size: $nm-font-body;
  font-weight: 600;
  text-align: center;
}

.nm-btn--primary {
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
}

.nm-item {
  flex-direction: row;
  align-items: center;
  margin-top: 24rpx;
}

.nm-item__cover {
  width: 128rpx;
  height: 128rpx;
  border-radius: $nm-radius-md;
  background-color: $nm-skeleton;
}

.nm-item__body {
  flex: 1;
  margin-left: $nm-space-sm;
}

.nm-item__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-item__meta {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-item__price {
  font-size: $nm-font-body;
  color: $nm-text-primary;
  font-weight: 600;
}

.nm-skeleton-wrap {
  margin-top: $nm-space-sm;
}

.nm-empty {
  margin-top: $nm-space-sm;
}
</style>
