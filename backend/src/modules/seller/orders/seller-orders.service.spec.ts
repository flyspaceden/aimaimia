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

  it('returns bundle snapshot fields for seller order detail with defaults', async () => {
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
      items: [
        {
          id: 'item-bundle',
          companyId: 'company-1',
          unitPrice: 88,
          quantity: 1,
          isPrize: false,
          prizeType: null,
          productSnapshot: {
            title: '精选水果礼盒',
            image: 'http://localhost/snapshot-bundle.jpg',
            productType: 'BUNDLE',
            bundleItems: [
              { productId: 'p1', productTitle: '苹果', skuId: 'sku-1', skuName: '红富士', quantity: 2 },
              { productId: 'p2', productTitle: '梨', skuId: 'sku-2', skuName: '皇冠梨', quantity: 1 },
            ],
          },
          sku: {
            product: {
              title: '秋季组合装',
              media: [{ url: 'http://localhost/live-bundle.jpg' }],
            },
          },
        },
        {
          id: 'item-simple',
          companyId: 'company-1',
          unitPrice: 20,
          quantity: 3,
          isPrize: false,
          prizeType: null,
          productSnapshot: null,
          sku: {
            product: {
              title: '香蕉',
              media: [],
            },
          },
        },
      ],
    });
    prisma.buyerAlias.findMany.mockResolvedValue([{ userId: 'buyer-1', alias: '买家001' }]);

    const out = await service.findById('company-1', 'staff-1', 'order-1');

    expect(out.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'item-bundle',
          title: '精选水果礼盒',
          imageUrl: 'http://localhost/snapshot-bundle.jpg',
          productType: 'BUNDLE',
          bundleItems: [
            { productId: 'p1', productTitle: '苹果', skuId: 'sku-1', skuName: '红富士', quantity: 2 },
            { productId: 'p2', productTitle: '梨', skuId: 'sku-2', skuName: '皇冠梨', quantity: 1 },
          ],
        }),
        expect.objectContaining({
          id: 'item-simple',
          productType: 'SIMPLE',
          bundleItems: [],
        }),
      ]),
    );
  });

  it('returns sku identity for normal seller order detail items and preserves bundle fields', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-2',
      userId: 'buyer-2',
      status: 'PAID',
      bizType: 'NORMAL_GOODS',
      shippingFee: 0,
      createdAt: new Date('2026-06-18T12:00:00.000Z'),
      addressSnapshot: { province: '浙江省', city: '杭州市' },
      invoice: null,
      refunds: [],
      shipments: [],
      items: [
        {
          id: 'item-normal-snapshot',
          companyId: 'company-1',
          unitPrice: 18,
          quantity: 2,
          isPrize: false,
          prizeType: null,
          productSnapshot: {
            title: '烟台苹果',
            skuId: 'snapshot-sku-1',
            skuTitle: '脆甜款',
          },
          sku: {
            id: 'live-sku-1',
            title: '直播间规格',
            product: {
              title: '烟台苹果',
              media: [{ url: 'http://localhost/apple-live.jpg' }],
            },
          },
        },
        {
          id: 'item-normal-live',
          companyId: 'company-1',
          unitPrice: 36,
          quantity: 1,
          isPrize: false,
          prizeType: null,
          productSnapshot: null,
          sku: {
            id: 'live-sku-2',
            title: '精品果',
            product: {
              title: '库尔勒香梨',
              media: [{ url: 'http://localhost/pear-live.jpg' }],
            },
          },
        },
        {
          id: 'item-bundle',
          companyId: 'company-1',
          unitPrice: 88,
          quantity: 1,
          isPrize: false,
          prizeType: null,
          productSnapshot: {
            title: '精选水果礼盒',
            image: 'http://localhost/snapshot-bundle.jpg',
            productType: 'BUNDLE',
            bundleItems: [
              { productId: 'p1', productTitle: '苹果', skuId: 'sku-1', skuName: '红富士', quantity: 2 },
            ],
          },
          sku: {
            id: 'bundle-live-sku',
            title: '组合规格',
            product: {
              title: '秋季组合装',
              media: [{ url: 'http://localhost/live-bundle.jpg' }],
            },
          },
        },
      ],
    });
    prisma.buyerAlias.findMany.mockResolvedValue([{ userId: 'buyer-2', alias: '买家002' }]);

    const out = await service.findById('company-1', 'staff-1', 'order-2');

    expect(out.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'item-normal-snapshot',
          title: '烟台苹果',
          skuId: 'snapshot-sku-1',
          skuTitle: '脆甜款',
          productType: 'SIMPLE',
          bundleItems: [],
        }),
        expect.objectContaining({
          id: 'item-normal-live',
          title: '库尔勒香梨',
          skuId: 'live-sku-2',
          skuTitle: '精品果',
          productType: 'SIMPLE',
          bundleItems: [],
        }),
        expect.objectContaining({
          id: 'item-bundle',
          title: '精选水果礼盒',
          productType: 'BUNDLE',
          bundleItems: [
            { productId: 'p1', productTitle: '苹果', skuId: 'sku-1', skuName: '红富士', quantity: 2 },
          ],
        }),
      ]),
    );
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
