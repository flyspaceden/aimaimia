/**
 * 域模型：我的页（Me）
 *
 * 用途：
 * - 头像框/任务/签到/推荐等与“我的”页面相关的数据结构
 */
import { Product } from './Product';

export type AvatarFrameType = 'vip' | 'task' | 'limited';

export type AvatarFrame = {
  id: string;
  type: AvatarFrameType;
  label: string;
  expiresAt?: string;
};

export type TaskStatus = 'todo' | 'inProgress' | 'done';

export type Task = {
  id: string;
  title: string;
  rewardLabel: string;
  rewardPoints?: number;
  rewardGrowth?: number;
  status: TaskStatus;
  targetRoute: string;
};

export type CheckInReward = {
  day: number;
  label: string;
  points?: number;
  growth?: number;
  highlight?: boolean;
};

export type CheckInStatus = {
  streakDays: number;
  todayChecked: boolean;
  rewards: CheckInReward[];
  lastReward?: CheckInReward;
};

export type RecommendationItem = {
  id: string;
  product: Product;
  reason: string;
};
