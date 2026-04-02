<template>
  <Screen :safeTop="true">
    <scroll-view
      class="nm-page"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view class="nm-cover">
        <image class="nm-cover__image" :src="company?.cover" mode="aspectFill" />
        <view class="nm-cover__overlay" />
        <view class="nm-cover__top">
          <view class="nm-cover__spacer" />
          <text class="nm-cover__title">企业</text>
          <view class="nm-cover__more" @click="showMore">
            <Icon name="dots-horizontal" :size="44" :color="textInverse" />
          </view>
        </view>
        <view class="nm-cover__content">
          <text class="nm-cover__name">{{ company?.name || '企业' }}</text>
          <text class="nm-cover__sub">{{ company?.mainBusiness || '企业信息占位' }}</text>
          <view class="nm-cover__meta">
            <text class="nm-cover__meta-text">{{ company?.location || '未知地区' }}</text>
            <text class="nm-cover__meta-text">距离 {{ company?.distanceKm?.toFixed(1) || '0.0' }} km</text>
          </view>
        </view>
      </view>

      <view class="nm-body">
        <ErrorState v-if="companyError && !company" :text="companyError" @retry="fetchCompany" />
        <template v-else>
          <view class="nm-tag-row">
            <Tag v-for="badge in company?.badges || []" :key="badge" :label="badge" tone="accent" />
          </view>

          <view class="nm-quick-row">
            <view class="nm-quick-card">
              <text class="nm-quick-label">目标成团</text>
              <text class="nm-quick-value">{{ company?.groupTargetSize || 30 }} 人</text>
            </view>
            <view class="nm-quick-card">
              <text class="nm-quick-label">最近检测</text>
              <text class="nm-quick-value">{{ company?.latestTestedAt || '暂无' }}</text>
            </view>
          </view>

          <scroll-view scroll-x class="nm-tabs">
            <view
              v-for="tab in tabs"
              :key="tab.id"
              :class="['nm-tab', activeTab === tab.id ? 'nm-tab--active' : '']"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </view>
          </scroll-view>
        </template>
      </view>

      <view class="nm-section">
        <template v-if="activeTab === 'calendar'">
          <view class="nm-panel">
            <view class="nm-panel__header">
              <view>
                <text class="nm-panel__title">可预约日历</text>
                <text class="nm-panel__subtitle nm-panel__subtitle--compact">未来 7 天滚动窗口</text>
              </view>
              <view class="nm-panel__actions">
                <view class="nm-panel__btn nm-panel__btn--ghost" @click="selectToday">今天</view>
                <view class="nm-panel__btn nm-panel__btn--primary" @click="openAgenda(null)">全部日程</view>
              </view>
            </view>

            <scroll-view scroll-x class="nm-dates">
            <view
              v-for="day in dayItems"
              :key="day.key"
              :class="[
                'nm-date',
                activeDate === day.key ? 'nm-date--active' : '',
                day.key === todayKey ? 'nm-date--today' : '',
              ]"
              @click="selectDate(day.key)"
            >
                <text class="nm-date__weekday">周{{ day.weekday }}</text>
                <text class="nm-date__label">{{ day.label }}</text>
                <view v-if="day.count" class="nm-date__badge">{{ day.count }}</view>
                <view v-else class="nm-date__dot" />
              </view>
            </scroll-view>
          </view>

          <view class="nm-agenda">
          <view class="nm-agenda__header">
            <text class="nm-agenda__title">{{ activeLabel }} · {{ selectedEvents.length }} 场</text>
            <text
              v-if="selectedEvents.length > 3"
              class="nm-agenda__link"
                @click="openAgenda(activeDate)"
              >查看当天全部</text>
            </view>
            <ErrorState v-if="eventError" :text="eventError" @retry="onRefresh" />
            <Skeleton v-else-if="eventLoading && selectedEvents.length === 0" :count="2" type="line" />
            <EmptyState v-else-if="!eventLoading && selectedEvents.length === 0" text="暂无活动" hint="可切换日期或查看全部日程" />
            <view v-else>
              <view v-for="event in selectedEvents.slice(0, 3)" :key="event.id" class="nm-event">
                <view class="nm-event__row">
                  <view class="nm-event__time">
                    <text class="nm-event__time-text">{{ event.startTime }}</text>
                    <text v-if="event.endTime" class="nm-event__time-sub">~ {{ event.endTime }}</text>
                  </view>
                  <view class="nm-event__body">
                    <view class="nm-row-between">
                      <text class="nm-event__title">{{ event.title }}</text>
                      <Tag :label="eventTypeLabel(event.type)" :tone="eventTypeTone(event.type)" />
                    </view>
                    <text class="nm-event__meta">{{ event.location || company?.location }}</text>
                    <text v-if="typeof event.capacity === 'number'" class="nm-event__meta">
                      已报名 {{ event.bookedCount || 0 }}/{{ event.capacity }}
                    </text>
                  </view>
                </view>
                <view class="nm-event__footer">
                  <view :class="['nm-status', `nm-status--${resolveEventStatus(event)}`]">
                    {{ eventStatusLabel(resolveEventStatus(event)) }}
                  </view>
                  <view
                    v-if="canBook(event)"
                    class="nm-event__action"
                    @click="openBooking(event)"
                  >预约</view>
                  <text v-else class="nm-event__hint">{{ bookingHint(event) }}</text>
                </view>
              </view>
            </view>
          </view>
        </template>

        <template v-else-if="activeTab === 'profile'">
          <view class="nm-panel">
            <text class="nm-panel__title">企业档案</text>
            <text class="nm-panel__subtitle">主营：{{ company?.mainBusiness }}</text>
            <text class="nm-panel__subtitle">地址：{{ company?.location }}</text>
            <text class="nm-panel__subtitle">距离：{{ company?.distanceKm?.toFixed(1) }} km</text>
          </view>
        </template>

        <template v-else-if="activeTab === 'cert'">
          <view class="nm-panel">
            <text class="nm-panel__title">资质认证</text>
            <text class="nm-panel__subtitle">已通过多项品质与产地认证，支持产地溯源。</text>
            <view class="nm-tag-row">
              <Tag v-for="badge in company?.badges || []" :key="badge" :label="badge" tone="success" />
            </view>
          </view>
        </template>

        <template v-else-if="activeTab === 'test'">
          <view class="nm-panel">
            <text class="nm-panel__title">检测报告预览</text>
            <view class="nm-preview">
              <text class="nm-panel__subtitle nm-panel__subtitle--flat">最近检测：{{ company?.latestTestedAt || '暂无' }}</text>
              <text class="nm-preview__desc">报告内容占位，后续接入真实检测文件</text>
            </view>
          </view>
        </template>

        <template v-else-if="activeTab === 'gallery'">
          <view class="nm-gallery">
            <image
              v-for="(item, index) in 3"
              :key="`gallery-${index}`"
              class="nm-gallery__item"
              :src="company?.cover"
              mode="aspectFill"
            />
          </view>
        </template>

        <template v-else-if="activeTab === 'booking'">
          <view class="nm-panel">
            <text class="nm-panel__title">预约记录</text>
            <text class="nm-panel__subtitle">你提交的预约会进入审核流程，审核结果将通知。</text>
          </view>
          <EmptyState v-if="bookings.length === 0" text="暂无预约" hint="在日历里选择活动并提交预约" />
          <view v-else>
            <view v-for="item in bookings" :key="item.id" class="nm-panel">
              <view class="nm-row-between">
                <text class="nm-panel__title">{{ item.date }}</text>
                <view :class="['nm-status', `nm-status--${bookingStatusTone(item.status)}`]">
                  {{ item.status }}
                </view>
              </view>
              <text class="nm-panel__subtitle nm-panel__subtitle--compact">人数 {{ item.people }} · 身份 {{ item.identity }}</text>
              <text v-if="item.note" class="nm-panel__subtitle nm-panel__subtitle--compact">审核备注：{{ item.note }}</text>
            </view>
          </view>
        </template>

        <template v-else-if="activeTab === 'group'">
          <view class="nm-panel">
            <text class="nm-panel__title">组团状态看板</text>
            <text class="nm-panel__subtitle">
              目标成团人数可由后台配置，当前默认 {{ company?.groupTargetSize || 30 }} 人。
            </text>
          </view>
          <EmptyState v-if="groups.length === 0" text="暂无考察团" hint="达到阈值后会自动发起组团" />
          <view v-else>
            <view v-for="group in groups" :key="group.id" class="nm-panel">
              <view class="nm-row-between">
                <text class="nm-panel__title">{{ group.title }}</text>
                <text class="nm-link" @click="openGroupDetail(group.id)">查看详情</text>
              </view>
              <text class="nm-panel__subtitle">目的地：{{ group.destination }}</text>
              <text class="nm-panel__subtitle">
                进度 {{ group.memberCount }}/{{ group.targetSize }} · 截止 {{ group.deadline }}
              </text>
              <view class="nm-progress">
                <view
                  class="nm-progress__fill"
                  :style="{ width: `${Math.min(100, (group.memberCount / group.targetSize) * 100)}%` }"
                />
              </view>
              <view class="nm-row-between">
                <text class="nm-panel__subtitle nm-panel__subtitle--flat">{{ groupStatusLabel(group.status) }}</text>
                <view class="nm-event__action" @click="openGroupSheet(group)">一键参团</view>
              </view>
            </view>
          </view>
        </template>
      </view>
    </scroll-view>

    <BottomSheet :open="showAgenda" mode="half" :title="agendaTitle" :scrollable="true" @close="showAgenda = false">
      <view class="nm-sheet">
        <EmptyState v-if="agendaEntries.length === 0" text="暂无日程" hint="稍后再来看看" />
        <view v-else>
          <view v-for="entry in agendaEntries" :key="entry[0]" class="nm-sheet__group">
            <text class="nm-sheet__title">{{ entry[0] }}</text>
            <text class="nm-sheet__sub">共 {{ entry[1].length }} 场</text>
            <view v-for="event in entry[1]" :key="event.id" class="nm-sheet__item">
              <view class="nm-sheet__row">
                <view class="nm-sheet__time">
                  <text class="nm-sheet__time-text">{{ event.startTime }}</text>
                  <text v-if="event.endTime" class="nm-sheet__time-sub">~ {{ event.endTime }}</text>
                </view>
                <view class="nm-sheet__content">
                  <view class="nm-row-between">
                    <text class="nm-sheet__name">{{ event.title }}</text>
                    <Tag :label="eventTypeLabel(event.type)" :tone="eventTypeTone(event.type)" />
                  </view>
                  <text class="nm-sheet__meta">{{ event.location || company?.location }}</text>
                </view>
              </view>
              <view class="nm-sheet__footer">
                <view :class="['nm-status', `nm-status--${resolveEventStatus(event)}`]">
                  {{ eventStatusLabel(resolveEventStatus(event)) }}
                </view>
                <view v-if="canBook(event)" class="nm-sheet__btn" @click="openBooking(event)">预约</view>
                <text v-else class="nm-event__hint">{{ bookingHint(event) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </BottomSheet>

    <BottomSheet :open="showBooking" mode="half" title="预约参观" :scrollable="true" @close="showBooking = false">
      <view class="nm-form">
        <view v-if="selectedEvent" class="nm-form__event">
          <text class="nm-form__event-label">已选活动</text>
          <text class="nm-form__event-title">{{ selectedEvent.title }}</text>
          <text class="nm-form__event-meta">
            {{ selectedEvent.date }} {{ selectedEvent.startTime }}{{ selectedEvent.endTime ? ` ~ ${selectedEvent.endTime}` : '' }}
          </text>
        </view>
        <text class="nm-form__label">期望参观日期</text>
        <input class="nm-input" v-model="bookingForm.date" placeholder="例如：2025-03-12" placeholder-class="nm-placeholder" />
        <text class="nm-form__label">参观人数</text>
        <input class="nm-input" v-model="bookingForm.people" placeholder="请输入人数" placeholder-class="nm-placeholder" />
        <text class="nm-form__label">身份</text>
        <view class="nm-row">
          <view
            v-for="role in identities"
            :key="role"
            :class="['nm-chip', bookingForm.identity === role ? 'nm-chip--active' : '']"
            @click="bookingForm.identity = role"
          >{{ role }}</view>
        </view>
        <text class="nm-form__label">联系人</text>
        <input class="nm-input" v-model="bookingForm.contactName" placeholder="姓名" placeholder-class="nm-placeholder" />
        <text class="nm-form__label">联系电话</text>
        <input class="nm-input" v-model="bookingForm.contactPhone" placeholder="手机号" placeholder-class="nm-placeholder" />
        <text class="nm-form__label">备注</text>
        <textarea class="nm-textarea" v-model="bookingForm.note" placeholder="可填写参观诉求/特殊安排" placeholder-class="nm-placeholder" />
        <view class="nm-primary" @click="submitBooking">提交预约</view>
      </view>
    </BottomSheet>

    <BottomSheet :open="showGroup" mode="half" title="一键参团" :scrollable="true" @close="showGroup = false">
      <view class="nm-form">
        <view v-if="selectedGroup" class="nm-form__event">
          <text class="nm-form__event-title">{{ selectedGroup.title }}</text>
          <text class="nm-form__event-meta">截止 {{ selectedGroup.deadline }}</text>
        </view>
        <view class="nm-group-card">
          <text class="nm-group-card__title">当前正在组团的考察团</text>
          <text class="nm-group-card__meta">目的地：{{ selectedGroup?.destination || '-' }}</text>
          <text class="nm-group-card__meta">目标成团人数：{{ selectedGroup?.targetSize || 30 }}</text>
          <text class="nm-group-card__meta">已报名人数：{{ selectedGroup?.memberCount || 0 }}</text>
          <text class="nm-group-card__meta">截止日期：{{ selectedGroup?.deadline || '-' }}</text>
        </view>
        <text class="nm-form__label">选择支付方式</text>
        <view class="nm-row">
          <view
            v-for="method in paymentMethods"
            :key="method.value"
            :class="['nm-chip', paymentMethod === method.value ? 'nm-chip--active' : '']"
            @click="paymentMethod = method.value"
          >{{ method.label }}</view>
        </view>
        <view class="nm-primary" @click="joinGroup">确认参团并支付</view>
      </view>
    </BottomSheet>
  </Screen>
</template>

<script setup lang="ts">
import { navTo } from '@/utils/nav';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Screen, BottomSheet, EmptyState, ErrorState, Skeleton, Tag, Icon } from '@/components';
import { useToast } from '@/components/feedback/useToast';
import { CompanyRepo, EventRepo, GroupRepo, type Company, type CompanyEvent, type Group } from '@/services/repos';

type CalendarMode = '7d' | 'month';
type DayItem = { key: string; label: string; weekday: string; count: number };

const toast = useToast();
const textInverse = '#FFFFFF';
const companyId = ref('');
const company = ref<Company | null>(null);
const companyError = ref('');

const activeTab = ref('calendar');
const tabs = [
  { id: 'calendar', label: '日历' },
  { id: 'profile', label: '档案' },
  { id: 'cert', label: '资质' },
  { id: 'test', label: '检测' },
  { id: 'gallery', label: '风采' },
  { id: 'booking', label: '预约' },
  { id: 'group', label: '组团' },
];

const showBooking = ref(false);
const showGroup = ref(false);
const showAgenda = ref(false);
const agendaDate = ref<string | null>(null);

const calendarMode = ref<CalendarMode>('7d');
const events = ref<CompanyEvent[]>([]);
const eventLoading = ref(false);
const eventError = ref('');
const refreshing = ref(false);
const summaryMap = ref<Record<string, number>>({});

const bookings = ref<{ id: string; date: string; people: number; identity: string; status: string; note?: string }[]>([]);
const groups = ref<Group[]>([]);

const selectedEvent = ref<CompanyEvent | null>(null);
const selectedGroup = ref<Group | null>(null);
const paymentMethod = ref<'wechat' | 'alipay'>('wechat');

const identities = ['消费者', '采购商', '学生', '媒体', '投资者'];
const bookingForm = reactive({
  date: '',
  people: '1',
  identity: '消费者',
  note: '',
  contactName: '',
  contactPhone: '',
});

const formatKey = (date: Date) => date.toISOString().slice(0, 10);
const weekLabels = ['日', '一', '二', '三', '四', '五', '六'];

const todayKey = formatKey(new Date());
const activeDate = ref(todayKey);

const dayItems = computed<DayItem[]>(() => {
  const items: DayItem[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const key = formatKey(date);
    items.push({
      key,
      label: String(date.getDate()),
      weekday: weekLabels[date.getDay()],
      count: summaryMap.value[key] || 0,
    });
  }
  return items;
});

const eventsByDate = computed(() => {
  const map = new Map<string, CompanyEvent[]>();
  events.value.forEach((event) => {
    const list = map.get(event.date) ?? [];
    list.push(event);
    map.set(event.date, list);
  });
  map.forEach((list) => list.sort((a, b) => a.startTime.localeCompare(b.startTime)));
  return map;
});

const selectedEvents = computed(() => eventsByDate.value.get(activeDate.value) ?? []);
const activeLabel = computed(() => {
  return activeDate.value;
});

const agendaGroups = computed(() => {
  const entries = Array.from(eventsByDate.value.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  if (agendaDate.value) {
    return Object.fromEntries(entries.filter(([date]) => date === agendaDate.value));
  }
  return Object.fromEntries(entries);
});
const agendaEntries = computed(() => Object.entries(agendaGroups.value));

const eventTypeLabel = (type: CompanyEvent['type']) => {
  if (type === 'tour') return '参观';
  if (type === 'activity') return '活动';
  if (type === 'guide') return '讲解';
  return '讲解';
};

const eventTypeTone = (type: CompanyEvent['type']) => {
  if (type === 'tour') return 'success';
  if (type === 'activity') return 'accent';
  return 'accent';
};

const resolveEventStatus = (event: CompanyEvent) => {
  if (event.endTime) {
    const endAt = new Date(`${event.date}T${event.endTime}`).getTime();
    if (endAt < Date.now()) return 'ended';
  }
  if (typeof event.capacity === 'number' && typeof event.bookedCount === 'number' && event.bookedCount >= event.capacity) {
    return 'full';
  }
  return 'open';
};

const eventStatusLabel = (status: string) => {
  if (status === 'open') return '可预约';
  if (status === 'full') return '已满';
  return '已结束';
};

const bookingTypes = new Set(['tour', 'guide', 'activity', 'briefing']);
const canBook = (event: CompanyEvent) => bookingTypes.has(event.type) && resolveEventStatus(event) === 'open';
const bookingHint = (event: CompanyEvent) => (bookingTypes.has(event.type) ? '暂不可预约' : '无需预约');

const bookingStatusTone = (status: string) => {
  if (status === '已通过') return 'open';
  if (status === '已驳回') return 'ended';
  return 'full';
};

const groupStatusLabel = (status: Group['status']) => {
  const map: Record<Group['status'], string> = {
    forming: '组团中',
    inviting: '邀请中',
    confirmed: '待支付',
    paid: '已支付',
    completed: '已完成',
  };
  return map[status];
};

const paymentMethods: Array<{ value: 'wechat' | 'alipay'; label: string }> = [
  { value: 'wechat', label: '微信支付' },
  { value: 'alipay', label: '支付宝' },
];

const fetchCompany = async () => {
  if (!companyId.value) return;
  const res = await CompanyRepo.getById(companyId.value);
  if (res.ok) {
    company.value = res.data;
    companyError.value = '';
  } else {
    companyError.value = res.error.message || '企业加载失败';
  }
};

const fetchEvents = async () => {
  if (eventLoading.value) return;
  eventLoading.value = true;
  const res = await EventRepo.list({ page: 1, pageSize: 50, companyId: companyId.value });
  if (res.ok) {
    eventError.value = '';
    events.value = res.data.items;
  } else {
    eventError.value = res.error.message || '加载失败';
  }
  eventLoading.value = false;
  if (refreshing.value) refreshing.value = false;
};

const fetchBookings = async () => {
  const res = await EventRepo.listBookings({ page: 1, pageSize: 10, companyId: companyId.value });
  if (res.ok) {
    bookings.value = res.data.items;
  }
};

const fetchGroups = async () => {
  const res = await GroupRepo.list({ page: 1, pageSize: 10, companyId: companyId.value });
  if (res.ok) {
    groups.value = res.data.items;
  }
};

const loadSummary = async () => {
  if (!companyId.value) return;
  const today = new Date();
  let startDate = formatKey(today);
  let endDate = formatKey(new Date(today.getTime() + 6 * 86400000));
  if (calendarMode.value === 'month') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    startDate = formatKey(first);
    endDate = formatKey(last);
  }
  const res = await EventRepo.summary({ companyId: companyId.value, startDate, endDate });
  if (res.ok) {
    const map: Record<string, number> = {};
    res.data.forEach((item) => {
      map[item.date] = item.count;
    });
    summaryMap.value = map;
  }
};

const onRefresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  eventError.value = '';
  Promise.all([fetchCompany(), fetchEvents(), fetchBookings(), fetchGroups(), loadSummary()]).finally(() => {
    refreshing.value = false;
  });
};

