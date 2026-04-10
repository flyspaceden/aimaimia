import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CsService } from './cs.service';

function createMocks() {
  const prisma: any = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
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
      findUnique: jest.fn(),
      create: jest.fn(),
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
  // $transaction 默认实现：把 tx 替换为 prisma 本身，这样测试中对
  // prisma.csSession.* 的 mock 在事务回调内部同样有效
  prisma.$transaction.mockImplementation(async (fn: any) => {
    if (typeof fn === 'function') {
      return fn(prisma);
    }
    return fn;
  });
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
        createdAt: new Date(), // 新建会话，未超时
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

      // 模拟 transferToAgent 中的 CAS + 分配坐席
      prisma.csSession.updateMany.mockResolvedValue({ count: 1 }); // CAS 成功
      agent.assignAgent.mockResolvedValue('admin-1');
      prisma.csSession.update.mockResolvedValue({});

      const result = await service.handleUserMessage('session-1', 'user-1', '转人工');

      expect(prisma.csSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', status: 'AI_HANDLING' },
        data: { status: 'QUEUING' },
      });
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
    it('有可用坐席 → CAS 成功 → 状态变为 AGENT_HANDLING，返回 true', async () => {
      const { service, prisma, agent, ticket } = createMocks();
      prisma.csSession.updateMany.mockResolvedValue({ count: 1 }); // CAS 成功
      agent.assignAgent.mockResolvedValue('admin-1');
      prisma.csSession.update.mockResolvedValue({});

      const result = await service.transferToAgent('session-1');

      // CAS: updateMany where status=AI_HANDLING → QUEUING
      expect(prisma.csSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', status: 'AI_HANDLING' },
        data: { status: 'QUEUING' },
      });
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

    it('无可用坐席 → CAS 成功，保持 QUEUING，返回 false', async () => {
      const { service, prisma, agent, ticket } = createMocks();
      prisma.csSession.updateMany.mockResolvedValue({ count: 1 }); // CAS 成功
      agent.assignAgent.mockResolvedValue(null);

      const result = await service.transferToAgent('session-1');

      // CAS: updateMany where status=AI_HANDLING → QUEUING
      expect(prisma.csSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', status: 'AI_HANDLING' },
        data: { status: 'QUEUING' },
      });
      expect(ticket.createTicket).toHaveBeenCalledWith('session-1');
      // 无坐席时不再调用 csSession.update（已在 CAS 步骤设为 QUEUING）
      expect(prisma.csSession.update).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });

  // ====================================================================
  // agentAcceptSession
  // ====================================================================

  describe('agentAcceptSession()', () => {
    it('容量检查（$queryRaw）+ CAS 更新防竞态', async () => {
      const { service, prisma } = createMocks();
      // 1. 容量检查成功（原子 UPDATE WHERE currentSessions < maxSessions）
      prisma.$queryRaw.mockResolvedValue([{ adminId: 'admin-1' }]);
      // 2. CAS 更新会话状态成功
      prisma.csSession.updateMany.mockResolvedValue({ count: 1 });

      await service.agentAcceptSession('s1', 'admin-1');

      // 验证容量检查使用了 $queryRaw
      expect(prisma.$queryRaw).toHaveBeenCalled();
      // 验证 CAS：updateMany 带 status=QUEUING 条件
      expect(prisma.csSession.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', status: 'QUEUING' },
        data: expect.objectContaining({ status: 'AGENT_HANDLING', agentId: 'admin-1' }),
      });
    });

    it('已被其他坐席接入时拒绝（CAS 失败 → 回退坐席计数）', async () => {
      const { service, prisma, agent } = createMocks();
      // 容量检查成功
      prisma.$queryRaw.mockResolvedValue([{ adminId: 'admin-1' }]);
      // CAS 失败：会话已被其他坐席接入
      prisma.csSession.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.agentAcceptSession('s1', 'admin-1'))
        .rejects.toThrow('会话不在排队状态或已被其他坐席接入');

      // 验证回退了坐席计数
      expect(agent.releaseAgent).toHaveBeenCalledWith('admin-1');
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

  // ====================================================================
  // 完整业务流程
  // ====================================================================

  describe('完整业务流程', () => {
    it('AI 解决流程: createSession → handleUserMessage(FAQ命中) → closeSession', async () => {
      const { service, prisma, routing, agent, ticket } = createMocks();

      // Step 1: createSession
      prisma.csSession.findFirst.mockResolvedValue(null);
      prisma.csSession.create.mockResolvedValue({ id: 's1' });

      const session = await service.createSession('u1', 'PERSONAL_CENTER');
      expect(session).toEqual({ sessionId: 's1', isExisting: false });

      // Step 2: handleUserMessage — FAQ 命中
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', userId: 'u1', status: 'AI_HANDLING',
        source: 'PERSONAL_CENTER', sourceId: null, messages: [],
      });
      prisma.csMessage.create
        .mockResolvedValueOnce({ id: 'msg-user', content: '运费多少' })
        .mockResolvedValueOnce({ id: 'msg-ai', content: '运费满50包邮' });
      routing.route.mockResolvedValue({
        layer: 1, reply: '运费满50包邮', contentType: 'TEXT', shouldTransferToAgent: false,
      });

      const msgResult = await service.handleUserMessage('s1', 'u1', '运费多少');
      expect(msgResult.aiReply).toEqual({ id: 'msg-ai', content: '运费满50包邮' });
      expect(msgResult.transferred).toBe(false);

      // Step 3: closeSession — AI 直接解决，无坐席无工单
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'AI_HANDLING', agentId: null, ticketId: null,
      });
      prisma.csSession.update.mockResolvedValue({});

      await service.closeSession('s1');

      expect(agent.releaseAgent).not.toHaveBeenCalled();
      expect(prisma.csTicket.update).not.toHaveBeenCalled();
      expect(prisma.csSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'CLOSED', closedAt: expect.any(Date) }),
      });
      expect(ticket.createTicket).not.toHaveBeenCalled();
    });

    it('转人工完整流程: createSession → handleUserMessage(转人工) → agentAcceptSession → handleAgentMessage → closeSession', async () => {
      const { service, prisma, routing, agent, ticket } = createMocks();

      // Step 1: createSession
      prisma.csSession.findFirst.mockResolvedValue(null);
      prisma.csSession.create.mockResolvedValue({ id: 's1' });

      const session = await service.createSession('u1', 'ORDER_DETAIL', 'order-1');
      expect(session).toEqual({ sessionId: 's1', isExisting: false });

      // Step 2: handleUserMessage — 触发转人工，无可用坐席 → QUEUING
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', userId: 'u1', status: 'AI_HANDLING',
        source: 'ORDER_DETAIL', sourceId: 'order-1', messages: [],
      });
      prisma.csMessage.create
        .mockResolvedValueOnce({ id: 'msg-user', content: '转人工' })
        .mockResolvedValueOnce({ id: 'msg-ai', content: '正在为您转接人工客服...' });
      routing.route.mockResolvedValue({
        layer: 3, reply: '正在为您转接人工客服...', contentType: 'TEXT', shouldTransferToAgent: true,
      });
      prisma.csSession.updateMany.mockResolvedValue({ count: 1 }); // CAS 成功
      agent.assignAgent.mockResolvedValue(null); // 无可用坐席

      const msgResult = await service.handleUserMessage('s1', 'u1', '转人工');
      expect(msgResult.transferred).toBe(false); // 无坐席 → transferToAgent returns false
      expect(ticket.createTicket).toHaveBeenCalledWith('s1');
      // CAS: updateMany where status=AI_HANDLING → QUEUING（不再调用 csSession.update）
      expect(prisma.csSession.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', status: 'AI_HANDLING' },
        data: { status: 'QUEUING' },
      });

      // Step 3: agentAcceptSession — QUEUING → AGENT_HANDLING
      prisma.$queryRaw.mockResolvedValue([{ adminId: 'admin-1' }]); // 容量检查成功
      prisma.csSession.updateMany.mockResolvedValue({ count: 1 });

      await service.agentAcceptSession('s1', 'admin-1');
      expect(prisma.csSession.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', status: 'QUEUING' },
        data: expect.objectContaining({ status: 'AGENT_HANDLING', agentId: 'admin-1' }),
      });

      // Step 4: handleAgentMessage
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'AGENT_HANDLING', agentId: 'admin-1', userId: 'u1',
      });
      prisma.csMessage.create.mockResolvedValue({ id: 'msg-agent', content: '您好，请问有什么可以帮您？' });

      const agentMsg = await service.handleAgentMessage('s1', 'admin-1', '您好，请问有什么可以帮您？');
      expect(agentMsg).toEqual({ id: 'msg-agent', content: '您好，请问有什么可以帮您？' });

      // Step 5: closeSession — AGENT_HANDLING → CLOSED
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'AGENT_HANDLING', agentId: 'admin-1', ticketId: 'ticket-1',
      });
      prisma.csSession.update.mockResolvedValue({});
      prisma.csTicket.update.mockResolvedValue({});

      await service.closeSession('s1');
      expect(agent.releaseAgent).toHaveBeenCalledWith('admin-1');
      expect(prisma.csSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'CLOSED' }),
      });
      expect(prisma.csTicket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({ status: 'RESOLVED', resolvedBy: 'admin-1' }),
      });
    });

    it('用户主动结束 AI 会话: createSession → handleUserMessage(AI回复) → closeSession(无坐席)', async () => {
      const { service, prisma, routing, agent, ticket } = createMocks();

      // Step 1: createSession
      prisma.csSession.findFirst.mockResolvedValue(null);
      prisma.csSession.create.mockResolvedValue({ id: 's1' });
      await service.createSession('u1', 'PERSONAL_CENTER');

      // Step 2: handleUserMessage — AI 正常回复
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', userId: 'u1', status: 'AI_HANDLING',
        source: 'PERSONAL_CENTER', sourceId: null, messages: [],
      });
      prisma.csMessage.create
        .mockResolvedValueOnce({ id: 'msg-user', content: '谢谢' })
        .mockResolvedValueOnce({ id: 'msg-ai', content: '不客气' });
      routing.route.mockResolvedValue({
        layer: 1, reply: '不客气', contentType: 'TEXT', shouldTransferToAgent: false,
      });

      await service.handleUserMessage('s1', 'u1', '谢谢');

      // Step 3: closeSession — 无坐席，无工单
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'AI_HANDLING', agentId: null, ticketId: null,
      });
      prisma.csSession.update.mockResolvedValue({});

      await service.closeSession('s1');

      expect(agent.releaseAgent).not.toHaveBeenCalled();
      expect(prisma.csTicket.update).not.toHaveBeenCalled();
      expect(ticket.createTicket).not.toHaveBeenCalled();
    });

    it('排队中用户放弃: createSession → handleUserMessage(转人工, 无坐席→QUEUING) → closeSession', async () => {
      const { service, prisma, routing, agent, ticket } = createMocks();

      // Step 1: createSession
      prisma.csSession.findFirst.mockResolvedValue(null);
      prisma.csSession.create.mockResolvedValue({ id: 's1' });
      await service.createSession('u1', 'PERSONAL_CENTER');

      // Step 2: handleUserMessage — 转人工，无坐席 → QUEUING
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', userId: 'u1', status: 'AI_HANDLING',
        source: 'PERSONAL_CENTER', sourceId: null, messages: [],
      });
      prisma.csMessage.create
        .mockResolvedValueOnce({ id: 'msg-user' })
        .mockResolvedValueOnce({ id: 'msg-ai' });
      routing.route.mockResolvedValue({
        layer: 3, reply: '正在为您转接...', contentType: 'TEXT', shouldTransferToAgent: true,
      });
      prisma.csSession.updateMany.mockResolvedValue({ count: 1 }); // CAS 成功
      agent.assignAgent.mockResolvedValue(null);

      await service.handleUserMessage('s1', 'u1', '转人工');
      // CAS: updateMany where status=AI_HANDLING → QUEUING
      expect(prisma.csSession.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', status: 'AI_HANDLING' },
        data: { status: 'QUEUING' },
      });

      // Step 3: closeSession — QUEUING → CLOSED，有工单但无坐席
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'QUEUING', agentId: null, ticketId: 'ticket-1',
      });
      prisma.csSession.update.mockResolvedValue({});
      prisma.csTicket.update.mockResolvedValue({});

      await service.closeSession('s1');

      expect(agent.releaseAgent).not.toHaveBeenCalled(); // 无坐席不释放
      expect(prisma.csSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'CLOSED' }),
      });
      expect(prisma.csTicket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({ status: 'RESOLVED', resolvedBy: null }),
      });
    });

    it('评价流程: closeSession → submitRating', async () => {
      const { service, prisma, agent } = createMocks();

      // Step 1: closeSession
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'AGENT_HANDLING', agentId: 'admin-1', ticketId: 'ticket-1',
      });
      prisma.csSession.update.mockResolvedValue({});
      prisma.csTicket.update.mockResolvedValue({});

      await service.closeSession('s1');

      // Step 2: submitRating
      prisma.csSession.findUnique.mockResolvedValue({ id: 's1', userId: 'u1' });
      const ratingData = { id: 'rating-1', sessionId: 's1', score: 5, tags: ['快速'] };
      prisma.csRating.create.mockResolvedValue(ratingData);

      const rating = await service.submitRating('s1', 'u1', 5, ['快速'], '很好');

      expect(prisma.csRating.create).toHaveBeenCalledWith({
        data: { sessionId: 's1', userId: 'u1', score: 5, tags: ['快速'], comment: '很好' },
      });
      expect(rating).toEqual(ratingData);
    });
  });

  // ====================================================================
  // 状态机完整路径
  // ====================================================================

  describe('状态机完整路径', () => {
    it('AI_HANDLING → CLOSED (AI直接解决)', async () => {
      const { service, prisma, agent } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'AI_HANDLING', agentId: null, ticketId: null,
      });
      prisma.csSession.update.mockResolvedValue({});

      await service.closeSession('s1');

      expect(prisma.csSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'CLOSED' }),
      });
      expect(agent.releaseAgent).not.toHaveBeenCalled();
    });

    it('QUEUING → CLOSED (用户放弃等待)', async () => {
      const { service, prisma, agent } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'QUEUING', agentId: null, ticketId: null,
      });
      prisma.csSession.update.mockResolvedValue({});

      await service.closeSession('s1');

      expect(prisma.csSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'CLOSED' }),
      });
      expect(agent.releaseAgent).not.toHaveBeenCalled();
    });

    it('已关闭会话再发消息 → BadRequestException', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', userId: 'u1', status: 'CLOSED', messages: [],
      });

      await expect(service.handleUserMessage('s1', 'u1', '你好')).rejects.toThrow(BadRequestException);
    });

    it('重复转人工: QUEUING 状态不再走路由（防重复工单）', async () => {
      const { service, prisma, routing, ticket } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', userId: 'u1', status: 'QUEUING', messages: [],
      });
      prisma.csMessage.create.mockResolvedValue({ id: 'msg-1', content: '转人工' });

      const result = await service.handleUserMessage('s1', 'u1', '转人工');

      expect(routing.route).not.toHaveBeenCalled();
      expect(ticket.createTicket).not.toHaveBeenCalled();
      expect(result.transferred).toBe(false);
      expect(result.aiReply).toBeNull();
    });

    it('AGENT_HANDLING 再次触发转人工关键词: 只保存消息，不重新转接', async () => {
      const { service, prisma, routing, ticket, agent } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', userId: 'u1', status: 'AGENT_HANDLING',
        agentId: 'admin-1', messages: [],
      });
      prisma.csMessage.create.mockResolvedValue({ id: 'msg-1', content: '转人工' });

      const result = await service.handleUserMessage('s1', 'u1', '转人工');

      expect(routing.route).not.toHaveBeenCalled();
      expect(ticket.createTicket).not.toHaveBeenCalled();
      expect(agent.assignAgent).not.toHaveBeenCalled();
      expect(result.transferred).toBe(false);
      expect(result.aiReply).toBeNull();
      expect(prisma.csMessage.create).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // closeSession 边界
  // ====================================================================

  describe('closeSession 边界', () => {
    it('关闭无坐席的会话: agentId 为 null → releaseAgent 不调用', async () => {
      const { service, prisma, agent } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'AI_HANDLING', agentId: null, ticketId: 'ticket-1',
      });
      prisma.csSession.update.mockResolvedValue({});
      prisma.csTicket.update.mockResolvedValue({});

      await service.closeSession('s1');

      expect(agent.releaseAgent).not.toHaveBeenCalled();
      expect(prisma.csTicket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({ status: 'RESOLVED', resolvedBy: null }),
      });
    });

    it('关闭无工单的会话: ticketId 为 null → 工单更新不调用', async () => {
      const { service, prisma, agent } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'AGENT_HANDLING', agentId: 'admin-1', ticketId: null,
      });
      prisma.csSession.update.mockResolvedValue({});

      await service.closeSession('s1');

      expect(agent.releaseAgent).toHaveBeenCalledWith('admin-1');
      expect(prisma.csTicket.update).not.toHaveBeenCalled();
    });

    it('关闭不存在的会话 → NotFoundException', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue(null);

      await expect(service.closeSession('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ====================================================================
  // agentReleaseSession（柔性脱身）
  // ====================================================================

  describe('agentReleaseSession()', () => {
    it('成功释放：CAS 更新 agentId=null + status=AI_HANDLING + 释放坐席 + 插系统消息', async () => {
      const { service, prisma, agent } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'AGENT_HANDLING', agentId: 'admin-1', ticketId: 't1',
      });
      prisma.csSession.updateMany.mockResolvedValue({ count: 1 });
      prisma.csMessage.create.mockResolvedValue({ id: 'sys-1', content: '客服已完成' });
      prisma.csTicket.update.mockResolvedValue({});

      const result = await service.agentReleaseSession('s1', 'admin-1');

      expect(prisma.csSession.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', agentId: 'admin-1', status: 'AGENT_HANDLING' },
        data: expect.objectContaining({
          agentId: null,
          agentJoinedAt: null,
          status: 'AI_HANDLING',
        }),
      });
      expect(agent.releaseAgent).toHaveBeenCalledWith('admin-1');
      expect(prisma.csMessage.create).toHaveBeenCalled();
      expect(prisma.csTicket.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: expect.objectContaining({ status: 'RESOLVED' }),
      });
      expect(result.systemMessage).toBeDefined();
    });

    it('会话不是 AGENT_HANDLING 状态 → 静默返回 alreadyReleased', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'AI_HANDLING', agentId: null, ticketId: null,
      });

      const result = await service.agentReleaseSession('s1', 'admin-1');

      expect(result).toEqual({ systemMessage: null, alreadyReleased: true });
      expect(prisma.csSession.updateMany).not.toHaveBeenCalled();
    });

    it('会话不存在 → 抛 BadRequestException', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue(null);

      await expect(service.agentReleaseSession('s1', 'admin-1'))
        .rejects.toThrow('会话不存在');
    });

    it('坐席不匹配 → 抛 BadRequestException', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'AGENT_HANDLING', agentId: 'other-admin', ticketId: null,
      });

      await expect(service.agentReleaseSession('s1', 'admin-1'))
        .rejects.toThrow('无权释放此会话');
    });

    it('无关联工单时不调用 ticket update', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', status: 'AGENT_HANDLING', agentId: 'admin-1', ticketId: null,
      });
      prisma.csSession.updateMany.mockResolvedValue({ count: 1 });
      prisma.csMessage.create.mockResolvedValue({ id: 'sys-1' });

      await service.agentReleaseSession('s1', 'admin-1');

      expect(prisma.csTicket.update).not.toHaveBeenCalled();
    });
  });

  // ====================================================================
  // D1-D8 数据一致性修复
  // ====================================================================

  describe('D1-D8 数据一致性修复', () => {
    it('D2: 路由期间会话被关闭 → 不写入 AI 回复', async () => {
      const { service, prisma, routing } = createMocks();
      prisma.csSession.findUnique
        .mockResolvedValueOnce({
          id: 's1',
          userId: 'u1',
          status: 'AI_HANDLING',
          source: 'PERSONAL_CENTER',
          sourceId: null,
          messages: [],
        })
        .mockResolvedValueOnce({ status: 'CLOSED' }); // 路由完成后状态变为 CLOSED
      prisma.csMessage.create.mockResolvedValueOnce({ id: 'msg-1' });
      routing.route.mockResolvedValue({
        layer: 1,
        reply: 'FAQ answer',
        contentType: 'TEXT',
        shouldTransferToAgent: false,
      });

      const result = await service.handleUserMessage('s1', 'u1', '退款');

      // 用户消息已保存
      expect(prisma.csMessage.create).toHaveBeenCalledTimes(1);
      // AI 回复未保存（被丢弃）
      expect(result.aiReply).toBeNull();
      expect(result.transferred).toBe(false);
    });

    it('D2: 路由期间会话被转人工 (AGENT_HANDLING) → 不写入 AI 回复', async () => {
      const { service, prisma, routing } = createMocks();
      prisma.csSession.findUnique
        .mockResolvedValueOnce({
          id: 's1',
          userId: 'u1',
          status: 'AI_HANDLING',
          source: 'PERSONAL_CENTER',
          sourceId: null,
          messages: [],
        })
        .mockResolvedValueOnce({ status: 'AGENT_HANDLING' });
      prisma.csMessage.create.mockResolvedValueOnce({ id: 'msg-1' });
      routing.route.mockResolvedValue({
        layer: 1,
        reply: 'FAQ answer',
        contentType: 'TEXT',
        shouldTransferToAgent: false,
      });

      const result = await service.handleUserMessage('s1', 'u1', '你好');

      expect(prisma.csMessage.create).toHaveBeenCalledTimes(1);
      expect(result.aiReply).toBeNull();
    });

    it('D3: createSession 使用 Serializable 隔离级别防并发', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findFirst.mockResolvedValue(null);
      prisma.csSession.create.mockResolvedValue({ id: 's1' });

      await service.createSession('u1', 'PERSONAL_CENTER');

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
    });

    it('D3: 序列化冲突 (P2034) 时重试一次，第二次复用已创建的会话', async () => {
      const { service, prisma } = createMocks();
      let callCount = 0;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        callCount++;
        if (callCount === 1) {
          const err: any = new Error('serialization failure');
          err.code = 'P2034';
          throw err;
        }
        return fn(prisma);
      });
      prisma.csSession.findFirst.mockResolvedValue({
        id: 'existing',
        messages: [],
        createdAt: new Date(),
      });

      const result = await service.createSession('u1', 'PERSONAL_CENTER');

      expect(callCount).toBe(2);
      expect(result.sessionId).toBe('existing');
      expect(result.isExisting).toBe(true);
    });
  });

  // ====================================================================
  // 评价边界
  // ====================================================================

  describe('评价边界', () => {
    it('重复评价: Prisma unique constraint → 错误传播', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({ id: 's1', userId: 'u1' });
      prisma.csRating.create.mockRejectedValue(
        new Error('Unique constraint failed on the fields: (`sessionId`)'),
      );

      await expect(
        service.submitRating('s1', 'u1', 5, ['快速'], '很好'),
      ).rejects.toThrow('Unique constraint failed on the fields: (`sessionId`)');
    });

    it('会话未关闭时提交评价: 仍可正常提交（评价基于 sessionId，不校验状态）', async () => {
      const { service, prisma } = createMocks();
      prisma.csSession.findUnique.mockResolvedValue({
        id: 's1', userId: 'u1', status: 'AGENT_HANDLING',
      });
      const ratingData = { id: 'rating-1', sessionId: 's1', score: 4, tags: ['专业'] };
      prisma.csRating.create.mockResolvedValue(ratingData);

      const result = await service.submitRating('s1', 'u1', 4, ['专业']);

      expect(result).toEqual(ratingData);
      expect(prisma.csRating.create).toHaveBeenCalledWith({
        data: { sessionId: 's1', userId: 'u1', score: 4, tags: ['专业'], comment: undefined },
      });
    });
  });
});
