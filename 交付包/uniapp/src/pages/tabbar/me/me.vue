<template>
  <Screen :safeTop="true">
    <view class="nm-topbar">
      <view class="nm-topbar__main">
        <text class="nm-topbar__title" lines="1">我的</text>
        <text class="nm-topbar__subtitle" lines="1">你的专属农脉空间</text>
      </view>
      <view class="nm-topbar__actions">
        <view class="nm-icon-wrap" @click="goInbox">
          <Icon class="nm-icon" name="bell-outline" :size="36" :color="textSecondary" />
          <view v-if="inboxUnreadCount > 0" class="nm-icon-badge">
            <text class="nm-icon-badge__text">{{ inboxUnreadCount > 99 ? '99+' : inboxUnreadCount }}</text>
          </view>
        </view>
        <view class="nm-icon-wrap nm-icon-wrap--cart" @click="goCart">
          <text class="nm-icon">🛒</text>
          <view v-if="cartCount > 0" class="nm-icon-badge nm-icon-badge--green">
            <text class="nm-icon-badge__text">{{ cartCount > 99 ? '99+' : cartCount }}</text>
          </view>
        </view>
      </view>
    </view>

    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view v-if="!isLoggedIn" class="nm-login-card" @click="showAuth = true">
        <view class="nm-login-info">
          <text class="nm-login-title" lines="1">登录/注册</text>
          <text class="nm-login-sub" lines="2">登录后解锁会员权益、任务签到与订单追踪</text>
        </view>
        <view class="nm-login-btn">立即登录</view>
      </view>

      <view v-else class="nm-profile-card" @click="goProfile">
        <view v-if="profile" class="nm-profile-row">
          <view class="nm-avatar-frame" @click.stop="goAppearance">
            <image v-if="profile.avatar" :src="profile.avatar" class="nm-avatar" mode="aspectFill" />
            <view v-else class="nm-avatar" />
          </view>
          <view class="nm-profile-info">
            <text class="nm-profile-greeting" lines="1">{{ greeting }}</text>
            <text class="nm-profile-name" lines="1">{{ profile.name }}</text>
            <text class="nm-profile-meta" lines="1">{{ profile.location || '—' }}</text>
            <view v-if="profileTags.length" class="nm-profile-tags">
              <view v-for="tag in profileTags" :key="tag" class="nm-tag">{{ tag }}</view>
            </view>
          </view>
          <view class="nm-profile-actions">
            <view class="nm-ai" @click.stop="goAiAssistant">
              <Icon class="nm-ai__icon" name="robot-happy-outline" :size="32" :color="accentBlue" />
              <text class="nm-ai__text">AI农管家</text>
            </view>
            <view class="nm-vip" @click.stop="goVip">会员权益</view>
          </view>
        </view>
        <view v-else class="nm-profile-skeleton">加载中...</view>
        <view class="nm-progress">
          <text class="nm-progress__level">{{ profile ? profile.level : '' }}</text>
          <view class="nm-progress__track">
            <view class="nm-progress__fill" :style="{ width: profile ? `${Math.min(100, profile.levelProgress * 100)}%` : '0%' }" />
          </view>
          <text class="nm-progress__text">
            距离下一等级还差 {{ profile ? Math.max(0, profile.nextLevelPoints - profile.growthPoints) : 0 }} 成长值
          </text>
          <text v-if="levelMeta" class="nm-progress__text">下一等级：{{ levelMeta.next }} · 权益：{{ levelMeta.perks }}</text>
          <text class="nm-progress__text">成长值来源：消费 / 互动 / 创作</text>
        </view>
        <view class="nm-assets">
          <view class="nm-asset">
            <text class="nm-asset__label">成长值</text>
            <text class="nm-asset__value">{{ profile ? profile.growthPoints : 0 }}</text>
          </view>
          <view class="nm-asset">
            <text class="nm-asset__label">农脉积分</text>
            <text class="nm-asset__value">{{ profile ? profile.points : 0 }}</text>
          </view>
        </view>
      </view>

      <view class="nm-section">
        <view class="nm-card">
          <view class="nm-section__header">
            <text class="nm-section__title">7 天签到</text>
            <text class="nm-section__link" @click="showCheckinRule">奖励说明</text>
          </view>
          <view v-if="checkIn" class="nm-checkin-summary">
            <view>
              <text class="nm-section__sub">今日奖励</text>
              <text class="nm-checkin-value">{{ checkInSummary.todayReward?.label || '已领取' }}</text>
            </view>
            <view>
              <text class="nm-section__sub">下一档</text>
              <text class="nm-checkin-value">{{ checkInSummary.upcomingReward?.label || '完成周期' }}</text>
            </view>
          </view>
          <view v-if="checkIn" class="nm-checkin-row">
            <view
              v-for="reward in checkIn.rewards"
              :key="reward.day"
              :class="['nm-checkin-dot', reward.day <= checkIn.streakDays ? 'nm-checkin-dot--active' : '', reward.highlight ? 'nm-checkin-dot--highlight' : '']"
            >
              {{ reward.day }}
            </view>
          </view>
          <text v-if="checkIn" class="nm-checkin-meta">连续 {{ checkIn.streakDays }} 天 · 断签重置</text>
          <view
            class="nm-primary-btn"
            :class="checkIn && checkIn.todayChecked ? 'nm-primary-btn--disabled' : ''"
            @click="handleCheckIn"
          >
            {{ checkIn && checkIn.todayChecked ? '今日已签到' : '签到' }}
          </view>
        </view>

        <view class="nm-card">
          <view class="nm-section__header">
            <text class="nm-section__title">我的任务/福利</text>
            <view class="nm-section__actions">
              <text class="nm-section__sub" @click="showTaskRule">规则</text>
              <text class="nm-section__link" @click="goTasks">全部</text>
            </view>
          </view>
          <view class="nm-task-row" v-for="task in tasks.slice(0, 3)" :key="task.id" @click="go(task.targetRoute)">
            <view>
              <text class="nm-task-title">{{ task.title }}</text>
              <text class="nm-task-reward">{{ task.rewardLabel }}</text>
            </view>
            <view
              :class="[
                'nm-task-status',
                task.status === 'done' ? 'nm-task-status--done' : 'nm-task-status--progress'
              ]"
            >
              {{ task.status === 'done' ? '已完成' : task.status === 'inProgress' ? '进行中' : '去完成' }}
            </view>
          </view>
          <text class="nm-section__sub">完成任务可解锁头像框与等级成长值</text>
        </view>
      </view>

      <view class="nm-section">
        <view class="nm-section__header">
          <text class="nm-section__title">订单管理</text>
          <text class="nm-section__link" @click="goOrders()">全部订单</text>
        </view>
        <view class="nm-quick-row">
          <view class="nm-quick-chip" @click="goAfterSale">
            <Icon class="nm-quick-chip__icon" name="headset" :size="32" :color="textSecondary" />
            <text class="nm-quick-chip__text">退款/售后</text>
          </view>
          <view class="nm-quick-chip" @click="goTrack">
            <Icon class="nm-quick-chip__icon" name="map-marker-path" :size="32" :color="textSecondary" />
            <text class="nm-quick-chip__text">物流追踪</text>
          </view>
        </view>
        <view class="nm-order-row">
          <view
            v-for="(entry, index) in orderEntries"
            :key="entry.id"
            class="nm-order-item"
            :class="index === orderEntries.length - 1 ? 'nm-order-item--last' : ''"
            @click="goOrders(entry.id)"
          >
            <view v-if="orderCounts && orderCounts[entry.id] > 0" class="nm-order-badge">
              {{ orderCounts[entry.id] > 99 ? '99+' : orderCounts[entry.id] }}
            </view>
            <text class="nm-order-text">{{ entry.label }}</text>
          </view>
        </view>
        <view v-if="issueOrder" class="nm-issue-card">
          <view class="nm-issue-header">
            <text class="nm-issue-title">异常订单</text>
            <text class="nm-section__link" @click="goOrderDetail(issueOrder.id)">查看详情</text>
          </view>
          <text class="nm-issue-sub">{{ issueOrder.id }} · {{ issueOrder.status }}</text>
          <view class="nm-progress__track">
            <view class="nm-progress__fill nm-progress__fill--blue" :style="{ width: issueProgress }" />
          </view>
          <text class="nm-issue-sub">当前进度：{{ issueStatusLabel }}</text>
        </view>
        <view v-else class="nm-issue-card">
          <text class="nm-issue-title">暂无异常订单</text>
          <text class="nm-issue-sub">售后进度会在这里展示，方便你快速处理</text>
        </view>
      </view>

      <view class="nm-section">
        <text class="nm-section__title">我的入口</text>
        <view class="nm-entry-card">
          <view class="nm-entry-row" @click="go('pages-sub/me/inbox')">
            <view class="nm-entry-icon">
              <Icon name="bell-outline" :size="36" :color="brandPrimary" />
            </view>
            <view class="nm-entry-info">
              <view class="nm-entry-title-row">
                <text class="nm-entry-title" lines="1">消息中心</text>
                <view v-if="inboxUnreadCount > 0" class="nm-entry-badge">
                  <text class="nm-entry-badge__text">{{ inboxUnreadCount > 99 ? '99+' : inboxUnreadCount }}</text>
                </view>
                <text v-else class="nm-entry-meta" lines="1">全部已读</text>
              </view>
              <text class="nm-entry-desc" lines="1">互动/交易/系统通知</text>
            </view>
            <Icon class="nm-entry-arrow" name="chevron-right" :size="40" :color="textSecondary" />
          </view>
          <view class="nm-entry-row" @click="go('pages-sub/me/following')">
            <view class="nm-entry-icon nm-entry-icon--blue">
              <Icon name="account-heart-outline" :size="36" :color="accentBlue" />
            </view>
            <view class="nm-entry-info">
              <view class="nm-entry-title-row">
                <text class="nm-entry-title" lines="1">我的关注</text>
                <text class="nm-entry-meta" lines="1">{{ followCounts.users }} 用户 · {{ followCounts.companies }} 企业</text>
              </view>
              <text class="nm-entry-desc" lines="1">查看动态与亲密度进度</text>
            </view>
            <Icon class="nm-entry-arrow" name="chevron-right" :size="40" :color="textSecondary" />
          </view>
          <view class="nm-entry-row nm-entry-row--last" @click="go('pages-sub/me/settings')">
            <view class="nm-entry-icon nm-entry-icon--neutral">
              <Icon name="cog-outline" :size="36" :color="textSecondary" />
            </view>
            <view class="nm-entry-info">
              <view class="nm-entry-title-row">
                <text class="nm-entry-title" lines="1">设置</text>
                <text class="nm-entry-meta" lines="1">账户/隐私/通知</text>
              </view>
              <text class="nm-entry-desc" lines="1">偏好设置与权限管理</text>
            </view>
            <Icon class="nm-entry-arrow" name="chevron-right" :size="40" :color="textSecondary" />
          </view>
        </view>
      </view>

      <view class="nm-section">
        <view class="nm-section__header">
          <text class="nm-section__title">为你推荐</text>
          <view class="nm-section__actions">
            <text class="nm-section__sub" @click="refreshRecommend">换一批</text>
            <text class="nm-section__link" @click="goRecommend">更多</text>
          </view>
        </view>
        <view v-if="recommendations.length === 0" class="nm-empty">暂无推荐</view>
        <view v-else v-for="item in recommendations.slice(0, 4)" :key="item.id" class="nm-recommend">
          <image :src="item.product.image" class="nm-recommend__image" mode="aspectFill" />
          <view class="nm-recommend__info">
            <text class="nm-recommend__title">{{ item.product.title }}</text>
            <view class="nm-recommend__tag">
              <text class="nm-recommend__tag-text">{{ formatReason(item.reason) }}</text>
            </view>
            <text class="nm-recommend__price">¥{{ item.product.price }}</text>
          </view>
          <view class="nm-recommend__dislike" @click="markNotInterested(item.id)">
            <Icon class="nm-recommend__dislike-icon" name="thumb-down-outline" :size="36" :color="textSecondary" />
            <text class="nm-recommend__dislike-text">不感兴趣</text>
          </view>
        </view>
      </view>
    </scroll-view>

    <AuthModal :open="showAuth" @close="showAuth = false" @success="onAuthSuccess" />
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Screen, AuthModal } from '@/components';
import Icon from '@/components/ui/Icon.vue';
import { useToast } from '@/components/feedback/useToast';
import { CheckInRepo, FollowRepo, OrderRepo, RecommendRepo, TaskRepo, UserRepo } from '@/services/repos';
import { APP_EVENTS, AuthState, CartState, InboxState, onAppEvent } from '@/services/state';

