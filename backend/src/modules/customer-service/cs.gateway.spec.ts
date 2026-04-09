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
});
