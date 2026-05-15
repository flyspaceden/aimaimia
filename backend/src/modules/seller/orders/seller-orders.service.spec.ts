import { ForbiddenException } from '@nestjs/common';
import { SellerOrdersService } from './seller-orders.service';

describe('SellerOrdersService invoice privacy', () => {
  let prisma: any;
  let service: SellerOrdersService;

  beforeEach(() => {
    prisma = {
      order: { findUnique: jest.fn() },
      buyerAlias: { findMany: jest.fn() },
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
