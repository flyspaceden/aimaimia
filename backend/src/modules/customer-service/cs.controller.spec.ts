import { CsController } from './cs.controller';

function createMocks() {
  const csService = {
    createSession: jest.fn(),
    getActiveSession: jest.fn(),
    getSessionMessages: jest.fn(),
    handleUserMessage: jest.fn(),
    getAdminSessionDetail: jest.fn(),
    submitRating: jest.fn(),
    getQuickEntries: jest.fn(),
    closeSession: jest.fn(),
  };
  const csGateway = {
    server: {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      socketsJoin: jest.fn(),
    },
  };
  const controller = new CsController(csService as any, csGateway as any);
  return { controller, csService, csGateway };
}

describe('CsController', () => {
  it('createSession — 调用 csService.createSession 并传入参数', async () => {
    const { controller, csService } = createMocks();
    csService.createSession.mockResolvedValue({ sessionId: 'sess-1', isExisting: false });

    const result = await controller.createSession('user-1', { source: 'GENERAL' } as any);

    expect(csService.createSession).toHaveBeenCalledWith('user-1', 'GENERAL', undefined);
    expect(result).toEqual({ sessionId: 'sess-1', isExisting: false });
  });

  it('sendMessage — 调用 handleUserMessage + 广播到 Socket.IO', async () => {
    const { controller, csService, csGateway } = createMocks();
    const userMsg = { id: 'msg-1', content: '你好', senderType: 'USER' };
    csService.handleUserMessage.mockResolvedValue({
      userMessage: userMsg,
      aiReply: null,
      transferred: false,
      routeResult: { shouldTransferToAgent: false },
    });

    const result = await controller.sendMessage('user-1', 'sess-1', { content: '你好' } as any);

    expect(csService.handleUserMessage).toHaveBeenCalledWith('sess-1', 'user-1', '你好', undefined);
    expect(csGateway.server.to).toHaveBeenCalledWith('session:sess-1');
    expect(csGateway.server.emit).toHaveBeenCalledWith('cs:message', userMsg);
    expect(result).toEqual({ userMessage: userMsg, aiReply: null, transferred: false });
  });

  it('sendMessage — AI 回复存在时广播 AI 消息', async () => {
    const { controller, csService, csGateway } = createMocks();
    const userMsg = { id: 'msg-1', content: '退款', senderType: 'USER' };
    const aiReply = { id: 'msg-2', content: '退款3-5天到账', senderType: 'AI' };
    csService.handleUserMessage.mockResolvedValue({
      userMessage: userMsg,
      aiReply,
      transferred: false,
      routeResult: { shouldTransferToAgent: false },
    });

    const result = await controller.sendMessage('user-1', 'sess-1', { content: '退款' } as any);

    // 第一次 emit 是用户消息，第二次是 AI 回复
    expect(csGateway.server.emit).toHaveBeenCalledWith('cs:message', userMsg);
    expect(csGateway.server.emit).toHaveBeenCalledWith('cs:message', aiReply);
    expect(result).toEqual({ userMessage: userMsg, aiReply, transferred: false });
  });

  it('sendMessage — 转人工成功时广播 cs:agent_joined', async () => {
    const { controller, csService, csGateway } = createMocks();
    const userMsg = { id: 'msg-1', content: '转人工', senderType: 'USER' };
    csService.handleUserMessage.mockResolvedValue({
      userMessage: userMsg,
      aiReply: null,
      transferred: true,
      routeResult: { shouldTransferToAgent: true },
    });
    csService.getAdminSessionDetail.mockResolvedValue({ agentId: 'agent-1' });

    const result = await controller.sendMessage('user-1', 'sess-1', { content: '转人工' } as any);

    expect(csService.getAdminSessionDetail).toHaveBeenCalledWith('sess-1');
    expect(csGateway.server.to).toHaveBeenCalledWith('agent:agent-1');
    expect(csGateway.server.socketsJoin).toHaveBeenCalledWith('session:sess-1');
    expect(csGateway.server.emit).toHaveBeenCalledWith('cs:agent_joined', {
      sessionId: 'sess-1',
      agentName: '客服',
    });
    expect(result.transferred).toBe(true);
  });

  it('sendMessage — 转人工排队时广播 cs:new_ticket', async () => {
    const { controller, csService, csGateway } = createMocks();
    const userMsg = { id: 'msg-1', content: '转人工', senderType: 'USER' };
    csService.handleUserMessage.mockResolvedValue({
      userMessage: userMsg,
      aiReply: null,
      transferred: false, // 未成功转接（排队中）
      routeResult: { shouldTransferToAgent: true },
    });

    const result = await controller.sendMessage('user-1', 'sess-1', { content: '转人工' } as any);

    expect(csGateway.server.to).toHaveBeenCalledWith('agent:lobby');
    expect(csGateway.server.emit).toHaveBeenCalledWith('cs:new_ticket', expect.objectContaining({
      sessionId: 'sess-1',
      userId: 'user-1',
      category: 'OTHER',
    }));
    // 系统提示消息
    expect(csGateway.server.emit).toHaveBeenCalledWith('cs:message', expect.objectContaining({
      senderType: 'SYSTEM',
      content: '正在为您转接人工客服，请稍候...',
    }));
    expect(result.transferred).toBe(false);
  });

  it('closeSession — 调用 csService 关闭会话并通知 Socket.IO', async () => {
    const { controller, csService, csGateway } = createMocks();
    csService.getSessionMessages.mockResolvedValue([]); // 归属检查
    csService.closeSession.mockResolvedValue(undefined);

    const result = await controller.closeSession('u1', 's1');

    expect(csService.closeSession).toHaveBeenCalledWith('s1');
    expect(csGateway.server.to).toHaveBeenCalledWith('session:s1');
    expect(csGateway.server.emit).toHaveBeenCalledWith('cs:session_closed', { sessionId: 's1' });
    expect(result).toEqual({ ok: true });
  });

  it('submitRating — 传入正确参数', async () => {
    const { controller, csService } = createMocks();
    csService.submitRating.mockResolvedValue({ success: true });

    const result = await controller.submitRating('user-1', 'sess-1', {
      score: 5,
      tags: ['快速', '专业'],
      comment: '很好',
    });

    expect(csService.submitRating).toHaveBeenCalledWith('sess-1', 'user-1', 5, ['快速', '专业'], '很好');
    expect(result).toEqual({ success: true });
  });
});
