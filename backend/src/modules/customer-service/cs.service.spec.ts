import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CsService } from './cs.service';

function createMocks() {
  const prisma = {
    csSession: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    csAgentStatus: {
      upsert: jest.fn(),
    },
    csMessage: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    csTicket: {
      update: jest.fn(),
    },
    csQuickEntry: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    csRating: {
      create: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _avg: { score: 4.5 } }),
    },
    order: { findUnique: jest.fn() },
    afterSaleRequest: { findUnique: jest.fn() },
  };
  const routing = {
    route: jest.fn(),
  };
  const agent = {
    assignAgent: jest.fn(),
    releaseAgent: jest.fn(),
    updateStatus: jest.fn(),
  };
  const ticket = {
    createTicket: jest.fn().mockResolvedValue('ticket-1'),
  };

  const service = new CsService(prisma as any, routing as any, agent as any, ticket as any);
  return { service, prisma, routing, agent, ticket };
}

describe('CsService', () => {
  // ====================================================================
  // createSession
  // ====================================================================

  describe('createSession()', () => {
    it('无已有活跃会话 → 创建新会话，isExisting=false', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findFirst.mockResolvedValue(null);
      prisma.csSession.create.mockResolvedValue({ id: 'new-session-1' });

      const result = await service.createSession('user-1', 'ORDER_DETAIL', 'order-1');

      expect(prisma.csSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            source: 'ORDER_DETAIL',
            sourceId: 'order-1',
            status: { in: ['AI_HANDLING', 'QUEUING', 'AGENT_HANDLING'] },
          }),
        }),
      );
      expect(prisma.csSession.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', source: 'ORDER_DETAIL', sourceId: 'order-1' },
      });
      expect(result).toEqual({ sessionId: 'new-session-1', isExisting: false });
    });

    it('已有活跃会话 → 返回已有 sessionId，isExisting=true', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findFirst.mockResolvedValue({
        id: 'existing-session-1',
        messages: [],
      });

      const result = await service.createSession('user-1', 'ORDER_DETAIL', 'order-1');

      expect(prisma.csSession.create).not.toHaveBeenCalled();
      expect(result).toEqual({ sessionId: 'existing-session-1', isExisting: true });
    });

    it('sourceId 为 undefined 时统一存为 null', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findFirst.mockResolvedValue(null);
      prisma.csSession.create.mockResolvedValue({ id: 'session-no-source' });

      await service.createSession('user-1', 'PERSONAL_CENTER');

      // findFirst 查询中 sourceId 应为 null
      expect(prisma.csSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sourceId: null }),
        }),
      );
      // create 中 sourceId 应为 null
      expect(prisma.csSession.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', source: 'PERSONAL_CENTER', sourceId: null },
      });
    });
  });

  // ====================================================================
  // getActiveSession
  // ====================================================================

  describe('getActiveSession()', () => {
    it('按 source+sourceId 查找，sourceId 为空时查 null', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findFirst.mockResolvedValue(null);

      await service.getActiveSession('user-1', 'PERSONAL_CENTER');

      expect(prisma.csSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            source: 'PERSONAL_CENTER',
            sourceId: null,
            status: { in: ['AI_HANDLING', 'QUEUING', 'AGENT_HANDLING'] },
          }),
          include: expect.objectContaining({
            messages: expect.any(Object),
            ticket: true,
          }),
        }),
      );
    });
  });

  // ====================================================================
  // handleUserMessage
  // ====================================================================

  describe('handleUserMessage()', () => {
    it('会话不存在 → 抛 NotFoundException', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue(null);

      await expect(service.handleUserMessage('no-session', 'user-1', '你好')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('用户不是会话持有者 → 抛 NotFoundException', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'other-user',
        status: 'AI_HANDLING',
        messages: [],
      });

      await expect(service.handleUserMessage('session-1', 'user-1', '你好')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('会话已关闭 → 抛 BadRequestException', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        status: 'CLOSED',
        messages: [],
      });

      await expect(service.handleUserMessage('session-1', 'user-1', '你好')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('AGENT_HANDLING 状态 → 只保存消息，不走路由，aiReply=null', async () => {
      const { service, prisma, routing } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        status: 'AGENT_HANDLING',
        messages: [],
      });
      prisma.csMessage.create.mockResolvedValue({ id: 'msg-1', content: '你好' });

      const result = await service.handleUserMessage('session-1', 'user-1', '你好');

      expect(prisma.csMessage.create).toHaveBeenCalledTimes(1);
      expect(routing.route).not.toHaveBeenCalled();
      expect(result.aiReply).toBeNull();
      expect(result.transferred).toBe(false);
    });

    it('AI_HANDLING + FAQ命中(layer 1) → 保存用户消息+AI回复', async () => {
      const { service, prisma, routing } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        status: 'AI_HANDLING',
        source: 'PERSONAL_CENTER',
        sourceId: null,
        messages: [],
      });

      const userMsg = { id: 'msg-user', content: '运费多少' };
      const aiMsg = { id: 'msg-ai', content: '运费满50包邮' };
      prisma.csMessage.create
        .mockResolvedValueOnce(userMsg) // 用户消息
        .mockResolvedValueOnce(aiMsg); // AI回复

      routing.route.mockResolvedValue({
        layer: 1,
        reply: '运费满50包邮',
        contentType: 'TEXT',
        shouldTransferToAgent: false,
      });

      const result = await service.handleUserMessage('session-1', 'user-1', '运费多少');

      // 保存了两条消息：用户消息 + AI 回复
      expect(prisma.csMessage.create).toHaveBeenCalledTimes(2);
      expect(result.userMessage).toEqual(userMsg);
      expect(result.aiReply).toEqual(aiMsg);
      expect(result.transferred).toBe(false);
    });

    it('路由结果 shouldTransferToAgent=true → 调用 transferToAgent', async () => {
      const { service, prisma, routing, agent, ticket } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        status: 'AI_HANDLING',
        source: 'PERSONAL_CENTER',
        sourceId: null,
        messages: [],
      });

      prisma.csMessage.create.mockResolvedValue({ id: 'msg-1' });

      routing.route.mockResolvedValue({
        layer: 3,
        reply: '正在为您转接人工客服...',
        contentType: 'TEXT',
        shouldTransferToAgent: true,
      });

      // 模拟 transferToAgent 中的调用：分配到坐席
      agent.assignAgent.mockResolvedValue('admin-1');
      prisma.csSession.update.mockResolvedValue({});

      const result = await service.handleUserMessage('session-1', 'user-1', '转人工');

      expect(ticket.createTicket).toHaveBeenCalledWith('session-1');
      expect(agent.assignAgent).toHaveBeenCalled();
      expect(result.transferred).toBe(true);
    });

    it('handleUserMessage — QUEUING 状态不走路由（防重复工单）', async () => {
      const { service, prisma, routing } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', userId: 'u1', status: 'QUEUING',
        messages: [],
      });
      prisma.csMessage.create.mockResolvedValue({ id: 'msg-1', content: 'test' });

      const result = await service.handleUserMessage('s1', 'u1', 'hello');

      expect(result.aiReply).toBeNull();
      expect(result.transferred).toBe(false);
      expect(routing.route).not.toHaveBeenCalled(); // 关键断言：排队中不走路由
    });
  });

  // ====================================================================
  // transferToAgent
  // ====================================================================

  describe('transferToAgent()', () => {
    it('有可用坐席 → 状态变为 AGENT_HANDLING，返回 true', async () => {
      const { service, prisma, agent, ticket } = createMocks();
      agent.assignAgent.mockResolvedValue('admin-1');
      prisma.csSession.update.mockResolvedValue({});

      const result = await service.transferToAgent('session-1');

      expect(ticket.createTicket).toHaveBeenCalledWith('session-1');
      expect(agent.assignAgent).toHaveBeenCalled();
      expect(prisma.csSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: expect.objectContaining({
          status: 'AGENT_HANDLING',
          agentId: 'admin-1',
          agentJoinedAt: expect.any(Date),
        }),
      });
      expect(result).toBe(true);
    });

    it('无可用坐席 → 状态变为 QUEUING，返回 false', async () => {
      const { service, prisma, agent, ticket } = createMocks();
      agent.assignAgent.mockResolvedValue(null);
      prisma.csSession.update.mockResolvedValue({});

      const result = await service.transferToAgent('session-1');

      expect(ticket.createTicket).toHaveBeenCalledWith('session-1');
      expect(prisma.csSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { status: 'QUEUING' },
      });
      expect(result).toBe(false);
    });
  });

  // ====================================================================
  // agentAcceptSession
  // ====================================================================

  describe('agentAcceptSession()', () => {
    it('CAS 更新防竞态 + 递增坐席计数', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.updateMany.mockResolvedValue({ count: 1 });
      prisma.csAgentStatus.upsert.mockResolvedValue({});

      await service.agentAcceptSession('s1', 'admin-1');

      // 验证 CAS：updateMany 带 status=QUEUING 条件
      expect(prisma.csSession.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', status: 'QUEUING' },
        data: expect.objectContaining({ status: 'AGENT_HANDLING', agentId: 'admin-1' }),
      });
      // 验证 currentSessions 递增
      expect(prisma.csAgentStatus.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { adminId: 'admin-1' },
          update: expect.objectContaining({ currentSessions: { increment: 1 } }),
        }),
      );
    });

    it('已被其他坐席接入时拒绝', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.updateMany.mockResolvedValue({ count: 0 }); // CAS 失败

      await expect(service.agentAcceptSession('s1', 'admin-1'))
        .rejects.toThrow('会话不在排队状态或已被其他坐席接入');
    });
  });

  // ====================================================================
  // closeSession
  // ====================================================================

  describe('closeSession()', () => {
    it('正常关闭：释放坐席 + 更新会话状态 + 更新工单状态', async () => {
      const { service, prisma, agent } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 'session-1',
        agentId: 'admin-1',
        ticketId: 'ticket-1',
        status: 'AGENT_HANDLING',
      });
      prisma.csSession.update.mockResolvedValue({});
      prisma.csTicket.update.mockResolvedValue({});

      await service.closeSession('session-1');

      // 释放坐席
      expect(agent.releaseAgent).toHaveBeenCalledWith('admin-1');
      // 更新会话状态为 CLOSED
      expect(prisma.csSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: expect.objectContaining({ status: 'CLOSED', closedAt: expect.any(Date) }),
      });
      // 更新工单状态为 RESOLVED
      expect(prisma.csTicket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({
          status: 'RESOLVED',
          resolvedBy: 'admin-1',
          resolvedAt: expect.any(Date),
        }),
      });
    });
  });

  // ====================================================================
  // submitRating
  // ====================================================================

  describe('submitRating()', () => {
    it('非会话持有者 → 抛 NotFoundException', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'other-user',
      });

      await expect(
        service.submitRating('session-1', 'user-1', 5, ['快速'], '很好'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ====================================================================
  // getStats
  // ====================================================================

  describe('getStats()', () => {
    it('返回正确的统计数据格式', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.count
        .mockResolvedValueOnce(100)  // totalSessions
        .mockResolvedValueOnce(60)   // aiResolved
        .mockResolvedValueOnce(30)   // agentHandled
        .mockResolvedValueOnce(5);   // queueCount
      prisma.csRating.aggregate.mockResolvedValue({ _avg: { score: 4.2 } });

      const stats = await service.getStats();

      expect(stats).toEqual({
        totalSessions: 100,
        aiResolveRate: 60, // Math.round((60/100)*100) = 60
        agentHandled: 30,
        avgRating: 4.2,
        queueCount: 5,
      });
    });
  });
});
