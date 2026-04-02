<template>
  <Screen :safeTop="true">
    <AppHeader title="心愿详情" />

    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
      @scrolltolower="onLoadMore"
    >
      <view v-if="wishLoading && !wish" class="nm-skeleton">
        <Skeleton :count="1" type="card" :height="440" />
        <view class="nm-skeleton__gap" />
        <Skeleton :count="1" type="line" :height="32" />
        <Skeleton :count="1" type="line" :height="32" class="nm-skeleton__line" />
      </view>
      <ErrorState v-else-if="wishError" :text="wishError" @retry="onRefresh" />
      <view v-else class="nm-content">
        <view class="nm-card nm-hero nm-card--border">
          <view class="nm-author-row">
            <image v-if="authorAvatar" :src="authorAvatar" class="nm-avatar" mode="aspectFill" />
            <view v-else class="nm-avatar nm-avatar--empty" />
            <view class="nm-author-info">
              <text class="nm-author-name">{{ authorName }}</text>
              <text class="nm-author-meta">{{ wish?.createdAt || '刚刚' }}</text>
            </view>
            <view :class="['nm-status-pill', statusTone]">
              <text class="nm-status-pill__text">{{ statusLabel }}</text>
            </view>
          </view>

          <text class="nm-title">{{ wish?.title }}</text>
          <text class="nm-desc">{{ wishContent }}</text>

          <view class="nm-tag-row">
            <Tag v-if="typeLabel" :label="typeLabel" tone="accent" class="nm-tag" />
            <Tag v-for="tag in wish?.tags || []" :key="tag" :label="tag" class="nm-tag" />
            <Tag
              v-for="mention in wish?.mentions || []"
              :key="mention.id"
              :label="`@${mention.name}`"
              tone="accent"
              class="nm-tag"
            />
          </view>

          <view class="nm-progress">
            <text class="nm-progress__label">进度 {{ progress }}%</text>
            <view class="nm-progress__track">
              <view class="nm-progress__fill" :style="{ width: `${progress}%` }" />
            </view>
          </view>

          <view class="nm-meta-row">
            <view class="nm-meta-item">
              <text class="nm-meta-label">评论</text>
              <text class="nm-meta-value">{{ wish?.comments || 0 }}</text>
            </view>
            <view class="nm-like" @click="toggleWishLike">
              <Icon
                class="nm-like__icon"
                :name="liked ? 'heart' : 'heart-outline'"
                :size="32"
                :color="liked ? danger : textSecondary"
              />
              <text class="nm-like__count">{{ wish?.likes || 0 }}</text>
            </view>
          </view>
        </view>

        <view class="nm-card">
          <view class="nm-section-header">
            <text class="nm-section-title">心愿力</text>
            <text class="nm-section-meta">{{ powerLevel }} · {{ powerScore }}</text>
          </view>
          <view class="nm-progress nm-progress--compact">
            <view class="nm-progress__track">
              <view class="nm-progress__fill" :style="{ width: `${powerProgress}%` }" />
            </view>
          </view>
          <view class="nm-power-meta">
            <text class="nm-power-tip">{{ powerTip }}</text>
            <text class="nm-power-tip">当前徽章 {{ badgeCount }} 枚</text>
          </view>
          <view v-if="badges.length" class="nm-badge-row">
            <Tag
              v-for="badge in badges"
              :key="badge.id"
              :label="badge.label"
              :tone="badgeTone(badge)"
              class="nm-tag"
            />
          </view>
          <text v-else class="nm-muted">继续互动即可解锁徽章</text>
        </view>

        <view class="nm-card">
          <view class="nm-section-header">
            <text class="nm-section-title">企业接单</text>
            <view class="nm-status-pill nm-status-pill--neutral">
              <text class="nm-status-pill__text">{{ fulfillmentLabel }}</text>
            </view>
          </view>
          <text class="nm-section-desc">
            {{ fulfillmentDesc }}
          </text>
          <view v-if="wish?.fulfillment?.status === 'open'" class="nm-action" @click="acceptByCompany">
            申请企业接单
          </view>
        </view>

        <view v-if="wish?.crowdfunding" class="nm-card">
          <view class="nm-section-header">
            <text class="nm-section-title">心愿众筹</text>
            <view class="nm-status-pill" :class="crowdStatusTone">
              <text class="nm-status-pill__text">{{ crowdStatusLabel }}</text>
            </view>
          </view>
          <text class="nm-section-desc">
            已筹 ¥{{ wish?.crowdfunding?.pledgedAmount }} / 目标 ¥{{ wish?.crowdfunding?.targetAmount }} ·
            {{ wish?.crowdfunding?.supporters }} 人支持
          </text>
          <view class="nm-progress nm-progress--compact">
            <view class="nm-progress__track">
              <view class="nm-progress__fill nm-progress__fill--accent" :style="{ width: `${crowdProgress}%` }" />
            </view>
          </view>
          <view v-if="wish?.crowdfunding?.status === 'open'" class="nm-crowd-row">
            <view v-for="amount in crowdPresets" :key="amount" class="nm-crowd-chip" @click="supportCrowdfunding(amount)">
              支持 ¥{{ amount }}
            </view>
          </view>
        </view>

        <view v-if="wish?.exchange" class="nm-card">
          <view class="nm-section-header">
            <text class="nm-section-title">积分兑换</text>
            <text class="nm-section-meta">当前积分 {{ mockPoints }}</text>
          </view>
          <text class="nm-section-desc">
            兑换所需 {{ wish?.exchange?.pointsRequired }} 积分 · 库存 {{ wish?.exchange?.stock }}
          </text>
          <text v-if="exchangeSoldOut" class="nm-warning">库存不足</text>
          <view class="nm-action" :class="exchangeDisabled ? 'nm-action--disabled' : ''" @click="redeemPoints">
            {{ exchangeButtonText }}
          </view>
        </view>

        <view v-if="isOwner" class="nm-card nm-card--flat">
          <text class="nm-section-title">更新心愿状态</text>
          <view class="nm-status-row">
            <view
              v-for="option in statusOptions"
              :key="option.value"
              :class="['nm-status-chip', wish?.status === option.value ? 'nm-status-chip--active' : '']"
              @click="updateStatus(option.value)"
            >
              <text :class="['nm-status-chip__text', wish?.status === option.value ? 'nm-status-chip__text--active' : '']">
                {{ option.label }}
              </text>
            </view>
          </view>
        </view>

        <view v-if="wish?.responses && wish.responses.length" class="nm-card nm-card--flat">
          <text class="nm-section-title">官方/企业回复</text>
          <view v-for="resp in wish.responses" :key="resp.id" class="nm-response">
            <text class="nm-response__meta">
              {{ resp.type === 'platform' ? '平台回复' : '企业回复' }} · {{ resp.createdAt }}
            </text>
            <text class="nm-response__content">{{ resp.content }}</text>
          </view>
        </view>

        <view class="nm-comments">
          <view class="nm-comments__header">
            <text class="nm-comments__title">评论</text>
            <view class="nm-comments__sort">
              <text
                v-for="item in sortOptions"
                :key="item.id"
                :class="['nm-comments__sort-item', commentSort === item.id ? 'nm-comments__sort-item--active' : '']"
                @click="commentSort = item.id"
              >
                {{ item.label }}
              </text>
            </view>
          </view>
          <text class="nm-comments__desc">像小红书一样聊一聊</text>
          <ErrorState v-if="commentError" :text="commentError" @retry="onRefresh" />
          <Skeleton v-else-if="loading && comments.length === 0" :count="2" type="line" :height="180" />
          <EmptyState v-else-if="!loading && comments.length === 0" text="暂无评论" hint="成为第一个发声的人" />
          <view v-else>
            <view v-for="comment in sortedComments" :key="comment.id" class="nm-comment">
              <view class="nm-comment__row">
                <view class="nm-comment__avatar" />
                <view class="nm-comment__body">
                  <view class="nm-comment__name-row">
                    <text class="nm-comment__name">{{ comment.author }}</text>
                    <text class="nm-comment__time">{{ comment.createdAt || '刚刚' }}</text>
                  </view>
                  <text class="nm-comment__content">{{ comment.content }}</text>
                  <view class="nm-comment__actions">
                    <text class="nm-comment__action" @click="setReplyTarget(comment)">回复</text>
                    <view class="nm-comment__like" @click="toggleCommentLike(comment)">
                      <Icon
                        :name="comment.liked ? 'heart' : 'heart-outline'"
                        :size="28"
                        :color="comment.liked ? danger : textSecondary"
                      />
                      <text class="nm-comment__like-count">{{ comment.likes }}</text>
                    </view>
                  </view>
                </view>
              </view>
              <view v-if="comment.replies" class="nm-replies">
                <view v-for="reply in comment.replies" :key="reply.id" class="nm-reply">
                  <view class="nm-reply__meta">
                    <text class="nm-reply__name">{{ reply.author }}</text>
                    <text class="nm-reply__time">{{ reply.createdAt || '刚刚' }}</text>
                  </view>
                  <text class="nm-reply__content">{{ reply.content }}</text>
                </view>
              </view>
            </view>
          </view>
          <LoadMore v-if="loading" text="加载中..." />
          <LoadMore v-else-if="!hasMore && comments.length > 0" text="没有更多了" />
        </view>
      </view>
    </scroll-view>

    <CommentInput
      v-model="inputText"
      placeholder="写下你的评论..."
      :disabled="!inputText || !inputText.trim()"
      :replyTo="replyToName"
      @cancel="clearReply"
      @send="sendComment"
    />
  </Screen>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Screen, AppHeader, EmptyState, ErrorState, Skeleton, CommentInput, LoadMore, Tag, Icon } from '@/components';
