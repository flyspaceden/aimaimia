/**
 * 任务中心仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：使用 `src/mocks/tasks.ts` 模拟任务列表与完成状态
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口：
 * - `GET /api/v1/tasks` → `Result<Task[]>`
 * - `POST /api/v1/tasks/{id}/complete` → `Result<Task[]>`
 */
import { mockTasks } from '../mocks';
import { Result, Task } from '../types';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

let taskCache = [...mockTasks];

// 任务仓储：任务列表与完成状态（复杂业务逻辑需中文注释）
export const TaskRepo = {
  /** 任务列表：`GET /api/v1/tasks` */
  list: async (): Promise<Result<Task[]>> => {
    if (USE_MOCK) {
      return simulateRequest(taskCache, { delay: 220 });
    }

    return ApiClient.get<Task[]>('/tasks');
  },
  /** 完成任务：`POST /api/v1/tasks/{id}/complete` */
  complete: async (id: string): Promise<Result<Task[]>> => {
    if (USE_MOCK) {
      taskCache = taskCache.map((task) => (task.id === id ? { ...task, status: 'done' } : task));
      return simulateRequest(taskCache, { delay: 240 });
    }

    return ApiClient.post<Task[]>(`/tasks/${id}/complete`);
  },
};
