import type {
  GrowthExchangeItem,
  GrowthExchangeRecord,
  GrowthGuide,
  GrowthSummary,
  NormalShareProfile,
  NormalShareRecord,
  NormalShareStats,
  Result,
} from '../types';
import { ApiClient } from './http/ApiClient';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';

const formatUuidV4 = (bytes: Uint8Array) => {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
};

const createIdempotencyKey = () => {
  const cryptoObj = (globalThis as unknown as {
    crypto?: {
      randomUUID?: () => string;
      getRandomValues?: (array: Uint8Array) => Uint8Array;
    };
  }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoObj?.getRandomValues) cryptoObj.getRandomValues(bytes);
  else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return formatUuidV4(bytes);
};

const mockGrowth: GrowthSummary = {
  pointsBalance: 680,
  pointsTotalEarned: 1040,
  pointsTotalSpent: 360,
  growthValue: 1360,
  level: { code: 'G2', name: '青苗会员', threshold: 500, titleLabel: '青苗' },
  nextLevel: { code: 'G3', name: '丰收会员', threshold: 2000, titleLabel: '丰收' },
  levelProgress: { current: 860, required: 1500, ratio: 0.5733 },
  updatedAt: new Date().toISOString(),
  directReferralStatus: 'ACTIVE',
  directReferralInviter: { id: 'u-inviter', nickname: '周阿姨', buyerNo: 'AIMM00000000000123' },
  autoVipBySpendEnabled: true,
  autoVipCumulativeSpendThreshold: 399,
  autoVipRemainingSpend: 128,
  directReferralPercent: 0.01,
};

const mockGuide: GrowthGuide = {
  inviteRules: [
    {
      code: 'NORMAL_INVITE_REGISTER',
      name: '邀请好友注册',
      categoryCode: 'INVITE',
      pointsReward: 20,
      growthReward: 20,
      grantTiming: 'IMMEDIATE',
      dailyLimit: 5,
      weeklyLimit: null,
      monthlyLimit: null,
      lifetimeLimit: null,
      sortOrder: 110,
    },
    {
      code: 'NORMAL_INVITE_FIRST_ORDER',
      name: '好友首单确认收货',
      categoryCode: 'INVITE',
      pointsReward: 200,
      growthReward: 300,
      grantTiming: 'CONFIRMED_RECEIPT',
      dailyLimit: null,
      weeklyLimit: null,
      monthlyLimit: 20,
      lifetimeLimit: null,
      sortOrder: 120,
    },
  ],
  earningRules: [
    {
      code: 'CHECK_IN',
      name: '每日签到',
      categoryCode: 'DAILY',
      pointsReward: 5,
      growthReward: 0,
      grantTiming: 'IMMEDIATE',
      dailyLimit: 1,
      weeklyLimit: null,
      monthlyLimit: null,
      lifetimeLimit: null,
      sortOrder: 40,
    },
    {
      code: 'FIRST_ORDER_RECEIVED',
      name: '首单确认收货',
      categoryCode: 'SHOPPING',
      pointsReward: 100,
      growthReward: 200,
      grantTiming: 'CONFIRMED_RECEIPT',
      dailyLimit: null,
      weeklyLimit: null,
      monthlyLimit: null,
      lifetimeLimit: 1,
      sortOrder: 80,
    },
  ],
  levels: [
    { code: 'G1', name: '新芽会员', threshold: 0, titleLabel: '新芽' },
    { code: 'G2', name: '青苗会员', threshold: 500, titleLabel: '青苗' },
    { code: 'G3', name: '丰收会员', threshold: 2000, titleLabel: '丰收' },
  ],
  pointsNote: '普通积分用于兑换红包和权益，兑换时会消耗。',
  growthNote: '成长值用于升级，不会因为积分兑换而减少。',
};

