/**
 * 用户仓储（Repo）
 *
 * 当前实现：
 * - 使用 `src/mocks/userProfile.ts` 模拟“我的”页资料
 *
 * 后端接入说明：
 * - 建议接口：
 *   - `GET /api/v1/me` → `Result<UserProfile>`
 *   - `PATCH /api/v1/me` → `Result<UserProfile>`
 * - `applyRewards` 在 Demo 用于“签到/任务”联动积分与成长值；真实场景建议由后端结算或在相关业务接口返回最新 Profile
 *
 * 详细接口清单：`说明文档/后端接口清单.md#51-用户资料`
 */
import { mockUserProfile } from '../mocks';
import { Result, UserProfile } from '../types';
import { simulateRequest } from './helpers';

let profileCache = { ...mockUserProfile };

// 用户仓储：个人信息与偏好
export const UserRepo = {
  /** 获取当前用户资料：`GET /api/v1/me` */
  profile: async (): Promise<Result<UserProfile>> => simulateRequest(profileCache),
  // 更新个人资料（前端占位，后续对接后端）
  /**
   * 更新个人资料
   * - 用途：个人资料编辑页
   * - 后端建议：`PATCH /api/v1/me`
   * - body：`Partial<{ name, location, interests, avatar, avatarFrame }>`
   */
  updateProfile: async (
    payload: Partial<Pick<UserProfile, 'name' | 'location' | 'interests' | 'avatar' | 'avatarFrame'>>
  ): Promise<Result<UserProfile>> => {
    profileCache = { ...profileCache, ...payload };
    return simulateRequest(profileCache, { delay: 260 });
  },
  // 任务/签到奖励：更新成长值与积分（复杂业务逻辑需中文注释）
  /**
   * 应用奖励（积分/成长值）
   * - 用途：签到/任务完成后的奖励联动（Demo）
   * - 后端建议：真实场景由后端结算；前端不应直接“加分”
   *   - 方案 A：签到/任务接口直接返回最新 `UserProfile`
   *   - 方案 B：提供 `POST /api/v1/me/rewards/apply`（仅内部/测试使用）
   */
  applyRewards: async (payload: { points?: number; growthPoints?: number }): Promise<Result<UserProfile>> => {
    const nextPoints = Math.max(0, profileCache.points + (payload.points ?? 0));
    const nextGrowth = Math.max(0, profileCache.growthPoints + (payload.growthPoints ?? 0));
    const nextLevelProgress = profileCache.nextLevelPoints
      ? Math.min(1, nextGrowth / profileCache.nextLevelPoints)
      : profileCache.levelProgress;
    profileCache = {
      ...profileCache,
      points: nextPoints,
      growthPoints: nextGrowth,
      levelProgress: nextLevelProgress,
    };
    return simulateRequest(profileCache, { delay: 240 });
  },
};
