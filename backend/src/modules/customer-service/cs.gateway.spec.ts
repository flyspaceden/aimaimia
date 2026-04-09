import { CsGateway } from './cs.gateway';

function createMocks() {
  const csService = {
    handleUserMessage: jest.fn(),
    handleAgentMessage: jest.fn(),
    agentAcceptSession: jest.fn(),
    closeSession: jest.fn(),
    getActiveSession: jest.fn(),
    getAdminSessionDetail: jest.fn(),
  };
  const agentService = {
    updateStatus: jest.fn(),
    handleDisconnect: jest.fn(),
    getQueueCount: jest.fn().mockResolvedValue(3),
    getActiveSessionIds: jest.fn().mockResolvedValue([]),
  };
  const jwtService = {
    verify: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'buyer-secret';
      if (key === 'ADMIN_JWT_SECRET') return 'admin-secret';
      return null;
    }),
  };

  const gateway = new CsGateway(
    csService as any,
    agentService as any,
    jwtService as any,
    configService as any,
  );

  // Mock the server (set after construction since @WebSocketServer sets it)
  const mockServer = {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    socketsJoin: jest.fn(),
  };
  (gateway as any).server = mockServer;

  return { gateway, csService, agentService, jwtService, configService, mockServer };
}

function createMockClient(data?: any): any {
  return {
    handshake: { auth: { token: 'test-token' } },
    data: data || {},
    join: jest.fn(),
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
    disconnect: jest.fn(),
  };
}