import { CommentRepo, WishRepo } from '@/services/repos';
import type { Wish, WishStatus } from '@/services/repos';
import type { Comment } from '@/services/repos/comment';
import { useToast } from '@/components/feedback/useToast';

const danger = '#C0392B';
const textSecondary = '#4B5B53';
const toast = useToast();
const currentUserId = 'u1';
const wishId = ref('w1');
const wish = ref<Wish | null>(null);
const wishLoading = ref(false);
const wishError = ref('');

const commentSort = ref<'latest' | 'earliest' | 'relevant' | 'top'>('latest');
const sortOptions: Array<{ id: 'earliest' | 'latest' | 'relevant' | 'top'; label: string }> = [
  { id: 'earliest', label: '最早' },
  { id: 'latest', label: '最晚' },
  { id: 'relevant', label: '最相关' },
  { id: 'top', label: '最多赞' },
];
const comments = ref<Comment[]>([]);
const page = ref(1);
const pageSize = ref(6);
const hasMore = ref(true);
const loading = ref(false);
const refreshing = ref(false);
const commentError = ref('');
const inputText = ref('');
const replyTarget = ref<Comment | null>(null);
const mockPoints = 320;
const crowdPresets = [10, 30, 50];

const authorName = computed(() => {
  if (!wish.value) return '';
  if (typeof wish.value.author === 'string') return wish.value.author;
  return wish.value.author?.name || '匿名';
});
const authorAvatar = computed(() => {
  if (!wish.value) return '';
  if (typeof wish.value.author === 'string') return '';
  return wish.value.author?.avatar || '';
});

