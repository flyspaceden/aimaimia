import { ForbiddenException } from '@nestjs/common';
import { SellerOrdersService } from './seller-orders.service';

describe('SellerOrdersService invoice privacy', () => {
  let prisma: any;
  let service: SellerOrdersService;

  beforeEach(() => {
    prisma = {
      order: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      buyerAlias: { findMany: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new SellerOrdersService(
      prisma,
      {} as any,
      { getWaybillPrintUrl: jest.fn(() => 'http://localhost/waybill.pdf') } as any,
      {} as any,
    );
  });

  it('returns invoiceStatus only for seller order detail', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'buyer-1',
      status: 'RECEIVED',
      bizType: 'NORMAL_GOODS',
      shippingFee: 0,
      createdAt: new Date('2026-05-15T12:00:00.000Z'),
      addressSnapshot: { province: '广东省', city: '深圳市' },
      invoice: {
        id: 'inv-1',
        status: 'ISSUED',
        invoiceNo: 'MOCK-1',
        pdfUrl: 'http://localhost/inv.pdf',
        profileSnapshot: {
          title: '深圳某公司',
          taxNo: '91440300MAEXAMPLE',
          phone: '13800000000',
          email: 'buyer@example.com',
        },
      },
      refunds: [],
      shipments: [],
      items: [{
        id: 'item-1',
        companyId: 'company-1',
        unitPrice: 50,
        quantity: 2,
        isPrize: false,
        prizeType: null,
        sku: {
          product: {
            title: '苹果',
            media: [{ url: 'http://localhost/apple.jpg' }],
          },
        },
      }],
    });
    prisma.buyerAlias.findMany.mockResolvedValue([{ userId: 'buyer-1', alias: '买家001' }]);

    const out = await service.findById('company-1', 'staff-1', 'order-1');
    const serialized = JSON.stringify(out);

    expect(out.invoiceStatus).toBe('ISSUED');
    expect(serialized).not.toContain('profileSnapshot');
    expect(serialized).not.toContain('pdfUrl');
    expect(serialized).not.toContain('invoiceNo');
    expect(serialized).not.toContain('91440300MAEXAMPLE');
    expect(serialized).not.toContain('13800000000');
    expect(serialized).not.toContain('buyer@example.com');
  });

  it('returns product description for seller picking slip item details', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'buyer-1',
      status: 'PAID',
      bizType: 'NORMAL_GOODS',
      shippingFee: 0,
      createdAt: new Date('2026-06-21T12:00:00.000Z'),
      addressSnapshot: { province: '云南省', city: '昆明市', district: '盘龙区' },
      invoice: null,
      refunds: [],
      shipments: [],
      items: [{
        id: 'item-1',
        companyId: 'company-1',
        unitPrice: 699.01,
        quantity: 1,
        isPrize: false,
        prizeType: null,
        sku: {
          product: {
            title: '印度小青龙699/10件产品套装',
            description: '多样海产品组合：有进口印度小青龙300克4只，苏丹鱼-忘不了鱼500克2条。',
            media: [],
          },
        },
      }],
    });
    prisma.buyerAlias.findMany.mockResolvedValue([{ userId: 'buyer-1', alias: '买家001' }]);

    const out = await service.findById('company-1', 'staff-1', 'order-1');

    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          items: expect.objectContaining({
            include: expect.objectContaining({
              sku: expect.objectContaining({
                include: expect.objectContaining({
                  product: expect.objectContaining({
                    select: expect.objectContaining({
                      description: true,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    );
    expect(out.items[0]).toMatchObject({
      title: '印度小青龙699/10件产品套装',
      description: '多样海产品组合：有进口印度小青龙300克4只，苏丹鱼-忘不了鱼500克2条。',
    });
  });

  it('returns buyer public id without leaking internal user id', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'buyer-1',
      status: 'RECEIVED',
      bizType: 'NORMAL_GOODS',
      shippingFee: 0,
      createdAt: new Date('2026-05-15T12:00:00.000Z'),
      addressSnapshot: { province: '广东省', city: '深圳市' },
      invoice: null,
      refunds: [],
      shipments: [],
      items: [{
        id: 'item-1',
        companyId: 'company-1',
        unitPrice: 50,
        quantity: 2,
        isPrize: false,
        prizeType: null,
        sku: {
          product: {
            title: '苹果',
            media: [],
          },
        },
      }],
    });
    prisma.buyerAlias.findMany.mockResolvedValue([{ userId: 'buyer-1', alias: '买家001' }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'buyer-1', buyerNo: 'AIMM00000000000001' }]);

    const out = await service.findById('company-1', 'staff-1', 'order-1');
    const serialized = JSON.stringify(out);

    expect(out.buyerAlias).toBe('买家001');
    expect((out as any).buyerNo).toBe('AIMM00000000000001');
    expect(serialized).not.toContain('buyer-1');
  });

  it('filters order list by buyer public id inside company scope', async () => {
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);
    prisma.buyerAlias.findMany.mockResolvedValue([]);

    await (service.findAll as any)(
      'company-1',
      1,
      20,
      undefined,
      undefined,
      'AIMM00000000000001',
      'staff-1',
    );

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          items: { some: { companyId: 'company-1' } },
          user: { buyerNo: 'AIMM00000000000001' },
        }),
      }),
    );
    expect(prisma.order.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        items: { some: { companyId: 'company-1' } },
        user: { buyerNo: 'AIMM00000000000001' },
      }),
    });
  });

  it('denies access when the order has no company items', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'buyer-1',
      status: 'RECEIVED',
      bizType: 'NORMAL_GOODS',
      createdAt: new Date(),
      addressSnapshot: {},
      invoice: { status: 'REQUESTED' },
      refunds: [],
      shipments: [],
      items: [],
    });

    await expect(service.findById('company-1', 'staff-1', 'order-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
