<template>
  <Screen :safeTop="true">
    <AppHeader :title="pageTitle" />
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view v-if="!isGroup && items.length === 0" class="nm-empty">
        <EmptyState text="暂无商品" hint="购物车为空，无法结算" />
      </view>

      <view v-else>
        <view v-if="isGroup" class="nm-card nm-card--highlight">
          <text class="nm-title">考察团信息</text>
          <text class="nm-sub">{{ groupTitle }}</text>
          <text class="nm-sub">出发时间：{{ groupDate }} {{ groupTime }}</text>
          <text class="nm-sub">提示：支付完成后视为报名成功（占位）</text>
        </view>

        <view class="nm-card">
          <text class="nm-title">收货地址</text>
          <text class="nm-sub">默认地址占位 · 可在后续接入地址管理</text>
        </view>

        <view v-if="!isGroup" class="nm-card">
          <text class="nm-title">商品清单</text>
          <view v-for="item in orderItems" :key="item.id" class="nm-item">
            <image class="nm-item__cover" :src="item.image" mode="aspectFill" />
            <view class="nm-item__body">
              <text class="nm-item__title">{{ item.title }}</text>
              <text class="nm-item__meta">数量 x{{ item.quantity }}</text>
            </view>
            <text class="nm-item__price">¥{{ item.price.toFixed(2) }}</text>
          </view>
        </view>

        <view class="nm-card">
          <text class="nm-title">支付方式</text>
          <view
            v-for="method in paymentMethods"
            :key="method.value"
            :class="['nm-pay', paymentMethod === method.value ? 'nm-pay--active' : '']"
            @click="paymentMethod = method.value"
          >
            <view class="nm-pay__body">
              <text class="nm-pay__title">{{ method.label }}</text>
              <text class="nm-pay__desc">{{ method.description }}</text>
            </view>
            <view class="nm-pay__radio" />
          </view>
        </view>

        <view v-if="!isGroup" class="nm-card">
          <text class="nm-title">费用明细</text>
          <view class="nm-row nm-row--between">
            <text class="nm-sub">商品小计</text>
            <text class="nm-sub">¥{{ total.toFixed(2) }}</text>
          </view>
          <view class="nm-row nm-row--between">
            <text class="nm-sub">运费</text>
            <text class="nm-sub">¥0.00</text>
          </view>
          <view class="nm-row nm-row--between">
            <text class="nm-sub">合计</text>
            <text class="nm-total">¥{{ total.toFixed(2) }}</text>
          </view>
        </view>

        <view class="nm-submit">
          <view class="nm-button" @click="handleCheckout">{{ isGroup ? '确认并支付' : '提交订单并支付' }}</view>
        </view>
      </view>
    </scroll-view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { Screen, AppHeader, EmptyState } from '@/components';
import { useToast } from '@/components/feedback/useToast';
import { CartState } from '@/services/state';
import { OrderRepo } from '@/services/repos';

const pageTitle = ref('确认订单');
const isGroup = ref(false);
const groupTitle = ref('考察团');
const groupDate = ref('');
const groupTime = ref('');
const refreshing = ref(false);
const toast = useToast();
const paymentMethod = ref<'wechat' | 'alipay'>('wechat');
const items = ref(CartState.getSnapshot().items);

onLoad((query) => {
  if (query?.source === 'group') {
    isGroup.value = true;
    pageTitle.value = '参团支付';
    if (query.title) groupTitle.value = decodeURIComponent(String(query.title));
    if (query.date) groupDate.value = decodeURIComponent(String(query.date));
    if (query.time) groupTime.value = decodeURIComponent(String(query.time));
  }
});

onShow(() => {
  if (!isGroup.value) {
    items.value = CartState.getSnapshot().items;
  }
});

const paymentMethods: Array<{ value: 'wechat' | 'alipay'; label: string; description: string }> = [
  { value: 'wechat', label: '微信支付', description: '推荐使用微信支付' },
  { value: 'alipay', label: '支付宝', description: '支持余额/花呗' },
];

const orderItems = computed(() =>
  items.value.map((item, index) => ({
    id: `oi-${item.productId}-${index}`,
    productId: item.productId,
    title: item.title,
    image: item.image || 'https://placehold.co/200x200/png',
    price: item.price,
    quantity: item.qty,
  }))
);

const total = computed(() => items.value.reduce((sum, item) => sum + item.price * item.qty, 0));

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  setTimeout(() => {
    refreshing.value = false;
  }, 300);
};

const handleCheckout = async () => {
  if (!isGroup.value && items.value.length === 0) {
    toast.show({ message: '购物车为空', type: 'info' });
    return;
  }
  if (isGroup.value) {
    toast.show({ message: '参团支付占位', type: 'info' });
    return;
  }
  const created = await OrderRepo.createFromCart({ items: orderItems.value, paymentMethod: paymentMethod.value });
  if (!created.ok) {
    toast.show({ message: created.error.message || '下单失败', type: 'error' });
    return;
  }
  const paid = await OrderRepo.payOrder(created.data.id, paymentMethod.value);
  if (!paid.ok) {
    toast.show({ message: paid.error.message || '支付失败', type: 'error' });
    return;
  }
  CartState.clear();
  toast.show({ message: '支付成功，订单已生成', type: 'success' });
  navTo({ url: '/pages-sub/order/orders' });
};
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
  margin-bottom: 32rpx;
}

.nm-card--highlight {
  border: 1rpx solid $nm-accent-blue;
  background-color: $nm-accent-blue-soft;
}

.nm-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-sub {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-row {
  margin-top: $nm-space-sm;
  flex-direction: row;
  align-items: center;
}

.nm-row--between {
  justify-content: space-between;
}

.nm-pay {
  margin-top: 20rpx;
  padding: $nm-space-md;
  border-radius: $nm-radius-lg;
  border: 1rpx solid $nm-border;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-pay--active {
  border-color: $nm-brand-primary;
}

.nm-pay__title {
  font-size: $nm-font-body;
  color: $nm-text-primary;
  font-weight: 600;
}

.nm-pay__desc {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-pay__radio {
  width: 36rpx;
  height: 36rpx;
  border-radius: $nm-radius-pill;
  border: 4rpx solid $nm-border;
}

.nm-pay--active .nm-pay__radio {
  background-color: $nm-brand-primary;
  border-color: $nm-brand-primary;
}

.nm-item {
  margin-top: 24rpx;
  flex-direction: row;
  align-items: center;
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
  color: $nm-text-primary;
  font-weight: 600;
}

.nm-total {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-submit {
  margin-top: $nm-space-md;
  align-items: center;
  width: 100%;
}

.nm-button {
  width: 100%;
  padding: 24rpx 0;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  font-size: $nm-font-body;
  font-weight: 600;
  text-align: center;
}

.nm-empty {
  padding: $nm-space-lg $nm-space-xl;
}
</style>
