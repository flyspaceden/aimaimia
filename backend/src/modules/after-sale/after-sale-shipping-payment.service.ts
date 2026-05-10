import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AfterSaleRequest,
  AfterSaleShippingPayment,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getConfigValue } from './after-sale.utils';
import { AFTER_SALE_CONFIG_KEYS } from './after-sale.constants';
import { AlipayService } from '../payment/alipay.service';

type Tx = Prisma.TransactionClient;
const SERIALIZABLE_MAX_RETRIES = 3;

export type AfterSaleShippingPaymentBuyerResponse = Pick<
  AfterSaleShippingPayment,
  'id' | 'afterSaleId' | 'merchantPaymentNo' | 'amount' | 'status'
> & {
  paymentParams: {
    channel?: 'alipay';
    orderStr?: string;
  };
};

@Injectable()
export class AfterSaleShippingPaymentService {
  constructor(
    private prisma: PrismaService,
    @Optional() private alipayService?: AlipayService,
  ) {}

  async estimateReturnShippingFee(afterSaleId: string): Promise<number> {
    return this.withSerializableRetry((tx) =>
      this.estimateReturnShippingFeeInTx(tx, afterSaleId),
    );
  }

  async createOrGetPayment(afterSaleId: string): Promise<AfterSaleShippingPayment> {
    return this.withSerializableRetry(
      async (tx) => {
        const request = await tx.afterSaleRequest.findUnique({
          where: { id: afterSaleId },
        });
        if (!request) throw new NotFoundException('售后单不存在');
        this.assertBuyerShippingPaymentAllowed(request);

        return this.upsertPaymentInTx(tx, request);
      },
    );
  }

  async createOrGetPaymentForBuyer(
    userId: string,
    afterSaleId: string,
  ): Promise<AfterSaleShippingPaymentBuyerResponse> {
    const payment = await this.withSerializableRetry(
      async (tx) => {
        const request = await tx.afterSaleRequest.findFirst({
          where: { id: afterSaleId, userId },
        });
        if (!request) throw new NotFoundException('售后单不存在');
        this.assertBuyerShippingPaymentAllowed(request);

        return this.upsertPaymentInTx(tx, request);
      },
    );

    const paymentParams = await this.buildAlipayPaymentParams(payment);
    return {
      id: payment.id,
      afterSaleId: payment.afterSaleId,
      merchantPaymentNo: payment.merchantPaymentNo,
      amount: payment.amount,
      status: payment.status,
      paymentParams,
    };
  }

  async handlePaymentSuccess(
    merchantPaymentNo: string,
    providerPaymentNo?: string | null,
    paidAt?: Date,
  ): Promise<void> {
    const confirmedAt = paidAt ?? new Date();

    await this.withSerializableRetry(
      async (tx) => {
        const payment = await tx.afterSaleShippingPayment.findUnique({
          where: { merchantPaymentNo },
        });
        if (!payment) throw new NotFoundException('售后退货运费支付单不存在');
        if (payment.status === 'PAID') return;
        if (payment.status === 'FAILED' && payment.paidAt) return;
        if (['REFUNDING', 'REFUNDED'].includes(payment.status)) return;
        if (!['UNPAID', 'PENDING', 'FAILED', 'CLOSED'].includes(payment.status)) {
          return;
        }

        const request = await tx.afterSaleRequest.findUnique({
          where: { id: payment.afterSaleId },
        });
        if (!request) throw new NotFoundException('售后单不存在');
        const manualRefundReason =
          request.status === 'APPROVED'
            ? null
            : `售后单状态已变更为 ${request.status}，需人工退还退货运费`;

        const updated = await tx.afterSaleShippingPayment.updateMany({
          where: {
            merchantPaymentNo,
            status: { in: ['UNPAID', 'PENDING', 'FAILED', 'CLOSED'] },
          },
          data: {
            status: 'PAID',
            providerPaymentNo: providerPaymentNo ?? payment.providerPaymentNo,
            paidAt: confirmedAt,
            failureReason: manualRefundReason,
          },
        });
        if (updated.count === 0) return;

        if (request.status !== 'APPROVED') {
          await tx.afterSaleRequest.update({
            where: { id: payment.afterSaleId },
            data: {
              manualReviewReason: manualRefundReason,
              manualReviewRequestedAt: confirmedAt,
            },
          });
          return;
        }

        await tx.afterSaleRequest.update({
          where: { id: payment.afterSaleId },
          data: { returnShippingPaidAt: confirmedAt },
        });
      },
    );
  }

  async handlePaymentFailure(
    merchantPaymentNo: string,
    reason: string,
  ): Promise<void> {
    await this.withSerializableRetry(
      async (tx) => {
        const payment = await tx.afterSaleShippingPayment.findUnique({
          where: { merchantPaymentNo },
        });
        if (!payment) throw new NotFoundException('售后退货运费支付单不存在');
        if (['PAID', 'CLOSED', 'REFUNDING', 'REFUNDED'].includes(payment.status)) {
          return;
        }

        await tx.afterSaleShippingPayment.updateMany({
          where: {
            merchantPaymentNo,
            status: { in: ['UNPAID', 'PENDING', 'FAILED'] },
          },
          data: {
            status: 'FAILED',
            failureReason: reason,
          },
        });
      },
    );
  }

