import { SellerShipmentsService } from './seller-shipments.service';

describe('SellerShipmentsService buyerNo', () => {
  let prisma: any;
  let service: SellerShipmentsService;

  beforeEach(() => {
    prisma = {
      shipment: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      buyerAlias: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'buyer-1', alias: '买家001' }]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'buyer-1', buyerNo: 'AIMM00000000000001' }]),
      },
    };
    service = new SellerShipmentsService(prisma);
  });

  it('filters shipment list by buyerNo inside company scope and returns buyerNo', async () => {
    prisma.shipment.findMany.mockResolvedValue([
      {
        id: 'shipment-1',
        status: 'IN_TRANSIT',
        carrierCode: 'SF',
        carrierName: '顺丰速运',
        trackingNo: 'SF1234567890',
        shippedAt: new Date('2026-06-01T00:00:00.000Z'),
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        order: {
          id: 'order-1',
          status: 'SHIPPED',
          userId: 'buyer-1',
          addressSnapshot: { province: '广东省', city: '深圳市' },
        },
      },
    ]);
    prisma.shipment.count.mockResolvedValue(1);

    const result = await (service.findAll as any)(
      'company-1',
      1,
      20,
      'aimm00000000000001',
    );

    expect(prisma.shipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          order: { user: { buyerNo: 'AIMM00000000000001' } },
        },
      }),
    );
    expect(result.items[0].order).toMatchObject({
      buyerAlias: '买家001',
      buyerNo: 'AIMM00000000000001',
    });
  });

  it('returns buyerNo in shipment detail without exposing internal userId', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      id: 'shipment-1',
      companyId: 'company-1',
      status: 'IN_TRANSIT',
      carrierCode: 'SF',
      carrierName: '顺丰速运',
      trackingNo: 'SF1234567890',
      shippedAt: new Date('2026-06-01T00:00:00.000Z'),
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      order: {
        id: 'order-1',
        status: 'SHIPPED',
        userId: 'buyer-1',
        addressSnapshot: { province: '广东省', city: '深圳市' },
        items: [],
      },
      trackingEvents: [],
    });

    const result = await service.findById('company-1', 'shipment-1');
    const serialized = JSON.stringify(result);

    expect(result.order).toMatchObject({
      buyerAlias: '买家001',
      buyerNo: 'AIMM00000000000001',
    });
    expect(serialized).not.toContain('"userId"');
    expect(serialized).not.toContain('buyer-1');
  });
});
