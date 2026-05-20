/**
 * 会员奖励仓储（Repo）
 *
 * 后端接口：
 * - GET /api/v1/bonus/member → MemberProfile
 * - POST /api/v1/bonus/referral → { success, inviterUserId, inviter }
 * - POST /api/v1/bonus/vip/purchase → 已停用（改走 VIP 礼包结算）
 * - GET /api/v1/bonus/wallet → Wallet
 * - GET /api/v1/bonus/wallet/ledger?page=&pageSize= → WalletLedgerPage
 * - POST /api/v1/bonus/withdraw → WithdrawResult
 * - GET /api/v1/bonus/withdraw/history → WithdrawRecord[]
 * - GET /api/v1/bonus/vip/tree → VipTree
 * - GET /api/v1/bonus/queue/status → QueueStatus
 */
import {
  MemberProfile, Wallet, WalletLedgerPage, WithdrawRecord,
  VipTree, QueueStatus, RewardItem, NormalRewardPage, Result,
  VipGiftOptionsResponse,
  ReferralBindingResult,
  DeductionPreview,
  WithdrawRequestInput,
  WithdrawResult,
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

  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }

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

const buildDeductionPreview = (
  goodsAmount: number,
  balance: number,
  tier: MemberProfile['tier'],
): DeductionPreview => {
  const safeGoodsAmount = Math.max(0, goodsAmount);
  const pointsBalance = Number(Math.max(0, balance).toFixed(2));
  const pointsRatio = tier === 'VIP' ? 0.15 : 0.10;
  const maxDeductible = Number(Math.min(pointsBalance, safeGoodsAmount * pointsRatio).toFixed(2));
  return { pointsBalance, pointsRatio, maxDeductible };
};

// Mock 数据 — 林青禾（VIP 用户）
const mockMember: MemberProfile = {
  tier: 'VIP',
  referralCode: 'LQHE2025',
  inviterUserId: 'u-001',
  inviter: { userId: 'u-001', nickname: '周阿姨', maskedPhone: '138****5678' },
  vipPurchasedAt: '2026-01-15T10:30:00Z',
  normalEligible: true,
  vipProgress: { selfPurchaseCount: 6, unlockedLevel: 4 },
};

const mockWallet: Wallet = {
  balance: 236.80, frozen: 47.60, total: 384.40,
  vip: { balance: 186.30, frozen: 35.60 },
  normal: { balance: 50.50, frozen: 12.00 },
};