const statusLabelMap: Record<WishStatus, string> = {
  草稿: '草稿',
  规划中: '规划中',
  已采纳: '已采纳',
  已实现: '已实现',
};
const statusLabel = computed(() => (wish.value ? statusLabelMap[wish.value.status] : ''));
const statusTone = computed(() => {
  if (!wish.value) return 'nm-status-pill--neutral';
  if (wish.value.status === '规划中') return 'nm-status-pill--brand';
  if (wish.value.status === '已采纳') return 'nm-status-pill--accent';
  return 'nm-status-pill--neutral';
});
const typeLabel = computed(() => wish.value?.type || '');
const wishContent = computed(() => wish.value?.content || (wish.value as any)?.description || '');
const replyToName = computed(() => replyTarget.value?.author || '');

const progress = computed(() => {
  if (!wish.value) return 0;
  if (typeof wish.value.progress === 'number') return wish.value.progress;
  if (wish.value.status === '已实现') return 100;
  if (wish.value.status === '已采纳') return 60;
  return 30;
});

const liked = computed(() => (wish.value?.likedBy || []).includes(currentUserId));

const powerScore = computed(() => wish.value?.wishPower?.score ?? wish.value?.power ?? 0);
const powerLevel = computed(() => wish.value?.wishPower?.level ?? '萌芽');
const powerTarget = computed(() => wish.value?.wishPower?.nextLevelMin ?? 200);
const powerProgress = computed(() => {
  const total = powerTarget.value || 1;
  return Math.min(100, Math.round((powerScore.value / total) * 100));
});
const powerTip = computed(() => {
  if (!wish.value?.wishPower) return '已达到最高等级';
  const next = powerTarget.value;
  if (!next) return '已达到最高等级';
  return `距离下一等级还差 ${Math.max(0, next - powerScore.value)}`;
});
const badges = computed(() => wish.value?.badges || []);
const badgeCount = computed(() => badges.value.length);

