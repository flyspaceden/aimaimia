<template>
  <Screen :safeTop="true">
    <AppHeader title="购物车" :subtitle="`共 ${items.length} 项商品`">
      <template #right>
        <IconButton v-if="items.length" @click="clearCart">
          <Icon name="trash-can-outline" :size="40" :color="textSecondary" />
        </IconButton>
      </template>
    </AppHeader>

    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view v-if="items.length === 0" class="nm-empty">
        <EmptyState text="购物车为空" hint="去首页逛逛，把喜欢的商品加入购物车吧" />
      </view>

      <view v-for="item in items" :key="item.productId" class="nm-card">
        <image v-if="item.image" class="nm-cover" :src="item.image" mode="aspectFill" />
        <view v-else class="nm-cover" />
          <view class="nm-info">
            <text class="nm-title" number-of-lines="2">{{ item.title }}</text>
            <view class="nm-meta">
              <QuantityStepper :value="item.qty" @change="onChangeQty(item.productId, $event)" />
              <view class="nm-delete" @click="remove(item.productId)">
                <Icon name="delete-outline" :size="36" :color="textSecondary" />
              </view>
            </view>
            <text class="nm-price">¥{{ item.price.toFixed(2) }}</text>
          </view>
        </view>
    </scroll-view>

    <view v-if="items.length" class="nm-checkout">
      <view>
        <text class="nm-total-label">合计</text>
        <text class="nm-total">¥{{ total }}</text>
      </view>
      <view class="nm-button" @click="goCheckout">去结算</view>
    </view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Screen, AppHeader, QuantityStepper, EmptyState, IconButton, Icon } from '@/components';
import { APP_EVENTS, CartState, onAppEvent } from '@/services/state';
import { useToast } from '@/components/feedback/useToast';

const textSecondary = '#4B5B53';
const items = ref(CartState.getSnapshot().items);
const refreshing = ref(false);
const toast = useToast();
let off: null | (() => void) = null;

const total = computed(() =>
  items.value.reduce((sum, item) => sum + item.price * item.qty, 0).toFixed(2)
);

const goCheckout = () => {
  if (items.value.length === 0) {
    toast.show({ message: '购物车为空', type: 'info' });
    return;
  }
  navTo({ url: '/pages-sub/order/checkout' });
};

const syncFromState = () => {
  items.value = CartState.getSnapshot().items;
};

const onChangeQty = (productId: string, qty: number) => {
  CartState.setQty(productId, qty);
};

const remove = (productId: string) => {
  CartState.remove(productId);
};

const clearCart = () => {
  CartState.clear();
  toast.show({ message: '已清空购物车', type: 'success' });
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  // 占位：真实场景可在此拉取服务端购物车，再更新 CartState
  setTimeout(() => {
    syncFromState();
    refreshing.value = false;
  }, 220);
};

onMounted(() => {
  // 监听购物车变化，保证数量/总价/空态联动
  off = onAppEvent(APP_EVENTS.CART_CHANGED, (snap) => {
    if (snap?.items) items.value = snap.items;
    else syncFromState();
  });
});

onBeforeUnmount(() => {
  if (off) off();
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: 232rpx;
}

.nm-empty {
  margin-top: $nm-space-lg;
}

.nm-card {
  flex-direction: row;
  padding: $nm-space-md;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  margin-bottom: $nm-space-md;
}

.nm-cover {
  width: 160rpx;
  height: 160rpx;
  border-radius: 28rpx;
  background-color: $nm-skeleton;
}

.nm-info {
  flex: 1;
  margin-left: $nm-space-md;
}

.nm-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-meta {
  margin-top: $nm-space-sm;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-delete {
  padding: 6rpx 0;
}

.nm-price {
  margin-top: $nm-space-sm;
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-brand-primary;
}

.nm-checkout {
  position: fixed;
  left: $nm-space-lg;
  right: $nm-space-lg;
  bottom: $nm-space-lg;
  padding: 28rpx;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-total-label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-total {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-button {
  padding: 20rpx 36rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  font-size: $nm-font-body;
  font-weight: 600;
}

</style>