const mockShareProfile: NormalShareProfile = {
  id: 'share-1',
  userId: 'user-1',
  code: 'S8K6M2Q9',
  status: 'ACTIVE',
  disabledReason: null,
  shareUrl: 'https://app.ai-maimai.com/s/S8K6M2Q9',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockExchangeItems: GrowthExchangeItem[] = [
  {
    id: 'exchange-coupon-1',
    type: 'COUPON',
    name: '5元平台红包',
    description: '普通商品下单可用',
    pointsCost: 100,
    stockTotal: 1000,
    stockDaily: 100,
    issuedTotal: 26,
    issuedToday: 3,
    issuedTodayDate: null,
    perUserDailyLimit: 1,
    perUserMonthlyLimit: 5,
    requiredLevelCode: null,
    requiredLevel: null,
    startAt: null,
    endAt: null,
    status: 'ACTIVE',
    sortOrder: 1,
    canExchange: true,
  },
];

export const GrowthRepo = {
  getMe: (): Promise<Result<GrowthSummary>> => {
    if (USE_MOCK) return simulateRequest(mockGrowth);
    return ApiClient.get<GrowthSummary>('/growth/me');
  },

  getGuide: (): Promise<Result<GrowthGuide>> => {
    if (USE_MOCK) return simulateRequest(mockGuide);
    return ApiClient.get<GrowthGuide>('/growth/guide');
  },

  getExchangeItems: (): Promise<Result<GrowthExchangeItem[]>> => {
    if (USE_MOCK) return simulateRequest(mockExchangeItems);
    return ApiClient.get<GrowthExchangeItem[]>('/growth/exchange/items');
  },

  exchangeItem: (
    itemId: string,
    idempotencyKey = createIdempotencyKey(),
  ): Promise<Result<GrowthExchangeRecord>> => {
    if (USE_MOCK) {
      return simulateRequest({
        id: `growth-exchange-${Date.now()}`,
        itemId,
        pointsCost: mockExchangeItems.find((item) => item.id === itemId)?.pointsCost ?? 0,
        status: 'SUCCESS',
        couponInstanceId: 'coupon-mock',
        failureReason: null,
        createdAt: new Date().toISOString(),
      });
    }
    return ApiClient.post<GrowthExchangeRecord>(`/growth/exchange/${itemId}`, { idempotencyKey });
  },

  getExchangeRecords: (): Promise<Result<GrowthExchangeRecord[]>> => {
    if (USE_MOCK) return simulateRequest([]);
    return ApiClient.get<GrowthExchangeRecord[]>('/growth/exchange/records');
  },

  getNormalShareMe: (): Promise<Result<NormalShareProfile>> => {
    if (USE_MOCK) return simulateRequest(mockShareProfile);
    return ApiClient.get<NormalShareProfile>('/normal-share/me');
  },

  bindNormalShareCode: (code: string): Promise<Result<NormalShareRecord>> => {
    if (USE_MOCK) {
      return simulateRequest({
        id: `normal-share-binding-${Date.now()}`,
        inviterUserId: 'mock-inviter',
        inviteeUserId: 'mock-invitee',
        code: code.trim().toUpperCase(),
        source: 'APP',
        relationStatus: 'ACTIVE',
        boundAt: new Date().toISOString(),
        firstOrderId: null,
        rewardStatus: 'PENDING',
        rewardIssuedAt: null,
        createdAt: new Date().toISOString(),
      });
    }
    return ApiClient.post<NormalShareRecord>('/normal-share/bind', { code, source: 'APP' });
  },

  getNormalShareStats: (): Promise<Result<NormalShareStats>> => {
    if (USE_MOCK) {
      return simulateRequest({ totalInvitees: 12, rewardedInvitees: 4, pendingInvitees: 8 });
    }
    return ApiClient.get<NormalShareStats>('/normal-share/stats');
  },

  getNormalShareRecords: (): Promise<Result<NormalShareRecord[]>> => {
    if (USE_MOCK) return simulateRequest([]);
    return ApiClient.get<NormalShareRecord[]>('/normal-share/records');
  },
};
