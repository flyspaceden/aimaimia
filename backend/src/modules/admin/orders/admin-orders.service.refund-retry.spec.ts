import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdminOrdersService } from './admin-orders.service';

describe('AdminOrdersService.retryRefund', () => {
  const makeService = () => {
    const prisma = {
      refund: {
        findUnique: jest.fn(),
      },
      refundStatusHistory: {
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const paymentService = {
      initiateRefund: jest.fn(),
      finalizeAutoRefundRecord: jest.fn(),
      finalizeSuccessfulRefundRecord: jest.fn(),
    };
    const service = new (AdminOrdersService as any)(
      prisma,
      {},
      {},
      {},
      paymentService,
    );
    return { service, prisma, paymentService };
  };

  it('30 秒内重复手动重试时节流且不调用退款通道', async () => {
    const { service, prisma, paymentService } = makeService();
    prisma.refund.findUnique.mockResolvedValue({
      id: 'r1',
      orderId: 'o1',
      amount: 65,
      status: 'REFUNDING',
      merchantRefundNo: 'MANUAL-REFUND-o1',
      providerRefundId: null,
    });
    const leaseTx = {
      $executeRaw: jest.fn(),
      refund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'r1',
          orderId: 'o1',
          status: 'REFUNDING',
        }),
      },
      refundStatusHistory: {
        findFirst: jest.fn().mockResolvedValue({ createdAt: new Date() }),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: any) => callback(leaseTx));

    await expect((service as any).retryRefund('o1', 'r1', 'admin1')).rejects.toThrow(BadRequestException);
    expect(paymentService.initiateRefund).not.toHaveBeenCalled();
    expect(leaseTx.refundStatusHistory.create).not.toHaveBeenCalled();
  });

  it('手动重试调用退款通道异常时写审计并抛 BadRequestException', async () => {
    const { service, prisma, paymentService } = makeService();
    prisma.refund.findUnique.mockResolvedValue({
      id: 'r1',
      orderId: 'o1',
      amount: 65,
      status: 'FAILED',
      merchantRefundNo: 'MANUAL-REFUND-o1',
      providerRefundId: null,
    });
    paymentService.initiateRefund.mockRejectedValue(new Error('alipay timeout'));
    const leaseTx = {
      $executeRaw: jest.fn(),
      refund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'r1',
          orderId: 'o1',
          status: 'FAILED',
        }),
      },
      refundStatusHistory: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: any) => callback(leaseTx));

    await expect((service as any).retryRefund('o1', 'r1', 'admin1')).rejects.toThrow(BadRequestException);
    expect(prisma.refundStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        refundId: 'r1',
        fromStatus: 'FAILED',
        toStatus: 'FAILED',
        remark: expect.stringContaining('alipay timeout'),
        operatorId: 'admin1',
      }),
    }));
  });

  it('手动重试 pending 状态 CAS 写回 count=0 时记审计并跳过覆盖', async () => {
    const { service, prisma, paymentService } = makeService();
    prisma.refund.findUnique.mockResolvedValue({
      id: 'r1',
      orderId: 'o1',
      amount: 65,
      status: 'FAILED',
      merchantRefundNo: 'MANUAL-REFUND-o1',
      providerRefundId: null,
    });
    paymentService.initiateRefund.mockResolvedValue({
      success: true,
      pending: true,
      providerRefundId: 'PROVIDER-REF-1',
    });
    const leaseTx = {
      $executeRaw: jest.fn(),
      refund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'r1',
          orderId: 'o1',
          status: 'FAILED',
        }),
      },
      refundStatusHistory: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const writeBackTx = {
      refund: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      refundStatusHistory: {
        create: jest.fn(),
      },
    };
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) => callback(leaseTx))
      .mockImplementationOnce(async (callback: any) => callback(writeBackTx));

    await expect((service as any).retryRefund('o1', 'r1', 'admin1')).resolves.toEqual({
      ok: true,
      message: '退款已受理，等待渠道确认',
    });
    expect(writeBackTx.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1', status: 'FAILED' },
    }));
    expect(writeBackTx.refundStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        refundId: 'r1',
        fromStatus: 'FAILED',
        toStatus: 'FAILED',
        remark: expect.stringContaining('状态已被并发更新'),
        operatorId: 'admin1',
      }),
    }));
  });

  it('手动重试微信退款 pending 时保持 REFUNDING 并保存 providerRefundId', async () => {
    const { service, prisma, paymentService } = makeService();
    prisma.refund.findUnique.mockResolvedValue({
      id: 'r1',
      orderId: 'o1',
      amount: 65,
      status: 'REFUNDING',
      merchantRefundNo: 'WX-REFUND-o1',
      providerRefundId: null,
    });
    paymentService.initiateRefund.mockResolvedValue({
      success: true,
      pending: true,
      providerRefundId: 'WX-PENDING-REF-1',
      message: 'PROCESSING',
    });
    const leaseTx = {
      $executeRaw: jest.fn(),
      refund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'r1',
          orderId: 'o1',
          status: 'REFUNDING',
        }),
      },
      refundStatusHistory: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const writeBackTx = {
      refund: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refundStatusHistory: {
        create: jest.fn(),
      },
    };
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) => callback(leaseTx))
      .mockImplementationOnce(async (callback: any) => callback(writeBackTx));

    await expect((service as any).retryRefund('o1', 'r1', 'admin1')).resolves.toEqual({
      ok: true,
      message: '退款已受理，等待渠道确认',
    });
    expect(writeBackTx.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1', status: 'REFUNDING' },
      data: {
        status: 'REFUNDING',
        providerRefundId: 'WX-PENDING-REF-1',
      },
    }));
    expect(writeBackTx.refund.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
    expect(writeBackTx.refundStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        refundId: 'r1',
        fromStatus: 'REFUNDING',
        toStatus: 'REFUNDING',
        remark: expect.stringContaining('等待渠道确认'),
        operatorId: 'admin1',
      }),
    }));
  });

  it('手动重试 AUTO-CANCEL 同步成功时复用 PaymentService finalizer 恢复红包和抵扣', async () => {
    const { service, prisma, paymentService } = makeService();
    prisma.refund.findUnique.mockResolvedValue({
      id: 'r1',
      orderId: 'o1',
      amount: 65,
      status: 'FAILED',
      merchantRefundNo: 'AUTO-CANCEL-o1',
      providerRefundId: null,
    });
    paymentService.initiateRefund.mockResolvedValue({
      success: true,
      providerRefundId: 'PROVIDER-REF-1',
      message: 'OK',
    });
    paymentService.finalizeSuccessfulRefundRecord.mockResolvedValue(true);
    const leaseTx = {
      $executeRaw: jest.fn(),
      refund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'r1',
          orderId: 'o1',
          status: 'FAILED',
        }),
      },
      refundStatusHistory: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: any) => callback(leaseTx));

    await expect((service as any).retryRefund('o1', 'r1', 'admin1')).resolves.toEqual({
      ok: true,
      message: 'OK',
    });
    expect(paymentService.finalizeSuccessfulRefundRecord).toHaveBeenCalledWith({
      refundId: 'r1',
      fromStatuses: ['FAILED'],
      providerRefundId: 'PROVIDER-REF-1',
      remark: '管理员手动重试成功',
      operatorId: 'admin1',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('手动重试 AS 退款同步成功时也复用统一成功 finalizer', async () => {
    const { service, prisma, paymentService } = makeService();
    prisma.refund.findUnique.mockResolvedValue({
      id: 'r-as-1', orderId: 'o1', amount: 65, status: 'FAILED',
      merchantRefundNo: 'AS-after-sale-1', providerRefundId: null,
    });
    paymentService.initiateRefund.mockResolvedValue({
      success: true, providerRefundId: 'PROVIDER-AS-1', message: 'OK',
    });
    paymentService.finalizeSuccessfulRefundRecord.mockResolvedValue(true);
    const leaseTx = {
      $executeRaw: jest.fn(),
      refund: { findUnique: jest.fn().mockResolvedValue({ id: 'r-as-1', orderId: 'o1', status: 'FAILED' }) },
      refundStatusHistory: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: any) => callback(leaseTx));

    await expect((service as any).retryRefund('o1', 'r-as-1', 'admin1')).resolves.toEqual({
      ok: true,
      message: 'OK',
    });
    expect(paymentService.finalizeSuccessfulRefundRecord).toHaveBeenCalledWith({
      refundId: 'r-as-1',
      fromStatuses: ['FAILED'],
      providerRefundId: 'PROVIDER-AS-1',
      remark: '管理员手动重试成功',
      operatorId: 'admin1',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('手动重试 pending 写回遇到 providerRefundId P2002 时另开事务写审计并抛 ConflictException', async () => {
    const { service, prisma, paymentService } = makeService();
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`providerRefundId`)',
      {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['providerRefundId'] },
      },
    );
    prisma.refund.findUnique.mockResolvedValue({
      id: 'r1',
      orderId: 'o1',
      amount: 65,
      status: 'FAILED',
      merchantRefundNo: 'MANUAL-REFUND-o1',
      providerRefundId: null,
    });
    paymentService.initiateRefund.mockResolvedValue({
      success: true,
      pending: true,
      providerRefundId: 'PROVIDER-REF-1',
    });

    const leaseTx = {
      $executeRaw: jest.fn(),
      refund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'r1',
          orderId: 'o1',
          status: 'FAILED',
        }),
      },
      refundStatusHistory: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const auditTx = {
      refundStatusHistory: { create: jest.fn() },
    };
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) => callback(leaseTx))
      .mockRejectedValueOnce(p2002)
      .mockImplementationOnce(async (callback: any) => callback(auditTx));

    await expect((service as any).retryRefund('o1', 'r1', 'admin1')).rejects.toThrow(ConflictException);
    expect(auditTx.refundStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        refundId: 'r1',
        fromStatus: 'FAILED',
        toStatus: 'FAILED',
        remark: expect.stringContaining('providerRefundId P2002 冲突'),
        operatorId: 'admin1',
      }),
    }));
  });
});
