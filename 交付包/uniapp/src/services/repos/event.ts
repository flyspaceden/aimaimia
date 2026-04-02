// 企业事件仓库：预约/活动/组团列表接口占位
import type { Result, PagedResult } from '../types';
import { mockPage } from './mock';

export type CompanyEvent = {
  id: string;
  title: string;
  startTime: string;
  endTime?: string;
  date: string;
  type: 'tour' | 'guide' | 'activity' | 'briefing';
  mode: 'booking' | 'group';
  location?: string;
  target?: number;
  joined?: number;
  deadline?: string;
  capacity?: number;
  bookedCount?: number;
};

export type EventBookingPayload = {
  companyId: string;
  eventId: string;
  date: string;
  people: number;
  identity: string;
  note?: string;
};

export type GroupJoinPayload = {
  companyId: string;
  eventId: string;
};

export type EventSummaryItem = {
  date: string;
  count: number;
};

export type BookingStatus = '待审核' | '已通过' | '已驳回';

export type BookingRequest = {
  id: string;
  companyId: string;
  companyName: string;
  applicant: string;
  people: number;
  date: string;
  status: BookingStatus;
  identity: string;
  note?: string;
  auditNote?: string;
};

const formatDateKey = (date: Date) => date.toISOString().slice(0, 10);

const today = new Date();
const day0 = formatDateKey(today);
const day1 = formatDateKey(new Date(today.getTime() + 86400000));
const day2 = formatDateKey(new Date(today.getTime() + 2 * 86400000));
const day3 = formatDateKey(new Date(today.getTime() + 3 * 86400000));
const day4 = formatDateKey(new Date(today.getTime() + 4 * 86400000));

const events: CompanyEvent[] = [
  {
    id: 'e1',
    title: '农场参观讲解',
    startTime: '09:30',
    endTime: '11:00',
    date: day0,
    type: 'tour',
    mode: 'booking',
    location: '温室 A 区',
    capacity: 30,
    bookedCount: 12,
  },
  {
    id: 'e2',
    title: '采摘体验活动',
    startTime: '14:00',
    endTime: '16:00',
    date: day0,
    type: 'activity',
    mode: 'booking',
    location: '果蔬体验区',
    capacity: 20,
    bookedCount: 18,
  },
  {
    id: 'e3',
    title: '品牌开放日',
    startTime: '16:30',
    endTime: '18:00',
    date: day1,
    type: 'briefing',
    mode: 'group',
    target: 30,
    joined: 18,
    deadline: day1,
  },
  {
    id: 'e4',
    title: '有机种植讲解',
    startTime: '10:00',
    endTime: '11:20',
    date: day2,
    type: 'guide',
    mode: 'booking',
    location: '育苗中心',
    capacity: 25,
    bookedCount: 20,
  },
  {
    id: 'e5',
    title: '秋冬专题考察团',
    startTime: '09:00',
    endTime: '12:00',
    date: day3,
    type: 'briefing',
    mode: 'group',
    target: 30,
    joined: 26,
    deadline: day3,
  },
  {
    id: 'e6',
    title: '田间管理交流',
    startTime: '15:30',
    endTime: '17:00',
    date: day4,
    type: 'activity',
    mode: 'booking',
    location: '示范田',
    capacity: 16,
    bookedCount: 16,
  },
];

export const EventRepo = {
  list: async (params: {
    page: number;
    pageSize: number;
    companyId: string;
    date?: string;
  }): Promise<Result<PagedResult<CompanyEvent>>> => {
    // TODO(后端)：支持按 companyId/date 过滤，返回分页事件
    const filtered = params.date ? events.filter((item) => item.date === params.date) : events;
    return mockPage(filtered, params.page, params.pageSize);
  },

  // 预约接口占位：后续对接后端创建预约单
  book: async (payload: EventBookingPayload): Promise<Result<{ bookingId: string }>> => {
    if (!payload.date || payload.people <= 0) {
      return { ok: false, error: { code: 'INVALID', message: '预约信息不完整' } };
    }
    return { ok: true, data: { bookingId: `booking-${Date.now()}` } };
  },

  // 组团接口占位：后续对接后端加入考察团
  joinGroup: async (payload: GroupJoinPayload): Promise<Result<{ groupId: string }>> => {
    if (!payload.eventId) {
      return { ok: false, error: { code: 'INVALID', message: '缺少事件信息' } };
    }
    return { ok: true, data: { groupId: `group-${Date.now()}` } };
  },

  // 日历摘要占位：按日期返回事件数量，避免一次性拉全量
  summary: async (params: {
    companyId: string;
    startDate: string;
    endDate: string;
  }): Promise<Result<EventSummaryItem[]>> => {
    const start = new Date(params.startDate).getTime();
    const end = new Date(params.endDate).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return { ok: false, error: { code: 'INVALID', message: '日期范围不合法' } };
    }
    const map: Record<string, number> = {};
    events.forEach((item) => {
      const time = new Date(item.date).getTime();
      if (time >= start && time <= end) {
        map[item.date] = (map[item.date] || 0) + 1;
      }
    });
    const list = Object.keys(map)
      .sort()
      .map((date) => ({ date, count: map[date] }));
    return { ok: true, data: list };
  },

  // 预约列表占位：供“运营审核”页使用
  listBookings: async (params: { page: number; pageSize: number; companyId?: string }): Promise<Result<PagedResult<BookingRequest>>> => {
    const mock: BookingRequest[] = [
      { id: 'b1', companyId: 'c1', companyName: '青禾有机农场', applicant: '张凯', people: 12, date: '2024-12-10', status: '待审核', identity: '采购商' },
      { id: 'b2', companyId: 'c2', companyName: '山谷果园', applicant: '李娜', people: 30, date: '2024-12-14', status: '待审核', identity: '消费者' },
      { id: 'b3', companyId: 'c1', companyName: '青禾有机农场', applicant: '陈乐', people: 6, date: '2024-12-18', status: '已通过', identity: '学生', auditNote: '已完成资质核验' },
    ];
    return mockPage(mock, params.page, params.pageSize);
  },

  // 预约审核占位：通过/驳回
  auditBooking: async (payload: { bookingId: string; action: 'approve' | 'reject'; note?: string }): Promise<Result<{ ok: true }>> => {
    if (!payload.bookingId) {
      return { ok: false, error: { code: 'INVALID', message: '缺少预约记录' } };
    }
    return { ok: true, data: { ok: true } };
  },
};
