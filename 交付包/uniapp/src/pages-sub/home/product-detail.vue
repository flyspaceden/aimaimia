<template>
  <Screen :safeTop="true">
    <AppHeader title="商品详情">
      <template #right>
        <view class="nm-cart" @click="goCart">
          <Icon class="nm-cart__icon" name="cart-outline" :size="44" :color="textPrimary" />
          <view v-if="cartCount > 0" class="nm-cart__badge">
            <text class="nm-cart__badge-text">{{ cartCount > 99 ? '99+' : cartCount }}</text>
          </view>
        </view>
      </template>
    </AppHeader>

    <scroll-view
      scroll-y
      class="nm-detail"
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view v-if="loading" class="nm-skeleton-wrap">
        <Skeleton :count="3" type="card" />
      </view>
      <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="onRefresh" />
      <EmptyState v-else-if="!product" text="商品不存在" />
      <view v-else>
        <image class="nm-hero" :src="product.image" mode="aspectFill" />
        <view class="nm-info">
          <text class="nm-title">{{ product.title }}</text>
          <text class="nm-origin">{{ product.origin }}</text>
          <view class="nm-price">
            <text class="nm-price__value">¥{{ product.price.toFixed(2) }}</text>
            <text class="nm-price__unit">/{{ product.unit }}</text>
            <text v-if="product.strikePrice" class="nm-price__strike">¥{{ product.strikePrice.toFixed(2) }}</text>
          </view>
          <view class="nm-tags">
            <Tag label="AI推荐" tone="accent" />
            <Tag v-for="tag in product.tags" :key="tag" :label="tag" />
          </view>
        </view>

        <view class="nm-ai-card">
          <text class="nm-ai-card__title">AI 推荐理由</text>
          <text class="nm-ai-card__text">可信产地 + 检测报告齐全，适合家庭低糖饮食。</text>
        </view>

        <view class="nm-trace-card" @click="showTrace">
          <view>
            <text class="nm-trace-card__title">AI 溯源图谱</text>
            <text class="nm-trace-card__sub">育种 - 种养 - 流通全链路可视化</text>
          </view>
          <text class="nm-trace-card__link">查看</text>
        </view>

        <view class="nm-section">
          <text class="nm-section__title">图文详情</text>
          <text class="nm-desc">这里展示商品产地、检测报告与图文详情内容（占位）。</text>
        </view>
      </view>
    </scroll-view>

    <view class="nm-bottom">
      <view class="nm-btn nm-btn--ghost" @click="addToCart">加入购物车</view>
      <view class="nm-btn nm-btn--primary" @click="buyNow">立即购买</view>
    </view>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Screen, AppHeader, Tag, EmptyState, ErrorState, Skeleton, Icon } from '@/components';
import { CartState, APP_EVENTS, onAppEvent } from '@/services/state';
import { ProductRepo, type Product } from '@/services/repos';
import { useToast } from '@/components/feedback/useToast';

const textPrimary = '#102016';
const toast = useToast();
const productId = ref('');
const product = ref<Product | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const refreshing = ref(false);
const cartCount = ref(CartState.getSnapshot().count);
let off: null | (() => void) = null;

const fetchProduct = async () => {
  if (!productId.value) return;
  loading.value = true;
  const res = await ProductRepo.getById(productId.value);
  if (res.ok) {
    product.value = res.data;
    errorMessage.value = '';
  } else {
    errorMessage.value = res.error.message || '加载失败';
  }
  loading.value = false;
  refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  fetchProduct();
};

const addToCart = () => {
  if (!product.value) return;
  CartState.addProduct({
    id: product.value.id,
    title: product.value.title,
    price: product.value.price,
    image: product.value.image,
  });
  toast.show({ message: '已加入购物车', type: 'success' });
};

const buyNow = () => {
  toast.show({ message: '购买功能即将上线', type: 'info' });
};

const showTrace = () => {
  toast.show({ message: 'AI 溯源图谱即将上线', type: 'info' });
};

const goCart = () => {
  navTo({ url: '/pages-sub/order/cart' });
};

onLoad((options?: Record<string, string>) => {
  productId.value = options?.id || 'p1';
  fetchProduct();
});

onMounted(() => {
  off = onAppEvent(APP_EVENTS.CART_CHANGED, (snap) => {
    cartCount.value = snap?.count ?? CartState.getSnapshot().count;
  });
});

onBeforeUnmount(() => {
  if (off) off();
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-detail {
  flex: 1;
  padding-bottom: 280rpx;
}

.nm-hero {
  height: 560rpx;
  margin: $nm-space-xl $nm-space-xl 0;
  border-radius: $nm-radius-lg;
  background-color: $nm-skeleton;
}

.nm-info {
  padding: $nm-space-lg $nm-space-xl 0;
}

.nm-title {
  font-size: $nm-font-title2;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-origin {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-price {
  margin-top: $nm-space-md;
  flex-direction: row;
  align-items: flex-end;
}

.nm-price__value {
  font-size: $nm-font-body;
  color: $nm-brand-primary;
  font-weight: 600;
}

.nm-price__unit {
  margin-left: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-price__strike {
  margin-left: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-muted;
  text-decoration: line-through;
}

.nm-tags {
  flex-direction: row;
  flex-wrap: wrap;
  gap: $nm-space-xs;
  margin-top: $nm-space-md;
}

.nm-ai-card {
  margin: $nm-space-lg $nm-space-xl 0;
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-accent-blue-soft;
  box-shadow: $nm-shadow-sm;
}

.nm-ai-card__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-accent-blue;
}

.nm-ai-card__text {
  margin-top: $nm-space-sm;
  font-size: $nm-font-body;
  color: $nm-text-secondary;
}

.nm-trace-card {
  margin: $nm-space-lg $nm-space-xl 0;
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-trace-card__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-trace-card__sub {
  margin-top: $nm-space-xs;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-trace-card__link {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-brand-primary;
}

.nm-section {
  margin-top: $nm-space-lg;
  padding: $nm-space-lg $nm-space-xl;
}

.nm-section__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-desc {
  margin-top: $nm-space-sm;
  font-size: $nm-font-body;
  color: $nm-text-secondary;
}

.nm-bottom {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: $nm-space-sm $nm-space-xl calc(#{$nm-space-md} + env(safe-area-inset-bottom));
  background-color: $nm-surface;
  border-top: 1rpx solid $nm-border;
  flex-direction: row;
  gap: $nm-space-md;
}

.nm-btn {
  flex: 1;
  padding: 24rpx 0;
  border-radius: $nm-radius-md;
  font-size: $nm-font-body;
  font-weight: 600;
  text-align: center;
}

.nm-btn--ghost {
  background-color: $nm-brand-primary-soft;
  color: $nm-brand-primary;
}

.nm-btn--primary {
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
}

.nm-cart {
  padding: 16rpx;
  align-items: center;
  justify-content: center;
}

.nm-cart__icon {
}

.nm-cart__badge {
  position: absolute;
  top: -12rpx;
  right: -16rpx;
  min-width: 36rpx;
  height: 36rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-accent-blue;
  align-items: center;
  justify-content: center;
  padding: 0 6rpx;
}

.nm-cart__badge-text {
  font-size: $nm-font-caption;
  color: $nm-text-inverse;
}

.nm-skeleton-wrap {
  padding: $nm-space-xl;
}
</style>
