import type {
  CaptainBindResult,
  CaptainLandingInfo,
  CaptainLedgerPage,
  CaptainMyProfile,
  CaptainOrderPage,
  Result,
} from '../types';
import { simulateRequest } from './helpers';
import { ApiClient } from './http/ApiClient';
import { USE_MOCK } from './http/config';

const mockProfile: CaptainMyProfile = {
  isCaptain: true,
  profile: {
    id: 'captain-profile-1',
    userId: 'captain-1',
    captainCode: 'SEA001',
    displayName: '海鲜团长',
    status: 'ACTIVE',
    createdAt: '2026-07-08T00:00:00.000Z',
    user: {
      id: 'captain-1',
      buyerNo: 'AIMM202607080001',
      profile: { nickname: '林团长', avatarUrl: null },
    },
  },
  account: {
    userId: 'captain-1',
    balance: 120,
    frozen: 30,
    withdrawn: 10,
    clawback: 0,
  },
  metric: {
    captainUserId: 'captain-1',
    month: '2026-07',
    personalGmv: 2800,
    teamGmv: 25000,
    directEffectiveBuyers: 12,
    teamEffectiveMembers: 35,
    newEffectiveMembers: 2,
    refundRate: 0.03,
    qualified: true,
    qualifiedTier: 'BASE',
  },
  boundRelation: null,
};

const mockLedgers: CaptainLedgerPage = {
  items: [
    {
      id: 'captain-ledger-1',
      type: 'DIRECT_ORDER',
      status: 'FROZEN',
      amount: 9,
      commissionBase: 100,
      rate: 0.09,
      orderId: 'order-1',
      createdAt: '2026-07-08T12:00:00.000Z',
    },
    {
      id: 'captain-ledger-2',
      type: 'MANAGEMENT_ALLOWANCE',
      status: 'AVAILABLE',
      amount: 550,
      settlementId: 'settlement-1',
      createdAt: '2026-07-01T12:00:00.000Z',
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
};

const mockOrders: CaptainOrderPage = {
  items: [
    {
      id: 'attr-1',
      orderId: 'order-1',
      buyerUserId: 'buyer-1',
      directCaptainUserId: 'captain-1',
      indirectCaptainUserId: null,
      commissionBase: 100,
      refundAmount: 0,
      directRate: 0.09,
      indirectRate: 0.02,
      status: 'FROZEN',
      createdAt: '2026-07-08T12:00:00.000Z',
      order: { id: 'order-1', status: 'PAID', totalAmount: 100, createdAt: '2026-07-08T12:00:00.000Z' },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
};

export const CaptainRepo = {
  getLanding: async (code: string): Promise<Result<CaptainLandingInfo>> => {
    const normalizedCode = code.trim().toUpperCase();
    if (USE_MOCK) {
      return simulateRequest({
        code: normalizedCode,
        valid: normalizedCode === 'SEA001',
        enabled: true,
        programName: '预包装海鲜团长经营激励',
        captain: normalizedCode === 'SEA001'
          ? {
            userId: 'captain-1',
            captainCode: 'SEA001',
            displayName: '海鲜团长',
            buyerNo: 'AIMM202607080001',
            nickname: '林团长',
            avatarUrl: null,
          }
          : null,
        reason: normalizedCode === 'SEA001' ? undefined : '团长码无效或已停用',
      });
    }
    return ApiClient.get<CaptainLandingInfo>(`/captain/landing/${encodeURIComponent(normalizedCode)}`);
  },

  bindByCode: async (code: string): Promise<Result<CaptainBindResult>> => {
    const normalizedCode = code.trim().toUpperCase();
    if (USE_MOCK) {
      return simulateRequest({
        success: true,
        relation: {
          id: 'captain-relation-1',
          buyerUserId: 'buyer-1',
          directCaptainUserId: 'captain-1',
          indirectCaptainUserId: null,
          codeUsed: normalizedCode,
          status: 'ACTIVE',
          boundAt: new Date().toISOString(),
        },
      });
    }
    return ApiClient.post<CaptainBindResult>('/captain/bind', { code: normalizedCode });
  },

  getMyCaptainProfile: async (): Promise<Result<CaptainMyProfile>> => {
    if (USE_MOCK) return simulateRequest(mockProfile);
    return ApiClient.get<CaptainMyProfile>('/captain/me', undefined, { noCache: true });
  },

  getMyLedgers: async (page = 1, pageSize = 20): Promise<Result<CaptainLedgerPage>> => {
    if (USE_MOCK) return simulateRequest(mockLedgers);
    return ApiClient.get<CaptainLedgerPage>('/captain/me/ledgers', { page, pageSize }, { noCache: true });
  },

  getMyOrders: async (page = 1, pageSize = 20): Promise<Result<CaptainOrderPage>> => {
    if (USE_MOCK) return simulateRequest(mockOrders);
    return ApiClient.get<CaptainOrderPage>('/captain/me/orders', { page, pageSize }, { noCache: true });
  },
};
