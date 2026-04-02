/**
 * 签到仓储（Repo）
 *
 * 作用：
 * - 7 天连续签到：返回 streakDays、todayChecked、奖励列表等
 *
 * 后端接入说明：
 * - 建议接口见：`说明文档/后端接口清单.md#53-签到`
 * - 关键点：
 *   - 连续天数与奖励结算必须由后端控制，避免前端篡改
 *   - `reset` 建议仅测试/运营环境使用
 */
import { mockCheckInStatus } from '../mocks';
import { CheckInStatus, Result } from '../types';
import { simulateRequest } from './helpers';

let checkInState: CheckInStatus = { ...mockCheckInStatus };

// 签到仓储：连续签到状态（复杂业务逻辑需中文注释）
export const CheckInRepo = {
  /** `GET /api/v1/check-in/status` */
  getStatus: async (): Promise<Result<CheckInStatus>> => simulateRequest(checkInState, { delay: 200 }),
  /** `POST /api/v1/check-in` */
  checkIn: async (): Promise<Result<CheckInStatus>> => {
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
  },
  /** `POST /api/v1/check-in/reset`（仅测试/运营） */
  reset: async (): Promise<Result<CheckInStatus>> => {
    checkInState = { ...mockCheckInStatus, lastReward: undefined };
    return simulateRequest(checkInState, { delay: 220 });
  },
};
