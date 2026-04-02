// 任务中心仓库：任务列表与状态占位
import type { Result } from '../types';

export type TaskStatus = 'todo' | 'inProgress' | 'done';

export type TaskItem = {
  id: string;
  title: string;
  rewardLabel: string;
  status: TaskStatus;
  targetRoute: string;
  rewardPoints?: number;
  rewardGrowth?: number;
};

const tasks: TaskItem[] = [
  { id: 't1', title: '完善健康偏好', rewardLabel: '+20 成长值', status: 'inProgress', targetRoute: '/pages-sub/me/profile', rewardGrowth: 20 },
  { id: 't2', title: '首次发布爱买买圈', rewardLabel: '+30 成长值', status: 'todo', targetRoute: '/pages-sub/circle/post-create', rewardGrowth: 30 },
  { id: 't3', title: '预约一次考察', rewardLabel: '+20 积分', status: 'todo', targetRoute: '/pages/tabbar/museum/museum', rewardPoints: 20 },
];

export const TaskRepo = {
  list: async (): Promise<Result<TaskItem[]>> => {
    return { ok: true, data: tasks };
  },

  // 完成任务占位：后端需变更任务状态并返回结果
  complete: async (taskId: string): Promise<Result<{ ok: true }>> => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return { ok: false, error: { code: 'NOT_FOUND', message: '任务不存在' } };
    }
    task.status = 'done';
    return { ok: true, data: { ok: true } };
  },
};
