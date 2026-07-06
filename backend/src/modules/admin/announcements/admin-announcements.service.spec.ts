import { BadRequestException } from '@nestjs/common';
import { AdminAnnouncementsService } from './admin-announcements.service';

describe('AdminAnnouncementsService', () => {
  const makeService = () => {
    const prisma = {
      $transaction: jest.fn(),
      user: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      announcement: {
        create: jest.fn().mockResolvedValue({ id: 'announcement-1' }),
        update: jest.fn().mockResolvedValue({ id: 'announcement-1' }),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      inboxMessage: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    return {
      service: new AdminAnnouncementsService(prisma as any),
      prisma,
    };
  };

  const baseDto = {
    title: '平台公告',
    content: '本周五 20:00 有平台活动',
    category: 'system' as const,
    type: 'platform_announcement' as const,
    priority: 'IMPORTANT' as const,
    audience: { type: 'ALL' as const },
  };

  it('previews ACTIVE buyer audience only', async () => {
    const { service, prisma } = makeService();
    prisma.user.count.mockResolvedValue(12);

    const result = await service.preview(baseDto);

    expect(result).toEqual({ count: 12, invalidBuyerNos: [] });
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', buyerNo: { not: null } },
    });
  });

  it('accepts current buyer app group-buy routes as announcement targets', async () => {
    const { service, prisma } = makeService();
    prisma.user.count.mockResolvedValue(3);

    await expect(service.preview({
      ...baseDto,
      target: { route: '/group-buy/activity-1' },
    })).resolves.toEqual({ count: 3, invalidBuyerNos: [] });

    await expect(service.preview({
      ...baseDto,
      target: { route: '/group-buy' },
    })).resolves.toEqual({ count: 3, invalidBuyerNos: [] });
  });

  it('rejects requests without an announcement audience explicitly', async () => {
    const { service } = makeService();

    await expect(service.preview({
      ...baseDto,
      audience: undefined as any,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid buyerNo values before publishing', async () => {
    const { service, prisma } = makeService();
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1', buyerNo: 'AIMM202607060001' }]);

    await expect(service.create({
      ...baseDto,
      audience: {
        type: 'BUYER_NOS',
        buyerNos: ['AIMM202607060001', 'AIMM202607069999'],
      },
    }, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.inboxMessage.createMany).not.toHaveBeenCalled();
  });

  it('creates announcement and inbox messages for buyerNo list without a long batch transaction', async () => {
    const { service, prisma } = makeService();
    prisma.user.findMany.mockResolvedValue([
      { id: 'user-1', buyerNo: 'AIMM202607060001' },
      { id: 'user-2', buyerNo: 'AIMM202607060002' },
    ]);
    prisma.inboxMessage.createMany.mockResolvedValue({ count: 2 });
    prisma.announcement.update.mockResolvedValue({
      id: 'announcement-1',
      status: 'SENT',
      recipientCount: 2,
      successCount: 2,
      failedCount: 0,
    });

    const result = await service.create({
      ...baseDto,
      audience: {
        type: 'BUYER_NOS',
        buyerNos: ['AIMM202607060001', 'AIMM202607060002'],
      },
      target: { route: ' /product/sku-1 ', params: { skuId: 'sku-1' } },
    }, 'admin-1');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.announcement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: '平台公告',
        createdBy: 'admin-1',
        recipientCount: 2,
        status: 'SENDING',
        target: { route: '/product/sku-1', params: { skuId: 'sku-1' } },
      }),
    }));
    expect(prisma.inboxMessage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: 'user-1', type: 'platform_announcement', target: { route: '/product/sku-1', params: { skuId: 'sku-1' } } }),
        expect.objectContaining({ userId: 'user-2', type: 'platform_announcement', target: { route: '/product/sku-1', params: { skuId: 'sku-1' } } }),
      ],
      skipDuplicates: true,
    });
    expect(result).toEqual(expect.objectContaining({
      id: 'announcement-1',
      status: 'SENT',
      successCount: 2,
      failedCount: 0,
    }));
  });

  it('marks partial failure when a createMany batch fails', async () => {
    const { service, prisma } = makeService();
    const recipients = Array.from({ length: 1001 }, (_, index) => ({
      id: `user-${index + 1}`,
      buyerNo: `AIMM20260706${String(index + 1).padStart(4, '0')}`,
    }));
    prisma.user.findMany.mockResolvedValue(recipients);
    prisma.inboxMessage.createMany
      .mockResolvedValueOnce({ count: 1000 })
      .mockRejectedValueOnce(new Error('db batch failed'));
    prisma.announcement.update.mockResolvedValue({
      id: 'announcement-1',
      status: 'PARTIAL_FAILED',
      recipientCount: 1001,
      successCount: 1000,
      failedCount: 1,
    });

    const result = await service.create({
      ...baseDto,
      audience: {
        type: 'BUYER_NOS',
        buyerNos: recipients.map((item) => item.buyerNo),
      },
    }, 'admin-1');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: 'announcement-1' },
      data: expect.objectContaining({
        status: 'PARTIAL_FAILED',
        successCount: 1000,
        failedCount: 1,
      }),
    });
    expect(result).toEqual(expect.objectContaining({ status: 'PARTIAL_FAILED' }));
  });

  it('rejects non-whitelisted app target routes', async () => {
    const { service } = makeService();

    await expect(service.create({
      ...baseDto,
      target: { route: 'https://evil.example.com/phishing' },
    }, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects dynamic route roots that do not have standalone buyer pages', async () => {
    const { service } = makeService();

    await expect(service.preview({
      ...baseDto,
      target: { route: '/product' },
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
