import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

describe('PaymentController.handleAlipayTransferNotify', () => {
  const buildController = (overrides?: {
    verifyNotify?: jest.Mock;
    withdraw?: any;
    withdrawPayoutService?: any;
  }) => {
    const paymentService = {
      handlePaymentCallback: jest.fn(),
      getByOrderId: jest.fn(),
    };
    const alipayService = {
      verifyNotify: overrides?.verifyNotify ?? jest.fn().mockResolvedValue(true),
    };
    const checkoutService = {
      findByMerchantOrderNo: jest.fn(),
    };
    const prisma = {
      withdrawRequest: {
        findFirst: jest.fn().mockResolvedValue(overrides?.withdraw ?? {
          id: 'w-1',
          status: 'PROCESSING',
        }),
      },
    };
    const withdrawPayoutService = overrides?.withdrawPayoutService ?? {
      finalizeWithdrawalPaid: jest.fn(),
      finalizeWithdrawalFailed: jest.fn(),
    };
    const moduleRef = {
      get: jest.fn().mockReturnValue(withdrawPayoutService),
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    return {
      controller: new (PaymentController as any)(
        paymentService,
        alipayService,
        checkoutService,
        moduleRef,
        prisma,
      ) as PaymentController,
      alipayService,
      prisma,
      moduleRef,
      withdrawPayoutService,
      res,
    };
  };

  it('returns failure when the Alipay signature is invalid', async () => {
    const { controller, alipayService, prisma, res } = buildController({
      verifyNotify: jest.fn().mockResolvedValue(false),
    });

    await (controller as any).handleAlipayTransferNotify({}, res as any);

    expect(alipayService.verifyNotify).toHaveBeenCalledWith({});
    expect(prisma.withdrawRequest.findFirst).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('failure');
  });

  it('routes SUCCESS transfer notify to finalizeWithdrawalPaid', async () => {
    const { controller, prisma, withdrawPayoutService, res } = buildController();
    const body = {
      msg_method: 'alipay.fund.trans.order.changed',
      biz_content: JSON.stringify({
        out_biz_no: 'WD-1',
        status: 'SUCCESS',
        order_id: 'O1',
        pay_fund_order_id: 'F1',
      }),
    };

    await (controller as any).handleAlipayTransferNotify(body, res as any);

    expect(prisma.withdrawRequest.findFirst).toHaveBeenCalledWith({
      where: { outBizNo: 'WD-1' },
    });
    expect(withdrawPayoutService.finalizeWithdrawalPaid).toHaveBeenCalledWith('w-1', {
      providerOrderId: 'O1',
      providerFundOrderId: 'F1',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('success');
  });

  it('routes FAIL transfer notify to finalizeWithdrawalFailed', async () => {
    const { controller, withdrawPayoutService, res } = buildController();
    const body = {
      msg_method: 'alipay.fund.trans.order.changed',
      biz_content: JSON.stringify({
        out_biz_no: 'WD-1',
        status: 'FAIL',
        error_code: 'PAYEE_NOT_EXIST',
        fail_reason: '收款方账户不存在',
      }),
    };

    await (controller as any).handleAlipayTransferNotify(body, res as any);

    expect(withdrawPayoutService.finalizeWithdrawalFailed).toHaveBeenCalledWith('w-1', {
      errorCode: 'PAYEE_NOT_EXIST',
      errorMessage: '收款方账户不存在',
      providerStatus: 'FAIL',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('success');
  });

  it('returns success without finalizing already closed withdrawals', async () => {
    const { controller, withdrawPayoutService, res } = buildController({
      withdraw: { id: 'w-1', status: 'PAID' },
    });

    await (controller as any).handleAlipayTransferNotify({
      msg_method: 'alipay.fund.trans.order.changed',
      biz_content: JSON.stringify({ out_biz_no: 'WD-1', status: 'SUCCESS' }),
    }, res as any);

    expect(withdrawPayoutService.finalizeWithdrawalPaid).not.toHaveBeenCalled();
    expect(withdrawPayoutService.finalizeWithdrawalFailed).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('success');
  });
});

describe('PaymentService.initiateTransfer', () => {
  const buildService = (overrides?: {
    alipayAvailable?: boolean;
    transferResult?: any;
  }) => {
    const alipayService = {
      isAvailable: jest.fn().mockReturnValue(overrides?.alipayAvailable ?? true),
      transferToAccount: jest.fn().mockResolvedValue(overrides?.transferResult ?? {
        success: true,
        processing: false,
        outBizNo: 'WD-1',
        orderId: 'O1',
        payFundOrderId: 'F1',
        providerStatus: 'SUCCESS',
      }),
    };
    const service = new PaymentService(
      {} as any,
      {} as any,
      alipayService as any,
    );
    return { service, alipayService };
  };

  it('delegates ALIPAY transfers to AlipayService and maps the result shape', async () => {
    const { service, alipayService } = buildService();

    const result = await (service as any).initiateTransfer({
      channel: 'ALIPAY',
      amount: 80,
      outBizNo: 'WD-1',
      payeeAccount: 'a@b.com',
      payeeRealName: '张三',
      remark: '提现',
    });

    expect(alipayService.transferToAccount).toHaveBeenCalledWith({
      outBizNo: 'WD-1',
      amount: 80,
      payeeAccount: 'a@b.com',
      payeeRealName: '张三',
      remark: '提现',
    });
    expect(result).toEqual({
      success: true,
      processing: false,
      outBizNo: 'WD-1',
      providerOrderId: 'O1',
      providerFundOrderId: 'F1',
      providerStatus: 'SUCCESS',
      errorCode: undefined,
      errorMessage: undefined,
    });
  });

  it('returns a deterministic failure when Alipay SDK is unavailable', async () => {
    const { service, alipayService } = buildService({ alipayAvailable: false });

    const result = await (service as any).initiateTransfer({
      channel: 'ALIPAY',
      amount: 80,
      outBizNo: 'WD-1',
      payeeAccount: 'a@b.com',
      payeeRealName: '张三',
    });

    expect(alipayService.transferToAccount).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      processing: false,
      outBizNo: 'WD-1',
      errorMessage: '支付宝 SDK 未初始化',
    });
  });
});

describe('PaymentService checkout payment failure callback', () => {
  it('delegates CheckoutSession release to CheckoutService.releaseSessionOnFailure', async () => {
    const merchantOrderNo = 'CS-123';
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback({
        checkoutSession: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        rewardLedger: {
          updateMany: jest.fn(),
        },
      })),
    };
    const checkoutService = {
      findByMerchantOrderNo: jest.fn().mockResolvedValue({
        id: 'cs-1',
        merchantOrderNo,
        bizType: 'NORMAL_GOODS',
        rewardId: null,
        couponInstanceIds: [],
      }),
      releaseSessionOnFailure: jest.fn().mockResolvedValue(undefined),
      releaseVipReservationInTx: jest.fn(),
    };
    const service = new PaymentService(
      prisma as any,
      {} as any,
      {} as any,
      checkoutService as any,
    );

    await service.handlePaymentCallback({
      merchantOrderNo,
      providerTxnId: 'ALI-TX-1',
      status: 'FAILED',
      rawPayload: {},
      skipSignatureVerification: true,
    });

    expect(checkoutService.releaseSessionOnFailure).toHaveBeenCalledWith(merchantOrderNo);
    expect(checkoutService.releaseVipReservationInTx).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
