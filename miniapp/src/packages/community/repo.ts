import { ApiClient } from '@/api/client';
import type {
  Author,
  CaptainApplication,
  CaptainLanding,
  CaptainLedger,
  CaptainMyApplication,
  CaptainMyProfile,
  CaptainOrder,
  CaptainRelation,
  FollowListItem,
  PageResult,
  SubmitCaptainApplication,
} from './types';

const CAPTAIN_ORDER_STATUS_LABELS: Record<string, string> = {
  PAID: '待发货', SHIPPED: '已发货', DELIVERED: '待收货', RECEIVED: '已完成',
  CANCELED: '已取消', REFUNDED: '已退款', PENDING_PAYMENT: '待支付',
};

const CAPTAIN_LEDGER_STATUS_LABELS: Record<string, string> = {
  PENDING: '冻结中', FROZEN: '冻结中', AVAILABLE: '可用', RESERVED: '处理中',
  COMPLETED: '已完成', VOIDED: '已作废', FAILED: '处理失败', REVERSED: '已冲正',
};

export function captainOrderStatusLabel(status: string): string {
  return CAPTAIN_ORDER_STATUS_LABELS[status] || '状态更新中';
}

export function captainLedgerStatusLabel(status: string): string {
  return CAPTAIN_LEDGER_STATUS_LABELS[status] || '状态更新中';
}

export const CommunityRepo = {
  captainLanding: (code: string) => ApiClient.get<CaptainLanding>(`/captain/landing/${encodeURIComponent(code.trim().toUpperCase())}`),
  bindCaptain: (code: string) => ApiClient.post<{ success: boolean; relation: CaptainRelation }>('/captain/bind', { code: code.trim().toUpperCase() }),
  captainMe: () => ApiClient.get<CaptainMyProfile>('/captain/me'),
  captainApplication: () => ApiClient.get<CaptainMyApplication>('/captain/applications/me'),
  submitCaptainApplication: (input: SubmitCaptainApplication) => ApiClient.post<CaptainApplication>('/captain/applications', input),
  captainLedgers: (page = 1, pageSize = 10) => ApiClient.get<PageResult<CaptainLedger>>('/captain/me/ledgers', { page, pageSize }),
  captainOrders: (page = 1, pageSize = 10) => ApiClient.get<PageResult<CaptainOrder>>('/captain/me/orders', { page, pageSize }),

  // The live backend's role filter compares Prisma's uppercase enum to the raw
  // query string, while the App sends lowercase. Fetch once and filter by the
  // returned author.type so the mini program uses the real, stable contract.
  following: (sort: 'recent' | 'active') => ApiClient.get<FollowListItem[]>('/follows', { sort }),
  toggleFollow: (authorId: string) => ApiClient.post<{ authorId: string; isFollowed: boolean }>(`/follows/${encodeURIComponent(authorId)}/toggle`),
  author: (authorId: string) => ApiClient.get<Author>(`/authors/${encodeURIComponent(authorId)}`),
};
