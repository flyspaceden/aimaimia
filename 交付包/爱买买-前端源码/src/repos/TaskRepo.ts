/**
 * 任务中心仓储（Repo）
 *
 * 作用：
 * - “我的任务/福利”列表与完成状态
 * - 任务通常会有奖励（积分/成长值/头像框），建议后端完成任务校验与结算
 *
 * 后端接入说明：
 * - 建议接口：
 *   - `GET /api/v1/tasks` → `Result<Task[]>`
 *   - `POST /api/v1/tasks/{id}/complete` → `Result<Task[]>`（或返回最新 Task + 最新 UserProfile）
 *
 * 详细接口清单：`说明文档/后端接口清单.md#52-任务`
 */
import { mockTasks } from '../mocks';
import { Result, Task } from '../types';
import { simulateRequest } from './helpers';

let taskCache = [...mockTasks];

// 任务仓储：任务列表与完成状态（复杂业务逻辑需中文注释）
export const TaskRepo = {
  /** 任务列表：`GET /api/v1/tasks` */
  list: async (): Promise<Result<Task[]>> => simulateRequest(taskCache, { delay: 220 }),
  /** 完成任务：`POST /api/v1/tasks/{id}/complete` */
  complete: async (id: string): Promise<Result<Task[]>> => {
    taskCache = taskCache.map((task) => (task.id === id ? { ...task, status: 'done' } : task));
    return simulateRequest(taskCache, { delay: 240 });
  },
};