const textSecondary = '#4B5B53';
const brandPrimary = '#2F8F4E';
const accentBlue = '#2B6CB0';

const toast = useToast();
const showAuth = ref(false);
const session = ref(AuthState.getSession());
const refreshing = ref(false);
const cartCount = ref(CartState.getSnapshot().count);
const inboxUnreadCount = ref(InboxState.getUnreadCount());
const profile = ref<any | null>(null);
const tasks = ref<any[]>([]);
const checkIn = ref<any | null>(null);
const recommendations = ref<any[]>([]);
const orderCounts = ref<Record<string, number> | null>(null);
const issueOrder = ref<any | null>(null);
const followCounts = ref({ users: 0, companies: 0 });

let offAuth: null | (() => void) = null;
let offCart: null | (() => void) = null;
let offInbox: null | (() => void) = null;

const isLoggedIn = computed(() => !!session.value);

const greeting = computed(() => {
  if (!profile.value) return '欢迎回来';
  if (checkIn.value?.streakDays >= 3) {
    return `已连续签到 ${checkIn.value.streakDays} 天，${profile.value.name}`;
  }
  const hour = new Date().getHours();
  const period = hour < 11 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  const interest = profile.value.interests?.[0];
  return interest ? `${period}，热爱${interest}的${profile.value.name}` : `${period}，${profile.value.name}`;
});

