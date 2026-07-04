import { TaskService } from './task.service';

describe('TaskService growth integration', () => {
  it('writes task rewards through GrowthEventService while preserving existing profile cache', async () => {
    const task = {
      id: 'task-1',
      title: '完善资料',
      rewardLabel: '+20积分',
      rewardPoints: 20,
      rewardGrowth: 30,
      targetRoute: '/me/profile',
      completions: [],
    };
    const tx: any = {
      taskCompletion: {
        create: jest.fn().mockResolvedValue({ id: 'completion-1' }),
      },
      userProfile: {
        upsert: jest.fn().mockResolvedValue({ userId: 'user-1' }),
      },
    };
    const prisma: any = {
      task: {
        findUnique: jest.fn().mockResolvedValue(task),
        findMany: jest.fn().mockResolvedValue([task]),
      },
      taskCompletion: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const growthEvents = {
      grantDirect: jest.fn().mockResolvedValue({ granted: true }),
    };
    const service = new TaskService(prisma, growthEvents as any);

    await service.complete('task-1', 'user-1');

    expect(tx.userProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: { userId: 'user-1' },
      update: {
        points: { increment: 20 },
        growthPoints: { increment: 30 },
      },
    });
    expect(growthEvents.grantDirect).toHaveBeenCalledWith(expect.objectContaining({
      tx,
      userId: 'user-1',
      behaviorCode: 'TASK_COMPLETE',
      pointsReward: 20,
      growthReward: 30,
      idempotencyKey: 'TASK:user-1:task-1',
      refType: 'TASK',
      refId: 'task-1',
      meta: { taskTitle: '完善资料' },
    }));
  });
});
