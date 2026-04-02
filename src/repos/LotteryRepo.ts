/**
 * 抽奖仓储（Repo）
 *
 * 后端接口（已登录 / 认证端点）：
 * - POST /api/v1/lottery/draw → DrawResult
 * - GET /api/v1/lottery/today → TodayStatus
 * - GET /api/v1/lottery/prizes → Prize[]（公开，无需认证）
 *
 * 公开端点（未登录 / 设备指纹限流）：
 * - POST /api/v1/lottery/public/draw  { deviceFingerprint } → DrawResult
 * - GET  /api/v1/lottery/public/today?fp={fingerprint} → TodayStatus
 */
import { Result } from '../types';
import { ApiClient } from './http/ApiClient';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { _mockInjectItem } from './CartRepo';
import { getDeviceFingerprint } from '../utils/deviceFingerprint';
import { useAuthStore } from '../store/useAuthStore';

export interface LotteryPrize {
  id: string;
  name: string;
  type: string;
  probability?: number;
  image?: string;
  prizePrice?: number;
  originalPrice?: number | null;
  threshold?: number;
  prizeQuantity?: number;
  expirationHours?: number | null;
  expiresAt?: string | null;
}

export interface DrawResult {
  won: boolean;
  prize?: LotteryPrize;
  message?: string;
  /** 公开抽奖中奖时的签名凭证（未登录用户专用，登录后 merge 时验证） */
  claimToken?: string;
}

export interface TodayStatus {
  hasDrawn: boolean;
  remainingDraws: number;
  lastResult?: DrawResult;
}

// Mock 模式下追踪今日是否已抽奖（按日期自动重置）
let mockDrawDate = ''; // 记录抽奖日期 YYYY-MM-DD
let mockHasDrawn = false;
let mockLastResult: DrawResult | undefined;

function getToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function resetIfNewDay() {
  const today = getToday();
  if (mockDrawDate !== today) {
    mockHasDrawn = false;
    mockLastResult = undefined;
    mockDrawDate = today;
  }
}

export const LotteryRepo = {
  /** 执行抽奖 */
  draw: async (): Promise<Result<DrawResult>> => {
    if (USE_MOCK) {
      resetIfNewDay();
      const isLoggedIn = useAuthStore.getState().isLoggedIn;
      // 每日限制 1 次
      if (mockHasDrawn) {
        return simulateRequest({ won: false, message: '今日抽奖次数已用完' } as DrawResult, { delay: 300, failRate: 0 });
      }
      // 模拟 30% 中奖率
      const won = Math.random() < 0.3;
      const claimToken = won && !isLoggedIn
        ? `mock-claim-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        : undefined;
      const result: DrawResult = {
        won,
        prize: won
          ? {
              id: 'prize-1',
              name: '5元红包',
              type: 'DISCOUNT_BUY',
              probability: 0.3,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            }
          : undefined,
        message: won ? '恭喜中奖！' : '再接再厉',
        claimToken,
      };
      mockHasDrawn = true;
      mockDrawDate = getToday();
      mockLastResult = result;
      // 已登录中奖时模拟后端自动加入服务端购物车
      if (won && isLoggedIn) {
        _mockInjectItem({
          id: `ci-prize-${Date.now()}`,
          skuId: 'sku-prize-redpack',
          quantity: 1,
          isPrize: true,
          prizeRecordId: `rec-${Date.now()}`,
          prizeType: 'DISCOUNT_BUY',
          product: {
            id: 'p-prize-redpack',
            title: '5元红包',
            image: null,
            price: 0,
            originalPrice: 5,
            stock: 999,
          },
        });
      }
      return simulateRequest(result, { delay: 1000 });
    }
    const isLoggedIn = useAuthStore.getState().isLoggedIn;
    if (isLoggedIn) {
      // 已登录：调用需认证的端点
      const r = await ApiClient.post<{
        result: 'WON' | 'NO_PRIZE';
        prize?: { id: string; name: string; type: string };
      }>('/lottery/draw');
      if (!r.ok) return r;
      return {
        ok: true as const,
        data: {
          won: r.data.result === 'WON',
          prize: r.data.prize,
          message: r.data.result === 'WON' ? '恭喜中奖！' : '谢谢参与',
        },
      };
    } else {
      // 未登录：调用公开端点，传设备指纹
      const fp = await getDeviceFingerprint();
      const r = await ApiClient.post<{
        result: 'WON' | 'NO_PRIZE';
        prize?: { id: string; name: string; type: string; prizePrice?: number; threshold?: number; prizeQuantity?: number; expirationHours?: number | null; originalPrice?: number | null; expiresAt?: string | null };
        claimToken?: string;
      }>('/lottery/public/draw', { deviceFingerprint: fp });
      if (!r.ok) return r;
      return {
        ok: true as const,
        data: {
          won: r.data.result === 'WON',
          prize: r.data.prize,
          message: r.data.result === 'WON' ? '恭喜中奖！' : '谢谢参与',
          claimToken: r.data.claimToken,
        },
      };
    }
  },

  /** 今日抽奖状态 */
  getTodayStatus: async (): Promise<Result<TodayStatus>> => {
    if (USE_MOCK) {
      resetIfNewDay();
      return simulateRequest({
        hasDrawn: mockHasDrawn,
        remainingDraws: mockHasDrawn ? 0 : 1,
        lastResult: mockLastResult,
      }, { failRate: 0 });
    }
    const isLoggedIn = useAuthStore.getState().isLoggedIn;
    if (isLoggedIn) {
      // 已登录：调用需认证的端点
      const r = await ApiClient.get<{
        hasDrawn: boolean;
        remainingChances: number;
        records?: Array<{ result: 'WON' | 'NO_PRIZE'; prize?: LotteryPrize }>;
      }>('/lottery/today');
      if (!r.ok) return r;

      const last = r.data.records && r.data.records.length > 0
        ? r.data.records[r.data.records.length - 1]
        : undefined;

      return {
        ok: true as const,
        data: {
          hasDrawn: r.data.hasDrawn,
          remainingDraws: r.data.remainingChances,
          lastResult: last
            ? {
                won: last.result === 'WON',
                prize: last.prize,
                message: last.result === 'WON' ? '恭喜中奖！' : '谢谢参与',
              }
            : undefined,
        },
      };
    } else {
      // 未登录：调用公开端点，传设备指纹
      const fp = await getDeviceFingerprint();
      const r = await ApiClient.get<{
        hasDrawn: boolean;
        remainingDraws: number;
      }>(`/lottery/public/today?fp=${fp}`);
      if (!r.ok) return r;
      return {
        ok: true as const,
        data: {
          hasDrawn: r.data.hasDrawn,
          remainingDraws: r.data.remainingDraws,
        },
      };
    }
  },

  /** 奖品列表 */
  getPrizes: async (): Promise<Result<LotteryPrize[]>> => {
    if (USE_MOCK) {
      return simulateRequest([
        { id: 'p-1', name: '5元红包', type: 'DISCOUNT_BUY', probability: 0.3, image: '' },
        { id: 'p-2', name: '免邮券', type: 'COUPON', probability: 0.2, image: '' },
        { id: 'p-3', name: '精品水果', type: 'PRODUCT', probability: 0.05, image: '' },
        { id: 'p-4', name: '谢谢参与', type: 'NONE', probability: 0.45, image: '' },
      ]);
    }
    return ApiClient.get<LotteryPrize[]>('/lottery/prizes');
  },
};