const selectDate = (key: string) => {
  activeDate.value = key;
};

const selectToday = () => {
  activeDate.value = todayKey;
};

const openBooking = (event: CompanyEvent) => {
  selectedEvent.value = event;
  bookingForm.date = event.date;
  bookingForm.people = '1';
  bookingForm.note = '';
  bookingForm.contactName = '';
  bookingForm.contactPhone = '';
  bookingForm.identity = identities[0];
  showBooking.value = true;
};

const submitBooking = async () => {
  if (!bookingForm.date || !bookingForm.people) {
    toast.show({ message: '请填写日期与人数', type: 'error' });
    return;
  }
  if (!selectedEvent.value) {
    toast.show({ message: '请先选择活动', type: 'error' });
    return;
  }
  const res = await EventRepo.book({
    companyId: companyId.value,
    eventId: selectedEvent.value.id,
    date: bookingForm.date,
    people: Number(bookingForm.people),
    identity: bookingForm.identity,
    note: bookingForm.note,
  });
  if (res.ok) {
    toast.show({ message: '预约已提交（占位）', type: 'success' });
    showBooking.value = false;
  } else {
    toast.show({ message: res.error.message || '预约失败', type: 'error' });
  }
};

const openAgenda = (date: string | null) => {
  if (date) {
    activeDate.value = date;
  }
  agendaDate.value = date;
  showAgenda.value = true;
};

