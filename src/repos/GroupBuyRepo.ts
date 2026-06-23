import {
  GroupBuyActivity,
  GroupBuyActivityPage,
  GroupBuyCheckoutInput,
  GroupBuyCheckoutPreview,
  GroupBuyCheckoutResponse,
  GroupBuyCurrentState,
  GroupBuyLandingInfo,
  GroupBuyLedgerPage,
  GroupBuyRebateAccount,
  GroupBuyWithdrawPage,
  Result,
  WithdrawRequestInput,
  WithdrawResult,
  err,
} from '../types';
import { createAppError, simulateRequest } from './helpers';
import { ApiClient } from './http/ApiClient';
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
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    return formatUuidV4(bytes);
  }

  const fallbackBytes = new Uint8Array(16);
  for (let i = 0; i < fallbackBytes.length; i += 1) {
    fallbackBytes[i] = Math.floor(Math.random() * 256);
  }
  return formatUuidV4(fallbackBytes);
};

const mockActivities: GroupBuyActivity[] = [
  {
    id: 'gb-lobster-001',
    title: '深海大龙虾团购',
    description: '鲜活大龙虾单只装，冷链配送到家。肉质紧实，适合清蒸、焗烤或家庭聚餐。',
    price: 1000,
    freeShipping: true,
    shippingSummary: '本活动商品包邮',
    ruleSummary: '仅限直接推荐全新用户购买同款商品',
    product: {
      id: 'product-lobster',
      title: '鲜活大龙虾',
      imageUrl: 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b',
    },
    sku: {
      id: 'sku-lobster-1',
      title: '单只装',
      stock: 18,
      weightGram: 1500,
    },
    items: [
      {
        productId: 'product-lobster',
        productTitle: '鲜活大龙虾',
        imageUrl: 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b',
        skuId: 'sku-lobster-1',
        skuTitle: '单只装',
        stock: 18,
        weightGram: 1500,
        quantity: 1,
      },
      {
        productId: 'product-abalone',
        productTitle: '深海鲍鱼',
        imageUrl: null,
        skuId: 'sku-abalone-6',
        skuTitle: '六只装',
        stock: 12,
        weightGram: 900,
        quantity: 1,
      },
    ],
    itemSummary: '鲜活大龙虾 x1、深海鲍鱼 x1',
    availableStock: 12,
    totalWeightGram: 2400,
    tiers: [
      { sequence: 1, label: '第一位好友' },
      { sequence: 2, label: '第二位好友' },
      { sequence: 3, label: '第三位好友' },
    ],
  },
  {
    id: 'gb-melon-001',
    title: '精品蜜瓜礼盒团购',
    description: '精选当季蜜瓜双果礼盒，果香清甜，适合家庭自用或节日赠礼。',
    price: 268,
    freeShipping: false,
    shippingSummary: '按商品配置收取运费',
    ruleSummary: '新客完成有效订单后计入分享进度',
    product: {
      id: 'product-melon',
      title: '精品蜜瓜礼盒',
      imageUrl: 'https://images.unsplash.com/photo-1571575173700-afb9492e6a50',
    },
    sku: {
      id: 'sku-melon-1',
      title: '双果礼盒',
      stock: 36,
      weightGram: 3200,
    },
    items: [
      {
        productId: 'product-melon',
        productTitle: '精品蜜瓜礼盒',
        imageUrl: 'https://images.unsplash.com/photo-1571575173700-afb9492e6a50',
        skuId: 'sku-melon-1',
        skuTitle: '双果礼盒',
        stock: 36,
        weightGram: 3200,
        quantity: 1,
      },
    ],
    itemSummary: '精品蜜瓜礼盒 x1',
    availableStock: 36,
    totalWeightGram: 3200,
    tiers: [
      { sequence: 1, label: '第一位好友' },
      { sequence: 2, label: '第二位好友' },
      { sequence: 3, label: '第三位好友' },
    ],
  },
];

const mockCurrent: GroupBuyCurrentState = {
  current: {
    id: 'gbi-current-001',
    status: 'SHARING',
    validReferralCount: 1,
    candidateCount: 2,
    code: { code: 'GB123456', status: 'ACTIVE' },
    activity: mockActivities[0],
    referrals: [
      { id: 'gbr-1', status: 'VALID', candidateSequence: 1, effectiveSequence: 1 },
      { id: 'gbr-2', status: 'CANDIDATE', candidateSequence: 2, effectiveSequence: null },
    ],
  },
  occupiesSlot: true,
  defaultTab: 'CURRENT',
  canBuyNew: false,
};

const mockRebateAccount: GroupBuyRebateAccount = {
  balance: 100,
  reserved: 0,
  withdrawn: 0,
  deducted: 0,
  available: 100,
  total: 100,
};

const notFound = (message: string) => err(createAppError('NOT_FOUND', message, message));

