import { NotificationMessageService } from './notification-message.service';

describe('NotificationMessageService', () => {
  const makeService = () => {
    const prisma = {
      notificationMessage: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    return { prisma, service: new NotificationMessageService(prisma as any) };
  };

  it('列表接口保留公告重要性和元数据供买家端展示', async () => {
    const { prisma, service } = makeService();
    prisma.notificationMessage.findMany.mockResolvedValue([{
      id: 'message-1',
      category: 'system',
      eventType: 'platform_announcement',
      title: '重要公告',
      body: '系统维护通知',
      severity: 'WARNING',
      metadata: { priority: 'IMPORTANT' },
      createdAt: new Date('2026-07-10T12:00:00.000Z'),
      readAt: null,
      action: null,
    }]);

    await expect(service.list('buyer:user-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'message-1',
        severity: 'WARNING',
        metadata: { priority: 'IMPORTANT' },
      }),
    ]);
    expect(prisma.notificationMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { recipientKey: 'buyer:user-1', deletedAt: null },
    }));
  });

  it('消息详情只能读取当前收件人未删除的消息', async () => {
    const { prisma, service } = makeService();
    prisma.notificationMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      category: 'service',
      eventType: 'cs_outreach_invite',
      title: '平台客服邀请沟通',
      body: '请进入客服对话。',
      severity: 'INFO',
      metadata: null,
      createdAt: new Date('2026-07-12T01:00:00.000Z'),
      readAt: null,
      action: { route: '/cs', params: { sessionId: 'session-1' } },
    });

    await expect(service.getOne('buyer:user-1', 'message-1')).resolves.toEqual(
      expect.objectContaining({ id: 'message-1', category: 'service', unread: true }),
    );
    expect(prisma.notificationMessage.findFirst).toHaveBeenCalledWith({
      where: { id: 'message-1', recipientKey: 'buyer:user-1', deletedAt: null },
    });
  });

  it('uses a stable createdAt plus id cursor for queue reward bell events', async () => {
    const { prisma, service } = makeService();
    const cursorTime =
      new Date('2026-07-10T12:00:00.000Z');
    prisma.notificationMessage.findMany.mockResolvedValue([
      {
        id: 'message-b',
        category: 'wallet',
        eventType: 'queueReward.available',
        title: '排队红包到账',
        body: '到账',
        severity: 'SUCCESS',
        metadata: { ring: true },
        createdAt: cursorTime,
        readAt: null,
        action: null,
      },
    ]);

    await expect(
      service.listQueueRewardEventsAfter(
        'buyer:user-1',
        cursorTime,
        'message-a',
        100,
      ),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({ id: 'message-b' }),
      ],
      nextCursor: {
        createdAt: cursorTime.toISOString(),
        id: 'message-b',
      },
      hasMore: false,
    });
    expect(
      prisma.notificationMessage.findMany,
    ).toHaveBeenCalledWith({
      where: {
        recipientKey: 'buyer:user-1',
        deletedAt: null,
        eventType: 'queueReward.available',
        OR: [
          { createdAt: { gt: cursorTime } },
          {
            createdAt: cursorTime,
            id: { gt: 'message-a' },
          },
        ],
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: 100,
    });
  });

  it('uses the latest server-side queue message as the initial bell cursor', async () => {
    const { prisma, service } = makeService();
    const createdAt =
      new Date('2026-07-10T12:00:00.000Z');
    prisma.notificationMessage.findFirst.mockResolvedValue({
      id: 'message-z',
      createdAt,
    });

    await expect(
      service.getQueueRewardEventBaseline('buyer:user-1'),
    ).resolves.toEqual({
      createdAt: createdAt.toISOString(),
      id: 'message-z',
    });
    expect(
      prisma.notificationMessage.findFirst,
    ).toHaveBeenCalledWith({
      where: {
        recipientKey: 'buyer:user-1',
        deletedAt: null,
        eventType: 'queueReward.available',
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      select: { id: true, createdAt: true },
    });
  });

  it('uses the epoch when no queue reward message exists yet', async () => {
    const { service } = makeService();

    await expect(
      service.getQueueRewardEventBaseline('buyer:user-1'),
    ).resolves.toEqual({
      createdAt: '1970-01-01T00:00:00.000Z',
      id: '',
    });
  });

  it('消息详情无法读取其他收件人的消息', async () => {
    const { service } = makeService();
    await expect(service.getOne('buyer:user-1', 'other-message')).rejects.toThrow('消息不存在');
  });

  it('未读数和全部已读都排除用户已经删除的消息', async () => {
    const { prisma, service } = makeService();
    prisma.notificationMessage.count.mockResolvedValue(3);

    await expect(service.unreadCount('buyer:user-1')).resolves.toBe(3);
    await service.markAllRead('buyer:user-1');

    expect(prisma.notificationMessage.count).toHaveBeenCalledWith({
      where: { recipientKey: 'buyer:user-1', deletedAt: null, readAt: null },
    });
    expect(prisma.notificationMessage.updateMany).toHaveBeenCalledWith({
      where: { recipientKey: 'buyer:user-1', deletedAt: null, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it('互动筛选包含客服 service 分类且不混入 system', async () => {
    const { prisma, service } = makeService();

    await service.list('buyer:user-1', 'interaction');

    expect(prisma.notificationMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        recipientKey: 'buyer:user-1',
        deletedAt: null,
        category: { in: ['interaction', 'service'] },
      },
    }));
  });

  it('单条删除和恢复始终同时校验消息与当前收件人', async () => {
    const { prisma, service } = makeService();
    prisma.notificationMessage.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.deleteOne('buyer:user-1', 'message-1')).resolves.toEqual({
      id: 'message-1',
      deletedCount: 1,
    });
    await expect(service.restoreOne('buyer:user-1', 'message-1')).resolves.toEqual({
      id: 'message-1',
      restoredCount: 1,
    });

    expect(prisma.notificationMessage.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'message-1', recipientKey: 'buyer:user-1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(prisma.notificationMessage.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'message-1', recipientKey: 'buyer:user-1', deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  });

  it('单条删除无法命中当前收件人时返回消息不存在', async () => {
    const { service } = makeService();
    await expect(service.deleteOne('buyer:user-1', 'other-user-message')).rejects.toThrow('消息不存在');
  });

  it('批量清理分别支持只删已读和删除全部', async () => {
    const { prisma, service } = makeService();
    prisma.notificationMessage.updateMany
      .mockResolvedValueOnce({ count: 4 })
      .mockResolvedValueOnce({ count: 7 });

    await expect(service.deleteRead('buyer:user-1')).resolves.toEqual({ deletedCount: 4 });
    await expect(service.deleteAll('buyer:user-1')).resolves.toEqual({ deletedCount: 7 });

    expect(prisma.notificationMessage.updateMany).toHaveBeenNthCalledWith(1, {
      where: { recipientKey: 'buyer:user-1', deletedAt: null, readAt: { not: null } },
      data: { deletedAt: expect.any(Date) },
    });
    expect(prisma.notificationMessage.updateMany).toHaveBeenNthCalledWith(2, {
      where: { recipientKey: 'buyer:user-1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
