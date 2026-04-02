/**
 * 签到仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：使用 `src/mocks/checkIn.ts` 模拟签到状态
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口：
 * - `GET /api/v1/check-in/status` → `Result<CheckInStatus>`
 * - `POST /api/v1/check-in` → `Result<CheckInStatus>`
 * - `POST /api/v1/check-in/reset` → `Result<CheckInStatus>`
 */
import { mockCheckInStatus } from '../mocks';
import { CheckInStatus, Result } from '../types';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

let checkInState: CheckInStatus = { ...mockCheckInStatus };

// 签到仓储：连续签到状态（复杂业务逻辑需中文注释）
export const CheckInRepo = {
  /** `GET /api/v1/check-in/status` */
  getStatus: async (): Promise<Result<CheckInStatus>> => {
    if (USE_MOCK) {
      return simulateRequest(checkInState, { delay: 200 });
    }

    return ApiClient.get<CheckInStatus>('/check-in/status');
  },
  /** `POST /api/v1/check-in` */
  checkIn: async (): Promise<Result<CheckInStatus>> => {
    if (USE_MOCK) {
      if (!checkInState.todayChecked) {
        const nextStreak = Math.min(7, checkInState.streakDays + 1);
        const reward = checkInState.rewards.find((item) => item.day === nextStreak);
        checkInState = {
          ...checkInState,
          todayChecked: true,
          streakDays: nextStreak,
          lastReward: reward,
        };
      } else {
        checkInState = {
          ...checkInState,
          lastReward: undefined,
        };
      }
      return simulateRequest(checkInState, { delay: 220 });
    }

    return ApiClient.post<CheckInStatus>('/check-in');
  },
  /** `POST /api/v1/check-in/reset`（仅测试/运营） */
  reset: async (): Promise<Result<CheckInStatus>> => {
    if (USE_MOCK) {
      checkInState = { ...mockCheckInStatus, lastReward: undefined };
      return simulateRequest(checkInState, { delay: 220 });
    }

    return ApiClient.post<CheckInStatus>('/check-in/reset');
  },
};