const profileTags = computed(() => {
  const tags: string[] = [];
  if (checkIn.value?.streakDays) tags.push(`连签${checkIn.value.streakDays}天`);
  if (profile.value?.interests?.length) tags.push(...profile.value.interests.slice(0, 2));
  return tags;
});

const checkInSummary = computed(() => {
  if (!checkIn.value) return { todayReward: null, upcomingReward: null };
  const nextDay = checkIn.value.todayChecked ? checkIn.value.streakDays : checkIn.value.streakDays + 1;
  const todayReward = checkIn.value.rewards.find((reward: any) => reward.day === nextDay);
  const upcomingReward = checkIn.value.rewards.find((reward: any) => reward.day === Math.min(nextDay + 1, 7));
  return { todayReward, upcomingReward };
});

const levelMeta = computed(() => {
  if (!profile.value) return null;
  const mapping: Record<string, { next: string; perks: string }> = {
    种子会员: { next: '生长会员', perks: '运费券/会员价' },
    生长会员: { next: '丰收会员', perks: '专属客服/活动名额' },
    丰收会员: { next: '更高等级', perks: '年度礼盒/顾问服务' },
  };
  return mapping[profile.value.level] || { next: '更多等级', perks: '权益持续升级' };
});

const issueProgress = computed(() => {
  if (!issueOrder.value) return '0%';
  const map: Record<string, number> = {
    applying: 0.25,
    reviewing: 0.5,
    refunding: 0.75,
    completed: 1,
  };
  const ratio = map[issueOrder.value.afterSaleStatus || 'reviewing'] || 0.4;
  return `${Math.min(100, ratio * 100)}%`;
});

