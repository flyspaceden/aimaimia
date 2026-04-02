// 用户仓库：个人资料/成长值占位
import type { Result } from '../types';
import { AuthState } from '../state/auth';

export type UserProfile = {
  id: string;
  name: string;
  avatar?: string;
  location?: string;
  level: string;
  levelProgress: number;
  growthPoints: number;
  nextLevelPoints: number;
  points: number;
  interests: string[];
  avatarFrame?: { id: string; type: 'vip' | 'task' | 'limited'; expireAt?: string };
};

const STORAGE_KEY = 'nm_profile_v1';

const defaultProfile: UserProfile = {
  id: 'u_mock',
  name: '江晴',
  avatar: '',
  location: '杭州',
  level: '生长会员',
  levelProgress: 0.56,
  growthPoints: 320,
  nextLevelPoints: 520,
  points: 860,
  interests: ['有机偏好', '轻食'],
  avatarFrame: { id: 'vip-1', type: 'vip' },
};

const readProfile = (): UserProfile => {
  const raw = uni.getStorageSync(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(String(raw));
      return { ...defaultProfile, ...(parsed as Partial<UserProfile>) };
    } catch {
      return { ...defaultProfile };
    }
  }
  const session = AuthState.getSession();
  if (session?.user) {
    return {
      ...defaultProfile,
      id: session.user.id,
      name: session.user.nickname || defaultProfile.name,
      location: session.user.city || defaultProfile.location,
    };
  }
  return { ...defaultProfile };
};

const writeProfile = (profile: UserProfile) => {
  uni.setStorageSync(STORAGE_KEY, JSON.stringify(profile));
};

export const UserRepo = {
  profile: async (): Promise<Result<UserProfile>> => {
    const profile = readProfile();
    writeProfile(profile);
    return { ok: true, data: profile };
  },

  // 更新资料占位：后端需保存昵称/所在地/兴趣标签
  updateProfile: async (payload: {
    name?: string;
    location?: string;
    interests?: string[];
    avatar?: string;
    avatarFrame?: UserProfile['avatarFrame'];
  }): Promise<Result<UserProfile>> => {
    const profile = readProfile();
    const next = {
      ...profile,
      name: payload.name ?? profile.name,
      location: payload.location ?? profile.location,
      interests: payload.interests ?? profile.interests,
      avatar: payload.avatar ?? profile.avatar,
      avatarFrame: payload.avatarFrame ?? profile.avatarFrame,
    };
    writeProfile(next);
    return { ok: true, data: next };
  },

  // 成长值与积分变更占位：后续由后端统一计算
  applyRewards: async (payload: { points?: number; growthPoints?: number }): Promise<Result<UserProfile>> => {
    const profile = readProfile();
    const next = {
      ...profile,
      points: profile.points + (payload.points || 0),
      growthPoints: profile.growthPoints + (payload.growthPoints || 0),
    };
    writeProfile(next);
    return { ok: true, data: next };
  },
};
