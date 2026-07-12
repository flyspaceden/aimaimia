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