const issueStatusLabel = computed(() => {
  if (!issueOrder.value) return '暂无';
  const map: Record<string, string> = {
    applying: '申请中',
    reviewing: '审核中',
    refunding: '退款中',
    completed: '已完成',
  };
  return map[issueOrder.value.afterSaleStatus || 'reviewing'] || '审核中';
});

const orderEntries = [
  { id: 'pendingPay', label: '待付款', icon: 'credit-card-outline' },
  { id: 'pendingShip', label: '待发货', icon: 'package-variant' },
  { id: 'shipping', label: '待收货', icon: 'truck-delivery-outline' },
  { id: 'afterSale', label: '退款/售后', icon: 'headset' },
];

const go = (url: string) => {
  navTo({ url: `/${url}` });
};
const goInbox = () => go('pages-sub/me/inbox');
const goCart = () => go('pages-sub/order/cart');
const goOrders = (status?: string) =>
  navTo({ url: status ? `/pages-sub/order/orders?status=${status}` : '/pages-sub/order/orders' });
const goOrderDetail = (id: string) => navTo({ url: `/pages-sub/order/order-detail?id=${id}` });
const goAfterSale = () => navTo({ url: '/pages-sub/order/after-sale' });
const goTrack = () => navTo({ url: '/pages-sub/order/track' });
const goProfile = () => go('pages-sub/me/profile');
const goAppearance = () => go('pages-sub/me/appearance');
const goVip = () => go('pages-sub/me/vip');
const goTasks = () => go('pages-sub/me/tasks');
const goRecommend = () => go('pages-sub/me/recommend');
const goAiAssistant = () => go('pages-sub/ai/assistant');