const fulfillmentLabelMap = {
  open: '待企业接单',
  accepted: '企业已接单',
  producing: '生产推进中',
  delivered: '交付完成',
};
const fulfillmentLabel = computed(() => {
  const status = wish.value?.fulfillment?.status || 'open';
  return fulfillmentLabelMap[status];
});
const fulfillmentDesc = computed(() => {
  const name = wish.value?.fulfillment?.companyName;
  return name ? `当前接单企业：${name}` : '企业可接单并进入生产排期';
});

const crowdProgress = computed(() => {
  const crowd = wish.value?.crowdfunding;
  if (!crowd) return 0;
  return Math.min(100, Math.round((crowd.pledgedAmount / crowd.targetAmount) * 100));
});
const crowdStatusLabel = computed(() => (wish.value?.crowdfunding?.status === 'success' ? '已达成' : '进行中'));
const crowdStatusTone = computed(() =>
  wish.value?.crowdfunding?.status === 'success' ? 'nm-status-pill--brand' : 'nm-status-pill--accent'
);

const exchangeSoldOut = computed(() => (wish.value?.exchange?.stock ?? 0) <= 0);
const exchangeDisabled = computed(() => exchangeSoldOut.value || wish.value?.exchange?.redeemed);
const exchangeButtonText = computed(() => (wish.value?.exchange?.redeemed ? '已兑换' : '立即兑换'));

const isOwner = computed(() => {
  if (!wish.value) return false;
  if (typeof wish.value.author === 'string') return false;
  return wish.value.author?.id === currentUserId;
});

const statusOptions = [
  { value: '规划中' as WishStatus, label: '规划中' },
  { value: '已采纳' as WishStatus, label: '已采纳' },
  { value: '已实现' as WishStatus, label: '已实现' },
];

const sortedComments = computed(() => {
  const list = [...comments.value];
  const toTime = (value?: string) => (value ? new Date(value.replace(' ', 'T')).getTime() : 0);
  if (commentSort.value === 'earliest') {
    return list.sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt));
  }
  if (commentSort.value === 'top') {
    return list.sort((a, b) => b.likes - a.likes);
  }
  if (commentSort.value === 'relevant') {
    return list.sort((a, b) => b.likes + (b.replies?.length || 0) - (a.likes + (a.replies?.length || 0)));
  }
  return list.sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
});

const fetchWish = async () => {
  wishLoading.value = true;
  const res = await WishRepo.getById(wishId.value);
  if (res.ok) {
    wishError.value = '';
    wish.value = res.data;
  } else {
    wishError.value = res.error.message || '加载失败';
  }
  wishLoading.value = false;
};

const fetchComments = async (reset: boolean) => {
  if (loading.value) return;
  if (!hasMore.value && !reset) return;
  loading.value = true;
  const nextPage = reset ? 1 : page.value + 1;
  const res = await CommentRepo.list({
    page: nextPage,
    pageSize: pageSize.value,
    targetId: wishId.value,
    targetType: 'wish',
  });
  if (res.ok) {
    commentError.value = '';
    comments.value = reset ? res.data.items : comments.value.concat(res.data.items);
    page.value = res.data.page;
    hasMore.value = res.data.hasMore;
  } else {
    commentError.value = res.error.message || '加载失败';
  }
  loading.value = false;
  if (refreshing.value) refreshing.value = false;
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  hasMore.value = true;
  commentError.value = '';
  Promise.all([fetchWish(), fetchComments(true)]).catch(() => {
    refreshing.value = false;
  });
};

const onLoadMore = () => {
  fetchComments(false);
};

const clearReply = () => {
  replyTarget.value = null;
};

