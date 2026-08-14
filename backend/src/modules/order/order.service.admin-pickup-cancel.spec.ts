import { BadRequestException } from '@nestjs/common';
import { OrderService } from './order.service';

describe('OrderService admin pickup cancel and refund', () => {
  const makeService = () => {
    const prisma = {
      order: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      refund: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r1', orderId: 'o1', status: 'REFUNDING', providerRefundId: null, updatedAt: new Date() },
        ]),
      },
    };
    const service = new OrderService(
      prisma as any,
      { rollbackForOrder: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      { buildInventoryMovements: jest.fn() } as any,
    );
    return { service, prisma };
  };

  const normalPickupOrder = (overrides: Record<string, unknown> = {}) => ({
    id: 'o1',
    userId: 'u1',
    status: 'PAID',
    bizType: 'NORMAL_GOODS',
    fulfillmentMode: 'PICKUP',
    checkoutSessionId: null,
    items: [{ companyId: 'c1' }],
    pickupFulfillment: { status: 'PREPARING' },
    ...overrides,
  });

  it('单笔 PREPARING 普通商品复用原未发货退款主链', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue(normalPickupOrder());
    const cancelPaid = jest
      .spyOn(service as any, 'cancelPaidUnshipped')
      .mockResolvedValue({ id: 'o1', status: 'CANCELED' });

    const result = await service.adminCancelPickupAndRefund('o1', 'admin1', '门店临时关闭');

    expect(cancelPaid).toHaveBeenCalledWith(
      'o1',
      'u1',
      expect.objectContaining({ id: 'o1' }),
      expect.objectContaining({
        actorType: 'ADMIN',
        actorId: 'admin1',
        allowReadyPickup: true,
        reason: '平台取消自提订单：门店临时关闭',
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      orderId: 'o1',
      affectedOrderIds: ['o1'],
      alreadyCanceled: false,
      refunds: [{ id: 'r1', orderId: 'o1', status: 'REFUNDING' }],
    });
  });

  it('READY 普通商品允许平台受控作废并退款', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue(normalPickupOrder({
      pickupFulfillment: { status: 'READY' },
    }));
    const cancelPaid = jest
      .spyOn(service as any, 'cancelPaidUnshipped')
      .mockResolvedValue({ id: 'o1', status: 'CANCELED' });

    await expect(
      service.adminCancelPickupAndRefund('o1', 'admin1', '质量风险'),
    ).resolves.toMatchObject({ ok: true, alreadyCanceled: false });
    expect(cancelPaid).toHaveBeenCalledTimes(1);
    expect(cancelPaid.mock.calls[0][3]).toMatchObject({ allowReadyPickup: true });
  });

  it('同 checkout session 多子单必须整会话取消', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue(normalPickupOrder({ checkoutSessionId: 'cs1' }));
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'o2',
        status: 'PAID',
        bizType: 'NORMAL_GOODS',
        fulfillmentMode: 'PICKUP',
        pickupFulfillment: { status: 'READY' },
      },
    ]);
    prisma.refund.findMany.mockResolvedValue([
      { id: 'r1', orderId: 'o1', status: 'REFUNDED', providerRefundId: 'pr1', updatedAt: new Date() },
      { id: 'r2', orderId: 'o2', status: 'REFUNDING', providerRefundId: 'pr2', updatedAt: new Date() },
    ]);
    const cancelSession = jest
      .spyOn(service as any, 'cancelEntireSessionUnshipped')
      .mockResolvedValue({ id: 'o1', status: 'CANCELED' });

    const result = await service.adminCancelPickupAndRefund('o1', 'admin1', '商家无法履约');

    expect(cancelSession).toHaveBeenCalledWith(
      'cs1',
      'u1',
      expect.objectContaining({ actorType: 'ADMIN', allowReadyPickup: true }),
    );
    expect(result.affectedOrderIds).toEqual(['o1', 'o2']);
    expect(result.refunds).toEqual(expect.arrayContaining([
      expect.objectContaining({ orderId: 'o1', status: 'REFUNDED' }),
      expect.objectContaining({ orderId: 'o2', status: 'REFUNDING' }),
    ]));
  });

  it('重复请求已取消订单只返回现有退款，不再创建退款', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue(normalPickupOrder({ status: 'CANCELED' }));
    prisma.refund.findMany.mockResolvedValue([
      { id: 'r1', orderId: 'o1', status: 'REFUNDING', providerRefundId: null, updatedAt: new Date() },
    ]);
    const cancelPaid = jest.spyOn(service as any, 'cancelPaidUnshipped');

    const result = await service.adminCancelPickupAndRefund('o1', 'admin1', '重复提交');

    expect(result).toEqual({
      ok: true,
      orderId: 'o1',
      affectedOrderIds: ['o1'],
      alreadyCanceled: true,
      refund: expect.objectContaining({ id: 'r1', orderId: 'o1', status: 'REFUNDING' }),
      refunds: [expect.objectContaining({ id: 'r1', orderId: 'o1', status: 'REFUNDING' })],
    });
    expect(cancelPaid).not.toHaveBeenCalled();
  });

  it('重复请求发现同会话子单缺退款记录时拒绝静默报成功', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue(normalPickupOrder({
      status: 'CANCELED',
      checkoutSessionId: 'cs1',
    }));
    prisma.order.findMany.mockResolvedValue([{
      id: 'o2',
      status: 'CANCELED',
      bizType: 'NORMAL_GOODS',
      fulfillmentMode: 'PICKUP',
      pickupFulfillment: { status: 'CANCELED' },
    }]);
    prisma.refund.findMany.mockResolvedValue([
      { id: 'r1', orderId: 'o1', status: 'REFUNDING', providerRefundId: null, updatedAt: new Date() },
    ]);

    await expect(
      service.adminCancelPickupAndRefund('o1', 'admin1', '重复提交'),
    ).rejects.toThrow('逐单退款记录不完整');
  });

  it.each(['PICKED_UP', 'VOID', 'CANCELED'])('%s 履约禁止快捷取消退款', async (status) => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue(normalPickupOrder({
      pickupFulfillment: { status },
    }));

    await expect(
      service.adminCancelPickupAndRefund('o1', 'admin1', '异常处理'),
    ).rejects.toThrow('仅备货中或待自提');
  });

  it.each([
    ['GROUP_BUY', '团购'],
    ['VIP_PACKAGE', 'VIP'],
  ])('%s 自提订单明确拒绝通用取消，不回滚专项权益', async (bizType, message) => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue(normalPickupOrder({ bizType }));

    await expect(
      service.adminCancelPickupAndRefund('o1', 'admin1', '无法履约'),
    ).rejects.toThrow(new RegExp(message));
    await expect(
      service.adminCancelPickupAndRefund('o1', 'admin1', '无法履约'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
