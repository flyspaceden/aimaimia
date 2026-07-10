import { NotificationMessageService } from './notification-message.service';

describe('NotificationMessageService', () => {
  it('列表接口保留公告重要性和元数据供买家端展示', async () => {
    const prisma = {
      notificationMessage: {
        findMany: jest.fn().mockResolvedValue([{
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
        }]),
      },
    };
    const service = new NotificationMessageService(prisma as any);

    await expect(service.list('buyer:user-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'message-1',
        severity: 'WARNING',
        metadata: { priority: 'IMPORTANT' },
      }),
    ]);
  });
});
