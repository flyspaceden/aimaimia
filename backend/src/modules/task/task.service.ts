import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TaskService {
  constructor(private prisma: PrismaService) {}

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

  /** 完成任务：事务内创建完成记录 + 更新用户积分/成长值 */
  async complete(taskId: string, userId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('任务不存在');

    const existing = await this.prisma.taskCompletion.findUnique({
      where: { userId_taskId: { userId, taskId } },
    });
    if (existing) throw new BadRequestException('任务已完成，请勿重复提交');

    // 事务：创建完成记录 + 更新 UserProfile 积分/成长值
    await this.prisma.$transaction(async (tx) => {
      await tx.taskCompletion.create({
        data: { userId, taskId },
      });

      const updates: any = {};
      if (task.rewardPoints) {
        updates.points = { increment: task.rewardPoints };
      }
      if (task.rewardGrowth) {
        updates.growthPoints = { increment: task.rewardGrowth };
      }

      if (Object.keys(updates).length > 0) {
        // 确保 UserProfile 存在
        await tx.userProfile.upsert({
          where: { userId },
          create: { userId },
          update: updates,
        });
      }
    });

    return this.list(userId);
  }
}
