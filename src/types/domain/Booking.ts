/**
 * 域模型：预约（Booking）
 *
 * 用途：
 * - 企业事件预约：提交预约 -> 运营审核 -> 成团邀请 -> 参团确认与支付
 *
 * 后端接入建议：
 * - 审核与成团阈值统计应由后端控制（见 `说明文档/后端接口清单.md#23-预约booking`）
 */
export type BookingIdentity =
  | 'consumer'
  | 'buyer'
  | 'student'
  | 'media'
  | 'investor'
  | 'other';

export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'invited' | 'joined' | 'paid';

export type Booking = {
  id: string;
  companyId: string;
  eventId?: string;
  date: string;
  headcount: number;
  identity: BookingIdentity;
  note?: string;
  contactName?: string;
  contactPhone?: string;
  status: BookingStatus;
  createdAt: string;
  reviewedAt?: string;
  auditNote?: string;
  groupId?: string;
};
