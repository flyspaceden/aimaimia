import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrderService } from './order.service';

jest.mock('../../common/security/encryption', () => ({
  decryptJsonValue: jest.fn((v: unknown) => v),
  encryptJsonValue: jest.fn((v: unknown) => v),
}));

jest.mock('../../common/security/privacy-mask', () => ({
  maskAddressSnapshot: jest.fn((v: any) => v),
  maskTrackingNo: jest.fn((v: string) => v),
}));

describe('OrderService receiver info correction', () => {
  const baseOrder = {
    id: 'o-receiver-1',
    userId: 'buyer-1',
    status: 'PAID',
    bizType: 'NORMAL_GOODS',
    totalAmount: 399.1,
    goodsAmount: 399.1,
    shippingFee: 0,
    discountAmount: 0,
    vipDiscountAmount: 0,
    totalCouponDiscount: 0,
    addressSnapshot: {
      recipientName: '旧收件人',
      phone: '10086',
      regionCode: '450481',
      regionText: '广西壮族自治区/梧州市/岑溪市',
      province: '广西壮族自治区',
      city: '梧州市',
      district: '岑溪市',
      detail: '旧地址 1 号',
    },
    createdAt: new Date('2026-06-27T00:00:00.000Z'),
    paidAt: new Date('2026-06-27T00:01:00.000Z'),
    deliveredAt: null,
    autoReceiveAt: null,
    buyerNote: null,
    items: [],
    shipments: [],
    statusHistory: [],
    payments: [],
    refunds: [],
    afterSaleRequests: [],
    invoice: null,
  };

  const payload = {
    recipientName: '张三',
    phone: '13800000000',
    regionCode: '450481',
    regionText: '广西壮族自治区/梧州市/岑溪市',
    detail: '新地址 2 号',
  };

  function makeService(overrides?: {
    order?: any;
    shipments?: any[];
  }) {
    const order = { ...baseOrder, ...(overrides?.order ?? {}) };
    const shipments = overrides?.shipments ?? [];
    const tx: any = {
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({
          ...order,
          addressSnapshot: {
            ...payload,
            province: '广西壮族自治区',
            city: '梧州市',
            district: '岑溪市',
          },
        }),
      },
      shipment: {
        findMany: jest.fn().mockResolvedValue(shipments),
      },
    };
    const prisma: any = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          ...order,
          addressSnapshot: {
            ...payload,
            province: '广西壮族自治区',
            city: '梧州市',
            district: '岑溪市',
          },
          shipments,
        }),
      },
      company: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const service = new OrderService(
      prisma as any,
      { allocateForOrder: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      { buildInventoryMovements: jest.fn() } as any,
    );
    return { service, prisma, tx };
  }

  it('updates the current order address snapshot before waybill generation', async () => {
    const { service, prisma, tx } = makeService();

    const result = await (service as any).updateReceiverInfo('o-receiver-1', 'buyer-1', payload);

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'o-receiver-1' },
      data: expect.objectContaining({
        addressSnapshot: expect.objectContaining({
          recipientName: '张三',
          phone: '13800000000',
          province: '广西壮族自治区',
          city: '梧州市',
          district: '岑溪市',
          detail: '新地址 2 号',
        }),
      }),
    }));
    expect(result.addressSnapshot.phone).toBe('13800000000');
    expect(result.receiverInfoEditable).toBe(true);
  });

  it('rejects invalid receiver phone before mutating the order', async () => {
    const { service, tx } = makeService();

    await expect(
      (service as any).updateReceiverInfo('o-receiver-1', 'buyer-1', {
        ...payload,
        phone: '10086',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('rejects orders that already have a generated waybill', async () => {
    const { service, tx } = makeService({
      shipments: [{ id: 'ship-1', waybillNo: 'SF1234567890' }],
    });

    await expect(
      (service as any).updateReceiverInfo('o-receiver-1', 'buyer-1', payload),
    ).rejects.toThrow(BadRequestException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('hides orders owned by another buyer', async () => {
    const { service, tx } = makeService();

    await expect(
      (service as any).updateReceiverInfo('o-receiver-1', 'buyer-2', payload),
    ).rejects.toThrow(NotFoundException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});