const openGroupSheet = (group: Group) => {
  selectedGroup.value = group;
  showGroup.value = true;
};

const joinGroup = async () => {
  if (!selectedGroup.value) {
    toast.show({ message: '请选择考察团', type: 'error' });
    return;
  }
  const res = await GroupRepo.join({ groupId: selectedGroup.value.id, headcount: 1 });
  if (!res.ok) {
    toast.show({ message: res.error.message || '参团失败', type: 'error' });
    return;
  }
  toast.show({
    message: `已选择${paymentMethod.value === 'wechat' ? '微信' : '支付宝'}支付（占位）`,
    type: 'info',
  });
  showGroup.value = false;
};

const openGroupDetail = (groupId: string) => {
  navTo({ url: `/pages-sub/group/group-detail?id=${groupId}` });
};

const showMore = () => {
  toast.show({ message: '更多操作即将上线', type: 'info' });
};

onMounted(() => {
  loadSummary();
});

watch(activeDate, () => {
  fetchEvents();
});

watch(calendarMode, () => {
  loadSummary();
});

onLoad((options?: Record<string, string>) => {
  companyId.value = options?.id || 'c1';
  onRefresh();
});

const agendaTitle = computed(() => (agendaDate.value ? `${agendaDate.value} 日程` : '全部日程'));
</script>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.nm-page {
  background-color: $nm-background;
}

