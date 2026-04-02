/**
 * 用户仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：使用 `src/mocks/userProfile.ts` 模拟"我的"页资料
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口：
 *   - `GET /api/v1/me` → `Result<UserProfile>`
 *   - `PATCH /api/v1/me` → `Result<UserProfile>`
 */
import { mockUserProfile } from '../mocks';
import { Result, UserProfile } from '../types';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

let profileCache = { ...mockUserProfile };

// 用户仓储：个人信息与偏好
export const UserRepo = {
  /** 获取当前用户资料：`GET /api/v1/me` */
  profile: async (): Promise<Result<UserProfile>> => {
    if (USE_MOCK) return simulateRequest(profileCache);
    return ApiClient.get<UserProfile>('/me');
  },
  /**
   * 更新个人资料
   * - 用途：个人资料编辑页
   * - 后端接口：`PATCH /api/v1/me`
   * - body：`Partial<{ name, location, interests, avatar, avatarFrame }>`
   */
  updateProfile: async (
    payload: Partial<Pick<UserProfile, 'name' | 'location' | 'interests' | 'avatar' | 'avatarFrame' | 'gender' | 'birthday'>>
  ): Promise<Result<UserProfile>> => {
    if (USE_MOCK) {
      profileCache = { ...profileCache, ...payload };
      return simulateRequest(profileCache, { delay: 260 });
    }
    return ApiClient.patch<UserProfile>('/me', payload);
  },
  /**
   * 应用奖励（积分/成长值）
   * - 用途：签到/任务完成后的奖励联动（Demo）
   * - 后端建议：真实场景由后端结算；前端不应直接"加分"
   */
  applyRewards: async (payload: { points?: number; growthPoints?: number }): Promise<Result<UserProfile>> => {
    // applyRewards 目前仅在 Mock 模式下使用，真实后端由签到/任务接口结算
    if (USE_MOCK) {
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
    }
    // 真实后端模式：调用 /me 获取最新资料（奖励由后端结算）
    return ApiClient.get<UserProfile>('/me');
  },
};