const loadProfile = async () => {
  const res = await UserRepo.profile();
  if (res.ok) profile.value = res.data;
};

const loadTasks = async () => {
  const res = await TaskRepo.list();
  if (res.ok) tasks.value = res.data;
};

const loadCheckIn = async () => {
  const res = await CheckInRepo.getStatus();
  if (res.ok) checkIn.value = res.data;
};

const loadRecommend = async () => {
  const res = await RecommendRepo.listForMe();
  if (res.ok) recommendations.value = res.data;
};

const loadOrderCounts = async () => {
  const res = await OrderRepo.getStatusCounts();
  if (res.ok) orderCounts.value = res.data;
};

const loadIssueOrder = async () => {
  const res = await OrderRepo.getLatestIssue();
  if (res.ok) issueOrder.value = res.data;
};

const loadFollowCounts = async () => {
  const [userRes, companyRes] = await Promise.all([
    FollowRepo.list({ page: 1, pageSize: 50, type: 'user' }),
    FollowRepo.list({ page: 1, pageSize: 50, type: 'company' }),
  ]);
  followCounts.value = {
    users: userRes.ok ? userRes.data.items.length : 0,
    companies: companyRes.ok ? companyRes.data.items.length : 0,
  };
};

const loadAll = async () => {
  await Promise.all([
    loadProfile(),
    loadTasks(),
    loadCheckIn(),
    loadRecommend(),
    loadOrderCounts(),
    loadIssueOrder(),
    loadFollowCounts(),
  ]);
};

const onRefresh = async () => {
  if (refreshing.value) return;
  refreshing.value = true;
  await InboxState.refreshUnreadCount();
  inboxUnreadCount.value = InboxState.getUnreadCount();
  await loadAll();
  refreshing.value = false;
};

const handleCheckIn = async () => {
  const res = await CheckInRepo.checkIn();
  if (!res.ok) {
    toast.show({ message: '签到失败', type: 'error' });
    return;
  }
  checkIn.value = res.data.status;
  if (res.data.lastReward?.points || res.data.lastReward?.growth) {
    await UserRepo.applyRewards({
      points: res.data.lastReward?.points || 0,
      growthPoints: res.data.lastReward?.growth || 0,
    });
    await loadProfile();
  }
  toast.show({ message: `签到成功，${res.data.lastReward?.label || '奖励已领取'}`, type: 'success' });
};

