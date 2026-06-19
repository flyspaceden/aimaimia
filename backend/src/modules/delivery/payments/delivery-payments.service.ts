import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryOrdersService } from '../orders/delivery-orders.service';
import {
  DeliveryCallbackChannel,
  extractDeliveryClaimedAmountCents,
  isDeliveryMerchantOrderNo,
  parseDeliveryYuanAmountToCents,
} from './delivery-payment-routing.util';

type DeliveryPaymentCallbackInput = {
  merchantOrderNo: string;
  providerTxnId: string;
  status: 'SUCCESS' | 'FAILED';
  paidAt?: string;
  rawPayload?: any;
  paymentChannel?: DeliveryCallbackChannel;
  claimedAmountCents?: number;
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
    this.assertCallbackChannelMatchesCheckout(checkout, 'ALIPAY');
    const claimedAmountCents = parseDeliveryYuanAmountToCents(claimedAmountYuan);
    if (!Number.isInteger(claimedAmountCents)) {
      throw new BadRequestException('配送支付金额格式错误');
    }
    if (checkout.totalAmountCents !== claimedAmountCents) {
      throw new BadRequestException('配送支付金额校验失败，请联系客服');
    }
  }

  async assertWechatAmountMatchesCheckout(
    merchantOrderNo: string,
    claimedAmountFen: number,
  ): Promise<void> {
    const checkout = await this.getCheckoutOrThrow(merchantOrderNo);
    this.assertCallbackChannelMatchesCheckout(checkout, 'WECHAT_PAY');
    if (!Number.isInteger(claimedAmountFen) || checkout.totalAmountCents !== claimedAmountFen) {
      throw new BadRequestException('配送支付金额校验失败，请联系客服');
    }
  }

  async handlePaymentCallback(body: DeliveryPaymentCallbackInput) {
    if (!isDeliveryMerchantOrderNo(body.merchantOrderNo)) {
      throw new BadRequestException('不是配送支付单号');
    }

    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    const checkout = await this.getCheckoutOrThrow(body.merchantOrderNo);
    if (body.paymentChannel) {
      this.assertCallbackChannelMatchesCheckout(checkout, body.paymentChannel);
    }
    if (body.status === 'SUCCESS') {
      if (!body.paymentChannel) {
        throw new BadRequestException('配送支付成功回调缺少明确的支付渠道');
      }
      const claimedAmountCents = this.resolveClaimedAmountCents(body);
      await this.assertAmountMatchesCheckoutCents(checkout, claimedAmountCents);

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

    const failedCheckout = await this.markFailedPayment(
      body.merchantOrderNo,
      body.providerTxnId,
      body.rawPayload,
    );
    this.logger.warn(`配送支付失败已记录: merchantOrderNo=${failedCheckout.merchantOrderNo}`);
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
    checkout: Awaited<ReturnType<DeliveryPaymentsService['getCheckoutOrThrow']>>,
    claimedAmountCents: number,
  ): Promise<void> {
    if (checkout.totalAmountCents !== claimedAmountCents) {
      throw new BadRequestException('配送支付金额校验失败，请联系客服');
    }
  }

  private resolveClaimedAmountCents(body: DeliveryPaymentCallbackInput): number {
    if (Number.isInteger(body.claimedAmountCents)) {
      return body.claimedAmountCents as number;
    }

    if (!body.paymentChannel) {
      throw new BadRequestException('配送支付成功回调缺少明确的支付渠道');
    }

    const claimedAmountCents = extractDeliveryClaimedAmountCents(
      body.rawPayload,
      body.paymentChannel,
    );
    if (!Number.isInteger(claimedAmountCents)) {
      throw new BadRequestException('配送支付成功回调缺少可校验的支付金额');
    }

    return claimedAmountCents as number;
  }

  private assertCallbackChannelMatchesCheckout(
    checkout: Awaited<ReturnType<DeliveryPaymentsService['getCheckoutOrThrow']>>,
    callbackChannel: DeliveryCallbackChannel,
  ) {
    if (!checkout.paymentChannel) {
      throw new BadRequestException('配送结算会话缺少支付渠道');
    }
    if (checkout.paymentChannel !== callbackChannel) {
      throw new BadRequestException('配送支付渠道与结算会话不匹配');
    }
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
            providerTxnId: true,
          },
        });

        if (!checkout) {
          throw new NotFoundException('配送结算会话不存在');
        }
        if (!checkout.paymentChannel) {
          throw new BadRequestException('配送结算会话缺少支付渠道');
        }

        this.assertProviderTxnIdConsistency(checkout.providerTxnId, providerTxnId);

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

  private assertProviderTxnIdConsistency(
    existingProviderTxnId: string | null | undefined,
    incomingProviderTxnId: string,
  ) {
    if (existingProviderTxnId && existingProviderTxnId !== incomingProviderTxnId) {
      throw new ConflictException('配送结算会话已绑定其他支付流水');
    }
  }
}
