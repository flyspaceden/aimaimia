<template>
  <Screen :safeTop="true">
    <AppHeader title="订单详情" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <Skeleton v-if="loading" :count="2" type="card" class="nm-skeleton" />
      <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="onRefresh" />
      <EmptyState v-else-if="!order" text="订单不存在" />
      <view v-else>
        <view class="nm-card nm-summary">
          <text class="nm-title">{{ order.id }}</text>
          <text class="nm-sub">{{ statusLabel(order.statusCode) }} · {{ order.createdAt }}</text>
          <text v-if="order.logisticsStatus" class="nm-sub nm-sub--loose">物流：{{ order.logisticsStatus }}</text>
          <text v-if="order.tracePreview" class="nm-sub">预计送达：{{ order.tracePreview }}</text>
          <text v-if="order.afterSaleStatus" class="nm-sub">
            售后进度：{{ afterSaleLabels[order.afterSaleStatus] || '处理中' }}
          </text>
        </view>

        <view class="nm-actions">
          <view v-if="order.statusCode === 'pendingPay'" class="nm-action nm-action--primary" @click="handlePay">
            立即支付
          </view>
          <view v-if="order.statusCode === 'shipping'" class="nm-action" @click="goTrack">查看物流</view>
          <view
            v-if="order.statusCode !== 'afterSale' && order.statusCode !== 'pendingPay'"
            class="nm-action"
            @click="goAfterSale(order.id)"
          >
            申请售后
          </view>
        </view>

        <view v-if="order.statusCode === 'afterSale'" class="nm-section">
          <text class="nm-section__title">售后进度</text>
          <view class="nm-card nm-card--compact">
            <view v-if="!order.afterSaleTimeline || order.afterSaleTimeline.length === 0" class="nm-sub">
              暂无售后节点
            </view>
            <view v-else class="nm-step" v-for="step in order.afterSaleTimeline" :key="step.status + step.time">
              <view
                :class="['nm-step__dot', step.status === order.afterSaleStatus ? 'nm-step__dot--active' : '']"
              />
              <view class="nm-step__body">
                <text class="nm-step__title">{{ step.title }}</text>
                <text class="nm-step__meta">{{ step.time }}</text>
                <text v-if="step.note" class="nm-step__meta">{{ step.note }}</text>
              </view>
            </view>
            <view class="nm-step__action" @click="advanceAfterSale">模拟推进售后</view>
          </view>
        </view>

        <view class="nm-section">
          <text class="nm-section__title">商品清单</text>
          <view v-if="order.items.length === 0" class="nm-empty">
            <EmptyState text="暂无商品" hint="订单中没有商品记录" />
          </view>
          <view v-else class="nm-item" v-for="item in order.items" :key="item.id">
            <view class="nm-item__info">
              <text class="nm-item__title">{{ item.title }}</text>
              <text class="nm-item__meta">数量 x{{ item.quantity }}</text>
            </view>
            <text class="nm-item__price">¥{{ item.price.toFixed(2) }}</text>
          </view>
        </view>

        <view class="nm-total-row">
          <text class="nm-sub">合计</text>
          <text class="nm-total">¥{{ order.totalPrice.toFixed(2) }}</text>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Screen, AppHeader, EmptyState, ErrorState, Skeleton } from '@/components';
import { useToast } from '@/components/feedback/useToast';
import { OrderRepo, type OrderDetail, type OrderStatus } from '@/services/repos';

const toast = useToast();
const refreshing = ref(false);
const loading = ref(false);
const errorMessage = ref('');
const orderId = ref('');
const order = ref<OrderDetail | null>(null);

const afterSaleLabels: Record<string, string> = {
  applying: '申请中',
  reviewing: '审核中',
  refunding: '退款中',
  completed: '已完成',
};

const statusLabel = (status: OrderStatus) => {
  const map: Record<OrderStatus, string> = {
    pendingPay: '待付款',
    pendingShip: '待发货',
    shipping: '待收货',
    afterSale: '售后处理中',
    completed: '已完成',
  };
  return map[status] || '订单处理中';
};

const fetchOrder = async () => {
  if (!orderId.value) return;
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

const goTrack = () => {
  navTo({ url: '/pages-sub/order/track' });
};

const goAfterSale = (id: string) => {
  navTo({ url: `/pages-sub/order/after-sale?id=${id}` });
};

const handlePay = async () => {
  if (!order.value) return;
  const res = await OrderRepo.payOrder(order.value.id, order.value.paymentMethod || 'wechat');
  if (!res.ok) {
    toast.show({ message: res.error.message || '支付失败', type: 'error' });
    return;
  }
  toast.show({ message: '支付成功', type: 'success' });
  fetchOrder();
};

const advanceAfterSale = async () => {
  if (!order.value) return;
  const res = await OrderRepo.advanceAfterSale(order.value.id);
  if (!res.ok) {
    toast.show({ message: res.error.message || '更新失败', type: 'error' });
    return;
  }
  toast.show({ message: '售后进度已更新', type: 'success' });
  fetchOrder();
};

onLoad((options?: Record<string, string>) => {
  orderId.value = options?.id || 'o1';
  fetchOrder();
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

.nm-card--compact {
  padding: 28rpx;
}

.nm-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-sub {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-sub--loose {
  margin-top: 12rpx;
}

.nm-actions {
  margin-top: 24rpx;
  padding-bottom: 24rpx;
  border-bottom: 1rpx solid $nm-border;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-action {
  padding: 12rpx 28rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  margin-right: 20rpx;
}

.nm-action--primary {
  background-color: $nm-brand-primary;
  border-color: $nm-brand-primary;
  color: $nm-text-inverse;
}

.nm-section {
  margin-top: $nm-space-lg;
}

.nm-section__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-step {
  margin-top: 24rpx;
  flex-direction: row;
  align-items: flex-start;
}

.nm-step__dot {
  width: 20rpx;
  height: 20rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
  margin-right: 20rpx;
  margin-top: 12rpx;
}

.nm-step__dot--active {
  background-color: $nm-brand-primary;
}

.nm-step__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-step__meta {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-step__action {
  margin-top: $nm-space-sm;
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  align-self: flex-start;
}

.nm-item {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 0;
  border-bottom: 1rpx solid $nm-border;
}

.nm-item__info {
  flex: 1;
  margin-right: 24rpx;
}

.nm-item__title {
  font-size: $nm-font-body;
  color: $nm-text-primary;
  font-weight: 600;
}

.nm-item__meta {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-item__price {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-total-row {
  margin-top: 24rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid $nm-border;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-total {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-skeleton {
  margin-top: $nm-space-sm;
}

.nm-empty {
  margin-top: $nm-space-sm;
}
</style>
