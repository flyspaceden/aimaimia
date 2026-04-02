<template>
  <BottomSheet :open="open" mode="auto" title="挂载商品" @close="emit('close')">
    <view class="nm-sheet">
      <Skeleton v-if="loading" :count="1" type="card" />
      <ErrorState v-else-if="errorMessage" :text="errorMessage" @retry="loadProduct" />
      <view v-else-if="product" class="nm-card">
        <image :src="product.image" class="nm-card__image" mode="aspectFill" />
        <view class="nm-card__body">
          <text class="nm-card__title">{{ product.title }}</text>
          <text class="nm-card__origin">{{ product.origin }}</text>
          <view class="nm-card__price-row">
            <text class="nm-card__price">¥{{ product.price }}</text>
            <text class="nm-card__unit">/{{ product.unit }}</text>
            <text v-if="product.strikePrice" class="nm-card__strike">¥{{ product.strikePrice }}</text>
          </view>
        </view>
      </view>
      <view v-else class="nm-empty">暂无关联商品</view>

      <view class="nm-actions">
        <view class="nm-btn nm-btn--primary" @click="addToCart">一键加购</view>
      </view>
    </view>
  </BottomSheet>
</template>

<script setup lang="ts">
// 商品快捷弹层（复刻 Expo 的 ProductQuickSheet）
import { ref, watch } from 'vue';
import { BottomSheet } from '@/components';
import { ProductRepo } from '@/services/repos';
import { CartState } from '@/services/state';
import { ErrorState, Skeleton } from '@/components';

const props = withDefaults(
  defineProps<{
    open: boolean;
    productId?: string;
  }>(),
  {
    open: false,
  }
);

const emit = defineEmits(['close']);
const product = ref<any | null>(null);
const loading = ref(false);
const errorMessage = ref('');

const loadProduct = async () => {
  if (!props.productId) {
    product.value = null;
    errorMessage.value = '';
    return;
  }
  loading.value = true;
  const res = await ProductRepo.getById(props.productId);
  if (res.ok) {
    product.value = res.data;
    errorMessage.value = '';
  } else {
    product.value = null;
    errorMessage.value = res.error.message || '商品加载失败';
  }
  loading.value = false;
};

watch(
  () => [props.open, props.productId],
  ([open]) => {
    if (open) loadProduct();
  }
);

const addToCart = () => {
  if (!product.value) return;
  // TODO(后端)：接入购物车接口后，这里应调用 CartRepo.addItem
  CartState.addProduct(
    { id: product.value.id, title: product.value.title, price: product.value.price, image: product.value.image },
    1
  );
  uni.showToast({ title: '已加入购物车', icon: 'success' });
  emit('close');
};
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-sheet {
  padding-bottom: $nm-space-xl;
}

.nm-card {
  border-radius: $nm-radius-lg;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  overflow: hidden;
  flex-direction: row;
  align-items: center;
  padding: $nm-space-md;
}

.nm-card__image {
  width: 168rpx;
  height: 168rpx;
  background-color: $nm-skeleton;
  border-radius: $nm-radius-md;
}

.nm-card__body {
  padding-left: $nm-space-md;
  flex: 1;
}

.nm-card__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-card__origin {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-card__price-row {
  margin-top: $nm-space-sm;
  flex-direction: row;
  align-items: baseline;
}

.nm-card__price {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-brand-primary;
}

.nm-card__unit {
  margin-left: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-card__strike {
  margin-left: 10rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  text-decoration: line-through;
}

.nm-empty {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  border: 1rpx solid $nm-border;
  color: $nm-text-secondary;
  text-align: center;
  background-color: $nm-surface;
}

.nm-actions {
  margin-top: $nm-space-md;
  flex-direction: row;
}

.nm-btn {
  flex: 1;
  padding: 14rpx 0;
  border-radius: $nm-radius-pill;
  text-align: center;
  font-size: $nm-font-caption;
}

.nm-btn--primary {
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
}
</style>
