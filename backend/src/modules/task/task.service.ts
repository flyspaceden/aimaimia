import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthEventService } from '../growth/growth-event.service';

@Injectable()
export class TaskService {
  constructor(
    private prisma: PrismaService,
    private growthEvents: GrowthEventService,
  ) {}

  /** 任务列表（含当前用户完成状态） */
  async list(userId: string) {
    const tasks = await this.prisma.task.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        completions: {
          where: { userId },
          select: { id: true },
        },
      },
    });

    return tasks.map((task) => ({
      id: task.id,
      title: task.title,
      rewardLabel: task.rewardLabel,
      rewardPoints: task.rewardPoints ?? undefined,
      rewardGrowth: task.rewardGrowth ?? undefined,
      targetRoute: task.targetRoute,
      status: task.completions.length > 0 ? 'done' : 'todo',
    }));
  }

  /** 完成任务：事务内创建完成记录 + 成长账本入账 */
  async complete(taskId: string, userId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('任务不存在');

    const existing = await this.prisma.taskCompletion.findUnique({
      where: { userId_taskId: { userId, taskId } },
    });
    if (existing) throw new BadRequestException('任务已完成，请勿重复提交');

    // 事务：创建完成记录 + GrowthEventService 统一更新成长账户和 UserProfile 缓存
    await this.prisma.$transaction(
      async (tx) => {
        await tx.taskCompletion.create({
          data: { userId, taskId },
        });

        await this.growthEvents.grantDirect({
          tx,
          userId,
          behaviorCode: 'TASK_COMPLETE',
          pointsReward: task.rewardPoints ?? 0,
          growthReward: task.rewardGrowth ?? 0,
          idempotencyKey: `TASK:${userId}:${taskId}`,
          refType: 'TASK',
          refId: taskId,
          meta: { taskTitle: task.title },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.list(userId);
  }
}
