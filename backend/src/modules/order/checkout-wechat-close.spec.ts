import { BadRequestException } from '@nestjs/common';
import { CheckoutExpireService } from './checkout-expire.service';
import { CheckoutService } from './checkout.service';

function buildCheckoutSession(overrides: Partial<any> = {}) {
  return {
    id: 'S1',
    userId: 'U1',
    status: 'ACTIVE',
    bizType: 'NORMAL_GOODS',
    merchantOrderNo: 'CS-1',
    paymentChannel: 'WECHAT_PAY',
    expectedTotal: 88,
    rewardId: null,
    couponInstanceIds: [],
    itemsSnapshot: [],
    ...overrides,
  };
}

function buildCheckoutServiceForMoneySafety(overrides: Partial<{
  session: any;
  prisma: any;
}> = {}) {
  const session = overrides.session ?? buildCheckoutSession();
  const tx = {
    checkoutSession: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    rewardLedger: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    inventoryLedger: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
    productSKU: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = overrides.prisma ?? {
    checkoutSession: {
      findUnique: jest.fn().mockResolvedValue(session),
    },
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  };
  const svc = new CheckoutService(prisma, {} as any);
  return { svc, prisma, tx, session };
}

function buildCheckoutExpireServiceForMoneySafety(overrides: Partial<{
  prisma: any;
}> = {}) {
  const tx = {
    checkoutSession: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    rewardLedger: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    inventoryLedger: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
    productSKU: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = overrides.prisma ?? {
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  };
  const svc = new CheckoutExpireService(prisma);
  return { svc, prisma, tx };
}

describe('Checkout WECHAT_PAY cancel/expire money safety', () => {
  it('cancelSession queries wechat and builds order when tradeState SUCCESS', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest.fn().mockResolvedValue({
        tradeState: 'SUCCESS',
        transactionId: 'WX-T-1',
        outTradeNo: 'CS-1',
        totalAmountFen: 8800,
        totalAmount: 88,
      }),
      closeOrder: jest.fn(),
    };
    const { svc } = buildCheckoutServiceForMoneySafety();
    svc.setWechatPayService(wechatPay);
    const buildSpy = jest
      .spyOn(svc, 'handlePaymentSuccess')
      .mockResolvedValue({ orderIds: ['O1'] } as any);
    const notifySpy = jest
      .spyOn(svc as any, 'notifyMerchantsAfterCheckoutBuild')
      .mockResolvedValue(undefined);

    await expect(svc.cancelSession('U1', 'S1')).rejects.toThrow(
      '支付已完成，订单已自动创建',
    );

    expect(wechatPay.queryOrder).toHaveBeenCalledWith('CS-1');
    expect(wechatPay.closeOrder).not.toHaveBeenCalled();
    expect(buildSpy).toHaveBeenCalledWith('CS-1', 'WX-T-1', expect.any(String));
    expect(notifySpy).toHaveBeenCalledWith(['O1'], 'cancel-paid-wechat');
  });

  it('cancelSession rejects WECHAT_PAY SUCCESS when provider amount does not match session', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest.fn().mockResolvedValue({
        tradeState: 'SUCCESS',
        transactionId: 'WX-T-amount-mismatch',
        outTradeNo: 'CS-amount-mismatch',
        totalAmountFen: 8799,
        totalAmount: 87.99,
      }),
      closeOrder: jest.fn(),
    };
    const { svc, prisma } = buildCheckoutServiceForMoneySafety({
      session: buildCheckoutSession({
        id: 'S-amount-mismatch',
        merchantOrderNo: 'CS-amount-mismatch',
        expectedTotal: 88,
      }),
    });
    svc.setWechatPayService(wechatPay);
    const buildSpy = jest
      .spyOn(svc, 'handlePaymentSuccess')
      .mockResolvedValue({ orderIds: ['O-bad'] } as any);

    let caught: any;
    try {
      await svc.cancelSession('U1', 'S-amount-mismatch');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).message).toContain('支付金额校验失败');
    expect(buildSpy).not.toHaveBeenCalled();
    expect(wechatPay.closeOrder).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('cancelSession rejects WECHAT_PAY SUCCESS when canonical fen amount is missing', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest.fn().mockResolvedValue({
        tradeState: 'SUCCESS',
        transactionId: 'WX-T-no-fen',
        outTradeNo: 'CS-no-fen',
        totalAmount: 88,
      }),
      closeOrder: jest.fn(),
    };
    const { svc, prisma } = buildCheckoutServiceForMoneySafety({
      session: buildCheckoutSession({
        id: 'S-no-fen',
        merchantOrderNo: 'CS-no-fen',
        expectedTotal: 88,
      }),
    });
    svc.setWechatPayService(wechatPay);
    const buildSpy = jest
      .spyOn(svc, 'handlePaymentSuccess')
      .mockResolvedValue({ orderIds: ['O-no-fen'] } as any);

    await expect(svc.cancelSession('U1', 'S-no-fen')).rejects.toThrow(
      '支付金额校验失败',
    );
    expect(buildSpy).not.toHaveBeenCalled();
    expect(wechatPay.closeOrder).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('cancelSession rejects WECHAT_PAY SUCCESS when transactionId is missing', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest.fn().mockResolvedValue({
        tradeState: 'SUCCESS',
        outTradeNo: 'CS-missing-tx',
        totalAmountFen: 8800,
        totalAmount: 88,
      }),
      closeOrder: jest.fn(),
    };
    const { svc, prisma } = buildCheckoutServiceForMoneySafety({
      session: buildCheckoutSession({
        id: 'S-missing-tx',
        merchantOrderNo: 'CS-missing-tx',
        expectedTotal: 88,
      }),
    });
    svc.setWechatPayService(wechatPay);
    const buildSpy = jest
      .spyOn(svc, 'handlePaymentSuccess')
      .mockResolvedValue({ orderIds: ['O-missing'] } as any);

    await expect(svc.cancelSession('U1', 'S-missing-tx')).rejects.toThrow(
      '正在确认支付状态，请稍后再试',
    );
    expect(buildSpy).not.toHaveBeenCalled();
    expect(wechatPay.closeOrder).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('cancelSession closes wechat order before expiring when NOTPAY', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest.fn().mockResolvedValue({
        tradeState: 'NOTPAY',
        transactionId: '',
        outTradeNo: 'CS-2',
        totalAmountFen: 0,
        totalAmount: 0,
      }),
      closeOrder: jest.fn().mockResolvedValue({
        success: true,
        terminal: false,
        alreadyPaid: false,
        message: '关单成功',
      }),
    };
    const { svc, prisma } = buildCheckoutServiceForMoneySafety({
      session: buildCheckoutSession({
        id: 'S2',
        merchantOrderNo: 'CS-2',
      }),
    });
    svc.setWechatPayService(wechatPay);

    await svc.cancelSession('U1', 'S2');

    expect(wechatPay.queryOrder).toHaveBeenCalledWith('CS-2');
    expect(wechatPay.closeOrder).toHaveBeenCalledWith('CS-2');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('cancelSession tries closeOrder when WECHAT_PAY query returns null and expires on terminal close', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest.fn().mockResolvedValue(null),
      closeOrder: jest.fn().mockResolvedValue({
        success: true,
        terminal: true,
        alreadyPaid: false,
        message: '订单不存在或已关闭',
      }),
    };
    const { svc, prisma } = buildCheckoutServiceForMoneySafety({
      session: buildCheckoutSession({
        id: 'S-query-null',
        merchantOrderNo: 'CS-query-null',
      }),
    });
    svc.setWechatPayService(wechatPay);

    await svc.cancelSession('U1', 'S-query-null');

    expect(wechatPay.queryOrder).toHaveBeenCalledWith('CS-query-null');
    expect(wechatPay.closeOrder).toHaveBeenCalledWith('CS-query-null');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('cancelSession rejects WECHAT_PAY cancel when service is unavailable', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(false),
      queryOrder: jest.fn(),
      closeOrder: jest.fn(),
    };
    const { svc, prisma } = buildCheckoutServiceForMoneySafety({
      session: buildCheckoutSession({
        id: 'S-unavailable',
        merchantOrderNo: 'CS-unavailable',
      }),
    });
    svc.setWechatPayService(wechatPay);

    await expect(svc.cancelSession('U1', 'S-unavailable')).rejects.toThrow(
      '正在确认支付状态，请稍后再试',
    );
    expect(wechatPay.queryOrder).not.toHaveBeenCalled();
    expect(wechatPay.closeOrder).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('expireSession skips local expiry when wechat close reports alreadyPaid and second query succeeds', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest
        .fn()
        .mockResolvedValueOnce({
          tradeState: 'NOTPAY',
          outTradeNo: 'CS-3',
          transactionId: '',
          totalAmountFen: 0,
          totalAmount: 0,
        })
        .mockResolvedValueOnce({
          tradeState: 'SUCCESS',
          outTradeNo: 'CS-3',
          transactionId: 'WX-T-3',
          totalAmountFen: 8800,
          totalAmount: 88,
        }),
      closeOrder: jest.fn().mockResolvedValue({
        success: false,
        terminal: false,
        alreadyPaid: true,
        message: '订单已支付',
      }),
    };
    const { svc, prisma } = buildCheckoutExpireServiceForMoneySafety();
    (svc as any).setWechatPayService(wechatPay);
    const buildSpy = jest.fn().mockResolvedValue({ orderIds: ['O3'] });
    svc.setCheckoutService({ handlePaymentSuccess: buildSpy });
    const notifySpy = jest
      .spyOn(svc as any, 'notifyMerchantsAfterCheckoutBuild')
      .mockResolvedValue(undefined);

    await (svc as any).expireSession(buildCheckoutSession({
      id: 'S3',
      merchantOrderNo: 'CS-3',
      expectedTotal: 88,
    }));

    expect(wechatPay.closeOrder).toHaveBeenCalledWith('CS-3');
    expect(wechatPay.queryOrder).toHaveBeenCalledTimes(2);
    expect(buildSpy).toHaveBeenCalledWith('CS-3', 'WX-T-3', expect.any(String));
    expect(notifySpy).toHaveBeenCalledWith(['O3'], 'expire-close-paid-wechat');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('expireSession skips local expiry when WECHAT_PAY SUCCESS is missing transactionId', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest.fn().mockResolvedValue({
        tradeState: 'SUCCESS',
        outTradeNo: 'CS-exp-missing-tx',
        totalAmountFen: 8800,
      }),
      closeOrder: jest.fn(),
    };
    const { svc, prisma } = buildCheckoutExpireServiceForMoneySafety();
    (svc as any).setWechatPayService(wechatPay);
    const buildSpy = jest.fn().mockResolvedValue({ orderIds: ['O-exp-missing'] });
    svc.setCheckoutService({ handlePaymentSuccess: buildSpy });

    await (svc as any).expireSession(buildCheckoutSession({
      id: 'S-exp-missing-tx',
      merchantOrderNo: 'CS-exp-missing-tx',
      expectedTotal: 88,
    }));

    expect(buildSpy).not.toHaveBeenCalled();
    expect(wechatPay.closeOrder).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('expireSession skips local expiry when WECHAT_PAY SUCCESS amount mismatches', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest.fn().mockResolvedValue({
        tradeState: 'SUCCESS',
        transactionId: 'WX-exp-bad-amount',
        outTradeNo: 'CS-exp-bad-amount',
        totalAmountFen: 8799,
      }),
      closeOrder: jest.fn(),
    };
    const { svc, prisma } = buildCheckoutExpireServiceForMoneySafety();
    (svc as any).setWechatPayService(wechatPay);
    const buildSpy = jest.fn().mockResolvedValue({ orderIds: ['O-exp-bad'] });
    svc.setCheckoutService({ handlePaymentSuccess: buildSpy });

    await (svc as any).expireSession(buildCheckoutSession({
      id: 'S-exp-bad-amount',
      merchantOrderNo: 'CS-exp-bad-amount',
      expectedTotal: 88,
    }));

    expect(buildSpy).not.toHaveBeenCalled();
    expect(wechatPay.closeOrder).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('expireSession tries closeOrder when WECHAT_PAY query returns null and expires on terminal close', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest.fn().mockResolvedValue(null),
      closeOrder: jest.fn().mockResolvedValue({
        success: true,
        terminal: true,
        alreadyPaid: false,
        message: '订单不存在或已关闭',
      }),
    };
    const { svc, prisma } = buildCheckoutExpireServiceForMoneySafety();
    (svc as any).setWechatPayService(wechatPay);
    svc.setCheckoutService({ handlePaymentSuccess: jest.fn() });

    await (svc as any).expireSession(buildCheckoutSession({
      id: 'S-exp-query-null',
      merchantOrderNo: 'CS-exp-query-null',
      expectedTotal: 88,
    }));

    expect(wechatPay.queryOrder).toHaveBeenCalledWith('CS-exp-query-null');
    expect(wechatPay.closeOrder).toHaveBeenCalledWith('CS-exp-query-null');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('expireSession skips local expiry when WECHAT_PAY close fails non-terminally', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest.fn().mockResolvedValue({
        tradeState: 'NOTPAY',
        outTradeNo: 'CS-exp-close-fail',
        totalAmountFen: 0,
      }),
      closeOrder: jest.fn().mockResolvedValue({
        success: false,
        terminal: false,
        alreadyPaid: false,
        message: '微信关单失败',
      }),
    };
    const { svc, prisma } = buildCheckoutExpireServiceForMoneySafety();
    (svc as any).setWechatPayService(wechatPay);
    svc.setCheckoutService({ handlePaymentSuccess: jest.fn() });

    await (svc as any).expireSession(buildCheckoutSession({
      id: 'S-exp-close-fail',
      merchantOrderNo: 'CS-exp-close-fail',
      expectedTotal: 88,
    }));

    expect(wechatPay.closeOrder).toHaveBeenCalledWith('CS-exp-close-fail');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('expireSession skips local expiry when WECHAT_PAY service is unavailable', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(false),
      queryOrder: jest.fn(),
      closeOrder: jest.fn(),
    };
    const { svc, prisma } = buildCheckoutExpireServiceForMoneySafety();
    (svc as any).setWechatPayService(wechatPay);
    svc.setCheckoutService({ handlePaymentSuccess: jest.fn() });

    await (svc as any).expireSession(buildCheckoutSession({
      id: 'S-exp-unavailable',
      merchantOrderNo: 'CS-exp-unavailable',
      expectedTotal: 88,
    }));

    expect(wechatPay.queryOrder).not.toHaveBeenCalled();
    expect(wechatPay.closeOrder).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