.nm-cover {
  position: relative;
  height: 480rpx;
}

.nm-cover__image {
  width: 100%;
  height: 100%;
}

.nm-cover__overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
}

.nm-cover__top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: calc(env(safe-area-inset-top) + 12rpx) $nm-space-md 0;
  height: 104rpx;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.nm-cover__spacer,
.nm-cover__more {
  width: 80rpx;
  height: 80rpx;
  align-items: center;
  justify-content: center;
}

.nm-cover__title {
  flex: 1;
  text-align: center;
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-inverse;
}

.nm-cover__content {
  position: absolute;
  left: $nm-space-xl;
  right: $nm-space-xl;
  bottom: 36rpx;
}

.nm-cover__name {
  font-size: $nm-font-title2;
  color: $nm-text-inverse;
  font-weight: 700;
}

.nm-cover__sub {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-inverse;
}

.nm-cover__meta {
  margin-top: 12rpx;
  flex-direction: row;
  justify-content: space-between;
}

.nm-cover__meta-text {
  font-size: $nm-font-caption;
  color: $nm-text-inverse;
}

.nm-body {
  padding: $nm-space-xl;
}

.nm-tag-row {
  flex-direction: row;
  flex-wrap: wrap;
  gap: $nm-space-sm;
  margin-top: $nm-space-md;
}