const setReplyTarget = (comment: Comment) => {
  replyTarget.value = comment;
};

const sendComment = (content: string) => {
  if (!content.trim()) return;
  uni.hideKeyboard();
  inputText.value = '';
  replyTarget.value = null;
  uni.showToast({ title: '发送成功（占位）', icon: 'none' });
};

const toggleWishLike = async () => {
  if (!wish.value) return;
  const res = await WishRepo.toggleLike({ wishId: wish.value.id, userId: currentUserId });
  if (res.ok) {
    if (!wish.value.likedBy) {
      wish.value.likedBy = [];
    }
    if (res.data.liked && !wish.value.likedBy.includes(currentUserId)) {
      wish.value.likedBy.push(currentUserId);
    }
    if (!res.data.liked) {
      wish.value.likedBy = wish.value.likedBy.filter((id) => id !== currentUserId);
    }
    wish.value.likes = res.data.likes;
  } else {
    toast.show({ message: res.error.message || '点赞失败', type: 'error' });
  }
};

const updateStatus = async (next: WishStatus) => {
  if (!wish.value) return;
  wish.value.status = next;
  await WishRepo.updateStatus({ wishId: wish.value.id, status: next });
  toast.show({ message: '状态已更新（占位）', type: 'success' });
};

const acceptByCompany = async () => {
  if (!wish.value) return;
  await WishRepo.acceptByCompany({ wishId: wish.value.id, companyId: 'c1' });
  toast.show({ message: '企业接单成功（占位）', type: 'success' });
};

const supportCrowdfunding = async (amount: number) => {
  if (!wish.value) return;
  await WishRepo.createCrowdfunding({ wishId: wish.value.id, targetAmount: amount });
  toast.show({ message: `已支持 ¥${amount}（占位）`, type: 'success' });
};

const redeemPoints = async () => {
  if (exchangeDisabled.value) return;
  if (!wish.value) return;
  await WishRepo.redeemPoints({ wishId: wish.value.id, points: wish.value.exchange?.pointsRequired || 0 });
  toast.show({ message: '兑换成功（占位）', type: 'success' });
};

const badgeTone = (badge: { tone?: string }) => {
  if (badge.tone === 'accent') return 'accent';
  return badge.tone === 'success' ? 'success' : 'neutral';
};

const toggleCommentLike = async (comment: Comment) => {
  const res = await CommentRepo.toggleLike({ commentId: comment.id, liked: !!comment.liked });
  if (res.ok) {
    comment.liked = res.data.liked;
    comment.likes = res.data.likes;
  }
};

onLoad((query) => {
  wishId.value = (query && query.id) || 'w1';
  fetchWish();
  fetchComments(true);
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  padding: $nm-space-xl;
  padding-bottom: calc(260rpx + env(safe-area-inset-bottom));
}

.nm-skeleton {
  padding: $nm-space-lg 0;
}

.nm-skeleton__gap {
  height: $nm-space-md;
}

.nm-skeleton__line {
  margin-top: $nm-space-sm;
}

.nm-card {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
  margin-bottom: $nm-space-lg;
}

.nm-hero {
  margin-top: $nm-space-sm;
}

.nm-card--flat {
  border-color: $nm-border;
  box-shadow: none;
}

.nm-card--border {
  border-color: $nm-border;
}

.nm-author-row {
  flex-direction: row;
  align-items: center;
}

.nm-avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
  margin-right: $nm-space-sm;
}

.nm-avatar--empty {
  background-color: $nm-brand-primary-soft;
}

.nm-author-info {
  flex: 1;
}

