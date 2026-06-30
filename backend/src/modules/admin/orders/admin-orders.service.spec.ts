import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdminOrdersService } from './admin-orders.service';

jest.mock('../../../common/security/encryption', () => ({
  decryptJsonValue: jest.fn((v: unknown) => v),
  encryptJsonValue: jest.fn((v: unknown) => v),
}));

describe('AdminOrdersService order detail bundle snapshot mapping', () => {
  let prisma: any;
  let service: AdminOrdersService;

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: jest.fn(),
      },
    };
    service = new AdminOrdersService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('returns productType and bundleItems from order item productSnapshot with defaults', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      totalAmount: 108,
      discountAmount: 0,
      addressSnapshot: {
        recipientName: '张三',
        phone: '13800138000',
        province: '浙江省',
        city: '杭州市',
        district: '西湖区',
        detail: '文一路 1 号',
      },
      user: {
        id: 'buyer-1',
        buyerNo: 'AIMM00000000000001',
        profile: { nickname: '买家A', avatarUrl: null },
        authIdentities: [{ identifier: '13800138000' }],
      },
      items: [
        {
          id: 'item-bundle',
          productSnapshot: {
            title: '精品水果礼盒',
            image: 'http://localhost/bundle.jpg',
            productType: 'BUNDLE',
            bundleItems: [
              { productId: 'p1', productTitle: '苹果', skuId: 'sku-1', skuName: '红富士', quantity: 2 },
              { productId: 'p2', productTitle: '梨', skuId: 'sku-2', skuName: '皇冠梨', quantity: 1 },
            ],
          },
          sku: {
            title: '默认规格',
            product: {
              id: 'product-bundle',
              company: { id: 'company-1', name: '商家A' },
              media: [{ url: 'http://localhost/live-bundle.jpg' }],
            },
          },
        },
        {
          id: 'item-simple',
          productSnapshot: null,
          sku: {
            title: '单品规格',
            product: {
              id: 'product-simple',
              company: { id: 'company-1', name: '商家A' },
              title: '香蕉',
              media: [{ url: 'http://localhost/banana.jpg' }],
            },
          },
        },
      ],
      checkoutSession: { paymentChannel: 'ALIPAY', providerTxnId: 'txn-1' },
      statusHistory: [],
      payments: [],
      refunds: [],
      shipments: [],
    });

    const out = await service.findById('order-1');

    expect(out.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'item-bundle',
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
});

describe('AdminOrdersService.updateReceiverInfo', () => {
  const payload = {
    recipientName: '新收件人',
    phone: '13800000000',
    regionCode: '450481',
    regionText: '广西壮族自治区/梧州市/岑溪市',
    detail: '新地址 2 号',
  };

  const makeService = (orderOverrides: Record<string, unknown> = {}, shipments: Array<{ waybillNo?: string | null }> = []) => {
    const order = {
      id: 'order-admin-receiver',
      status: 'PAID',
      bizType: 'NORMAL_GOODS',
      items: [{ companyId: 'company-1' }],
      addressSnapshot: {
        recipientName: '旧收件人',
        phone: '10086',
        regionCode: '450481',
        regionText: '广西壮族自治区/梧州市/岑溪市',
        detail: '旧地址 1 号',
      },
      ...orderOverrides,
    };
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({ ...order, addressSnapshot: payload }),
      },
      shipment: {
        findMany: jest.fn().mockResolvedValue(shipments),
      },
      $executeRaw: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      $transaction: jest.fn((callback: any) => callback(tx)),
      order: {
        findUnique: jest.fn().mockResolvedValue({
          ...order,
          addressSnapshot: payload,
          user: null,
          items: [],
          checkoutSession: null,
          statusHistory: [],
          payments: [],
          refunds: [],
          shipments: [],
        }),
      },
    };
    const service = new AdminOrdersService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma, tx };
  };

  it.each(['NORMAL_GOODS', 'VIP_PACKAGE', 'GROUP_BUY'])(
    'allows admins to update %s receiver info before waybill generation',
    async (bizType) => {
      const { service, prisma, tx } = makeService({ bizType });

      await (service as any).updateReceiverInfo('order-admin-receiver', payload);

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'order-admin-receiver' },
        data: expect.objectContaining({
          addressSnapshot: expect.objectContaining({
            recipientName: '新收件人',
            phone: '13800000000',
            province: '广西壮族自治区',
            city: '梧州市',
            district: '岑溪市',
            detail: '新地址 2 号',
          }),
        }),
      }));
    },
  );

  it('rejects admin receiver info updates after waybill generation', async () => {
    const { service, tx } = makeService({}, [{ waybillNo: 'SF1234567890' }]);

    await expect(
      (service as any).updateReceiverInfo('order-admin-receiver', payload),
    ).rejects.toThrow(BadRequestException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});