export const BonusRepo = {
  /** 会员信息 */
  getMember: async (): Promise<Result<MemberProfile>> => {
    if (USE_MOCK) return simulateRequest(mockMember);
    return ApiClient.get<MemberProfile>('/bonus/member');
  },

  /** 使用推荐码 */
  useReferralCode: async (code: string): Promise<Result<ReferralBindingResult>> => {
    if (USE_MOCK) {
      return simulateRequest({
        success: true,
        inviterUserId: 'u-inviter',
        inviter: { userId: 'u-inviter', nickname: '李四', maskedPhone: '139****1111' },
      }, { delay: 400 });
    }
    return ApiClient.post('/bonus/referral', { code });
  },

  /** @deprecated 旧 VIP 直购接口已停用，前端应改走 VIP 礼包结算 */
  purchaseVip: async (): Promise<Result<MemberProfile>> => {
    if (USE_MOCK) {
      return Promise.resolve({
        ok: false,
        error: {
          code: 'INVALID',
          message: '旧 VIP 直购接口已停用',
          displayMessage: '请通过 VIP 礼包完成购买',
          retryable: false,
        },
      });
    }
    return {
      ok: false,
      error: {
        code: 'INVALID',
        message: '旧 VIP 直购接口已停用',
        displayMessage: '请通过 VIP 礼包完成购买',
        retryable: false,
      },
    };
  },

  /** 钱包余额 */
  getWallet: async (): Promise<Result<Wallet>> => {
    if (USE_MOCK) return simulateRequest(mockWallet);
    return ApiClient.get<Wallet>('/bonus/wallet');
  },

  /** 钱包流水 */
  getWalletLedger: async (page = 1, pageSize = 20): Promise<Result<WalletLedgerPage>> => {
    if (USE_MOCK) {
      return simulateRequest({
        items: [
          { id: 'l-01', entryType: 'CREDIT', amount: 18.60, status: 'SETTLED', refType: 'VIP_TREE', meta: null, createdAt: '2026-03-26' },
          { id: 'l-02', entryType: 'CREDIT', amount: 50.00, status: 'SETTLED', refType: 'VIP_REFERRAL', meta: null, createdAt: '2026-03-24' },
          { id: 'l-03', entryType: 'CREDIT', amount: 9.30, status: 'SETTLED', refType: 'NORMAL_TREE', meta: null, createdAt: '2026-03-22' },
          { id: 'l-04', entryType: 'CREDIT', amount: 24.50, status: 'SETTLED', refType: 'VIP_TREE', meta: null, createdAt: '2026-03-18' },
          { id: 'l-04-deduct', entryType: 'DEDUCT', amount: 18.00, status: 'SETTLED', refType: 'ORDER', meta: { orderNo: 'MO-20260318' }, createdAt: '2026-03-17' },
          { id: 'l-05', entryType: 'DEBIT', amount: -100.00, status: 'SETTLED', refType: 'WITHDRAW', meta: null, createdAt: '2026-03-15' },
          { id: 'l-06', entryType: 'CREDIT', amount: 50.00, status: 'SETTLED', refType: 'VIP_REFERRAL', meta: null, createdAt: '2026-03-12' },
          { id: 'l-06-restore', entryType: 'RELEASE', amount: 7.20, status: 'SETTLED', refType: 'REFUND_RESTORE', meta: { orderNo: 'MO-20260310' }, createdAt: '2026-03-10' },
          { id: 'l-07', entryType: 'CREDIT', amount: 15.80, status: 'SETTLED', refType: 'VIP_TREE', meta: null, createdAt: '2026-03-08' },
          { id: 'l-08', entryType: 'CREDIT', amount: 6.20, status: 'SETTLED', refType: 'ORDER', meta: null, createdAt: '2026-03-05' },
          { id: 'l-09', entryType: 'DEBIT', amount: -50.00, status: 'SETTLED', refType: 'WITHDRAW', meta: null, createdAt: '2026-02-28' },
          { id: 'l-10', entryType: 'CREDIT', amount: 12.40, status: 'SETTLED', refType: 'VIP_TREE', meta: null, createdAt: '2026-02-20' },
        ],
        nextPage: undefined,
      });
    }
    return ApiClient.get<WalletLedgerPage>('/bonus/wallet/ledger', { page, pageSize });
  },

  /** 申请提现 */
  requestWithdraw: async (input: WithdrawRequestInput): Promise<Result<WithdrawResult>> => {
    if (USE_MOCK) {
      return simulateRequest(
        {
          withdrawId: `w-${Date.now()}`,
          grossAmount: input.amount,
          taxAmount: Number((input.amount * 0.20).toFixed(2)),
          taxRate: 0.20,
          netAmount: Number((input.amount * 0.80).toFixed(2)),
          status: 'PROCESSING' as const,
          message: '提现处理中（mock）',
        },
        { delay: 400 },
      );
    }
    return ApiClient.post<WithdrawResult>('/bonus/withdraw', input, {
      headers: { 'Idempotency-Key': createIdempotencyKey() },
    });
  },

  /** 抵扣预览（独立 helper；结算页优先使用 /orders/preview 返回的后端权威字段） */
  getDeductionPreview: async (goodsAmount: number): Promise<Result<DeductionPreview>> => {
    if (USE_MOCK) {
      return simulateRequest(buildDeductionPreview(goodsAmount, mockWallet.balance, mockMember.tier), { delay: 200 });
    }

    const [walletResult, memberResult] = await Promise.all([
      BonusRepo.getWallet(),
      BonusRepo.getMember(),
    ]);
    if (!walletResult.ok) return walletResult;
    if (!memberResult.ok) return memberResult;
    return {
      ok: true,
      data: buildDeductionPreview(goodsAmount, walletResult.data.balance, memberResult.data.tier),
    };
  },

  /** 提现记录 */
  getWithdrawHistory: async (): Promise<Result<WithdrawRecord[]>> => {
    if (USE_MOCK) {
      return simulateRequest([
        { id: 'w-1', amount: 50, channel: 'WECHAT', status: 'COMPLETED', createdAt: '2026-02-01' },
        { id: 'w-2', amount: 20, channel: 'ALIPAY', status: 'REQUESTED', createdAt: '2026-02-12' },
      ]);
    }
    return ApiClient.get<WithdrawRecord[]>('/bonus/withdraw/history');
  },

  /** VIP 三叉树 */
  getVipTree: async (): Promise<Result<VipTree>> => {
    if (USE_MOCK) {
      return simulateRequest({
        node: { id: 'n-1', level: 2, position: 1, childrenCount: 2 },
        children: [
          { id: 'n-2', userId: 'u-2', level: 3, position: 0, childrenCount: 1, children: [
            { id: 'n-5', userId: 'u-5', level: 4, position: 0, childrenCount: 0 },
          ] },
          { id: 'n-3', userId: 'u-3', level: 3, position: 1, childrenCount: 0, children: [] },
        ],
      });
    }
    return ApiClient.get<VipTree>('/bonus/vip/tree');
  },

  /** 排队状态 */
  getQueueStatus: async (): Promise<Result<QueueStatus>> => {
    if (USE_MOCK) {
      return simulateRequest({ inQueue: true, bucketKey: 'CNY_10_50', position: 23, joinedAt: '2026-02-14T10:00:00Z' });
    }
    return ApiClient.get<QueueStatus>('/bonus/queue/status');
  },

  /** 普通树上下文（普通用户奖励树可视化） */
  getNormalTreeContext: async (): Promise<Result<VipTree>> => {
    if (USE_MOCK) {
      return simulateRequest({
        node: { id: 'nn-1', level: 1, position: 0, childrenCount: 3 },
        children: [
          { id: 'nn-2', userId: 'u-n2', level: 2, position: 0, childrenCount: 0, children: [] },
          { id: 'nn-3', userId: 'u-n3', level: 2, position: 1, childrenCount: 0, children: [] },
        ],
      });
    }
    return ApiClient.get<VipTree>('/bonus/normal-tree/context');
  },

  /** 普通用户钱包 */
  getNormalWallet: async (): Promise<Result<Wallet>> => {
    if (USE_MOCK) return simulateRequest({ balance: 32.5, frozen: 5.0, total: 37.5 });
    return ApiClient.get<Wallet>('/bonus/normal-wallet');
  },

  /** 普通用户奖励列表（含冻结状态/解锁条件/过期倒计时） */
  getNormalRewards: async (page = 1, pageSize = 20): Promise<Result<NormalRewardPage>> => {
    if (USE_MOCK) {
      return simulateRequest({
        items: [
          { id: 'nrp-1', amount: 8.50, status: 'FROZEN' as const, entryType: 'FREEZE' as const, requiredLevel: 4, expiresAt: '2026-04-20T00:00:00Z', remainingDays: 24, sourceOrderId: 'o-201', scheme: 'VIP_UPSTREAM', createdAt: '2026-03-21' },
          { id: 'nrp-2', amount: 15.30, status: 'FROZEN' as const, entryType: 'FREEZE' as const, requiredLevel: 6, expiresAt: '2026-04-15T00:00:00Z', remainingDays: 19, sourceOrderId: 'o-202', scheme: 'VIP_UPSTREAM', createdAt: '2026-03-16' },
          { id: 'nrp-3', amount: 5.20, status: 'FROZEN' as const, entryType: 'FREEZE' as const, requiredLevel: 8, expiresAt: '2026-03-30T00:00:00Z', remainingDays: 3, sourceOrderId: 'o-203', scheme: 'NORMAL_TREE', createdAt: '2026-02-28' },
          { id: 'nrp-4', amount: 18.60, status: 'FROZEN' as const, entryType: 'FREEZE' as const, requiredLevel: 10, expiresAt: '2026-03-29T00:00:00Z', remainingDays: 2, sourceOrderId: 'o-204', scheme: 'VIP_UPSTREAM', createdAt: '2026-02-27' },
        ],
        total: 4, page: 1, pageSize: 20,
      });
    }
    return ApiClient.get<NormalRewardPage>('/bonus/normal-rewards', { page, pageSize });
  },

  /** 获取 VIP 赠品方案列表（不要求登录） */
  getVipGiftOptions: async (): Promise<Result<VipGiftOptionsResponse>> => {
    if (USE_MOCK) {
      return simulateRequest({
        packages: [
          {
            id: 'mock-pkg-001',
            price: 399,
            sortOrder: 0,
            giftOptions: [
              {
                id: 'gift-1', title: '有机茶叶礼盒', subtitle: '精选高山绿茶', coverUrl: null,
                coverMode: 'AUTO_GRID' as const, totalPrice: 128.00, badge: '热门', available: true,
                items: [
                  { skuId: 'sku-gift-1a', productTitle: '高山绿茶', productImage: null, skuTitle: '250g装', price: 68.00, quantity: 1 },
                  { skuId: 'sku-gift-1b', productTitle: '铁观音', productImage: null, skuTitle: '200g装', price: 60.00, quantity: 1 },
                ],
              },
              {
                id: 'gift-2', title: '农家蜂蜜套装', subtitle: '天然百花蜜500g×2', coverUrl: null,
                coverMode: 'AUTO_STACKED' as const, totalPrice: 99.00, badge: null, available: true,
                items: [
                  { skuId: 'sku-gift-2a', productTitle: '百花蜜', productImage: null, skuTitle: '500g', price: 49.50, quantity: 2 },
                ],
              },
              {
                id: 'gift-3', title: '五谷杂粮大礼包', subtitle: '10种粗粮组合', coverUrl: null,
                coverMode: 'AUTO_GRID' as const, totalPrice: 158.00, badge: '限量', available: false,
                items: [
                  { skuId: 'sku-gift-3a', productTitle: '红豆', productImage: null, skuTitle: '500g', price: 15.00, quantity: 2 },
                  { skuId: 'sku-gift-3b', productTitle: '黑米', productImage: null, skuTitle: '500g', price: 18.00, quantity: 2 },
                  { skuId: 'sku-gift-3c', productTitle: '燕麦', productImage: null, skuTitle: '500g', price: 22.00, quantity: 2 },
                  { skuId: 'sku-gift-3d', productTitle: '小米', productImage: null, skuTitle: '500g', price: 12.00, quantity: 2 },
                ],
              },
            ],
          },
        ],
      });
    }
    return ApiClient.get<VipGiftOptionsResponse>('/bonus/vip/gift-options');
  },

  /** 获取可用奖励列表（用于结算页选择抵扣） */
  getAvailableRewards: async (): Promise<Result<RewardItem[]>> => {
    if (USE_MOCK) {
      return simulateRequest([
        { id: 'rp-1', amount: 5.00, sourceType: 'ORDER' as const, source: '消费返积分', minOrderAmount: 50, expireAt: '2026-03-15', status: 'AVAILABLE' as const },
        { id: 'rp-2', amount: 10.00, sourceType: 'REFERRAL' as const, source: '推荐返积分', minOrderAmount: 100, expireAt: '2026-04-01', status: 'AVAILABLE' as const },
        { id: 'rp-3', amount: 2.50, sourceType: 'VIP_BONUS' as const, source: 'VIP 消费积分', minOrderAmount: 0, expireAt: '2026-03-20', status: 'AVAILABLE' as const },
        { id: 'rp-4', amount: 20.00, sourceType: null, source: '新人消费积分', minOrderAmount: 200, expireAt: '2026-02-28', status: 'AVAILABLE' as const },
        { id: 'rp-5', amount: 8.00, sourceType: 'ORDER' as const, source: '消费返积分', minOrderAmount: 80, expireAt: '2026-02-10', status: 'EXPIRED' as const },
      ]);
    }
    return ApiClient.get<RewardItem[]>('/bonus/rewards/available');
  },
};
