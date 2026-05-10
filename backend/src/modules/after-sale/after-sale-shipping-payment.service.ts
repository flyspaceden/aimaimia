import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AfterSaleRequest,
  AfterSaleShippingPayment,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getConfigValue } from './after-sale.utils';
import { AFTER_SALE_CONFIG_KEYS } from './after-sale.constants';

type Tx = Prisma.TransactionClient;

@Injectable()
export class AfterSaleShippingPaymentService {
  constructor(private prisma: PrismaService) {}

  async estimateReturnShippingFee(afterSaleId: string): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => this.estimateReturnShippingFeeInTx(tx, afterSaleId),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createOrGetPayment(afterSaleId: string): Promise<AfterSaleShippingPayment> {
    return this.prisma.$transaction(
      async (tx) => {
        const request = await tx.afterSaleRequest.findUnique({
          where: { id: afterSaleId },
        });
        if (!request) throw new NotFoundException('售后单不存在');
        this.assertBuyerShippingPaymentAllowed(request);

        return this.upsertPaymentInTx(tx, request);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createOrGetPaymentForBuyer(
    userId: string,
    afterSaleId: string,
  ): Promise<AfterSaleShippingPayment> {
    return this.prisma.$transaction(
      async (tx) => {
        const request = await tx.afterSaleRequest.findFirst({
          where: { id: afterSaleId, userId },
        });
        if (!request) throw new NotFoundException('售后单不存在');
        this.assertBuyerShippingPaymentAllowed(request);

        return this.upsertPaymentInTx(tx, request);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async handlePaymentSuccess(
    merchantPaymentNo: string,
    providerPaymentNo?: string | null,
    paidAt?: Date,
  ): Promise<void> {
    const confirmedAt = paidAt ?? new Date();

    await this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.afterSaleShippingPayment.findUnique({
          where: { merchantPaymentNo },
        });
        if (!payment) throw new NotFoundException('售后退货运费支付单不存在');
        if (payment.status === 'PAID') return;

        await tx.afterSaleShippingPayment.update({
          where: { merchantPaymentNo },
          data: {
            status: 'PAID',
            providerPaymentNo: providerPaymentNo ?? payment.providerPaymentNo,
            paidAt: confirmedAt,
            failureReason: null,
          },
        });
        await tx.afterSaleRequest.update({
          where: { id: payment.afterSaleId },
          data: { returnShippingPaidAt: confirmedAt },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async handlePaymentFailure(
    merchantPaymentNo: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.afterSaleShippingPayment.findUnique({
          where: { merchantPaymentNo },
        });
        if (!payment) throw new NotFoundException('售后退货运费支付单不存在');
        if (payment.status === 'PAID') return;

        await tx.afterSaleShippingPayment.updateMany({
          where: {
            merchantPaymentNo,
            status: { not: 'PAID' },
          },
          data: {
            status: 'FAILED',
            failureReason: reason,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async refundShippingPayment(afterSaleId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.afterSaleShippingPayment.findUnique({
          where: { afterSaleId },
        });
        if (!payment || payment.status === 'REFUNDED' || payment.status === 'REFUNDING') {
          return;
        }

        if (payment.status === 'PAID') {
          await tx.afterSaleShippingPayment.update({
            where: { afterSaleId },
            data: {
              status: 'REFUNDING',
              failureReason: reason,
            },
          });
          return;
        }

        await tx.afterSaleShippingPayment.update({
          where: { afterSaleId },
          data: {
            status: 'CLOSED',
            failureReason: reason,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async upsertPaymentInTx(
    tx: Tx,
    request: AfterSaleRequest,
  ): Promise<AfterSaleShippingPayment> {
    const amount = await this.estimateReturnShippingFeeInTx(tx, request.id);
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
}