describe('CsGateway', () => {
  // ---- Connection Auth ----

  it('handleConnection — 无 token → disconnect', async () => {
    const { gateway } = createMocks();
    const client = createMockClient();
    client.handshake.auth = {}; // 没有 token

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it('handleConnection — 有效买家 JWT → join user room, isAgent=false', async () => {
    const { gateway, jwtService } = createMocks();
    const client = createMockClient();

    // 买家 token：第一次 verify 成功
    jwtService.verify.mockReturnValue({ sub: 'user-1' });

    await gateway.handleConnection(client);

    expect(client.join).toHaveBeenCalledWith('user:user-1');
    expect(client.data).toEqual({ userId: 'user-1', isAgent: false });
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('handleConnection — 有效管理员 JWT → join agent room + lobby, isAgent=true', async () => {
    const { gateway, jwtService, agentService } = createMocks();
    const client = createMockClient();

    // 管理员 token：第一次 verify 抛出错误，第二次成功
    jwtService.verify
      .mockImplementationOnce(() => { throw new Error('invalid'); })
      .mockReturnValueOnce({ sub: 'admin-1' });

    await gateway.handleConnection(client);

    expect(client.join).toHaveBeenCalledWith('agent:admin-1');
    expect(client.join).toHaveBeenCalledWith('agent:lobby');
    expect(client.data).toEqual({ adminId: 'admin-1', isAgent: true });
    expect(agentService.updateStatus).toHaveBeenCalledWith('admin-1', 'ONLINE');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('handleConnection — 无效 token（两个 verify 都失败） → disconnect', async () => {
    const { gateway, jwtService } = createMocks();
    const client = createMockClient();

    jwtService.verify
      .mockImplementationOnce(() => { throw new Error('bad buyer'); })
      .mockImplementationOnce(() => { throw new Error('bad admin'); });

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  // ---- Message Handling ----

  it('handleSend — 买家发消息：调用 handleUserMessage，广播 cs:message', async () => {
    const { gateway, csService, mockServer } = createMocks();
    const client = createMockClient({ userId: 'user-1', isAgent: false });

    const userMsg = { id: 'msg-1', content: '你好', senderType: 'USER' };
    csService.getActiveSession.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
    csService.handleUserMessage.mockResolvedValue({
      userMessage: userMsg,
      aiReply: null,
      transferred: false,
      routeResult: { shouldTransferToAgent: false },
    });

    await gateway.handleSend(client, { sessionId: 'session-1', content: '你好' });

    expect(csService.handleUserMessage).toHaveBeenCalledWith('session-1', 'user-1', '你好', undefined);
    expect(client.join).toHaveBeenCalledWith('session:session-1');
    expect(mockServer.to).toHaveBeenCalledWith('session:session-1');
    expect(mockServer.emit).toHaveBeenCalledWith('cs:message', userMsg);
  });

  it('handleSend — 坐席发消息：调用 handleAgentMessage，广播 cs:message', async () => {
    const { gateway, csService, mockServer } = createMocks();
    const client = createMockClient({ adminId: 'admin-1', isAgent: true });

    const agentMsg = { id: 'msg-2', content: '您好', senderType: 'AGENT' };
    csService.handleAgentMessage.mockResolvedValue(agentMsg);

    await gateway.handleSend(client, { sessionId: 'session-1', content: '您好' });

    expect(csService.handleAgentMessage).toHaveBeenCalledWith('session-1', 'admin-1', '您好', undefined);
    expect(mockServer.to).toHaveBeenCalledWith('session:session-1');
    expect(mockServer.emit).toHaveBeenCalledWith('cs:message', agentMsg);
  });

  it('handleSend — 消息超长(>5000) → emit cs:error', async () => {
    const { gateway, csService } = createMocks();
    const client = createMockClient({ userId: 'user-1', isAgent: false });

    const longContent = 'x'.repeat(5001);

    await gateway.handleSend(client, { sessionId: 'session-1', content: longContent });

    expect(client.emit).toHaveBeenCalledWith('cs:error', { message: '消息内容无效或超长' });
    expect(csService.handleUserMessage).not.toHaveBeenCalled();
    expect(csService.handleAgentMessage).not.toHaveBeenCalled();
  });

  it('handleSend — 服务抛错 → emit cs:error（不崩溃）', async () => {
    const { gateway, csService } = createMocks();
    const client = createMockClient({ userId: 'user-1', isAgent: false });

    csService.getActiveSession.mockResolvedValue(null);
    csService.handleUserMessage.mockRejectedValue(new Error('会话不存在'));

    await gateway.handleSend(client, { sessionId: 'session-1', content: '你好' });

    expect(client.emit).toHaveBeenCalledWith('cs:error', { message: '会话不存在' });
  });

  // ---- Session Management ----

  it('handleAcceptTicket — 坐席领取：调用 agentAcceptSession，广播 cs:agent_joined', async () => {
    const { gateway, csService, agentService, mockServer } = createMocks();
    const client = createMockClient({ adminId: 'admin-1', isAgent: true });

    await gateway.handleAcceptTicket(client, { sessionId: 'session-1' });

    expect(csService.agentAcceptSession).toHaveBeenCalledWith('session-1', 'admin-1');
    expect(client.join).toHaveBeenCalledWith('session:session-1');
    expect(mockServer.to).toHaveBeenCalledWith('session:session-1');
    expect(mockServer.emit).toHaveBeenCalledWith('cs:agent_joined', {
      sessionId: 'session-1',
      agentName: '客服',
    });
    // 验证队列更新广播
    expect(agentService.getQueueCount).toHaveBeenCalled();
    expect(mockServer.to).toHaveBeenCalledWith('agent:lobby');
    expect(mockServer.emit).toHaveBeenCalledWith('cs:queue_update', { queueCount: 3 });
  });

  it('handleCloseSession — 非坐席请求 → 忽略（不崩溃）', async () => {
    const { gateway, csService, mockServer } = createMocks();
    const client = createMockClient({ userId: 'user-1', isAgent: false });

    await gateway.handleCloseSession(client, { sessionId: 'session-1' });

    expect(csService.closeSession).not.toHaveBeenCalled();
    expect(mockServer.emit).not.toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalled();
  });

  // ---- 坐席 Socket 生命周期 ----

  describe('坐席 Socket 生命周期', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('坐席重连清除断线定时器：disconnect → reconnect → agentService.handleDisconnect 不被调用', async () => {
      const { gateway, jwtService, agentService } = createMocks();

      // 第一个客户端连接为管理员
      const client1 = createMockClient();
      jwtService.verify
        .mockImplementationOnce(() => { throw new Error('not buyer'); })
        .mockReturnValueOnce({ sub: 'admin-1' });
      await gateway.handleConnection(client1);
      expect(agentService.updateStatus).toHaveBeenCalledWith('admin-1', 'ONLINE');

      // 断线 → 设置 30 秒定时器
      await gateway.handleDisconnect(createMockClient({ adminId: 'admin-1', isAgent: true }));

      // 10 秒后重连（在 30 秒定时器触发前）
      jest.advanceTimersByTime(10_000);
      const client2 = createMockClient();
      jwtService.verify
        .mockImplementationOnce(() => { throw new Error('not buyer'); })
        .mockReturnValueOnce({ sub: 'admin-1' });
      await gateway.handleConnection(client2);

      // 跑完剩余的 30 秒
      jest.advanceTimersByTime(30_000);

      // agentService.handleDisconnect 不应该被调用（定时器已被清除）
      expect(agentService.handleDisconnect).not.toHaveBeenCalled();
    });

    it('坐席关闭会话后可接新会话', async () => {
      const { gateway, csService, agentService } = createMocks();
      const client = createMockClient({ adminId: 'admin-1', isAgent: true });

      // 关闭会话
      await gateway.handleCloseSession(client, { sessionId: 'session-1' });
      expect(csService.closeSession).toHaveBeenCalledWith('session-1');

      // 接新会话
      await gateway.handleAcceptTicket(client, { sessionId: 'session-2' });
      expect(csService.agentAcceptSession).toHaveBeenCalledWith('session-2', 'admin-1');
    });

    it('非坐席发 cs:accept_ticket → 被忽略', async () => {
      const { gateway, csService } = createMocks();
      const client = createMockClient({ userId: 'user-1', isAgent: false });

      await gateway.handleAcceptTicket(client, { sessionId: 'session-1' });

      expect(csService.agentAcceptSession).not.toHaveBeenCalled();
    });

    it('非坐席发 cs:close_session → 被忽略', async () => {
      const { gateway, csService } = createMocks();
      const client = createMockClient({ userId: 'user-1', isAgent: false });

      await gateway.handleCloseSession(client, { sessionId: 'session-1' });

      expect(csService.closeSession).not.toHaveBeenCalled();
    });
  });

  // ---- Socket 事件 payload 形状 ----

  describe('Socket 事件 payload 形状', () => {
    it('cs:message 事件包含完整 CsMessage 字段', async () => {
      const { gateway, csService, mockServer } = createMocks();
      const client = createMockClient({ adminId: 'admin-1', isAgent: true });

      const agentMsg = {
        id: 'msg-100',
        sessionId: 'session-1',
        senderType: 'AGENT',
        content: '您好，有什么可以帮您？',
        contentType: 'TEXT',
        createdAt: '2026-04-07T00:00:00.000Z',
      };
      csService.handleAgentMessage.mockResolvedValue(agentMsg);

      await gateway.handleSend(client, { sessionId: 'session-1', content: '您好，有什么可以帮您？' });

      expect(mockServer.to).toHaveBeenCalledWith('session:session-1');
      const emittedPayload = mockServer.emit.mock.calls.find(
        (c: any[]) => c[0] === 'cs:message',
      )?.[1];
      expect(emittedPayload).toBeDefined();
      expect(emittedPayload).toHaveProperty('id');
      expect(emittedPayload).toHaveProperty('sessionId');
      expect(emittedPayload).toHaveProperty('senderType');
      expect(emittedPayload).toHaveProperty('content');
      expect(emittedPayload).toHaveProperty('contentType');
      expect(emittedPayload).toHaveProperty('createdAt');
    });

    it('cs:agent_joined 事件包含 sessionId 和 agentName', async () => {
      const { gateway, csService, agentService, mockServer } = createMocks();
      const client = createMockClient({ adminId: 'admin-1', isAgent: true });

      await gateway.handleAcceptTicket(client, { sessionId: 'session-1' });

      const agentJoinedCall = mockServer.emit.mock.calls.find(
        (c: any[]) => c[0] === 'cs:agent_joined',
      );
      expect(agentJoinedCall).toBeDefined();
      const payload = agentJoinedCall![1];
      expect(payload).toEqual({ sessionId: 'session-1', agentName: '客服' });
    });

    it('cs:error 事件在异常时发送', async () => {
      const { gateway, csService } = createMocks();
      const client = createMockClient({ adminId: 'admin-1', isAgent: true });

      csService.handleAgentMessage.mockRejectedValue(new Error('无权在此会话发送消息'));

      await gateway.handleSend(client, { sessionId: 'session-1', content: '你好' });

      expect(client.emit).toHaveBeenCalledWith('cs:error', { message: '无权在此会话发送消息' });
    });

    it('cs:typing 事件中继 — 买家和坐席', () => {
      const { gateway } = createMocks();

      // 买家发 typing
      const buyerClient = createMockClient({ userId: 'user-1', isAgent: false });
      gateway.handleTyping(buyerClient, { sessionId: 'session-1', senderType: 'USER' as any });
      expect(buyerClient.to).toHaveBeenCalledWith('session:session-1');
      expect(buyerClient.emit).toHaveBeenCalledWith('cs:typing', {
        sessionId: 'session-1',
        senderType: 'USER',
      });

      // 坐席发 typing
      const agentClient = createMockClient({ adminId: 'admin-1', isAgent: true });
      gateway.handleTyping(agentClient, { sessionId: 'session-1', senderType: 'AGENT' as any });
      expect(agentClient.to).toHaveBeenCalledWith('session:session-1');
      expect(agentClient.emit).toHaveBeenCalledWith('cs:typing', {
        sessionId: 'session-1',
        senderType: 'AGENT',
      });
    });
  });
});
