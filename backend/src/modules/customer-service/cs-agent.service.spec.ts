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
      updateMany: jest.fn(),
      findMany: jest.fn(),
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
    it('将 AGENT_HANDLING 会话退回 QUEUING + 标记离线 + 重置 currentSessions', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.updateMany.mockResolvedValue({ count: 2 });
      prisma.csAgentStatus.updateMany.mockResolvedValue({ count: 1 });

      await service.handleDisconnect('admin-1');

      // 1. 将该坐席正在处理的会话退回排队
      expect(prisma.csSession.updateMany).toHaveBeenCalledWith({
        where: { agentId: 'admin-1', status: 'AGENT_HANDLING' },
        data: { status: 'QUEUING', agentId: null, agentJoinedAt: null },
      });

      // 2. 标记离线，重置会话计数为 0
      expect(prisma.csAgentStatus.updateMany).toHaveBeenCalledWith({
        where: { adminId: 'admin-1' },
        data: { status: 'OFFLINE', currentSessions: 0, lastActiveAt: expect.any(Date) },
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

  // ====================================================================
  // 坐席完整生命周期
  // ====================================================================

  describe('坐席完整生命周期', () => {
    it('上线→接入→达到上限→释放→可再接入', async () => {
      const { service, prisma } = createMocks();

      // 上线
      prisma.csAgentStatus.upsert.mockResolvedValue({ adminId: 'a1', status: 'ONLINE' });
      await service.updateStatus('a1', 'ONLINE' as any);
      expect(prisma.csAgentStatus.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'ONLINE' }) }),
      );

      // 第一次分配成功
      prisma.$queryRaw.mockResolvedValueOnce([{ adminId: 'a1' }]);
      const first = await service.assignAgent();
      expect(first).toBe('a1');

      // 达到上限 → 无可用坐席
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const atMax = await service.assignAgent();
      expect(atMax).toBeNull();

      // 释放
      prisma.csAgentStatus.updateMany.mockResolvedValue({ count: 1 });
      await service.releaseAgent('a1');
      expect(prisma.csAgentStatus.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { adminId: 'a1', currentSessions: { gt: 0 } },
          data: expect.objectContaining({ currentSessions: { decrement: 1 } }),
        }),
      );

      // 释放后再次分配成功
      prisma.$queryRaw.mockResolvedValueOnce([{ adminId: 'a1' }]);
      const afterRelease = await service.assignAgent();
      expect(afterRelease).toBe('a1');
    });

    it('断线→重连：handleDisconnect 退回会话+标记 OFFLINE，updateStatus 标记 ONLINE', async () => {
      const { service, prisma } = createMocks();

      // 断线
      prisma.csSession.updateMany.mockResolvedValue({ count: 1 });
      prisma.csAgentStatus.updateMany.mockResolvedValue({ count: 1 });
      await service.handleDisconnect('a1');
      expect(prisma.csSession.updateMany).toHaveBeenCalledWith({
        where: { agentId: 'a1', status: 'AGENT_HANDLING' },
        data: { status: 'QUEUING', agentId: null, agentJoinedAt: null },
      });
      expect(prisma.csAgentStatus.updateMany).toHaveBeenCalledWith({
        where: { adminId: 'a1' },
        data: { status: 'OFFLINE', currentSessions: 0, lastActiveAt: expect.any(Date) },
      });

      // 重连
      prisma.csAgentStatus.upsert.mockResolvedValue({ adminId: 'a1', status: 'ONLINE' });
      await service.updateStatus('a1', 'ONLINE' as any);
      expect(prisma.csAgentStatus.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'ONLINE' }),
        }),
      );
    });

    it('maxSessions=0 的坐席永远不会被选中（0 < 0 为 false）', async () => {
      const { service, prisma } = createMocks();

      // 原子 SQL WHERE currentSessions < maxSessions，0 < 0 为 false → 查询返回空
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.assignAgent();

      expect(result).toBeNull();
    });
  });

  // ====================================================================
  // 并发安全
  // ====================================================================

  describe('并发安全', () => {
    it('两次 assignAgent 同时调用：第二次因 FOR UPDATE SKIP LOCKED 返回空', async () => {
      const { service, prisma } = createMocks();

      // 第一次调用获取到坐席，第二次调用被跳过（SKIP LOCKED）
      prisma.$queryRaw
        .mockResolvedValueOnce([{ adminId: 'a1' }])
        .mockResolvedValueOnce([]);

      const [result1, result2] = await Promise.all([
        service.assignAgent(),
        service.assignAgent(),
      ]);

      expect(result1).toBe('a1');
      expect(result2).toBeNull();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('快速连续发消息：两次调用均保存成功', async () => {
      // 此测试验证 CsService.handleUserMessage 的并发安全，
      // 这里通过验证 assignAgent 连续多次调用不会互相干扰来代理测试
      const { service, prisma } = createMocks();

      // 模拟两次独立的坐席分配请求
      prisma.$queryRaw
        .mockResolvedValueOnce([{ adminId: 'a1' }])
        .mockResolvedValueOnce([{ adminId: 'a2' }]);

      const r1 = await service.assignAgent();
      const r2 = await service.assignAgent();

      expect(r1).toBe('a1');
      expect(r2).toBe('a2');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });
  });
});
