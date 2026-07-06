import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CsOutreachService } from './cs-outreach.service';

describe('CsOutreachService', () => {
  const makeService = () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          buyerNo: 'AIMM20260706000001',
          status: 'ACTIVE',
        }),
      },
      csAgentStatus: {
        findUnique: jest.fn().mockResolvedValue({
          adminId: 'admin-1',
          currentSessions: 1,
          maxSessions: 5,
        }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ adminId: 'admin-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      csSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'session-1' }),
      },
      csMessage: {
        create: jest.fn().mockResolvedValue({ id: 'message-1' }),
      },
      inboxMessage: {
        create: jest.fn().mockResolvedValue({ id: 'inbox-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'user-1',
            buyerNo: 'AIMM20260706000001',
            status: 'ACTIVE',
            profile: { nickname: '张三', avatarUrl: 'https://example.com/a.png' },
            authIdentities: [{ identifier: '13812341234' }],
            memberProfile: { tier: 'VIP' },
          },
        ]),
      },
    };
    const maskingService = {
      mask: jest.fn((text: string) => text.replace('13812341234', '138****1234')),
    };
    return {
      service: new CsOutreachService(prisma as any, maskingService as any),
      prisma,
      tx,
      maskingService,
    };
  };

  it('searches active buyers for outreach with masked phone only', async () => {
    const { service, prisma } = makeService();

    const result = await service.searchBuyers('aimm20260706000001');

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'ACTIVE',
        buyerNo: { not: null },
      }),
      take: 10,
    }));
    expect(result).toEqual([
      {
        id: 'user-1',
        buyerNo: 'AIMM20260706000001',
        nickname: '张三',
        avatarUrl: 'https://example.com/a.png',
        phone: '138****1234',
        memberTier: 'VIP',
        status: 'ACTIVE',
      },
    ]);
  });

  it('rejects invalid buyerNo without opening a transaction', async () => {
    const { service, prisma } = makeService();

    await expect(service.create('admin-1', {
      buyerNo: 'user-1',
      initialMessage: '您好',
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects missing initial message without opening a transaction', async () => {
    const { service, prisma } = makeService();

    await expect(service.create('admin-1', {
      buyerNo: 'AIMM20260706000001',
      initialMessage: undefined as any,
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects missing or inactive buyers without creating a session', async () => {
    const { service, tx } = makeService();
    tx.user.findUnique.mockResolvedValue({ id: 'user-1', buyerNo: 'AIMM20260706000001', status: 'BANNED' });

    await expect(service.create('admin-1', {
      buyerNo: 'AIMM20260706000001',
      initialMessage: '您好',
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.csSession.create).not.toHaveBeenCalled();
    expect(tx.inboxMessage.create).not.toHaveBeenCalled();
  });

  it('creates outreach session first agent message and inbox invite in one Serializable transaction', async () => {
    const { service, prisma, tx, maskingService } = makeService();

    const result = await service.create('admin-1', {
      buyerNo: 'aimm20260706000001',
      initialMessage: '您好，请确认手机号 13812341234',
      inviteTitle: '平台客服邀请沟通',
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(maskingService.mask).toHaveBeenCalledWith('您好，请确认手机号 13812341234');
    expect(tx.csAgentStatus.updateMany).toHaveBeenCalledWith({
      where: {
        adminId: 'admin-1',
        currentSessions: 1,
      },
      data: {
        currentSessions: { increment: 1 },
        lastActiveAt: expect.any(Date),
        status: 'ONLINE',
      },
    });
    expect(tx.csSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        source: 'ADMIN_OUTREACH',
        status: 'AGENT_HANDLING',
        agentId: 'admin-1',
        agentJoinedAt: expect.any(Date),
      }),
    });
    expect(tx.csMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: 'session-1',
        senderType: 'AGENT',
        senderId: 'admin-1',
        contentType: 'TEXT',
        content: '您好，请确认手机号 138****1234',
        routeLayer: 3,
      }),
    });
    expect(tx.inboxMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        category: 'system',
        type: 'cs_outreach_invite',
        title: '平台客服邀请沟通',
        target: { route: '/cs', params: { sessionId: 'session-1' } },
      }),
    });
    expect(result).toEqual({ sessionId: 'session-1', inboxMessageId: 'inbox-1', messageId: 'message-1' });
  });

  it('reuses an active outreach session already handled by the current admin', async () => {
    const { service, tx } = makeService();
    tx.csSession.findFirst.mockResolvedValue({
      id: 'session-existing',
      status: 'AGENT_HANDLING',
      agentId: 'admin-1',
    });

    const result = await service.create('admin-1', {
      buyerNo: 'AIMM20260706000001',
      initialMessage: '您好，继续沟通',
    });

    expect(tx.csAgentStatus.updateMany).not.toHaveBeenCalled();
    expect(tx.csSession.create).not.toHaveBeenCalled();
    expect(tx.csMessage.create).not.toHaveBeenCalled();
    expect(tx.inboxMessage.create).not.toHaveBeenCalled();
    expect(result).toEqual({ sessionId: 'session-existing', reused: true });
  });

  it('rejects outreach when the buyer is already handled by another admin', async () => {
    const { service, tx } = makeService();
    tx.csSession.findFirst.mockResolvedValue({
      id: 'session-other',
      status: 'AGENT_HANDLING',
      agentId: 'admin-2',
    });

    await expect(service.create('admin-1', {
      buyerNo: 'AIMM20260706000001',
      initialMessage: '您好',
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.csAgentStatus.updateMany).not.toHaveBeenCalled();
    expect(tx.csSession.create).not.toHaveBeenCalled();
    expect(tx.csMessage.create).not.toHaveBeenCalled();
    expect(tx.inboxMessage.create).not.toHaveBeenCalled();
  });

  it('claims an existing queued buyer session before sending the outreach message', async () => {
    const { service, tx } = makeService();
    tx.csSession.findFirst.mockResolvedValue({
      id: 'session-queued',
      status: 'QUEUING',
      agentId: null,
    });

    const result = await service.create('admin-1', {
      buyerNo: 'AIMM20260706000001',
      initialMessage: '您好，平台客服现在接入',
    });

    expect(tx.csSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-queued', status: 'QUEUING', agentId: null },
      data: expect.objectContaining({
        status: 'AGENT_HANDLING',
        agentId: 'admin-1',
        agentJoinedAt: expect.any(Date),
      }),
    });
    expect(tx.csSession.create).not.toHaveBeenCalled();
    expect(tx.csMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: 'session-queued',
        senderType: 'AGENT',
        senderId: 'admin-1',
        content: '您好，平台客服现在接入',
      }),
    });
    expect(tx.inboxMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        target: { route: '/cs', params: { sessionId: 'session-queued' } },
      }),
    });
    expect(result).toEqual({
      sessionId: 'session-queued',
      inboxMessageId: 'inbox-1',
      messageId: 'message-1',
      claimed: true,
    });
  });

  it('creates an agent status row for first outreach by this admin', async () => {
    const { service, tx } = makeService();
    tx.csAgentStatus.findUnique.mockResolvedValue(null);

    await service.create('admin-1', {
      buyerNo: 'AIMM20260706000001',
      initialMessage: '您好',
    });

    expect(tx.csAgentStatus.create).toHaveBeenCalledWith({
      data: {
        adminId: 'admin-1',
        status: 'ONLINE',
        currentSessions: 1,
        lastActiveAt: expect.any(Date),
      },
    });
    expect(tx.csAgentStatus.updateMany).not.toHaveBeenCalled();
  });

  it('rejects outreach when current agent is at capacity', async () => {
    const { service, tx } = makeService();
    tx.csAgentStatus.findUnique.mockResolvedValue({
      adminId: 'admin-1',
      currentSessions: 5,
      maxSessions: 5,
    });

    await expect(service.create('admin-1', {
      buyerNo: 'AIMM20260706000001',
      initialMessage: '您好',
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.csSession.create).not.toHaveBeenCalled();
  });

  it('rejects outreach when another request changes the agent session count first', async () => {
    const { service, tx } = makeService();
    tx.csAgentStatus.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.create('admin-1', {
      buyerNo: 'AIMM20260706000001',
      initialMessage: '您好',
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.csSession.create).not.toHaveBeenCalled();
    expect(tx.inboxMessage.create).not.toHaveBeenCalled();
  });
});