const showCheckinRule = () => {
  toast.show({ message: '连续签到奖励递增，断签后重置', type: 'info' });
};

const showTaskRule = () => {
  toast.show({ message: '完成任务可获得成长值/积分奖励', type: 'info' });
};

const refreshRecommend = async () => {
  await loadRecommend();
  toast.show({ message: '已刷新推荐', type: 'success' });
};

const markNotInterested = async (id: string) => {
  const res = await RecommendRepo.markNotInterested(id);
  if (!res.ok) {
    toast.show({ message: '操作失败', type: 'error' });
    return;
  }
  toast.show({ message: '已为你减少类似推荐', type: 'info' });
  await loadRecommend();
};

const formatReason = (reason: string) => reason.replace(/^推荐理由[:：]\s*/, '');

const onAuthSuccess = async () => {
  session.value = AuthState.getSession();
  await loadAll();
};

onMounted(async () => {
  offAuth = onAppEvent(APP_EVENTS.AUTH_CHANGED, (next) => {
    session.value = next || null;
    if (!next) {
      profile.value = null;
    }
  });
  offCart = onAppEvent(APP_EVENTS.CART_CHANGED, (snap) => {
    cartCount.value = (snap && snap.count) || CartState.getSnapshot().count;
  });
  offInbox = onAppEvent(APP_EVENTS.INBOX_CHANGED, (payload) => {
    inboxUnreadCount.value = (payload && payload.unreadCount) || InboxState.getUnreadCount();
  });

  await InboxState.refreshUnreadCount();
  inboxUnreadCount.value = InboxState.getUnreadCount();
  await loadAll();
});

onBeforeUnmount(() => {
  if (offAuth) offAuth();
  if (offCart) offCart();
  if (offInbox) offInbox();
});
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-topbar {
  display: flex;
  padding: $nm-space-md $nm-space-xl;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1rpx solid $nm-border;
  background-color: $nm-background;
  box-sizing: border-box;
  width: 100%;
}

.nm-topbar__main {
  flex: 1;
  min-width: 0;
  margin-right: $nm-space-sm;
}

