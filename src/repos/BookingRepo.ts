/**
 * 预约仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：使用 `src/mocks/bookings.ts` 在前端模拟状态流转
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口：
 * - `GET /api/v1/bookings` → `Result<Booking[]>`
 * - `GET /api/v1/bookings/company/{companyId}` → `Result<Booking[]>`
 * - `POST /api/v1/bookings` → `Result<Booking>`
 * - `POST /api/v1/bookings/{id}/review` → `Result<Booking>`
 * - `POST /api/v1/bookings/{id}/invite` → `Result<Booking>`
 * - `POST /api/v1/bookings/{id}/confirm` → `Result<Booking>`
 * - `POST /api/v1/bookings/join-group` → `Result<Booking>`
 * - `POST /api/v1/bookings/{id}/paid` → `Result<Booking>`
 */
import { mockBookings } from '../mocks';
import { Booking, BookingStatus, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

type BookingCreateInput = {
  companyId: string;
  eventId?: string;
  date: string;
  headcount: number;
  identity: Booking['identity'];
  note?: string;
  contactName?: string;
  contactPhone?: string;
};

// 预约仓储：用于提交、审核与状态流转
export const BookingRepo = {
  // 获取全部预约（用于运营审核）
  /** 运营审核列表：`GET /api/v1/bookings` */
  list: async (): Promise<Result<Booking[]>> => {
    if (USE_MOCK) {
      return simulateRequest([...mockBookings]);
    }

    return ApiClient.get<Booking[]>('/bookings');
  },
  // 获取企业预约列表
  /** 企业预约列表：`GET /api/v1/bookings/company/{companyId}` */
  listByCompany: async (companyId: string): Promise<Result<Booking[]>> => {
    if (USE_MOCK) {
      return simulateRequest(mockBookings.filter((item) => item.companyId === companyId));
    }

    return ApiClient.get<Booking[]>(`/bookings/company/${companyId}`);
  },
  // 获取考察团预约列表（保持 mock-only，无专用端点）
  /** 考察团预约列表：mock-only */
  listByGroup: async (groupId: string): Promise<Result<Booking[]>> =>
    simulateRequest(mockBookings.filter((item) => item.groupId === groupId)),
  // 提交预约（默认待审核）
  /**
   * 提交预约
   * - 后端接口：`POST /api/v1/bookings`
   * - body：`{ companyId, eventId?, date, headcount, identity, note?, contactName?, contactPhone? }`
   */
  create: async (payload: BookingCreateInput): Promise<Result<Booking>> => {
    if (USE_MOCK) {
      const booking: Booking = {
        id: `b-${Date.now()}`,
        companyId: payload.companyId,
        eventId: payload.eventId,
        date: payload.date,
        headcount: payload.headcount,
        identity: payload.identity,
        note: payload.note,
        contactName: payload.contactName,
        contactPhone: payload.contactPhone,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      mockBookings.unshift(booking);
      return simulateRequest(booking, { delay: 300 });
    }

    return ApiClient.post<Booking>('/bookings', payload);
  },
  // 审核预约：通过/驳回
  /**
   * 审核预约
   * - 后端接口：`POST /api/v1/bookings/{id}/review`
   * - body：`{ status: 'approved' | 'rejected', note? }`
   */
  review: async (id: string, status: Extract<BookingStatus, 'approved' | 'rejected'>, note?: string) => {
    if (USE_MOCK) {
      const target = mockBookings.find((item) => item.id === id);
      if (!target) {
        return err(createAppError('NOT_FOUND', `预约不存在: ${id}`, '预约不存在'));
      }
      target.status = status;
      target.auditNote = note;
      target.reviewedAt = new Date().toISOString();
      return simulateRequest(target, { delay: 300 });
    }

    return ApiClient.post<Booking>(`/bookings/${id}/review`, { status, note });
  },
  // 发起成团邀请
  /**
   * 发起成团邀请
   * - 后端接口：`POST /api/v1/bookings/{id}/invite`
   * - body：`{ groupId }`
   */
  inviteToGroup: async (id: string, groupId: string): Promise<Result<Booking>> => {
    if (USE_MOCK) {
      const target = mockBookings.find((item) => item.id === id);
      if (!target) {
        return err(createAppError('NOT_FOUND', `预约不存在: ${id}`, '预约不存在'));
      }
      target.status = 'invited';
      target.groupId = groupId;
      return simulateRequest(target, { delay: 300 });
    }

    return ApiClient.post<Booking>(`/bookings/${id}/invite`, { groupId });
  },
  // 用户确认参团（待支付）
  /**
   * 用户确认参团
   * - 后端接口：`POST /api/v1/bookings/{id}/confirm`
   */
  confirmJoin: async (id: string): Promise<Result<Booking>> => {
    if (USE_MOCK) {
      const target = mockBookings.find((item) => item.id === id);
      if (!target) {
        return err(createAppError('NOT_FOUND', `预约不存在: ${id}`, '预约不存在'));
      }
      target.status = 'joined';
      return simulateRequest(target, { delay: 300 });
    }

    return ApiClient.post<Booking>(`/bookings/${id}/confirm`);
  },
  // 参团入口：生成待支付预约记录（用于模拟当前用户参团）
  /**
   * 一键参团入口（生成参团记录）
   * - 后端接口：`POST /api/v1/bookings/join-group`
   * - body：`{ companyId, groupId, headcount?, identity?, contactName? }`
   */
  joinGroup: async (payload: {
    companyId: string;
    groupId: string;
    headcount?: number;
    identity?: Booking['identity'];
    contactName?: string;
  }): Promise<Result<Booking>> => {
    if (USE_MOCK) {
      const booking: Booking = {
        id: `b-${Date.now()}`,
        companyId: payload.companyId,
        groupId: payload.groupId,
        date: new Date().toISOString().slice(0, 10),
        headcount: payload.headcount ?? 1,
        identity: payload.identity ?? 'consumer',
        contactName: payload.contactName ?? '当前用户',
        status: 'joined',
        createdAt: new Date().toISOString(),
      };
      mockBookings.unshift(booking);
      return simulateRequest(booking, { delay: 300 });
    }

    return ApiClient.post<Booking>('/bookings/join-group', payload);
  },
  // 支付完成
  /**
   * 标记支付完成（占位）
   * - 后端接口：`POST /api/v1/bookings/{id}/paid`
   */
  markPaid: async (id: string): Promise<Result<Booking>> => {
    if (USE_MOCK) {
      const target = mockBookings.find((item) => item.id === id);
      if (!target) {
        return err(createAppError('NOT_FOUND', `预约不存在: ${id}`, '预约不存在'));
      }
      target.status = 'paid';
      return simulateRequest(target, { delay: 300 });
    }

    return ApiClient.post<Booking>(`/bookings/${id}/paid`);
  },
};
