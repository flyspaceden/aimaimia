<template>
  <Screen :safeTop="true">
    <AppHeader :title="pageTitle" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
      @scrolltolower="onLoadMore"
    >
      <view class="nm-tabs">
        <view
          v-for="tab in tabs"
          :key="tab.value"
          :class="['nm-tab', activeStatus === tab.value ? 'nm-tab--active' : '']"
          @click="setStatus(tab.value)"
        >
          {{ tab.label }}
        </view>
      </view>

      <ErrorState v-if="errorMessage" :text="errorMessage" @retry="onRefresh" />
      <Skeleton v-else-if="loading && orders.length === 0" :count="2" type="card" class="nm-skeleton-wrap" />
      <view v-else-if="orders.length === 0" class="nm-empty">
        <EmptyState text="暂无订单" hint="去首页看看新鲜好物" />
      </view>
      <view v-else>
        <view v-for="order in orders" :key="order.id" class="nm-card" @click="goDetail(order.id)">
          <view class="nm-header">
            <text class="nm-title">{{ order.id }}</text>
            <text class="nm-status">{{ statusLabel(order.statusCode) }}</text>
          </view>
          <text class="nm-sub">
            {{ order.createdAt || '刚刚' }} · {{ order.items.length }} 件商品
          </text>
          <text v-if="order.afterSaleStatus" class="nm-sub nm-sub--tight">
            售后进度：{{ afterSaleLabels[order.afterSaleStatus] || '处理中' }}
          </text>
          <view class="nm-row nm-row--between">
            <text class="nm-price">合计 ¥{{ order.totalPrice.toFixed(2) }}</text>
            <view class="nm-action-row">
              <text v-if="order.statusCode === 'pendingPay'" class="nm-action nm-action--primary">去支付</text>
              <text class="nm-action nm-action--link">查看详情</text>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { computed, onMounted, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Screen, AppHeader, EmptyState, ErrorState, Skeleton } from '@/components';
import { OrderRepo, type Order, type OrderStatus } from '@/services/repos';

const tabs: Array<{ label: string; value: OrderStatus | '' }> = [
  { label: '全部', value: '' },
  { label: '待付款', value: 'pendingPay' },
  { label: '待发货', value: 'pendingShip' },
  { label: '待收货', value: 'shipping' },
  { label: '退款/售后', value: 'afterSale' },
  { label: '已完成', value: 'completed' },
];
const orders = ref<Order[]>([]);
const activeStatus = ref<string>('');
const page = ref(1);
const pageSize = ref(6);
const hasMore = ref(true);
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');

const goDetail = (id: string) => {
  navTo({ url: `/pages-sub/order/order-detail?id=${id}` });
};

const orderStatusLabels: Record<OrderStatus, string> = {
  pendingPay: '待付款',
  pendingShip: '待发货',
  shipping: '待收货',
  afterSale: '退款/售后',
  completed: '已完成',
};

const afterSaleLabels: Record<string, string> = {
  applying: '申请中',
  reviewing: '审核中',
  refunding: '退款中',
  completed: '已完成',
};

const pageTitle = computed(() => {
  if (!activeStatus.value) return '全部订单';
  const key = activeStatus.value as OrderStatus;
  return orderStatusLabels[key] || '订单';
});

const statusLabel = (status: OrderStatus) => orderStatusLabels[status] || '订单处理中';

const setStatus = (status: OrderStatus | '') => {
  activeStatus.value = status;
  onRefresh();
};

const fetchOrders = async (reset: boolean) => {
  if (loading.value) return;
  if (!hasMore.value && !reset) return;
  loading.value = true;
  const nextPage = reset ? 1 : page.value + 1;
  const res = await OrderRepo.list({ page: nextPage, pageSize: pageSize.value, status: activeStatus.value });
  if (res.ok) {
    errorMessage.value = '';
    orders.value = reset ? res.data.items : orders.value.concat(res.data.items);
    page.value = res.data.page;
    hasMore.value = res.data.hasMore;
  } else {
    errorMessage.value = res.error.message || '加载失败';
  }
  loading.value = false;
  if (refreshing.value) refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  hasMore.value = true;
  errorMessage.value = '';
  fetchOrders(true);
};

const onLoadMore = () => {
  fetchOrders(false);
};

onMounted(() => {
  fetchOrders(true);
});

onLoad((options?: Record<string, string>) => {
  const status = options?.status as OrderStatus | undefined;
  if (status) {
    activeStatus.value = status;
  }
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: $nm-space-3xl;
}

.nm-tabs {
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: $nm-space-md;
}

.nm-tab {
  margin-right: $nm-space-sm;
  margin-bottom: $nm-space-sm;
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-tab--active {
  border-color: $nm-brand-primary;
  background-color: $nm-brand-primary-soft;
  color: $nm-brand-primary;
}

.nm-card {
  padding: 28rpx;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  margin-bottom: $nm-space-md;
  border: 1rpx solid $nm-border;
}

.nm-header {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-status {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-sub {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-sub--tight {
  margin-top: 8rpx;
}

.nm-row {
  margin-top: 20rpx;
  flex-direction: row;
  align-items: center;
}

.nm-row--between {
  justify-content: space-between;
}

.nm-price {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-action-row {
  flex-direction: row;
  align-items: center;
}

.nm-action {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-action--primary {
  color: $nm-brand-primary;
  margin-right: 20rpx;
}

.nm-action--link {
  color: $nm-accent-blue;
}

.nm-skeleton-wrap {
  margin-top: $nm-space-md;
}

.nm-empty {
  margin-top: $nm-space-md;
}
</style>
