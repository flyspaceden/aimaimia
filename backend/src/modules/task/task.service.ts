import { ConflictException, Injectable } from '@nestjs/common';

@Injectable()
export class TaskService {
  /**
   * 当前任务模型没有保存“签到、浏览企业、首单”等服务端行为证据。
   * App 的任务入口也处于隐藏状态，因此在证据链补齐前必须 fail closed，
   * 不能把数据库里的演示任务暴露为可领取奖励。
   */
  async list(_userId: string) {
    return [];
  }

  /** 客户端不得自行声明行为已完成；未来应按 task code 读取服务端证据。 */
  async complete(_taskId: string, _userId: string): Promise<never> {
    throw new ConflictException({
      code: 'TASK_CLAIM_UNAVAILABLE',
      message: '任务奖励尚未开放，请以后端实际活动通知为准',
    });
  }
}