.nm-topbar__title {
  font-size: $nm-font-title2;
  font-weight: 600;
  color: $nm-text-primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-topbar__subtitle {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-topbar__actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
}

.nm-icon-wrap {
  display: flex;
  padding: 12rpx 20rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
  align-items: center;
  justify-content: center;
  margin-left: 16rpx;
  position: relative;
}

.nm-icon-wrap:first-child {
  margin-left: 0;
}

.nm-icon-wrap--cart {
  background-color: $nm-brand-primary-soft;
  border-color: transparent;
}

.nm-icon {
  font-size: 36rpx;
  line-height: 36rpx;
}

.nm-icon-badge {
  position: absolute;
  top: -12rpx;
  right: -12rpx;
  min-width: 36rpx;
  height: 36rpx;
  padding: 0 8rpx;
  border-radius: 18rpx;
  background-color: $nm-danger;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-icon-badge--green {
  background-color: $nm-accent-blue;
}

.nm-icon-badge__text {
  font-size: $nm-font-caption;
  line-height: $nm-font-caption;
  color: $nm-text-inverse;
}

.nm-page {
  padding: $nm-space-lg $nm-space-xl $nm-space-3xl;
  padding-bottom: $nm-space-3xl;
  width: 100%;
  box-sizing: border-box;
  overflow-x: hidden;
}

.nm-profile-card {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
  width: 100%;
  box-sizing: border-box;
}

.nm-profile-row {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.nm-avatar-frame {
  width: 144rpx;
  height: 144rpx;
  border-radius: $nm-radius-pill;
  border: 2rpx solid $nm-accent-blue;
  align-items: center;
  justify-content: center;
}

.nm-avatar {
  width: 128rpx;
  height: 128rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
}

.nm-profile-info {
  flex: 1;
  min-width: 0;
  margin-left: $nm-space-sm;
  overflow: hidden;
}

.nm-profile-actions {
  align-items: flex-end;
  flex-shrink: 0;
  margin-left: $nm-space-sm;
}

.nm-profile-skeleton {
  padding: $nm-space-md 0;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-profile-greeting {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-profile-name {
  margin-top: 8rpx;
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-profile-meta {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-profile-tags {
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: $nm-space-sm;
}

.nm-tag {
  padding: 8rpx 16rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-accent-blue-soft;
  margin-right: 12rpx;
  margin-bottom: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-ai,
.nm-vip {
  padding: 12rpx 20rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  margin-bottom: 16rpx;
  flex-direction: row;
  align-items: center;
}

.nm-ai {
  border-color: $nm-accent-blue;
  background-color: $nm-accent-blue-soft;
}

.nm-vip {
  border-color: $nm-brand-primary;
  color: $nm-brand-primary;
}

.nm-ai__icon {
  color: $nm-accent-blue;
}

.nm-ai__text {
  margin-left: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-progress {
  margin-top: $nm-space-sm;
}

.nm-progress__level {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-progress__track {
  height: 12rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
  overflow: hidden;
}

.nm-progress__fill {
  height: 100%;
  width: 60%;
  background-color: $nm-brand-primary;
}

.nm-progress__fill--blue {
  background-color: $nm-accent-blue;
}

.nm-progress__text {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-assets {
  display: flex;
  margin-top: $nm-space-md;
  flex-direction: row;
  justify-content: space-between;
}

.nm-asset {
  flex: 1;
  align-items: center;
}

.nm-asset__label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-asset__value {
  margin-top: 4rpx;
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-login-card {
  display: flex;
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
}

.nm-login-info {
  flex: 1;
  min-width: 0;
  margin-right: $nm-space-sm;
}

.nm-login-title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-login-sub {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  overflow: hidden;
}

.nm-login-btn {
  padding: 20rpx 32rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  font-size: $nm-font-body;
  font-weight: 600;
  flex-shrink: 0;
  white-space: nowrap;
}

.nm-section {
  margin-top: $nm-space-lg;
}

.nm-card {
  padding: 28rpx;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  border: 1rpx solid transparent;
  margin-bottom: $nm-space-md;
  width: 100%;
  box-sizing: border-box;
}

.nm-section__header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-section__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-section__sub {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-section__link {
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-section__actions {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.nm-checkin-summary {
  display: flex;
  margin-top: $nm-space-sm;
  flex-direction: row;
  justify-content: space-between;
}

.nm-checkin-value {
  margin-top: 8rpx;
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-checkin-row {
  display: flex;
  margin-top: $nm-space-sm;
  flex-direction: row;
  flex-wrap: wrap;
}

.nm-checkin-dot {
  width: 48rpx;
  height: 48rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  background-color: $nm-border;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: $nm-font-caption;
  line-height: 48rpx;
  text-align: center;
  color: $nm-text-secondary;
  margin-right: 12rpx;
  margin-bottom: 12rpx;
}

.nm-checkin-dot--active {
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  border-color: $nm-brand-primary;
}

.nm-checkin-dot--highlight {
  border-color: $nm-accent-blue;
}

.nm-primary-btn {
  margin-top: $nm-space-sm;
  padding: 12rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  text-align: center;
  font-size: $nm-font-caption;
}

.nm-primary-btn--disabled {
  background-color: $nm-border;
  color: $nm-text-secondary;
}

.nm-checkin-meta {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-task-row {
  display: flex;
  margin-top: $nm-space-sm;
  padding: 16rpx 0;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1rpx solid $nm-border;
}

.nm-task-title {
  font-size: $nm-font-body;
  color: $nm-text-primary;
}

.nm-task-reward {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-task-status {
  padding: 8rpx 16rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid transparent;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-task-status--done {
  background-color: $nm-brand-primary-soft;
  border-color: transparent;
  color: $nm-brand-primary;
}

.nm-task-status--progress {
  background-color: $nm-accent-blue-soft;
  border-color: transparent;
  color: $nm-accent-blue;
}

.nm-quick-row {
  display: flex;
  margin-top: $nm-space-sm;
  margin-bottom: 20rpx;
  flex-direction: row;
}

.nm-quick-chip {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  margin-right: 20rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
}

.nm-quick-chip__icon {
  margin-right: 12rpx;
}

.nm-quick-chip__text {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-order-row {
  display: flex;
  margin-top: 0;
  flex-direction: row;
  justify-content: space-between;
}

.nm-order-item {
  flex: 1;
  margin-right: 16rpx;
  padding: 32rpx 0;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  box-sizing: border-box;
}

.nm-order-item--last {
  margin-right: 0;
}

.nm-order-badge {
  position: absolute;
  top: -8rpx;
  right: -8rpx;
  padding: 0 8rpx;
  min-width: 28rpx;
  height: 28rpx;
  border-radius: 14rpx;
  background-color: $nm-danger;
  border: 4rpx solid $nm-surface;
  font-size: 18rpx;
  line-height: 18rpx;
  color: $nm-text-inverse;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-order-text {
  margin-top: 0;
  line-height: 32rpx;
  white-space: nowrap;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-issue-card {
  margin-top: $nm-space-md;
  padding: $nm-space-md;
  border-radius: $nm-radius-lg;
  border: 1rpx solid transparent;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
}

.nm-issue-header {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-issue-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-issue-sub {
  margin-top: 8rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-entry-card {
  margin-top: $nm-space-sm;
  padding: 8rpx 12rpx;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid transparent;
  box-shadow: $nm-shadow-sm;
  width: 100%;
  box-sizing: border-box;
}

.nm-entry-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 24rpx 16rpx;
  border-bottom: 1rpx solid $nm-border;
}

.nm-entry-row--last {
  border-bottom-width: 0;
}

.nm-entry-icon {
  width: 72rpx;
  height: 72rpx;
  border-radius: 36rpx;
  background-color: $nm-brand-primary-soft;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 20rpx;
}

.nm-entry-icon--blue {
  background-color: $nm-accent-blue-soft;
}

.nm-entry-icon--neutral {
  background-color: $nm-border;
}

.nm-entry-info {
  flex: 1;
  min-width: 0;
}

.nm-entry-title-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-entry-title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-entry-meta {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  flex-shrink: 0;
  margin-left: $nm-space-sm;
  max-width: 240rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-entry-desc {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-entry-arrow {
  color: $nm-text-secondary;
}

.nm-entry-badge {
  min-width: 32rpx;
  height: 32rpx;
  padding: 0 12rpx;
  border-radius: 16rpx;
  background-color: $nm-danger;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-entry-badge__text {
  font-size: $nm-font-caption;
  line-height: 32rpx;
  color: $nm-text-inverse;
}

.nm-recommend {
  display: flex;
  margin-top: 0;
  margin-bottom: 24rpx;
  padding: $nm-space-md;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid transparent;
  box-shadow: $nm-shadow-sm;
  flex-direction: row;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
}

.nm-recommend__image {
  width: 128rpx;
  height: 128rpx;
  border-radius: $nm-radius-md;
  background-color: $nm-skeleton;
}

.nm-recommend__info {
  flex: 1;
  margin-left: 24rpx;
}

.nm-recommend__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-recommend__tag {
  margin-top: 12rpx;
  align-self: flex-start;
  padding: 8rpx 16rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-accent-blue-soft;
}

.nm-recommend__tag-text {
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-recommend__price {
  margin-top: 12rpx;
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-recommend__dislike {
  align-items: center;
  margin-left: $nm-space-sm;
}

.nm-recommend__dislike-icon {
  color: $nm-text-secondary;
}

.nm-recommend__dislike-text {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-empty {
  margin-top: $nm-space-sm;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}
</style>
