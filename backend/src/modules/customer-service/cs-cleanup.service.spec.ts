import { CsCleanupService } from './cs-cleanup.service';

describe('CsCleanupService', () => {
  it('只对成功抢到关闭状态转换的定时清理执行副作用', async () => {
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
      csSession: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: 'session-1',
              status: 'AGENT_HANDLING',
              agentId: 'admin-1',
              ticketId: 'ticket-1',
              createdAt: new Date(0),
              messages: [],
            },
          ]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          status: 'AGENT_HANDLING',
          agentId: 'admin-1',
          ticketId: 'ticket-1',
          createdAt: new Date(0),
          messages: [],
        }),
      },
      csTicket: { update: jest.fn() },
    };
    const agentService: any = { releaseAgent: jest.fn() };
    const service = new CsCleanupService(prisma, agentService);

    await service.cleanupIdleSessions();

    expect(prisma.csSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', status: 'AGENT_HANDLING', agentId: 'admin-1' },
      data: { status: 'CLOSED', closedAt: expect.any(Date) },
    });
    expect(agentService.releaseAgent).not.toHaveBeenCalled();
    expect(prisma.csTicket.update).not.toHaveBeenCalled();
  });

  it('成功清理时在同一事务内关闭会话、释放坐席并解决工单', async () => {
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
      csSession: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: 'session-1',
              status: 'AGENT_HANDLING',
              agentId: 'admin-1',
              ticketId: 'ticket-1',
              createdAt: new Date(0),
              messages: [],
            },
          ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          status: 'AGENT_HANDLING',
          agentId: 'admin-1',
          ticketId: 'ticket-1',
          createdAt: new Date(0),
          messages: [],
        }),
      },
      csTicket: { update: jest.fn() },
    };
    const agentService: any = { releaseAgent: jest.fn() };
    const service = new CsCleanupService(prisma, agentService);

    await service.cleanupIdleSessions();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(agentService.releaseAgent).toHaveBeenCalledWith('admin-1', prisma);
    expect(prisma.csTicket.update).toHaveBeenCalled();
  });

  it('扫描后出现新消息时事务内复核活动时间并放弃关闭', async () => {
    const now = new Date();
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
      csSession: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: 'session-1',
              status: 'AGENT_HANDLING',
              agentId: 'admin-1',
              ticketId: 'ticket-1',
              createdAt: new Date(0),
              messages: [],
            },
          ]),
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          status: 'AGENT_HANDLING',
          agentId: 'admin-1',
          ticketId: 'ticket-1',
          createdAt: new Date(0),
          messages: [{ createdAt: now }],
        }),
        updateMany: jest.fn(),
      },
      csTicket: { update: jest.fn() },
    };
    const agentService: any = { releaseAgent: jest.fn() };
    const service = new CsCleanupService(prisma, agentService);

    await service.cleanupIdleSessions();

    expect(prisma.csSession.updateMany).not.toHaveBeenCalled();
    expect(agentService.releaseAgent).not.toHaveBeenCalled();
    expect(prisma.csTicket.update).not.toHaveBeenCalled();
  });
});
