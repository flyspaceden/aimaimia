import { CsAgentService } from './cs-agent.service';

function createMocks() {
  const prisma = {
    $queryRaw: jest.fn(),
    csAgentStatus: {
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    csSession: {
      count: jest.fn(),
    },
  };
  const service = new CsAgentService(prisma as any);
  return { service, prisma };
}

describe('CsAgentService', () => {
  // ====================================================================
  // assignAgent
  // ====================================================================

  describe('assignAgent()', () => {
    it('有可用坐席 → 返回 adminId（原子 UPDATE RETURNING）', async () => {
      const { service, prisma } = createMocks();
      prisma.$queryRaw.mockResolvedValue([{ adminId: 'admin-1' }]);

      const result = await service.assignAgent();

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(result).toBe('admin-1');
    });

    it('无可用坐席（空结果）→ 返回 null', async () => {
      const { service, prisma } = createMocks();
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.assignAgent();

      expect(result).toBeNull();
    });
  });

  // ====================================================================
  // releaseAgent
  // ====================================================================

  describe('releaseAgent()', () => {
    it('递减 currentSessions（只在 >0 时）', async () => {
      const { service, prisma } = createMocks();
      prisma.csAgentStatus.updateMany.mockResolvedValue({ count: 1 });

      await service.releaseAgent('admin-1');

      expect(prisma.csAgentStatus.updateMany).toHaveBeenCalledWith({
        where: { adminId: 'admin-1', currentSessions: { gt: 0 } },
        data: {
          currentSessions: { decrement: 1 },
          lastActiveAt: expect.any(Date),
        },
      });
    });
  });

  // ====================================================================
  // updateStatus
  // ====================================================================

  describe('updateStatus()', () => {
    it('upsert 创建或更新坐席状态', async () => {
      const { service, prisma } = createMocks();
      prisma.csAgentStatus.upsert.mockResolvedValue({ adminId: 'admin-1', status: 'ONLINE' });

      await service.updateStatus('admin-1', 'ONLINE' as any);

      expect(prisma.csAgentStatus.upsert).toHaveBeenCalledWith({
        where: { adminId: 'admin-1' },
        create: { adminId: 'admin-1', status: 'ONLINE', lastActiveAt: expect.any(Date) },
        update: { status: 'ONLINE', lastActiveAt: expect.any(Date) },
      });
    });
  });

  // ====================================================================
  // handleDisconnect
  // ====================================================================

  describe('handleDisconnect()', () => {
    it('标记离线', async () => {
      const { service, prisma } = createMocks();
      prisma.csAgentStatus.updateMany.mockResolvedValue({ count: 1 });

      await service.handleDisconnect('admin-1');

      expect(prisma.csAgentStatus.updateMany).toHaveBeenCalledWith({
        where: { adminId: 'admin-1' },
        data: { status: 'OFFLINE', lastActiveAt: expect.any(Date) },
      });
    });
  });

  // ====================================================================
  // getQueueCount
  // ====================================================================

  describe('getQueueCount()', () => {
    it('返回排队中会话数', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.count.mockResolvedValue(7);

      const count = await service.getQueueCount();

      expect(prisma.csSession.count).toHaveBeenCalledWith({ where: { status: 'QUEUING' } });
      expect(count).toBe(7);
    });
  });
});
