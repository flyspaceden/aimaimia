// 预约/参团成员仓库：成员列表与参团占位（需后端对接）
import type { Result, PagedResult } from '../types';
import { mockPage } from './mock';

export type GroupBookingStatus = 'pending' | 'approved' | 'rejected' | 'invited' | 'joined' | 'paid';

export type Booking = {
  id: string;
  groupId: string;
  contactName: string;
  identity: string;
  headcount: number;
  status: GroupBookingStatus;
  auditNote?: string;
};

const bookings: Booking[] = [
  { id: 'b1', groupId: 'e3', contactName: '王可', identity: '采购商', headcount: 6, status: 'approved' },
  { id: 'b2', groupId: 'e3', contactName: '赵宁', identity: '消费者', headcount: 2, status: 'invited' },
  { id: 'b3', groupId: 'e5', contactName: '孙晨', identity: '学生', headcount: 12, status: 'joined' },
];

export const BookingRepo = {
  // 参团成员列表：后端需按 groupId 查询报名记录
  listByGroup: async (params: {
    groupId: string;
    page: number;
    pageSize: number;
  }): Promise<Result<PagedResult<Booking>>> => {
    const filtered = bookings.filter((item) => item.groupId === params.groupId);
    return mockPage(filtered, params.page, params.pageSize);
  },

  // 参团占位：后端需创建预约/参团记录
  joinGroup: async (payload: {
    groupId: string;
    companyId: string;
    identity: string;
    headcount: number;
    contactName: string;
  }): Promise<Result<{ bookingId: string }>> => {
    if (!payload.groupId || payload.headcount <= 0) {
      return { ok: false, error: { code: 'INVALID', message: '参团信息不完整' } };
    }
    return { ok: true, data: { bookingId: `booking-${Date.now()}` } };
  },
};
