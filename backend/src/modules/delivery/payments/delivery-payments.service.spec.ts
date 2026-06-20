import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import {
  DeliveryOrdersService,
  DeliveryProviderTxnConflictException,
} from '../orders/delivery-orders.service';
import { DeliveryPaymentsService } from './delivery-payments.service';

describe('DeliveryPaymentsService', () => {
  let tx: any;
  let deliveryPrisma: any;
  let deliveryOrdersService: { createOrderFromPaidCheckout: jest.Mock };
  let service: DeliveryPaymentsService;

  beforeEach(() => {
    tx = {
      deliveryCheckoutSession: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      deliveryPayment: {
        upsert: jest.fn(),
      },
    };

    deliveryPrisma = {
      deliveryCheckoutSession: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    deliveryOrdersService = {
      createOrderFromPaidCheckout: jest.fn(),
    };

    service = new DeliveryPaymentsService(
      deliveryPrisma as DeliveryPrismaService,
      deliveryOrdersService as unknown as DeliveryOrdersService,
    );
  });

  it('verifies Alipay delivery checkout amount in yuan against stored cents total', async () => {
    deliveryPrisma.deliveryCheckoutSession.findUnique.mockResolvedValue({
      merchantOrderNo: 'PSZF0000000000001',
      totalAmountCents: 4900,
      paymentChannel: 'ALIPAY',
    });

    await expect(
      service.assertAlipayAmountMatchesCheckout('PSZF0000000000001', '49.00'),
    ).resolves.toBeUndefined();

    await expect(
      service.assertAlipayAmountMatchesCheckout('PSZF0000000000001', '48.99'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('verifies WeChat delivery checkout amount in fen against stored cents total', async () => {
    deliveryPrisma.deliveryCheckoutSession.findUnique.mockResolvedValue({
      merchantOrderNo: 'PSZF0000000000001',
      totalAmountCents: 4900,
      paymentChannel: 'WECHAT_PAY',
    });

    await expect(
      service.assertWechatAmountMatchesCheckout('PSZF0000000000001', 4900),
    ).resolves.toBeUndefined();

    await expect(
      service.assertWechatAmountMatchesCheckout('PSZF0000000000001', 4899),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects Alipay delivery callback when checkout expects WeChat Pay', async () => {
    deliveryPrisma.deliveryCheckoutSession.findUnique.mockResolvedValue({
      merchantOrderNo: 'PSZF0000000000001',
      totalAmountCents: 4900,
      paymentChannel: 'WECHAT_PAY',
    });

    await expect(
      service.assertAlipayAmountMatchesCheckout('PSZF0000000000001', '49.00'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects WeChat delivery callback when checkout expects Alipay', async () => {
    deliveryPrisma.deliveryCheckoutSession.findUnique.mockResolvedValue({
      merchantOrderNo: 'PSZF0000000000001',
      totalAmountCents: 4900,
      paymentChannel: 'ALIPAY',
    });

    await expect(
      service.assertWechatAmountMatchesCheckout('PSZF0000000000001', 4900),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('delegates delivery payment success into delivery order creation and returns a provider success response', async () => {
    deliveryPrisma.deliveryCheckoutSession.findUnique.mockResolvedValue({
      id: 'checkout_1',
      merchantOrderNo: 'PSZF0000000000001',
      totalAmountCents: 4900,
      paymentChannel: 'ALIPAY',
      status: 'ACTIVE',
    });
    deliveryOrdersService.createOrderFromPaidCheckout.mockResolvedValue({
      orderId: 'PSDD0000000000001',
      subOrderIds: ['PSZDD000000000001'],
      idempotent: false,
      manifest: {
        status: 'PENDING',
        trigger: 'queued',
      },
    });

    const result = await service.handlePaymentCallback({
      merchantOrderNo: 'PSZF0000000000001',
      providerTxnId: 'ALI_TXN_1',
      status: 'SUCCESS',
      paidAt: '2026-06-19T12:00:00.000Z',
      paymentChannel: 'ALIPAY',
      claimedAmountCents: 4900,
      rawPayload: { total_amount: '49.00' },
      skipSignatureVerification: true,
    });

    expect(deliveryOrdersService.createOrderFromPaidCheckout).toHaveBeenCalledWith({
      merchantOrderNo: 'PSZF0000000000001',
      providerTxnId: 'ALI_TXN_1',
      paidAt: new Date('2026-06-19T12:00:00.000Z'),
      rawPayload: { total_amount: '49.00' },
    });
    expect(result).toEqual({
      code: 'SUCCESS',
      message: '配送支付处理成功',
      orderId: 'PSDD0000000000001',
      subOrderIds: ['PSZDD000000000001'],
      manifest: {
        status: 'PENDING',
        trigger: 'queued',
      },
    });
  });

  it('rejects delivery payment success when claimed amount is missing', async () => {
    deliveryPrisma.deliveryCheckoutSession.findUnique.mockResolvedValue({
      id: 'checkout_1',
      merchantOrderNo: 'PSZF0000000000001',
      totalAmountCents: 4900,
      paymentChannel: 'ALIPAY',
      status: 'ACTIVE',
    });

    await expect(
      service.handlePaymentCallback({
        merchantOrderNo: 'PSZF0000000000001',
        providerTxnId: 'ALI_TXN_0',
        status: 'SUCCESS',
        paymentChannel: 'ALIPAY',
        rawPayload: {},
        skipSignatureVerification: true,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(deliveryOrdersService.createOrderFromPaidCheckout).not.toHaveBeenCalled();
  });

  it('rejects delivery payment success when callback channel does not match checkout', async () => {
    deliveryPrisma.deliveryCheckoutSession.findUnique.mockResolvedValue({
      id: 'checkout_1',
      merchantOrderNo: 'PSZF0000000000001',
      totalAmountCents: 4900,
      paymentChannel: 'ALIPAY',
      status: 'ACTIVE',
    });

    await expect(
      service.handlePaymentCallback({
        merchantOrderNo: 'PSZF0000000000001',
        providerTxnId: 'WX_TXN_1',
        status: 'SUCCESS',
        paymentChannel: 'WECHAT_PAY',
        claimedAmountCents: 4900,
        rawPayload: { amountFen: 4900 },
        skipSignatureVerification: true,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(deliveryOrdersService.createOrderFromPaidCheckout).not.toHaveBeenCalled();
  });

  it('marks delivery checkout/payment failed without creating an order when provider reports failure', async () => {
    deliveryPrisma.deliveryCheckoutSession.findUnique.mockResolvedValue({
      id: 'checkout_1',
      merchantOrderNo: 'PSZF0000000000001',
      paymentChannel: 'ALIPAY',
      totalAmountCents: 4900,
      status: 'ACTIVE',
    });
    tx.deliveryCheckoutSession.findUnique.mockResolvedValue({
      id: 'checkout_1',
      merchantOrderNo: 'PSZF0000000000001',
      paymentChannel: 'ALIPAY',
      totalAmountCents: 4900,
    });
    tx.deliveryPayment.upsert.mockResolvedValue({ id: 'PSZF0000000000001', status: 'FAILED' });
    tx.deliveryCheckoutSession.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.handlePaymentCallback({
      merchantOrderNo: 'PSZF0000000000001',
      providerTxnId: 'ALI_TXN_2',
      status: 'FAILED',
      rawPayload: { trade_status: 'TRADE_CLOSED' },
      skipSignatureVerification: true,
    });

    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(deliveryOrdersService.createOrderFromPaidCheckout).not.toHaveBeenCalled();
    expect(tx.deliveryPayment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { merchantOrderNo: 'PSZF0000000000001' },
        create: expect.objectContaining({
          id: 'PSZF0000000000001',
          checkoutSessionId: 'checkout_1',
          status: 'FAILED',
        }),
      }),
    );
    expect(result).toEqual({ code: 'SUCCESS', message: '配送支付失败已记录' });
  });

  it('rejects a failed callback with a different providerTxnId after the checkout is already paid', async () => {
    deliveryPrisma.deliveryCheckoutSession.findUnique.mockResolvedValue({
      id: 'checkout_1',
      merchantOrderNo: 'PSZF0000000000001',
      paymentChannel: 'ALIPAY',
      totalAmountCents: 4900,
      status: 'PAID',
    });
    tx.deliveryCheckoutSession.findUnique.mockResolvedValue({
      id: 'checkout_1',
      merchantOrderNo: 'PSZF0000000000001',
      paymentChannel: 'ALIPAY',
      totalAmountCents: 4900,
      status: 'PAID',
      providerTxnId: 'ALI_TXN_1',
    });

    await expect(
      service.handlePaymentCallback({
        merchantOrderNo: 'PSZF0000000000001',
        providerTxnId: 'ALI_TXN_2',
        status: 'FAILED',
        rawPayload: { trade_status: 'TRADE_CLOSED' },
        skipSignatureVerification: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(deliveryOrdersService.createOrderFromPaidCheckout).not.toHaveBeenCalled();
    expect(tx.deliveryPayment.upsert).not.toHaveBeenCalled();
    expect(tx.deliveryCheckoutSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a repeated success callback with a different providerTxnId without recording an abnormal payment', async () => {
    deliveryPrisma.deliveryCheckoutSession.findUnique.mockResolvedValue({
      id: 'checkout_1',
      merchantOrderNo: 'PSZF0000000000001',
      totalAmountCents: 4900,
      paymentChannel: 'ALIPAY',
      status: 'PAID',
    });
    tx.deliveryCheckoutSession.findUnique.mockResolvedValue({
      id: 'checkout_1',
      merchantOrderNo: 'PSZF0000000000001',
      totalAmountCents: 4900,
      paymentChannel: 'ALIPAY',
      status: 'PAID',
      providerTxnId: 'ALI_TXN_1',
    });
    deliveryOrdersService.createOrderFromPaidCheckout.mockRejectedValue(
      new DeliveryProviderTxnConflictException(),
    );

    await expect(
      service.handlePaymentCallback({
        merchantOrderNo: 'PSZF0000000000001',
        providerTxnId: 'ALI_TXN_2',
        status: 'SUCCESS',
        paymentChannel: 'ALIPAY',
        claimedAmountCents: 4900,
        rawPayload: { total_amount: '49.00' },
        skipSignatureVerification: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(deliveryPrisma.$transaction).not.toHaveBeenCalled();
    expect(tx.deliveryPayment.upsert).not.toHaveBeenCalled();
    expect(tx.deliveryCheckoutSession.updateMany).not.toHaveBeenCalled();
  });

  it('keeps provider-success abnormal delivery payments as paid records when order creation fails', async () => {
    deliveryPrisma.deliveryCheckoutSession.findUnique.mockResolvedValue({
      id: 'checkout_1',
      merchantOrderNo: 'PSZF0000000000001',
      totalAmountCents: 4900,
      paymentChannel: 'ALIPAY',
      status: 'ACTIVE',
    });
    tx.deliveryCheckoutSession.findUnique.mockResolvedValue({
      id: 'checkout_1',
      merchantOrderNo: 'PSZF0000000000001',
      paymentChannel: 'ALIPAY',
      totalAmountCents: 4900,
      status: 'ACTIVE',
    });
    tx.deliveryPayment.upsert.mockResolvedValue({ id: 'PSZF0000000000001', status: 'PAID' });
    tx.deliveryCheckoutSession.updateMany.mockResolvedValue({ count: 1 });
    deliveryOrdersService.createOrderFromPaidCheckout.mockRejectedValue(
      new BadRequestException('库存不足'),
    );

    await expect(
      service.handlePaymentCallback({
        merchantOrderNo: 'PSZF0000000000001',
        providerTxnId: 'ALI_TXN_3',
        status: 'SUCCESS',
        paidAt: '2026-06-19T12:00:00.000Z',
        paymentChannel: 'ALIPAY',
        claimedAmountCents: 4900,
        rawPayload: { total_amount: '49.00' },
        skipSignatureVerification: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.deliveryPayment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { merchantOrderNo: 'PSZF0000000000001' },
        create: expect.objectContaining({
          id: 'PSZF0000000000001',
          checkoutSessionId: 'checkout_1',
          orderId: null,
          status: 'PAID',
          paidAt: new Date('2026-06-19T12:00:00.000Z'),
          exceptionSummary: expect.stringContaining('库存不足'),
        }),
        update: expect.objectContaining({
          orderId: null,
          status: 'PAID',
          paidAt: new Date('2026-06-19T12:00:00.000Z'),
          exceptionSummary: expect.stringContaining('库存不足'),
        }),
      }),
    );
    expect(tx.deliveryCheckoutSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'checkout_1', status: 'ACTIVE' },
      data: {
        status: 'PAID',
        providerTxnId: 'ALI_TXN_3',
        paidAt: new Date('2026-06-19T12:00:00.000Z'),
      },
    });
  });
});
