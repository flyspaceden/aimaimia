import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryOrdersService } from '../orders/delivery-orders.service';
import { isDeliveryMerchantOrderNo } from './delivery-payment-routing.util';

type DeliveryPaymentCallbackInput = {
  merchantOrderNo: string;
  providerTxnId: string;
  status: 'SUCCESS' | 'FAILED';
  paidAt?: string;
  rawPayload?: any;
  skipSignatureVerification?: boolean;
};

@Injectable()
export class DeliveryPaymentsService {
  private readonly logger = new Logger(DeliveryPaymentsService.name);

  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly deliveryOrdersService: DeliveryOrdersService,
  ) {}

  async assertAlipayAmountMatchesCheckout(
    merchantOrderNo: string,
    claimedAmountYuan: string,
  ): Promise<void> {
    const checkout = await this.getCheckoutOrThrow(merchantOrderNo);
    const expected = (checkout.totalAmountCents / 100).toFixed(2);
    if (claimedAmountYuan !== expected) {
      throw new BadRequestException('配送支付金额校验失败，请联系客服');
    }
  }

  async assertWechatAmountMatchesCheckout(
    merchantOrderNo: string,
    claimedAmountFen: number,
  ): Promise<void> {
    const checkout = await this.getCheckoutOrThrow(merchantOrderNo);
    if (!Number.isInteger(claimedAmountFen) || checkout.totalAmountCents !== claimedAmountFen) {
      throw new BadRequestException('配送支付金额校验失败，请联系客服');
    }
  }

  async handlePaymentCallback(body: DeliveryPaymentCallbackInput) {
    if (!isDeliveryMerchantOrderNo(body.merchantOrderNo)) {
      throw new BadRequestException('不是配送支付单号');
    }

    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    if (body.status === 'SUCCESS') {
      const claimedAmountCents = this.extractClaimedAmountCents(body.rawPayload);
      if (claimedAmountCents !== null) {
        await this.assertAmountMatchesCheckoutCents(body.merchantOrderNo, claimedAmountCents);
      }

      try {
        const result = await this.deliveryOrdersService.createOrderFromPaidCheckout({
          merchantOrderNo: body.merchantOrderNo,
          providerTxnId: body.providerTxnId,
          paidAt,
          rawPayload: body.rawPayload as Prisma.JsonValue,
        });

        return {
          code: 'SUCCESS',
          message: '配送支付处理成功',
          orderId: result.orderId,
          subOrderIds: result.subOrderIds,
          manifest: result.manifest,
        };
      } catch (error) {
        await this.recordAbnormalPayment({
          merchantOrderNo: body.merchantOrderNo,
          providerTxnId: body.providerTxnId,
          paidAt,
          rawPayload: body.rawPayload as Prisma.JsonValue,
          error,
        });
        throw error;
      }
    }

    const checkout = await this.markFailedPayment(body.merchantOrderNo, body.providerTxnId, body.rawPayload);
    this.logger.warn(`配送支付失败已记录: merchantOrderNo=${checkout.merchantOrderNo}`);
    return { code: 'SUCCESS', message: '配送支付失败已记录' };
  }

  private async getCheckoutOrThrow(merchantOrderNo: string) {
    const checkout = await this.deliveryPrisma.deliveryCheckoutSession.findUnique({
      where: { merchantOrderNo },
      select: {
        id: true,
        merchantOrderNo: true,
        totalAmountCents: true,
        paymentChannel: true,
        status: true,
      },
    });

    if (!checkout) {
      throw new NotFoundException('配送结算会话不存在');
    }

    return checkout;
  }

  private async assertAmountMatchesCheckoutCents(
    merchantOrderNo: string,
    claimedAmountCents: number,
  ): Promise<void> {
    const checkout = await this.getCheckoutOrThrow(merchantOrderNo);
    if (checkout.totalAmountCents !== claimedAmountCents) {
      throw new BadRequestException('配送支付金额校验失败，请联系客服');
    }
  }

  private extractClaimedAmountCents(rawPayload: any): number | null {
    if (!rawPayload || typeof rawPayload !== 'object') {
      return null;
    }

    if (typeof rawPayload.total_amount === 'string' || typeof rawPayload.total_amount === 'number') {
      return this.parseYuanAmountToCents(rawPayload.total_amount);
    }
    if (typeof rawPayload.totalAmount === 'string' || typeof rawPayload.totalAmount === 'number') {
      return this.parseYuanAmountToCents(rawPayload.totalAmount);
    }
    if (typeof rawPayload.amountFen === 'number') {
      return rawPayload.amountFen;
    }
    if (typeof rawPayload.amount === 'number' && Number.isInteger(rawPayload.amount)) {
      return rawPayload.amount;
    }

    return null;
  }

  private parseYuanAmountToCents(amount: string | number): number {
    const normalized = typeof amount === 'number' ? amount.toFixed(2) : amount.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
      throw new BadRequestException('配送支付金额格式错误');
    }
    return Math.round(Number(normalized) * 100);
  }

  private async markFailedPayment(merchantOrderNo: string, providerTxnId: string, rawPayload?: any) {
    return this.deliveryPrisma.$transaction(
      async (tx) => {
        const checkout = await tx.deliveryCheckoutSession.findUnique({
          where: { merchantOrderNo },
          select: {
            id: true,
            merchantOrderNo: true,
            paymentChannel: true,
            totalAmountCents: true,
            status: true,
          },
        });

        if (!checkout) {
          throw new NotFoundException('配送结算会话不存在');
        }
        if (!checkout.paymentChannel) {
          throw new BadRequestException('配送结算会话缺少支付渠道');
        }

        if (checkout.status === 'PAID' || checkout.status === 'COMPLETED') {
          return checkout;
        }

        await tx.deliveryPayment.upsert({
          where: { merchantOrderNo },
          create: {
            id: merchantOrderNo,
            orderId: null,
            checkoutSessionId: checkout.id,
            channel: checkout.paymentChannel,
            scene: 'APP',
            amountCents: checkout.totalAmountCents,
            currency: 'CNY',
            status: 'FAILED',
            merchantOrderNo,
            providerTxnId,
            requestPayload: Prisma.JsonNull,
            rawNotifyPayload: (rawPayload as Prisma.JsonValue) ?? Prisma.JsonNull,
            exceptionSummary: '支付渠道返回失败状态',
            paidAt: null,
          },
          update: {
            orderId: null,
            checkoutSessionId: checkout.id,
            status: 'FAILED',
            providerTxnId,
            rawNotifyPayload: (rawPayload as Prisma.JsonValue) ?? Prisma.JsonNull,
            exceptionSummary: '支付渠道返回失败状态',
          },
        });

        await tx.deliveryCheckoutSession.updateMany({
          where: { id: checkout.id, status: 'ACTIVE' },
          data: {
            status: 'FAILED',
            providerTxnId,
          },
        });

        return checkout;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  private async recordAbnormalPayment(params: {
    merchantOrderNo: string;
    providerTxnId: string;
    paidAt: Date;
    rawPayload?: Prisma.JsonValue;
    error: any;
  }) {
    await this.deliveryPrisma.$transaction(
      async (tx) => {
        const checkout = await tx.deliveryCheckoutSession.findUnique({
          where: { merchantOrderNo: params.merchantOrderNo },
          select: {
            id: true,
            paymentChannel: true,
            totalAmountCents: true,
            status: true,
          },
        });

        if (!checkout || !checkout.paymentChannel) {
          return;
        }

        const exceptionSummary =
          params.error instanceof Error ? params.error.message : '配送订单创建失败';

        await tx.deliveryPayment.upsert({
          where: { merchantOrderNo: params.merchantOrderNo },
          create: {
            id: params.merchantOrderNo,
            orderId: null,
            checkoutSessionId: checkout.id,
            channel: checkout.paymentChannel,
            scene: 'APP',
            amountCents: checkout.totalAmountCents,
            currency: 'CNY',
            status: 'FAILED',
            merchantOrderNo: params.merchantOrderNo,
            providerTxnId: params.providerTxnId,
            requestPayload: Prisma.JsonNull,
            rawNotifyPayload: params.rawPayload ?? Prisma.JsonNull,
            exceptionSummary,
            paidAt: params.paidAt,
          },
          update: {
            orderId: null,
            checkoutSessionId: checkout.id,
            status: 'FAILED',
            providerTxnId: params.providerTxnId,
            rawNotifyPayload: params.rawPayload ?? Prisma.JsonNull,
            exceptionSummary,
            paidAt: params.paidAt,
          },
        });

        await tx.deliveryCheckoutSession.updateMany({
          where: { id: checkout.id, status: 'ACTIVE' },
          data: {
            status: 'FAILED',
            providerTxnId: params.providerTxnId,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }
}