  async refundShippingPayment(afterSaleId: string, reason: string): Promise<void> {
    const paymentToRefund = await this.withSerializableRetry(
      async (tx) => {
        const payment = await tx.afterSaleShippingPayment.findUnique({
          where: { afterSaleId },
        });
        if (!payment || payment.status === 'REFUNDED' || payment.status === 'REFUNDING') {
          return null;
        }

        if (payment.status === 'PAID' || (payment.status === 'FAILED' && payment.paidAt)) {
          const updated = await tx.afterSaleShippingPayment.updateMany({
            where: { afterSaleId, status: payment.status },
            data: {
              status: 'REFUNDING',
              failureReason: `退货运费退款中: ${reason}`,
            },
          });
          return updated.count === 1 ? payment : null;
        }

        await tx.afterSaleShippingPayment.update({
          where: { afterSaleId },
          data: {
            status: 'CLOSED',
            failureReason: reason,
          },
        });
        return null;
      },
    );

    if (!paymentToRefund) return;

    const merchantRefundNo = this.getMerchantRefundNo(afterSaleId);
    let result: { success: boolean; message: string };
    try {
      if (!this.alipayService?.refund) {
        throw new Error('支付宝退款服务不可用');
      }
      result = await this.alipayService.refund({
        merchantOrderNo: paymentToRefund.merchantPaymentNo,
        refundAmount: paymentToRefund.amount,
        merchantRefundNo,
        refundReason: reason,
      });
    } catch (err: any) {
      result = {
        success: false,
        message: err?.message || '支付宝退款异常',
      };
    }

    await this.withSerializableRetry(
      async (tx) => {
        await tx.afterSaleShippingPayment.update({
          where: { afterSaleId },
          data: result.success
            ? {
                status: 'REFUNDED',
                refundedAt: new Date(),
                failureReason: null,
              }
            : {
                status: 'FAILED',
                failureReason: `退货运费退款失败: ${result.message || '支付宝退款失败'}`,
              },
        });
      },
    );
  }

  private async upsertPaymentInTx(
    tx: Tx,
    request: AfterSaleRequest,
  ): Promise<AfterSaleShippingPayment> {
    const amount = await this.resolveReturnShippingFeeInTx(tx, request);
    const merchantPaymentNo = this.getMerchantPaymentNo(request.id);

    return tx.afterSaleShippingPayment.upsert({
      where: { merchantPaymentNo },
      create: {
        afterSaleId: request.id,
        amount,
        status: 'UNPAID',
        merchantPaymentNo,
        provider: 'ALIPAY',
      },
      update: {},
    });
  }

  private async resolveReturnShippingFeeInTx(
    tx: Tx,
    request: AfterSaleRequest,
  ): Promise<number> {
    if (request.returnShippingFee != null) {
      return Math.max(0, Math.round(request.returnShippingFee * 100) / 100);
    }

    return this.estimateReturnShippingFeeInTx(tx, request.id);
  }

  private async estimateReturnShippingFeeInTx(
    tx: Tx,
    _afterSaleId: string,
  ): Promise<number> {
    const configured = await getConfigValue(
      tx as any,
      AFTER_SALE_CONFIG_KEYS.RETURN_SHIPPING_FEE_DEFAULT,
      10,
    );
    return Math.max(0, Math.round(configured * 100) / 100);
  }

  private assertBuyerShippingPaymentAllowed(request: AfterSaleRequest): void {
    if (request.status !== 'APPROVED') {
      throw new BadRequestException('售后单未审批通过，不能支付退货运费');
    }
    if (!request.requiresReturn || request.returnShippingPayer !== 'BUYER') {
      throw new BadRequestException('当前售后单不需要买家支付退货运费');
    }
    if (request.returnShippingFeeDeducted) {
      throw new BadRequestException('退货运费已从退款金额中扣除，无需单独支付');
    }
  }

  private getMerchantPaymentNo(afterSaleId: string): string {
    return `AS_SHIP_PAY_${afterSaleId}`;
  }

  private getMerchantRefundNo(afterSaleId: string): string {
    return `AS_SHIP_REFUND_${afterSaleId}`;
  }

  private async buildAlipayPaymentParams(
    payment: AfterSaleShippingPayment,
  ): Promise<AfterSaleShippingPaymentBuyerResponse['paymentParams']> {
    if (payment.status !== 'UNPAID' && payment.status !== 'PENDING' && payment.status !== 'FAILED') {
      return {};
    }
    if (!this.alipayService?.createAppPayOrder) {
      return {};
    }
    if (this.alipayService.isAvailable && !this.alipayService.isAvailable()) {
      return {};
    }

    const orderStr = await this.alipayService.createAppPayOrder({
      merchantOrderNo: payment.merchantPaymentNo,
      totalAmount: payment.amount,
      subject: `爱买买退货运费-${payment.afterSaleId}`,
    });
    return { channel: 'alipay', orderStr };
  }

  private async withSerializableRetry<T>(
    operation: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < SERIALIZABLE_MAX_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }
    throw new Error('Serializable transaction retry exhausted');
  }
}