.nm-author-name {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-author-meta {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-status-pill {
  padding: 8rpx 20rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-background;
  border: 1rpx solid $nm-border;
}

.nm-status-pill__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-status-pill--brand {
  background-color: $nm-brand-primary-soft;
  border-color: transparent;
}

.nm-status-pill--brand .nm-status-pill__text {
  color: $nm-brand-primary;
}

.nm-status-pill--accent {
  background-color: $nm-accent-blue-soft;
  border-color: transparent;
}

.nm-status-pill--accent .nm-status-pill__text {
  color: $nm-accent-blue;
}

.nm-title {
  margin-top: $nm-space-md;
  font-size: $nm-font-title2;
  line-height: $nm-line-title2;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-desc {
  margin-top: $nm-space-sm;
  font-size: $nm-font-body;
  color: $nm-text-secondary;
}

.nm-tag-row {
  margin-top: $nm-space-md;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-tag {
  margin-right: 16rpx;
  margin-bottom: 16rpx;
}

.nm-progress {
  margin-top: $nm-space-md;
}

.nm-progress--compact {
  margin-top: $nm-space-sm;
}

.nm-progress__label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-progress__track {
  margin-top: 12rpx;
  height: 16rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
  overflow: hidden;
}

.nm-progress__fill {
  height: 100%;
  background-color: $nm-brand-primary;
}

.nm-progress__fill--accent {
  background-color: $nm-accent-blue;
}

.nm-meta-row {
  margin-top: $nm-space-md;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-meta-item {
  flex-direction: row;
  align-items: center;
}

.nm-meta-label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-meta-value {
  margin-left: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-primary;
}

.nm-like {
  flex-direction: row;
  align-items: center;
}

.nm-like__icon {
}

.nm-like__count {
  margin-left: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-section-header {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-section-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-section-meta {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-section-desc {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-power-meta {
  margin-top: $nm-space-md;
  flex-direction: row;
  justify-content: space-between;
}

.nm-power-tip {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-badge-row {
  margin-top: 20rpx;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-muted {
  margin-top: $nm-space-md;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-action {
  margin-top: $nm-space-sm;
  padding: 12rpx 24rpx;
  align-self: flex-start;
  background-color: $nm-surface;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-brand-primary;
  color: $nm-brand-primary;
  font-size: $nm-font-caption;
  text-align: center;
}

.nm-action--disabled {
  opacity: 0.4;
}

.nm-crowd-row {
  margin-top: $nm-space-sm;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-crowd-chip {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  margin-right: 16rpx;
  margin-bottom: 16rpx;
}

.nm-warning {
  margin-top: 6rpx;
  font-size: $nm-font-caption;
  color: $nm-danger;
}

.nm-status-row {
  margin-top: $nm-space-sm;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-status-chip {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  margin-right: 16rpx;
  margin-bottom: 16rpx;
}

.nm-status-chip--active {
  background-color: $nm-brand-primary;
  border-color: $nm-brand-primary;
}

.nm-status-chip__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-status-chip__text--active {
  color: $nm-text-inverse;
}

.nm-response {
  margin-top: $nm-space-md;
  padding-top: $nm-space-md;
  border-top: 1rpx solid $nm-border;
}

.nm-response__meta {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-response__content {
  margin-top: 6rpx;
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-comments {
  margin-top: $nm-space-lg;
}

.nm-comments__header {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8rpx;
}

.nm-comments__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-comments__sort {
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-comments__sort-item {
  margin-left: 12rpx;
  margin-bottom: 8rpx;
  padding: 8rpx 20rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-comments__sort-item--active {
  color: $nm-brand-primary;
  border-color: $nm-brand-primary;
  background-color: $nm-brand-primary-soft;
}

.nm-comments__desc {
  margin-bottom: $nm-space-md;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-comment {
  margin-top: $nm-space-md;
  padding: 24rpx;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
}

.nm-comment__row {
  flex-direction: row;
  align-items: flex-start;
}

.nm-comment__avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
  margin-right: $nm-space-sm;
}

.nm-comment__body {
  flex: 1;
}

.nm-comment__name-row {
  flex-direction: row;
  align-items: center;
}

.nm-comment__name {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-comment__time {
  margin-left: $nm-space-sm;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-comment__content {
  margin-top: 8rpx;
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-comment__actions {
  margin-top: 12rpx;
  flex-direction: row;
  align-items: center;
}

.nm-comment__action {
  margin-right: $nm-space-md;
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-comment__like {
  flex-direction: row;
  align-items: center;
}

.nm-comment__like-count {
  margin-left: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-replies {
  margin-top: 20rpx;
}

.nm-reply {
  margin-top: 20rpx;
  margin-left: 72rpx;
  padding: 20rpx;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
  background-color: $nm-background;
}

.nm-reply__name {
  font-size: $nm-font-caption;
  color: $nm-text-primary;
}

.nm-reply__meta {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-reply__time {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-reply__content {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}
</style>
