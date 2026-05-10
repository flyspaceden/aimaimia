import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AfterSaleOperatorType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptJsonValue } from '../../common/security/encryption';
import { parseChineseAddress } from '../../common/utils/parse-region';
import {
  CarrierWaybillAddress,
  SellerShippingService,
} from '../seller/shipping/seller-shipping.service';
import { AfterSaleStatusHistoryService } from './after-sale-status-history.service';
import { AfterSaleShippingPaymentService } from './after-sale-shipping-payment.service';

type Tx = Prisma.TransactionClient;

type ReturnWaybillResult = {
  carrierCode: string;
  carrierName: string;
  waybillNo: string;
  waybillUrl: string;
  sfOrderId?: string;
};

@Injectable()
export class AfterSaleReturnShippingService {
  constructor(
    private prisma: PrismaService,
    private sellerShippingService: SellerShippingService,
    private afterSaleStatusHistory: AfterSaleStatusHistoryService,
    private afterSaleShippingPaymentService: AfterSaleShippingPaymentService,
  ) {}

  getReturnWaybillBizNo(afterSaleId: string): string {
    return `AS_RETURN_${afterSaleId}`;
  }

  async createReturnWaybill(userId: string, afterSaleId: string) {
    const estimatedReturnShippingFee =
      await this.afterSaleShippingPaymentService.estimateReturnShippingFee(afterSaleId);
    let createdWaybill: ReturnWaybillResult | null = null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.acquireReturnWaybillLock(tx, afterSaleId);

        const request = await tx.afterSaleRequest.findFirst({
          where: { id: afterSaleId, userId },
          include: {
            order: {
              select: {
                id: true,
                addressSnapshot: true,
                items: {
                  include: {
                    sku: {
                      include: {
                        product: {
                          include: {
                            company: {
                              select: {
                                id: true,
                                name: true,
                                servicePhone: true,
                                address: true,
                                contact: true,
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            orderItem: {
              include: {
                sku: {
                  include: {
                    product: {
                      include: {
                        company: {
                          select: {
                            id: true,
                            name: true,
                            servicePhone: true,
                            address: true,
                            contact: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!request) throw new NotFoundException('售后申请不存在');
        this.assertCanCreateReturnWaybill(request);

        const returnItems = this.resolveReturnItems(request);
        const company = returnItems[0].sku.product.company;
        const companyId = company.id;
        const sender = this.parseBuyerAddress(request.order.addressSnapshot);
        const receiver = this.buildCompanyReturnReceiver(company);
        const items = returnItems.map((item: any) => ({
          name: item.sku?.product?.title || '退货商品',
          quantity: item.quantity,
          weight:
            item.sku?.weightGram && item.sku.weightGram > 0
              ? (item.sku.weightGram * item.quantity) / 1000
              : undefined,
        }));

        const waybill = await this.sellerShippingService.createCarrierWaybillWithAddresses({
          companyId,
          bizNo: this.getReturnWaybillBizNo(afterSaleId),
          carrierCode: 'SF',
          sender,
          receiver,
          items,
        });
        createdWaybill = waybill;

        const returnShippingFee = request.returnShippingFee == null
          ? estimatedReturnShippingFee
          : request.returnShippingFee;
        const now = new Date();
        const cas = await tx.afterSaleRequest.updateMany({
          where: {
            id: afterSaleId,
            userId,
            status: 'APPROVED',
            returnWaybillNo: null,
          },
          data: {
            status: 'RETURN_SHIPPING',
            returnCarrierCode: waybill.carrierCode,
            returnCarrierName: waybill.carrierName,
            returnWaybillNo: waybill.waybillNo,
            returnWaybillUrl: waybill.waybillUrl,
            returnLabelUrl: waybill.waybillUrl,
            returnSfOrderId: waybill.sfOrderId,
            returnShippingFee,
            returnShippingPayer: request.returnShippingPayer,
            returnShippedAt: now,
          },
        });

        if (cas.count === 0) {
          throw new ConflictException('售后申请状态已变更，请刷新后重试');
        }

        await this.afterSaleStatusHistory.create(tx, {
          afterSaleId,
          fromStatus: 'APPROVED',
          toStatus: 'RETURN_SHIPPING',
          reason: '买家生成退货面单',
          operatorType: AfterSaleOperatorType.BUYER,
          operatorId: userId,
          meta: {
            carrierCode: waybill.carrierCode,
            carrierName: waybill.carrierName,
            waybillNo: waybill.waybillNo,
            sfOrderId: waybill.sfOrderId ?? null,
          },
        });

        return {
          ok: true,
          carrierCode: waybill.carrierCode,
          carrierName: waybill.carrierName,
          waybillNo: waybill.waybillNo,
          waybillUrl: waybill.waybillUrl,
          returnLabelUrl: waybill.waybillUrl,
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      const waybillToCancel = createdWaybill as ReturnWaybillResult | null;
      if (waybillToCancel) {
        await this.sellerShippingService.cancelCarrierWaybill(
          waybillToCancel.sfOrderId ?? '',
          waybillToCancel.waybillNo,
        );
      }
      throw err;
    }
  }

  async cancelIfNotPickedUp(afterSaleId: string): Promise<
    { cancelled: true } | { cancelled: false; reason: 'NO_WAYBILL' | 'STATE_CHANGED' }
  > {
    const request = await this.prisma.afterSaleRequest.findUnique({
      where: { id: afterSaleId },
      select: {
        id: true,
        status: true,
        returnWaybillNo: true,
        returnSfOrderId: true,
      },
    });

    if (!request?.returnWaybillNo) {
      return { cancelled: false, reason: 'NO_WAYBILL' };
    }

    await this.sellerShippingService.cancelCarrierWaybill(
      request.returnSfOrderId ?? '',
      request.returnWaybillNo,
    );

    const cas = await this.prisma.$transaction(
      (tx) => tx.afterSaleRequest.updateMany({
        where: {
          id: afterSaleId,
          status: { in: ['APPROVED', 'RETURN_SHIPPING'] },
          returnWaybillNo: request.returnWaybillNo,
        },
        data: {
          returnCarrierCode: null,
          returnCarrierName: null,
          returnWaybillNo: null,
          returnWaybillUrl: null,
          returnLabelUrl: null,
          returnSfOrderId: null,
          returnShippedAt: null,
        },
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (cas.count === 0) {
      return { cancelled: false, reason: 'STATE_CHANGED' };
    }

    return { cancelled: true };
  }

  private assertCanCreateReturnWaybill(request: any): void {
    if (request.status !== 'APPROVED') {
      throw new BadRequestException('仅已审批通过的售后申请可生成退货面单');
    }
    if (!request.requiresReturn) {
      throw new BadRequestException('该售后申请无需退回商品');
    }
    if (request.returnWaybillNo) {
      throw new BadRequestException('该售后申请已生成退货面单');
    }
    if (
      request.returnShippingPayer === 'BUYER' &&
      !request.returnShippingFeeDeducted &&
      request.returnShippingPaidAt == null
    ) {
      throw new BadRequestException('请先支付退货运费');
    }
  }

  private resolveReturnItems(request: any): any[] {
    const items = request.orderItem ? [request.orderItem] : (request.order?.items ?? []);
    if (items.length === 0) {
      throw new BadRequestException('售后商品信息缺失，无法生成退货面单');
    }

    const companyIds = new Set(
      items.map((item: any) => item.companyId || item.sku?.product?.company?.id).filter(Boolean),
    );
    if (companyIds.size !== 1) {
      throw new BadRequestException('整单售后包含多个商家，请分别生成退货面单');
    }

    return items;
  }

  private parseBuyerAddress(addressSnapshot: unknown): CarrierWaybillAddress {
    if (!addressSnapshot) {
      throw new BadRequestException('订单地址信息缺失，无法生成退货面单');
    }

    let addr: any;
    try {
      addr = decryptJsonValue(
        typeof addressSnapshot === 'string'
          ? JSON.parse(addressSnapshot)
          : addressSnapshot,
      );
    } catch {
      throw new BadRequestException('订单地址信息格式错误，无法生成退货面单');
    }

    const name = addr.recipientName || addr.receiverName || addr.name || '';
    const tel = addr.phone || addr.recipientPhone || addr.receiverPhone || '';
    let province = addr.province || '';
    let city = addr.city || '';
    let district = addr.district || '';
    const detail = addr.detail || '';

    if (!province && addr.regionText) {
      const parsed = parseChineseAddress(addr.regionText);
      province = parsed.province;
      city = parsed.city;
      district = parsed.district;
    }

    const sender = { name, tel, province, city, district, detail };
    this.assertAddressReady(sender, '买家退货寄件地址不完整，请先补充收货地址信息');
    return sender;
  }

  private buildCompanyReturnReceiver(company: {
    name: string;
    servicePhone: string | null;
    address: Prisma.JsonValue | null;
    contact: Prisma.JsonValue | null;
  }): CarrierWaybillAddress {
    const address = (company.address ?? {}) as Record<string, any>;
    const contact = (company.contact ?? {}) as Record<string, any>;
    const receiver = {
      name: contact?.name || company.name,
      tel: contact?.phone || company.servicePhone || '',
      province: address?.province || '',
      city: address?.city || '',
      district: address?.district || '',
      detail: address?.detail || address?.text || '',
    };

    this.assertAddressReady(
      receiver,
      '商家退货收件地址不完整，请联系商家补充省市和详细地址',
    );
    return receiver;
  }

  private assertAddressReady(address: CarrierWaybillAddress, message: string): void {
    if (!address.name || !address.tel || !address.province || !address.city || !address.detail) {
      throw new BadRequestException(message);
    }
  }

  private async acquireReturnWaybillLock(tx: Tx, afterSaleId: string): Promise<void> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext('after-sale-return-waybill'),
        hashtext(${afterSaleId})
      )
    `;
  }
}
