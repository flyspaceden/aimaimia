/**
 * 预约仓储（Repo）
 *
 * 业务背景：
 * - 数字展览馆 -> 企业页 -> 事件/日历 -> 提交预约
 * - 预约进入后台审核（运营审核页面）
 * - 审核通过后进入“预约池”，达到阈值可触发组团邀请
 * - 用户确认参团并支付（支付入口预留）
 *
 * 当前实现：
 * - 使用 `src/mocks/bookings.ts` 在前端模拟状态流转
 *
 * 后端接入说明：
 * - 建议接口见：`说明文档/后端接口清单.md#23-预约booking`
 * - 关键点：
 *   - 审核流转应由后端控制（权限：运营/企业）
 *   - 成团阈值可按企业配置（默认 30），由后端根据预约池统计触发
 *   - 支付应走微信/支付宝；支付回调后更新状态（paid）
 */
import { mockBookings } from '../mocks';
import { Booking, BookingStatus, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';

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

// 预约仓储：用于提交、审核与状态流转（Mock 数据）
export const BookingRepo = {
  // 获取全部预约（用于运营审核）
  /** 运营审核列表：`GET /api/v1/bookings` */
  list: async (): Promise<Result<Booking[]>> => simulateRequest([...mockBookings]),
  // 获取企业预约列表
  /** 企业预约列表：`GET /api/v1/companies/{companyId}/bookings` */
  listByCompany: async (companyId: string): Promise<Result<Booking[]>> =>
    simulateRequest(mockBookings.filter((item) => item.companyId === companyId)),
  // 获取考察团预约列表
  /** 考察团预约列表：`GET /api/v1/groups/{groupId}/bookings` */
  listByGroup: async (groupId: string): Promise<Result<Booking[]>> =>
    simulateRequest(mockBookings.filter((item) => item.groupId === groupId)),
  // 提交预约（默认待审核）
  /**
   * 提交预约
   * - 后端建议：`POST /api/v1/bookings`
   * - body：`{ companyId, eventId?, date, headcount, identity, note?, contactName?, contactPhone? }`
   */
  create: async (payload: BookingCreateInput): Promise<Result<Booking>> => {
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
  },
  // 审核预约：通过/驳回
  /**
   * 审核预约
   * - 后端建议：`POST /api/v1/bookings/{id}/review`
   * - body：`{ status: 'approved' | 'rejected', note? }`
   * - 权限：运营/企业
   */
  review: async (id: string, status: Extract<BookingStatus, 'approved' | 'rejected'>, note?: string) => {
    const target = mockBookings.find((item) => item.id === id);
    if (!target) {
      return err(createAppError('NOT_FOUND', `预约不存在: ${id}`, '预约不存在'));
    }
    target.status = status;
    target.auditNote = note;
    target.reviewedAt = new Date().toISOString();
    return simulateRequest(target, { delay: 300 });
  },
  // 发起成团邀请
  /**
   * 发起成团邀请
   * - 后端建议：`POST /api/v1/bookings/{id}/invite`
   * - body：`{ groupId }`
   */
  inviteToGroup: async (id: string, groupId: string): Promise<Result<Booking>> => {
    const target = mockBookings.find((item) => item.id === id);
    if (!target) {
      return err(createAppError('NOT_FOUND', `预约不存在: ${id}`, '预约不存在'));
    }
    target.status = 'invited';
    target.groupId = groupId;
    return simulateRequest(target, { delay: 300 });
  },
  // 用户确认参团（待支付）
  /**
   * 用户确认参团
   * - 后端建议：`POST /api/v1/bookings/{id}/confirm-join`
   * - 说明：确认后进入“待支付/已参团未支付”的状态，后续由支付回调更新 paid
   */
  confirmJoin: async (id: string): Promise<Result<Booking>> => {
    const target = mockBookings.find((item) => item.id === id);
    if (!target) {
      return err(createAppError('NOT_FOUND', `预约不存在: ${id}`, '预约不存在'));
    }
    target.status = 'joined';
    return simulateRequest(target, { delay: 300 });
  },
  // 参团入口：生成待支付预约记录（用于模拟当前用户参团）
  /**
   * 一键参团入口（生成参团记录）
   * - 后端建议：`POST /api/v1/bookings/join-group`
   * - body：`{ companyId, groupId, headcount?, identity?, contactName? }`
   */
  joinGroup: async (payload: {
    companyId: string;
    groupId: string;
    headcount?: number;
    identity?: Booking['identity'];
    contactName?: string;
  }): Promise<Result<Booking>> => {
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
  },
  // 支付完成
  /**
   * 标记支付完成（占位）
   * - 后端建议：`POST /api/v1/bookings/{id}/paid`
   * - 说明：真实场景应由支付回调触发该状态变更
   */
  markPaid: async (id: string): Promise<Result<Booking>> => {
    const target = mockBookings.find((item) => item.id === id);
    if (!target) {
      return err(createAppError('NOT_FOUND', `预约不存在: ${id}`, '预约不存在'));
    }
    target.status = 'paid';
    return simulateRequest(target, { delay: 300 });
  },
};