export const GroupBuyRepo = {
  listActivities: async (): Promise<Result<GroupBuyActivityPage>> => {
    if (USE_MOCK) return simulateRequest({ items: mockActivities });
    return ApiClient.get<GroupBuyActivityPage>('/group-buy/activities');
  },

  getActivity: async (activityId: string): Promise<Result<GroupBuyActivity>> => {
    if (USE_MOCK) {
      const activity = mockActivities.find((item) => item.id === activityId);
      return activity ? simulateRequest(activity) : notFound('团购商品不存在');
    }

    const result = await GroupBuyRepo.listActivities();
    if (!result.ok) return result as Result<GroupBuyActivity>;
    const activity = result.data.items.find((item) => item.id === activityId);
    if (!activity) return notFound('团购商品不存在');
    return { ok: true, data: activity };
  },

  getCurrent: async (): Promise<Result<GroupBuyCurrentState>> => {
    if (USE_MOCK) return simulateRequest(mockCurrent);
    return ApiClient.get<GroupBuyCurrentState>('/group-buy/me/current', undefined, { noCache: true });
  },

  createCheckout: async (
    input: GroupBuyCheckoutInput,
  ): Promise<Result<GroupBuyCheckoutResponse>> => {
    const idempotencyKey = input.idempotencyKey ?? createIdempotencyKey();
    if (USE_MOCK) {
      const activity = mockActivities.find((item) => item.id === input.activityId);
      if (!activity) return notFound('团购商品不存在') as Result<GroupBuyCheckoutResponse>;
      return simulateRequest({
        sessionId: `gb-checkout-${Date.now()}`,
        merchantOrderNo: `GB${Date.now()}`,
        expectedTotal: activity.price,
        goodsAmount: activity.price,
        shippingFee: activity.freeShipping ? 0 : 12,
        discountAmount: 0,
        paymentParams: {},
      });
    }

    return ApiClient.post<GroupBuyCheckoutResponse>('/group-buy/checkout', {
      ...input,
      idempotencyKey,
    });
  },

  previewCheckout: async (
    input: GroupBuyCheckoutInput,
  ): Promise<Result<GroupBuyCheckoutPreview>> => {
    if (USE_MOCK) {
      const activity = mockActivities.find((item) => item.id === input.activityId);
      if (!activity) return notFound('团购商品不存在') as Result<GroupBuyCheckoutPreview>;
      const shippingFee = activity.freeShipping ? 0 : 12;
      return simulateRequest({
        expectedTotal: Number((activity.price + shippingFee).toFixed(2)),
        goodsAmount: activity.price,
        shippingFee,
        discountAmount: 0,
      });
    }

    return ApiClient.post<GroupBuyCheckoutPreview>('/group-buy/checkout/preview', input);
  },

  getLanding: async (code: string): Promise<Result<GroupBuyLandingInfo>> => {
    if (USE_MOCK) {
      const valid = code === 'GB123456';
      return simulateRequest({
        code,
        valid,
        activity: valid ? mockActivities[0] : null,
        inviter: valid ? { userId: 'user-sharer-1', nickname: '分享用户', buyerNo: 'AIMM202606220001' } : null,
        reason: valid ? undefined : '团购推荐码无效或已结束',
      });
    }
    return ApiClient.get<GroupBuyLandingInfo>(`/group-buy/landing/${encodeURIComponent(code)}`);
  },

  terminateCurrent: async (): Promise<Result<{ status: string }>> => {
    if (USE_MOCK) return simulateRequest({ status: 'TERMINATED' });
    return ApiClient.post('/group-buy/me/current/terminate');
  },

  abandonCurrent: async (instanceId: string): Promise<Result<{ status: string }>> => {
    if (!instanceId) {
      return err(createAppError('INVALID', '缺少团购资格ID', '团购状态已变化，请刷新后重试'));
    }
    if (USE_MOCK) return simulateRequest({ status: 'ABANDONED' });
    return ApiClient.post(`/group-buy/me/current/${encodeURIComponent(instanceId)}/abandon`);
  },

  getRebateAccount: async (): Promise<Result<GroupBuyRebateAccount>> => {
    if (USE_MOCK) return simulateRequest(mockRebateAccount);
    return ApiClient.get<GroupBuyRebateAccount>('/group-buy/me/rebate-account');
  },

  listRebateLedgers: async (page = 1, pageSize = 20): Promise<Result<GroupBuyLedgerPage>> => {
    if (USE_MOCK) {
      return simulateRequest({
        items: [
          {
            id: 'gbl-1',
            type: 'RELEASE' as const,
            status: 'AVAILABLE' as const,
            amount: 100,
            balanceBefore: 0,
            balanceAfter: 100,
            instanceId: 'gbi-current-001',
            referralId: 'gbr-1',
            orderId: 'order-1',
            refType: 'GROUP_BUY_REFERRAL',
            refId: 'gbr-1',
            meta: { tierSequence: 1 },
            createdAt: '2026-06-22T12:10:00.000Z',
          },
        ],
        total: 1,
        page,
        pageSize,
      });
    }
    return ApiClient.get<GroupBuyLedgerPage>('/group-buy/me/rebate-ledgers', { page, pageSize });
  },

  requestRebateWithdraw: async (
    input: WithdrawRequestInput,
  ): Promise<Result<WithdrawResult>> => {
    if (USE_MOCK) {
      return simulateRequest({
        withdrawId: `gbw-${Date.now()}`,
        grossAmount: input.amount,
        taxAmount: Number((input.amount * 0.20).toFixed(2)),
        taxRate: 0.20,
        netAmount: Number((input.amount * 0.80).toFixed(2)),
        status: 'PROCESSING' as const,
        message: '提现处理中（mock）',
      });
    }
    return ApiClient.post<WithdrawResult>('/group-buy/me/rebate-withdraw', input, {
      headers: { 'Idempotency-Key': createIdempotencyKey() },
    });
  },

  listRebateWithdrawals: async (
    page = 1,
    pageSize = 20,
  ): Promise<Result<GroupBuyWithdrawPage>> => {
    if (USE_MOCK) {
      return simulateRequest({
        items: [],
        total: 0,
        page,
        pageSize,
      });
    }
    return ApiClient.get<GroupBuyWithdrawPage>('/group-buy/me/rebate-withdraw/history', {
      page,
      pageSize,
    });
  },
};
