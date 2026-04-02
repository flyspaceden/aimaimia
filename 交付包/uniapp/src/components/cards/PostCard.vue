<template>
  <view class="nm-post" @click="emitPress">
    <view class="nm-post__header">
      <view class="nm-post__author" @click.stop="emitAuthor">
        <view class="nm-post__avatar" />
        <view class="nm-post__author-info">
          <view class="nm-post__name-row">
            <text class="nm-post__name" number-of-lines="1">{{ authorName }}</text>
            <Icon v-if="isCompany" class="nm-post__verify" name="check-decagram" :size="28" :color="accentBlue" />
          </view>
          <text class="nm-post__meta" number-of-lines="1">{{ authorTag }}</text>
          <view v-if="item.followed && item.intimacyLevel" class="nm-post__intimacy">
            <text class="nm-post__intimacy-text">亲密度 {{ item.intimacyLevel }}%</text>
            <view class="nm-post__intimacy-track">
              <view class="nm-post__intimacy-fill" :style="{ width: `${item.intimacyLevel}%` }" />
            </view>
          </view>
        </view>
      </view>
      <view class="nm-post__header-actions">
        <view
          v-if="showFollow"
          :class="['nm-post__follow', item.followed ? 'nm-post__follow--active' : '']"
          @click.stop="emitFollow"
        >
          <text :class="['nm-post__follow-text', item.followed ? 'nm-post__follow-text--active' : '']">
            {{ item.followed ? '已关注' : '关注' }}
          </text>
        </view>
        <view class="nm-post__more" @click.stop="emitMore">
          <Icon class="nm-post__more-icon" name="dots-horizontal" :size="36" :color="textSecondary" />
        </view>
      </view>
    </view>

    <view class="nm-post__media">
      <image v-if="coverImage" :src="coverImage" class="nm-post__media-image" mode="aspectFill" />
      <view v-else class="nm-post__media-image nm-post__media-image--empty" />
      <view v-if="imageCount > 1" class="nm-post__image-count">
        <text class="nm-post__image-count-text">+{{ imageCount - 1 }}</text>
      </view>
      <view v-if="item.productId" class="nm-post__product-tag" @click.stop="emitProduct">
        <text class="nm-post__product-tag-text">{{ item.productTagLabel || '即看即买' }}</text>
      </view>
    </view>

    <text class="nm-post__title" number-of-lines="2">{{ item.title }}</text>
    <text class="nm-post__content" number-of-lines="3">{{ item.content }}</text>

    <view v-if="item.tags && item.tags.length" class="nm-post__tags">
      <view v-for="tag in item.tags" :key="tag" class="nm-tag">
        <text class="nm-tag__text">{{ tag }}</text>
      </view>
    </view>

    <view class="nm-post__footer">
      <text class="nm-post__time">{{ item.createdAt || '刚刚' }}</text>
      <view class="nm-post__actions">
        <view class="nm-post__action" @click.stop="emitLike">
          <Icon
            class="nm-post__action-icon"
            :name="liked ? 'heart' : 'heart-outline'"
            :size="36"
            :color="liked ? dangerColor : textSecondary"
          />
          <text class="nm-post__action-text">{{ item.likes || 0 }}</text>
        </view>
        <view class="nm-post__action" @click.stop="emitComment">
          <Icon class="nm-post__action-icon" name="comment-processing-outline" :size="36" :color="textSecondary" />
          <text class="nm-post__action-text">{{ item.comments || 0 }}</text>
        </view>
        <view class="nm-post__action" @click.stop="emitShare">
          <Icon class="nm-post__action-icon" name="share-variant" :size="36" :color="textSecondary" />
          <text class="nm-post__action-text">{{ item.shares || 0 }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/ui/Icon.vue';

const props = withDefaults(
  defineProps<{
    item: Record<string, any>;
    currentUserId?: string;
  }>(),
  {
    currentUserId: '',
  }
);

const emit = defineEmits(['press', 'author', 'more', 'product', 'like', 'comment', 'share', 'follow']);

const authorName = computed(() => props.item.authorName || props.item.author || '匿名');
const authorTag = computed(() => [props.item.city, props.item.tag].filter(Boolean).join(' · '));
const isCompany = computed(() => props.item.authorType === 'company');
const isSelf = computed(() =>
  Boolean(props.currentUserId && props.item.authorId && props.item.authorId === props.currentUserId)
);
const showFollow = computed(() => !isSelf.value);
const imageList = computed(() => {
  if (Array.isArray(props.item.images) && props.item.images.length) return props.item.images;
  return props.item.image ? [props.item.image] : [];
});
const coverImage = computed(() => (imageList.value.length ? imageList.value[0] : ''));
const imageCount = computed(() => imageList.value.length);
const liked = computed(() => Boolean((props.item as any).liked));
const textSecondary = '#4B5B53';
const accentBlue = '#2B6CB0';
const dangerColor = '#C0392B';

const emitPress = () => emit('press', props.item);
const emitAuthor = () => emit('author', props.item);
const emitMore = () => emit('more', props.item);
const emitProduct = () => emit('product', props.item);
const emitLike = () => emit('like', props.item);
const emitComment = () => emit('comment', props.item);
const emitShare = () => emit('share', props.item);
const emitFollow = () => emit('follow', props.item);
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-post {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid $nm-border;
  margin-bottom: $nm-space-lg;
}

.nm-post__header {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-post__author {
  flex-direction: row;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.nm-post__avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
  margin-right: 12rpx;
}

.nm-post__author-info {
  flex: 1;
  min-width: 0;
}

.nm-post__name-row {
  flex-direction: row;
  align-items: center;
}

.nm-post__name {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-post__verify {
  margin-left: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-post__meta {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-post__intimacy {
  margin-top: 8rpx;
}

.nm-post__intimacy-text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-post__intimacy-track {
  margin-top: 6rpx;
  height: 10rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
  overflow: hidden;
}

.nm-post__intimacy-fill {
  height: 100%;
  background-color: $nm-brand-primary;
}

.nm-post__header-actions {
  flex-direction: row;
  align-items: center;
}

.nm-post__follow {
  padding: 6rpx 16rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-brand-primary;
}

.nm-post__follow--active {
  border-color: $nm-border;
}

.nm-post__follow-text {
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
}

.nm-post__follow-text--active {
  color: $nm-text-secondary;
}

.nm-post__more {
  margin-left: 12rpx;
  padding: 4rpx 8rpx;
}

.nm-post__more-icon {
  color: $nm-text-secondary;
}

.nm-post__media {
  margin-top: $nm-space-md;
  position: relative;
}

.nm-post__media-image {
  width: 100%;
  height: 320rpx;
  border-radius: $nm-radius-md;
  background-color: $nm-skeleton;
}

.nm-post__media-image--empty {
  background-color: $nm-skeleton;
}

.nm-post__image-count {
  position: absolute;
  right: 12rpx;
  top: 12rpx;
  padding: 6rpx 10rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-overlay;
}

.nm-post__image-count-text {
  font-size: $nm-font-caption;
  color: $nm-text-inverse;
}

.nm-post__product-tag {
  position: absolute;
  left: 12rpx;
  bottom: 12rpx;
  padding: 6rpx 10rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
}

.nm-post__product-tag-text {
  font-size: $nm-font-caption;
  color: $nm-text-inverse;
}

.nm-post__title {
  margin-top: $nm-space-sm;
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-post__content {
  margin-top: 6rpx;
  font-size: $nm-font-body;
  color: $nm-text-secondary;
}

.nm-post__tags {
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: $nm-space-sm;
}

.nm-tag {
  margin-right: 8rpx;
  margin-bottom: 8rpx;
  padding: 6rpx 12rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
}

.nm-tag__text {
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
}

.nm-post__footer {
  margin-top: $nm-space-md;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-post__time {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-post__actions {
  flex-direction: row;
  align-items: center;
}

.nm-post__action {
  flex-direction: row;
  align-items: center;
  margin-left: 12rpx;
}

.nm-post__action-icon {
  color: $nm-text-secondary;
}

.nm-post__action-text {
  margin-left: 6rpx;
  font-size: $nm-font-caption;
  line-height: $nm-line-caption;
  color: $nm-text-secondary;
}
</style>
