import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupBuyActivityStatus,
  GroupBuyCodeStatus,
  GroupBuyInstanceStatus,
  Prisma,
  ProductStatus,
  SkuStatus,
} from '@prisma/client';

import { encryptJsonValue } from '../../common/security/encryption';
import { parseChineseAddress } from '../../common/utils/parse-region';
import { PrismaService } from '../../prisma/prisma.service';
import { PLATFORM_COMPANY_ID } from '../bonus/engine/constants';
import { GroupBuyCheckoutDto } from './dto/group-buy-checkout.dto';

const CHANNEL_MAP: Record<string, string> = {
  wechat: 'WECHAT_PAY',
  alipay: 'ALIPAY',
  bankcard: 'UNIONPAY',
};

const GROUP_BUY_MAX_MONTHLY_LAUNCHES_KEY = 'GROUP_BUY_MAX_MONTHLY_LAUNCHES';
const DEFAULT_MAX_MONTHLY_LAUNCHES = 4;

@Injectable()
export class GroupBuyCheckoutService {
  constructor(private readonly prisma: PrismaService) {}

  private alipayService: any = null;
  private wechatPayService: any = null;

  private readonly serializableTransactionOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  };

  setAlipayService(service: any) {
    this.alipayService = service;
  }

  setWechatPayService(service: any) {
    this.wechatPayService = service;
  }

  async createCheckout(userId: string, dto: GroupBuyCheckoutDto) {
    this.assertCashOnly(dto);

    if (dto.idempotencyKey) {
      const existing = await this.prisma.checkoutSession.findFirst({
        where: {
          userId,
          bizType: 'GROUP_BUY',
          idempotencyKey: dto.idempotencyKey,
        },
      });
      if (existing) {
        return this.toCheckoutResponse(existing);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const activity = await tx.groupBuyActivity.findUnique({
        where: { id: dto.activityId },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              companyId: true,
              status: true,
              media: {
                select: { url: true },
                orderBy: { sortOrder: 'asc' },
                take: 1,
              },
            },
          },
          sku: {
            select: {
              id: true,
              title: true,
              status: true,
              stock: true,
              weightGram: true,
            },
          },
          tiers: {
            orderBy: { sequence: 'asc' },
          },
        },
      });
      if (!activity || activity.deletedAt) {
        throw new NotFoundException('团购活动不存在');
      }
      this.assertActivityCanCheckout(activity);

      const occupying = await tx.groupBuyInstance.findFirst({
        where: {
          userId,
          status: {
            in: [
              GroupBuyInstanceStatus.QUALIFICATION_PENDING,
              GroupBuyInstanceStatus.SHARING,
            ],
          },
        },
        select: { id: true, status: true },
      });
      if (occupying) {
        throw new ConflictException({
          code: 'GROUP_BUY_SLOT_OCCUPIED',
          message: '需要先结束本次分享，或完成本次分享后才能购买新的团购商品',
        });
      }

      const monthStart = this.getMonthStart();
      const monthlyStartedCount = await tx.groupBuyInstance.count({
        where: {
          userId,
          createdAt: { gte: monthStart },
        },
      });
      const maxMonthlyLaunches = await this.getMaxMonthlyLaunches(tx);
      if (monthlyStartedCount >= maxMonthlyLaunches) {
        throw new BadRequestException('本月团购参与次数已用完');
      }

      const groupBuyCode = dto.shareCode
        ? await this.resolveShareCode(
          tx,
          userId,
          dto.activityId,
          dto.shareCode,
          activity.tiers.length,
        )
        : null;

      const address = await tx.address.findUnique({
        where: { id: dto.addressId, userId, deletedAt: null },
      });
      if (!address) {
        throw new BadRequestException('收货地址无效');
      }

      const shippingFee = activity.freeShipping ? 0 : 0;
      const expectedTotal = Number((activity.price + shippingFee).toFixed(2));
      if (dto.expectedTotal !== undefined && Math.abs(dto.expectedTotal - expectedTotal) > 0.01) {
        throw new BadRequestException(
          `价格已变更：预期 ¥${dto.expectedTotal.toFixed(2)}，实际 ¥${expectedTotal.toFixed(2)}。请刷新后重新结算`,
        );
      }

      const region = parseChineseAddress(address.regionText);
      const addressSnapshot = encryptJsonValue({
        recipientName: address.recipientName,
        phone: address.phone,
        regionCode: address.regionCode,
        regionText: address.regionText,
        province: region.province,
        city: region.city,
        district: region.district,
        detail: address.detail,
      });
      const tierSnapshot = activity.tiers.map((tier) => ({
        sequence: tier.sequence,
        basisPoints: tier.basisPoints,
        label: tier.label,
      }));
      const merchantOrderNo = `GB${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      const session = await tx.checkoutSession.create({
        data: {
          userId,
          bizType: 'GROUP_BUY',
          bizMeta: {
            groupBuyActivityId: activity.id,
            groupBuyCodeId: groupBuyCode?.id ?? null,
            referredByInstanceId: groupBuyCode?.instance?.id ?? null,
            groupBuyPriceSnapshot: activity.price,
            freeShippingSnapshot: activity.freeShipping,
            shippingFeeSnapshot: shippingFee,
            tierSnapshot,
          },
          itemsSnapshot: [
            {
              skuId: activity.skuId,
              quantity: 1,
              isPrize: false,
              unitPrice: activity.price,
              companyId: PLATFORM_COMPANY_ID,
              productSnapshot: {
                productId: activity.productId,
                companyId: PLATFORM_COMPANY_ID,
                title: activity.product.title,
                skuTitle: activity.sku.title,
                image: activity.product.media?.[0]?.url || '',
                price: activity.price,
                isPrize: false,
              },
            },
          ],
          addressSnapshot,
          rewardId: null,
          deductionGroupId: null,
          expectedTotal,
          goodsAmount: activity.price,
          shippingFee,
          discountAmount: 0,
          vipDiscountAmount: 0,
          merchantOrderNo,
          paymentChannel: (CHANNEL_MAP[dto.paymentChannel || 'wechat'] || dto.paymentChannel || 'WECHAT_PAY') as any,
          couponInstanceIds: [],
          totalCouponDiscount: 0,
          couponPerAmounts: [],
          idempotencyKey: dto.idempotencyKey,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        } as any,
      });

      return this.toCheckoutResponse(session);
    }, this.serializableTransactionOptions);
  }

  private assertCashOnly(dto: GroupBuyCheckoutDto) {
    if ((dto.deductionAmount ?? 0) > 0 || dto.rewardId) {
      throw new BadRequestException('团购商品必须现金购买，不能使用消费积分抵扣');
    }
    if ((dto.groupBuyRebateDeductionAmount ?? 0) > 0) {
      throw new BadRequestException('团购商品必须现金购买，不能使用团购返还余额抵扣');
    }
    if (dto.couponInstanceIds && dto.couponInstanceIds.length > 0) {
      throw new BadRequestException('团购商品不能使用平台红包');
    }
  }

  private assertActivityCanCheckout(activity: any) {
    const now = new Date();
    if (activity.status !== GroupBuyActivityStatus.ACTIVE) {
      throw new BadRequestException('团购活动未开始或已结束');
    }
    if (activity.startAt && activity.startAt > now) {
      throw new BadRequestException('团购活动未开始');
    }
    if (activity.endAt && activity.endAt <= now) {
      throw new BadRequestException('团购活动已结束');
    }
    if (activity.product.companyId !== PLATFORM_COMPANY_ID) {
      throw new BadRequestException('团购活动商品配置异常');
    }
    if (activity.product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException('团购活动商品已下架');
    }
    if (activity.sku.status !== SkuStatus.ACTIVE) {
      throw new BadRequestException('团购活动商品规格已下架');
    }
    if (activity.sku.stock <= 0) {
      throw new BadRequestException('团购活动商品库存不足');
    }
  }

  private async resolveShareCode(
    tx: Prisma.TransactionClient,
    userId: string,
    activityId: string,
    shareCode: string,
    tierCount: number,
  ) {
    const groupBuyCode = await tx.groupBuyCode.findUnique({
      where: { code: shareCode },
      include: {
        instance: {
          select: {
            id: true,
            userId: true,
            activityId: true,
            status: true,
          },
        },
      },
    });
    if (!groupBuyCode || groupBuyCode.status !== GroupBuyCodeStatus.ACTIVE) {
      throw new BadRequestException('团购推荐码无效');
    }
    if (groupBuyCode.instance.userId === userId) {
      throw new BadRequestException('不能使用自己的团购推荐码');
    }
    if (groupBuyCode.instance.activityId !== activityId) {
      throw new BadRequestException('团购推荐码与当前商品不匹配');
    }
    if (groupBuyCode.instance.status !== GroupBuyInstanceStatus.SHARING) {
      throw new BadRequestException('团购推荐码当前不可用');
    }
    const existingReferralCount = await tx.groupBuyReferral.count({
      where: {
        instanceId: groupBuyCode.instance.id,
        status: { in: ['CANDIDATE', 'VALID'] },
      },
    });
    if (existingReferralCount >= tierCount) {
      throw new BadRequestException('团购推荐码名额已满');
    }
    return groupBuyCode;
  }

  private getMonthStart(now = new Date()) {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  private async getMaxMonthlyLaunches(tx: Prisma.TransactionClient) {
    const row = await tx.ruleConfig.findUnique({
      where: { key: GROUP_BUY_MAX_MONTHLY_LAUNCHES_KEY },
      select: { value: true },
    });
    const value = this.unwrapRuleConfigNumber(row?.value);
    if (!Number.isFinite(value) || !value || value < 1) {
      return DEFAULT_MAX_MONTHLY_LAUNCHES;
    }
    return Math.max(1, Math.floor(value));
  }

  private unwrapRuleConfigNumber(raw: unknown) {
    const value = raw
      && typeof raw === 'object'
      && !Array.isArray(raw)
      && 'value' in raw
      ? (raw as { value?: unknown }).value
      : raw;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private async toCheckoutResponse(session: any) {
    const paymentParams = await this.buildPaymentParams(session);
    return {
      sessionId: session.id,
      merchantOrderNo: session.merchantOrderNo,
      expectedTotal: session.expectedTotal,
      goodsAmount: session.goodsAmount,
      shippingFee: session.shippingFee,
      discountAmount: session.discountAmount ?? 0,
      paymentParams,
    };
  }

  private async buildPaymentParams(session: any) {
    if (!session.merchantOrderNo) return {};
    if (
      session.paymentChannel === 'ALIPAY'
      && this.alipayService?.isAvailable?.()
    ) {
      const orderStr = await this.alipayService.createAppPayOrder({
        merchantOrderNo: session.merchantOrderNo,
        totalAmount: session.expectedTotal,
        subject: `爱买买团购订单-${session.merchantOrderNo}`,
      });
      return { channel: 'alipay', orderStr };
    }
    if (
      session.paymentChannel === 'WECHAT_PAY'
      && this.wechatPayService?.isAvailable?.()
    ) {
      const wxParams = await this.wechatPayService.createAppOrder({
        outTradeNo: session.merchantOrderNo,
        amount: session.expectedTotal,
        description: `爱买买团购订单-${session.merchantOrderNo}`,
      });
      return { channel: 'wechat', ...wxParams };
    }
    return {};
  }
}
