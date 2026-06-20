import { NotFoundException } from '@nestjs/common';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryCustomerServiceService } from './delivery-customer-service.service';

describe('DeliveryCustomerServiceService', () => {
  let deliveryPrisma: any;
  let service: DeliveryCustomerServiceService;

  beforeEach(() => {
    deliveryPrisma = {
      deliveryCustomerServiceConversation: {
        findMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      deliverySubOrder: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      deliveryOrder: {
        findUnique: jest.fn(),
      },
    };

    service = new DeliveryCustomerServiceService(deliveryPrisma as DeliveryPrismaService);
  });

  it('reads seller conversations from delivery customer service tables only', async () => {
    deliveryPrisma.deliveryCustomerServiceConversation.findMany.mockResolvedValue([
      {
        id: 'conv_1',
        merchantId: 'merchant_1',
        status: 'OPEN',
        subject: '催配送',
      },
    ]);

    const result = await service.listSellerConversations('merchant_1', {});

    expect(deliveryPrisma.deliveryCustomerServiceConversation.findMany).toHaveBeenCalledWith({
      where: {
        merchantId: 'merchant_1',
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      take: 20,
      skip: 0,
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            nickname: true,
          },
        },
        unit: {
          select: {
            id: true,
            name: true,
          },
        },
        order: {
          select: {
            id: true,
            status: true,
          },
        },
        subOrder: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });
    expect(result).toEqual([
      {
        id: 'conv_1',
        merchantId: 'merchant_1',
        status: 'OPEN',
        subject: '催配送',
      },
    ]);
  });

  it('reads buyer conversations scoped to the authenticated delivery user only', async () => {
    deliveryPrisma.deliveryCustomerServiceConversation.findMany.mockResolvedValue([
      {
        id: 'conv_1',
        userId: 'delivery_user_1',
        status: 'OPEN',
        subject: '商品问题',
      },
    ]);

    const result = await (service as any).listBuyerConversations('delivery_user_1', {});

    expect(deliveryPrisma.deliveryCustomerServiceConversation.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'delivery_user_1',
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      take: 20,
      skip: 0,
      include: expect.any(Object),
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: 'conv_1',
        userId: 'delivery_user_1',
      }),
    ]);
  });

  it('lets a buyer create an app conversation for their own delivery suborder', async () => {
    deliveryPrisma.deliverySubOrder.findUnique.mockResolvedValue({
      id: 'sub_1',
      merchantId: 'merchant_1',
      orderId: 'order_1',
      order: {
        userId: 'delivery_user_1',
        unitId: 'unit_1',
      },
    });
    deliveryPrisma.deliveryCustomerServiceConversation.create.mockResolvedValue({
      id: 'conv_1',
      source: 'APP',
      userId: 'delivery_user_1',
      unitId: 'unit_1',
      merchantId: 'merchant_1',
      subOrderId: 'sub_1',
      lastMessagePreview: '商品有破损',
    });

    const result = await (service as any).createBuyerConversation('delivery_user_1', {
      subOrderId: 'sub_1',
      subject: '商品问题',
      message: '商品有破损',
    });

    expect(deliveryPrisma.deliveryCustomerServiceConversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'APP',
        status: 'OPEN',
        userId: 'delivery_user_1',
        unitId: 'unit_1',
        merchantId: 'merchant_1',
        orderId: 'order_1',
        subOrderId: 'sub_1',
        subject: '商品问题',
        lastMessagePreview: '商品有破损',
      }),
    });
    expect(result).toEqual(expect.objectContaining({ id: 'conv_1', source: 'APP' }));
  });

  it('rejects buyer conversation creation for another buyer suborder', async () => {
    deliveryPrisma.deliverySubOrder.findUnique.mockResolvedValue({
      id: 'sub_2',
      merchantId: 'merchant_1',
      orderId: 'order_2',
      order: {
        userId: 'other_delivery_user',
        unitId: 'unit_2',
      },
    });

    await expect(
      (service as any).createBuyerConversation('delivery_user_1', {
        subOrderId: 'sub_2',
        message: '商品有破损',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(deliveryPrisma.deliveryCustomerServiceConversation.create).not.toHaveBeenCalled();
  });

  it('writes seller replies into delivery customer service conversations only', async () => {
    deliveryPrisma.deliverySubOrder.findUnique.mockResolvedValue({
      id: 'sub_1',
      merchantId: 'merchant_1',
      orderId: 'order_1',
      order: {
        userId: 'user_1',
        unitId: 'unit_1',
      },
    });
    deliveryPrisma.deliveryCustomerServiceConversation.create.mockResolvedValue({
      id: 'conv_1',
      merchantId: 'merchant_1',
      assignedStaffId: 'staff_1',
      source: 'SELLER',
      status: 'OPEN',
      lastMessagePreview: '今天内发货',
      subject: '配送进度',
    });

    const result = await service.createSellerConversation('merchant_1', 'staff_1', {
      subOrderId: 'sub_1',
      subject: '配送进度',
      message: '今天内发货',
    });

    expect(deliveryPrisma.deliveryCustomerServiceConversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: 'merchant_1',
        assignedStaffId: 'staff_1',
        orderId: 'order_1',
        subOrderId: 'sub_1',
        userId: 'user_1',
        unitId: 'unit_1',
        source: 'SELLER',
        status: 'OPEN',
        lastMessagePreview: '今天内发货',
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'conv_1',
        source: 'SELLER',
      }),
    );
  });

  it('rejects seller orderId conversation creation when the order does not belong to the current merchant', async () => {
    deliveryPrisma.deliverySubOrder.findFirst.mockResolvedValue(null);

    await expect(
      service.createSellerConversation('merchant_1', 'staff_1', {
        orderId: 'order_2',
        message: '请尽快处理',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(deliveryPrisma.deliverySubOrder.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: 'order_2',
        merchantId: 'merchant_1',
      },
      select: {
        orderId: true,
        order: {
          select: {
            userId: true,
            unitId: true,
          },
        },
      },
    });
    expect(deliveryPrisma.deliveryOrder.findUnique).not.toHaveBeenCalled();
    expect(deliveryPrisma.deliveryCustomerServiceConversation.create).not.toHaveBeenCalled();
  });

  it('updates a seller conversation inside delivery customer service tables only', async () => {
    deliveryPrisma.deliveryCustomerServiceConversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      merchantId: 'merchant_1',
      assignedStaffId: 'staff_1',
      status: 'OPEN',
      subject: '配送进度',
      lastMessagePreview: '今天内发货',
    });
    deliveryPrisma.deliveryCustomerServiceConversation.update.mockResolvedValue({
      id: 'conv_1',
      merchantId: 'merchant_1',
      assignedStaffId: 'staff_1',
      status: 'CLOSED',
      subject: '配送进度',
      lastMessagePreview: '已签收，关闭会话',
    });

    const result = await service.updateSellerConversation('merchant_1', 'staff_1', 'conv_1', {
      status: 'CLOSED',
      message: '已签收，关闭会话',
    });

    expect(deliveryPrisma.deliveryCustomerServiceConversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: expect.objectContaining({
        assignedStaffId: 'staff_1',
        source: 'SELLER',
        status: 'CLOSED',
        lastMessagePreview: '已签收，关闭会话',
      }),
    });
    expect(result.status).toBe('CLOSED');
  });

  it('throws when a seller tries to update another merchant conversation', async () => {
    deliveryPrisma.deliveryCustomerServiceConversation.findFirst.mockResolvedValue(null);

    await expect(
      service.updateSellerConversation('merchant_1', 'staff_1', 'missing', {
        status: 'CLOSED',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