.nm-quick-row {
  flex-direction: row;
  gap: $nm-space-sm;
  margin-top: $nm-space-md;
}

.nm-quick-card {
  flex: 1;
  padding: $nm-space-md;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
}

.nm-quick-label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-quick-value {
  margin-top: 8rpx;
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-tabs {
  margin-top: $nm-space-lg;
  white-space: nowrap;
}

.nm-tab {
  display: inline-flex;
  margin-right: $nm-space-sm;
  padding: 16rpx 28rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-tab--active {
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  border-color: $nm-brand-primary;
}

.nm-section {
  padding: 0 $nm-space-xl $nm-space-3xl;
}

.nm-panel {
  padding: $nm-space-lg;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  box-shadow: $nm-shadow-sm;
  margin-bottom: $nm-space-lg;
}

.nm-panel__header {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: $nm-space-md;
}

.nm-panel__actions {
  flex-direction: row;
  gap: $nm-space-sm;
}

.nm-panel__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-panel__subtitle {
  margin-top: $nm-space-sm;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-panel__subtitle + .nm-panel__subtitle {
  margin-top: $nm-space-xs;
}

.nm-panel__subtitle--compact {
  margin-top: $nm-space-xs;
}

.nm-panel__subtitle--flat {
  margin-top: 0;
}

.nm-panel__btn {
  padding: 24rpx 24rpx;
  border-radius: $nm-radius-pill;
  font-size: $nm-font-caption;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-panel__btn--ghost {
  border: 1rpx solid $nm-border;
  color: $nm-text-secondary;
}

.nm-panel__btn--primary {
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
}

.nm-dates {
  margin-top: 0;
  white-space: nowrap;
}

.nm-date {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  width: 136rpx;
  padding: 20rpx;
  margin-right: $nm-space-sm;
  border-radius: $nm-radius-md;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
  font-size: $nm-font-caption;
}

.nm-date--active {
  background-color: $nm-brand-primary;
  border-color: $nm-brand-primary;
}

.nm-date__weekday {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-date__label {
  margin-top: 8rpx;
  font-size: $nm-font-title3;
  color: $nm-text-primary;
}

.nm-date--active .nm-date__weekday,
.nm-date--active .nm-date__label {
  color: $nm-text-inverse;
}

.nm-date--today {
  border-color: $nm-accent-blue;
}

.nm-date--active.nm-date--today {
  border-color: $nm-brand-primary;
}

.nm-date__badge {
  margin-top: 12rpx;
  padding: 4rpx 12rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary-soft;
  border: 1rpx solid transparent;
  font-size: $nm-font-caption;
  color: $nm-brand-primary;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-date__dot {
  margin-top: 16rpx;
  width: 12rpx;
  height: 12rpx;
  border-radius: 6rpx;
  background-color: $nm-border;
}

.nm-date--active .nm-date__badge,
.nm-date--active .nm-date__dot {
  background-color: $nm-surface;
}

.nm-agenda {
  margin-top: $nm-space-lg;
}

.nm-agenda__header {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: $nm-space-md;
}

.nm-agenda__title {
  font-size: $nm-font-title3;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-agenda__link {
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-event {
  padding: 28rpx;
  border-radius: $nm-radius-lg;
  background-color: $nm-surface;
  border: 1rpx solid transparent;
  box-shadow: $nm-shadow-sm;
  margin-bottom: $nm-space-md;
}

.nm-event__row {
  flex-direction: row;
  align-items: flex-start;
}

.nm-event__time {
  width: 144rpx;
  padding: 16rpx 0;
  border-radius: $nm-radius-md;
  background-color: $nm-brand-primary-soft;
  align-items: center;
}

.nm-event__time-text {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-brand-primary;
}

.nm-event__time-sub {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-event__body {
  flex: 1;
  margin-left: $nm-space-md;
}

.nm-event__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-event__meta {
  margin-top: $nm-space-xs;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-event__footer {
  margin-top: $nm-space-md;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-event__action {
  padding: 16rpx 24rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  font-size: $nm-font-caption;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-event__hint {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-status {
  padding: 8rpx 20rpx;
  border-radius: $nm-radius-pill;
  font-size: $nm-font-caption;
}

.nm-status--open {
  background-color: $nm-brand-primary-soft;
  color: $nm-brand-primary;
}

.nm-status--full,
.nm-status--ended {
  background-color: $nm-border;
  color: $nm-text-secondary;
}

.nm-gallery {
  flex-direction: row;
  justify-content: space-between;
  margin-bottom: $nm-space-lg;
}

.nm-gallery__item {
  width: 31%;
  height: 200rpx;
  border-radius: $nm-radius-md;
  background-color: $nm-skeleton;
}

.nm-preview {
  margin-top: $nm-space-md;
  padding: $nm-space-md;
  border-radius: $nm-radius-md;
  border: 1rpx solid $nm-border;
}

.nm-preview__desc {
  margin-top: 12rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-link {
  font-size: $nm-font-caption;
  color: $nm-accent-blue;
}

.nm-row-between {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-progress {
  height: 12rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-border;
  margin-top: 20rpx;
  overflow: hidden;
}

.nm-progress__fill {
  height: 100%;
  background-color: $nm-brand-primary;
}

.nm-sheet {
  padding: $nm-space-md $nm-space-xl $nm-space-2xl;
}

.nm-sheet__row {
  flex-direction: row;
}

.nm-sheet__footer {
  margin-top: 20rpx;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.nm-sheet__group {
  margin-bottom: $nm-space-md;
}

.nm-sheet__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-sheet__sub {
  margin-top: $nm-space-xs;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-sheet__item {
  margin-top: $nm-space-md;
  padding: $nm-space-md;
  border-radius: $nm-radius-md;
  background-color: $nm-surface;
  border: 1rpx solid transparent;
  box-shadow: $nm-shadow-sm;
  flex-direction: column;
}

.nm-sheet__time {
  width: 128rpx;
  align-items: center;
}

.nm-sheet__time-text {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-brand-primary;
}

.nm-sheet__time-sub {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  margin-top: 4rpx;
}

.nm-sheet__content {
  flex: 1;
  margin-left: $nm-space-md;
}

.nm-sheet__name {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-sheet__meta {
  margin-top: $nm-space-xs;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-sheet__btn {
  padding: 16rpx 24rpx;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  font-size: $nm-font-caption;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-form__event {
  margin-bottom: $nm-space-md;
  padding: $nm-space-md;
  border-radius: $nm-radius-md;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
}

.nm-form__event-label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-form__event-title {
  margin-top: 8rpx;
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-form__event-meta {
  margin-top: 4rpx;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-form__label {
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
  margin-top: $nm-space-sm;
}

.nm-input {
  margin-top: 12rpx;
  height: 80rpx;
  border-radius: $nm-radius-md;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
  padding: 20rpx $nm-space-md;
  font-size: $nm-font-caption;
  color: $nm-text-primary;
}

.nm-textarea {
  margin-top: 12rpx;
  height: 160rpx;
  border-radius: $nm-radius-md;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
  padding: 20rpx $nm-space-md;
  font-size: $nm-font-caption;
  color: $nm-text-primary;
}

.nm-row {
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: $nm-space-sm;
  gap: $nm-space-sm;
}

.nm-chip {
  padding: 12rpx 24rpx;
  border-radius: $nm-radius-pill;
  border: 1rpx solid $nm-border;
  background-color: $nm-surface;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-chip--active {
  background-color: $nm-brand-primary;
  color: $nm-text-inverse;
  border-color: $nm-brand-primary;
}

.nm-group-card {
  margin-bottom: $nm-space-md;
  padding: $nm-space-md;
  border-radius: $nm-radius-md;
  background-color: $nm-surface;
  border: 1rpx solid $nm-border;
}

.nm-group-card__title {
  font-size: $nm-font-body;
  font-weight: 600;
  color: $nm-text-primary;
}

.nm-group-card__meta {
  margin-top: $nm-space-xs;
  font-size: $nm-font-caption;
  color: $nm-text-secondary;
}

.nm-primary {
  margin-top: $nm-space-lg;
  padding: 24rpx 0;
  border-radius: $nm-radius-pill;
  background-color: $nm-brand-primary;
  text-align: center;
  color: $nm-text-inverse;
  font-size: $nm-font-body;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-placeholder {
  color: $nm-text-secondary;
}
</style>
