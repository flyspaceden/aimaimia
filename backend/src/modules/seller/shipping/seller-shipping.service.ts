import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { SfExpressService } from '../../shipment/sf-express.service';
import { OrderShippingCostService } from '../../shipment/order-shipping-cost.service';
import { maskIp, maskTrackingNo } from '../../../common/security/privacy-mask';
import { decryptJsonValue } from '../../../common/security/encryption';
import { parseChineseAddress } from '../../../common/utils/parse-region';
import { SellerRiskControlService } from '../risk-control/seller-risk-control.service';
import { UploadService } from '../../upload/upload.service';
import { InboxService } from '../../inbox/inbox.service';
import { fetchBinaryWithLimit } from '../../../common/utils/remote-binary-fetch.util';
import { DEFAULT_SKU_WEIGHT_GRAM, GRAMS_PER_KG } from '../../../common/constants/shipping.constants';

export type CarrierWaybillAddress = {
  name: string;
  tel: string;
  province: string;
  city: string;
  district: string;
  detail: string;
};

export type CarrierWaybillItem = {
  name: string;
  quantity: number;
  weightGram?: number;
  weight?: number;
};

type WaybillGenerationMarker = {
  waybillGeneration: {
    status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    token: string;
    startedAt: string;
    attempt: number;
    sfCustomerOrderId: string;
    completedAt?: string;
  };
};

type WaybillGenerationContext = {
  orderId: string;
  userId: string;
  companyId: string;
  shipmentId: string;
  marker: WaybillGenerationMarker;
  sfCustomerOrderId: string;
  addressSnapshot: unknown;
  items: CarrierWaybillItem[];
  carrierCode: string;
};

@Injectable()
export class SellerShippingService {
  private readonly logger = new Logger(SellerShippingService.name);
  private readonly apiPrefix: string;
  private readonly hmacSecret: string;
  private static readonly WAYBILL_LOCK_NAMESPACE = 'seller-waybill-order';
  private static readonly WAYBILL_GENERATION_MARKER_TTL_MS = 15 * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private sellerRiskControl: SellerRiskControlService,
    private sfExpress: SfExpressService,
    private uploadService: UploadService,
    private shippingCost: OrderShippingCostService,
    @Optional() private inboxService?: InboxService,
  ) {
    this.apiPrefix = this.configService.get<string>('API_PREFIX', '/api/v1');
    this.hmacSecret = this.configService.getOrThrow<string>('SELLER_JWT_SECRET');
  }

  /**
   * 验证订单包含当前企业商品
   */
  private assertCompanyCanAccessOrder(
    companyId: string,
    items: Array<{ companyId: string | null }>,
  ) {
    const hasMyItems = items.some((item) => item.companyId === companyId);
    if (!hasMyItems) {
      throw new ForbiddenException('无权操作该订单');
    }
  }

  /**
   * 解析地址快照
   * 兼容明文 JSON 与加密 envelope。
   * 返回结构化地址（省/市/区/详细），供顺丰等快递 API 使用。
   */
  private parseAddressSnapshot(addressSnapshot: unknown): {
    name: string;
    phone: string;
    province: string;
    city: string;
    district: string;
    detail: string;
    fullAddress: string;
  } {
    if (!addressSnapshot) {
      throw new BadRequestException('订单地址信息缺失');
    }

    let addr: any;
    try {
      addr = decryptJsonValue(
        typeof addressSnapshot === 'string'
          ? JSON.parse(addressSnapshot)
          : addressSnapshot,
      );
    } catch {
      throw new BadRequestException('订单地址信息格式错误');
    }

    // 兼容新旧字段名：recipientName(checkout写入) > receiverName(旧) > name(更旧)
    const name = addr.recipientName || addr.receiverName || addr.name || '';
    const phone = addr.phone || addr.recipientPhone || addr.receiverPhone || '';

    // 优先使用独立字段；缺失时用统一 parser 解析 regionText
    // （覆盖直辖市 / 自治区 / 空格分隔 / 直接拼接 四种格式）
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

    const fullAddress = [province, city, district, detail].filter(Boolean).join('');

    return { name, phone, province, city, district, detail, fullAddress };
  }

  /**
   * 获取发件人信息（从企业信息构建）
   */
  private async getSenderInfo(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, servicePhone: true, address: true, contact: true },
    });

    if (!company) {
      throw new NotFoundException('企业信息不存在');
    }

    // 从 company.address（Json）和 contact（Json）提取结构化发件信息
    const address = company.address as Record<string, any> | null;
    const contact = company.contact as Record<string, any> | null;

    return {
      senderName: contact?.name || company.name,
      senderPhone: contact?.phone || company.servicePhone || '',
      senderProvince: address?.province || '',
      senderCity: address?.city || '',
      senderDistrict: address?.district || '',
      senderDetail: address?.detail || '',
      senderAddress: address?.text || [address?.province, address?.city, address?.district, address?.detail].filter(Boolean).join('') || '',
    };
  }

  /**
   * 生成电子面单
   *
   * 核心流程：
   * 1. 校验订单归属及状态
   * 2. 解析收件人地址
   * 3. 获取发件人信息
   * 4. 调用快递服务商 API 创建面单
   * 5. 更新 Shipment 记录
   *
   * 使用 Serializable 隔离级别防止并发重复生成
   */
  async generateWaybill(
    companyId: string,
    staffId: string,
    orderId: string,
    carrierCode: string,
  ) {
    // 只支持顺丰
    carrierCode = 'SF';

    const context = await this.reserveWaybillGeneration(
      companyId,
      orderId,
      carrierCode,
    );

    let waybillResult: Awaited<ReturnType<SellerShippingService['createCarrierWaybill']>>;
    try {
      waybillResult = await this.createCarrierWaybill(
        companyId,
        orderId,
        carrierCode,
        context.addressSnapshot,
        context.items,
        context.sfCustomerOrderId,
      );
    } catch (error) {
      await this.clearWaybillGenerationMarker(context);
      await this.notifyBuyerForReceiverInfoError(context, error);
      throw error;
    }

    await this.persistGeneratedWaybill(context, waybillResult);
    await this.shippingCost.recordPackage({
      orderId: context.orderId,
      packageIndex: 0,
      companyId: context.companyId,
      sfOrderId: waybillResult.sfOrderId,
      weightGramSent: waybillResult.weightGramSent,
    });

    this.logger.log(
      `面单生成成功: orderId=${orderId}, carrierCode=${carrierCode}, waybillNo=${waybillResult.waybillNo}`,
    );

    return {
      ok: true,
      waybillNo: this.maskWaybillNo(waybillResult.waybillNo),
      waybillPrintUrl: this.getWaybillPrintUrl(companyId, orderId, staffId),
      carrierCode: waybillResult.carrierCode,
      carrierName: waybillResult.carrierName,
    };
  }

  private async reserveWaybillGeneration(
    companyId: string,
    orderId: string,
    carrierCode: string,
  ): Promise<WaybillGenerationContext> {
    return this.prisma.$transaction(async (tx) => {
      await this.acquireWaybillGenerationLock(
        tx,
        `${companyId}:${orderId}`,
      );

      const order = await tx.order.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        throw new NotFoundException('订单不存在');
      }

      const orderItems = await tx.orderItem.findMany({
        where: { orderId, companyId },
        select: {
          companyId: true,
          quantity: true,
          productSnapshot: true,
          sku: {
            select: {
              weightGram: true,
              product: { select: { title: true } },
            },
          },
        },
      });

      this.assertCompanyCanAccessOrder(companyId, orderItems);

      if (order.status !== 'PAID' && order.status !== 'SHIPPED') {
        throw new BadRequestException('只有已付款或部分已发货订单可生成面单');
      }

      const existingShipment = await tx.shipment.findUnique({
        where: {
          orderId_companyId: {
            orderId,
            companyId,
          },
        },
      });

      if (existingShipment?.waybillNo) {
        throw new BadRequestException('该订单已生成面单，请勿重复操作');
      }

      if (this.hasActiveWaybillGenerationMarker(existingShipment?.rawCarrierPayload)) {
        throw new BadRequestException('该订单面单正在生成，请稍后重试');
      }

      const attempt = this.getNextWaybillGenerationAttempt(existingShipment?.rawCarrierPayload);
      const sfCustomerOrderId = this.buildSfCustomerOrderId(orderId, companyId, attempt);
      const marker = this.createWaybillGenerationMarker(attempt, sfCustomerOrderId);
      const items = orderItems.map((item) => ({
        name: this.normalizeSnapshotProduct(item.productSnapshot)?.title || item.sku?.product?.title || '商品',
        quantity: item.quantity,
        weightGram: this.resolveOrderItemWeightGram(item),
      }));

      let shipmentId: string;
      if (existingShipment) {
        const cas = await tx.shipment.updateMany({
          where: {
            id: existingShipment.id,
            waybillNo: null,
          },
          data: {
            carrierCode,
            carrierName: '顺丰速运',
            rawCarrierPayload: marker as Prisma.InputJsonValue,
          },
        });

        if (cas.count === 0) {
          throw new BadRequestException('该订单已生成面单，请勿重复操作');
        }
        shipmentId = existingShipment.id;
      } else {
        const shipment = await tx.shipment.create({
          data: {
            orderId,
            companyId,
            carrierCode,
            carrierName: '顺丰速运',
            waybillNo: null,
            status: 'INIT',
            rawCarrierPayload: marker as Prisma.InputJsonValue,
          },
        });
        shipmentId = shipment.id;
      }

      return {
        orderId,
        userId: order.userId,
        companyId,
        shipmentId,
        marker,
        sfCustomerOrderId,
        addressSnapshot: order.addressSnapshot,
        items,
        carrierCode,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async persistGeneratedWaybill(
    context: WaybillGenerationContext,
    waybillResult: Awaited<ReturnType<SellerShippingService['createCarrierWaybill']>>,
  ): Promise<void> {
    const cas = await this.prisma.$transaction(
      (tx) => tx.shipment.updateMany({
        where: {
          id: context.shipmentId,
          waybillNo: null,
          rawCarrierPayload: {
            equals: context.marker as Prisma.InputJsonValue,
          },
        },
        data: {
          waybillNo: waybillResult.waybillNo,
          waybillUrl: waybillResult.waybillUrl,
          carrierCode: waybillResult.carrierCode,
          carrierName: waybillResult.carrierName,
          sfOrderId: waybillResult.sfOrderId,
          senderInfoSnapshot: waybillResult.senderInfoSnapshot as Prisma.InputJsonValue,
          receiverInfoSnapshot: waybillResult.receiverInfoSnapshot as Prisma.InputJsonValue,
          rawCarrierPayload: this.createCompletedWaybillGenerationPayload(context),
        },
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (cas.count > 0) return;

    const current = await this.prisma.shipment.findUnique({
      where: { id: context.shipmentId },
      select: {
        waybillNo: true,
        sfOrderId: true,
        rawCarrierPayload: true,
      },
    });

    if (current?.waybillNo === waybillResult.waybillNo) {
      return;
    }

    await this.compensateFailedWaybillPersist(context, waybillResult);
    throw new BadRequestException('该订单面单状态已变更，请刷新后重试');
  }

  private async compensateFailedWaybillPersist(
    context: WaybillGenerationContext,
    waybillResult: Awaited<ReturnType<SellerShippingService['createCarrierWaybill']>>,
  ): Promise<void> {
    try {
      await this.cancelCarrierWaybillStrict(
        waybillResult.sfOrderId ?? '',
        waybillResult.waybillNo,
      );
      await this.clearWaybillGenerationMarker(context);
    } catch (err: any) {
      this.logger.warn(`面单生成最终持久化失败，且远端取消失败: ${err.message}`);
      await this.markWaybillGenerationFailed(context, waybillResult, err);
    }
  }

  private isReceiverContactError(error: any): boolean {
    const message = String(error?.message || '');
    if (!message) return false;
    if (/寄方|寄件|发件|sender|商家|企业/.test(message)) return false;
    return /对方.*(电话|手机).*不合法|收(件|方).*(电话|手机).*不合法|receiver.*(phone|tel)/i.test(message);
  }

  private async notifyBuyerForReceiverInfoError(
    context: WaybillGenerationContext,
    error: any,
  ): Promise<void> {
    if (!this.inboxService?.send || !this.isReceiverContactError(error)) return;

    try {
      await this.inboxService.send({
        userId: context.userId,
        category: 'transaction',
        type: 'order_receiver_info_required',
        title: '请修改收货信息',
        content: '商家发货时发现收货手机号无法生成快递面单，请修改收货信息。修改前商家无法发货。',
        target: {
          route: '/orders/[id]',
          params: { id: context.orderId },
        },
      });
    } catch (notifyError: any) {
      this.logger.warn(
        `收货信息纠错通知发送失败: orderId=${context.orderId}, error=${notifyError?.message || notifyError}`,
      );
    }
  }

  private createWaybillGenerationMarker(
    attempt: number,
    sfCustomerOrderId: string,
  ): WaybillGenerationMarker {
    return {
      waybillGeneration: {
        status: 'IN_PROGRESS',
        token: randomUUID(),
        startedAt: new Date().toISOString(),
        attempt,
        sfCustomerOrderId,
      },
    };
  }

  private buildSfCustomerOrderId(
    orderId: string,
    companyId: string,
    attempt: number,
  ): string {
    const digest = createHash('sha1')
      .update(`${orderId}:${companyId}:${attempt}`)
      .digest('hex')
      .slice(0, 32);

    return `AIMM-WB-${digest}`;
  }

  private getNextWaybillGenerationAttempt(rawCarrierPayload: unknown): number {
    const previousAttempt = Math.max(
      this.getCancelledWaybillCount(rawCarrierPayload),
      this.getCompletedWaybillAttempt(rawCarrierPayload),
    );
    return previousAttempt + 1;
  }

  private getCancelledWaybillCount(rawCarrierPayload: unknown): number {
    if (!rawCarrierPayload || typeof rawCarrierPayload !== 'object') return 0;
    const payload = rawCarrierPayload as { waybillCancellation?: unknown };
    if (!payload.waybillCancellation || typeof payload.waybillCancellation !== 'object') {
      return 0;
    }

    const cancelledCount = Number(
      (payload.waybillCancellation as { cancelledCount?: unknown }).cancelledCount,
    );
    return Number.isInteger(cancelledCount) && cancelledCount > 0
      ? cancelledCount
      : 0;
  }

  private getCompletedWaybillAttempt(rawCarrierPayload: unknown): number {
    const marker = this.getWaybillGenerationMarker(rawCarrierPayload);
    if (!marker || marker.status !== 'COMPLETED') return 0;

    const attempt = Number(marker.attempt);
    return Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
  }

  private hasActiveWaybillGenerationMarker(rawCarrierPayload: unknown): boolean {
    const marker = this.getWaybillGenerationMarker(rawCarrierPayload);
    if (!marker || marker.status !== 'IN_PROGRESS') return false;

    const startedAt = Date.parse(marker.startedAt ?? '');
    if (Number.isNaN(startedAt)) return true;

    return Date.now() - startedAt < SellerShippingService.WAYBILL_GENERATION_MARKER_TTL_MS;
  }

  private getWaybillGenerationMarker(rawCarrierPayload: unknown): {
    status?: string;
    token?: string;
    startedAt?: string;
    attempt?: number;
    sfCustomerOrderId?: string;
    completedAt?: string;
  } | null {
    if (!rawCarrierPayload || typeof rawCarrierPayload !== 'object') return null;
    const payload = rawCarrierPayload as { waybillGeneration?: unknown };
    if (!payload.waybillGeneration || typeof payload.waybillGeneration !== 'object') {
      return null;
    }
    return payload.waybillGeneration as {
      status?: string;
      token?: string;
      startedAt?: string;
      attempt?: number;
      sfCustomerOrderId?: string;
      completedAt?: string;
    };
  }

  private async clearWaybillGenerationMarker(
    context: WaybillGenerationContext,
  ): Promise<void> {
    await this.prisma.$transaction(
      (tx) => tx.shipment.updateMany({
        where: {
          id: context.shipmentId,
          waybillNo: null,
          rawCarrierPayload: {
            equals: context.marker as Prisma.InputJsonValue,
          },
        },
        data: { rawCarrierPayload: Prisma.DbNull },
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async markWaybillGenerationFailed(
    context: WaybillGenerationContext,
    waybillResult: Awaited<ReturnType<SellerShippingService['createCarrierWaybill']>>,
    error: Error,
  ): Promise<void> {
    await this.prisma.$transaction(
      (tx) => tx.shipment.updateMany({
        where: {
          id: context.shipmentId,
          waybillNo: null,
          rawCarrierPayload: {
            equals: context.marker as Prisma.InputJsonValue,
          },
        },
        data: {
          rawCarrierPayload: {
            waybillGeneration: {
              ...context.marker.waybillGeneration,
              status: 'FAILED',
              failedAt: new Date().toISOString(),
              failureReason: 'FINAL_PERSIST_CANCEL_FAILED',
              remoteWaybillNo: waybillResult.waybillNo,
              remoteSfOrderId: waybillResult.sfOrderId ?? null,
              error: error.message,
            },
          } as Prisma.InputJsonValue,
        },
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private createCompletedWaybillGenerationPayload(
    context: WaybillGenerationContext,
  ): Prisma.InputJsonValue {
    return {
      waybillGeneration: {
        ...context.marker.waybillGeneration,
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * 批量生成面单
   * 逐个调用 generateWaybill，收集结果（失败不阻断后续）
   */
  async batchGenerateWaybill(
    companyId: string,
    staffId: string,
    items: { orderId: string; carrierCode: string }[],
  ) {
    await this.sellerRiskControl.assertFeatureAllowed(
      companyId,
      'BATCH_WAYBILL',
    );

    const results: {
      orderId: string;
      success: boolean;
      waybillNo?: string;
      waybillPrintUrl?: string;
      error?: string;
    }[] = [];

    for (const item of items) {
      try {
          const result = await this.generateWaybill(
            companyId,
            staffId,
            item.orderId,
            item.carrierCode,
          );
          results.push({
            orderId: item.orderId,
            success: true,
            waybillNo: result.waybillNo,
            waybillPrintUrl: result.waybillPrintUrl,
          });
      } catch (err: any) {
        results.push({
          orderId: item.orderId,
          success: false,
          error: err.message,
        });
      }
    }

    return { results };
  }

  /**
   * 获取面单打印代理 URL
   * 生成带 HMAC 签名的临时访问 URL，有效期 15 分钟
   */
  getWaybillPrintUrl(
    companyId: string,
    orderId: string,
    staffId: string,
  ): string {
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 分钟过期
    const payload = `${companyId}:${orderId}:${staffId}:${expiresAt}`;
    const signature = createHmac('sha256', this.hmacSecret).update(payload).digest('hex');

    return `${this.apiPrefix}/seller/orders/${orderId}/waybill/print?companyId=${encodeURIComponent(companyId)}&staffId=${encodeURIComponent(staffId)}&expires=${expiresAt}&sig=${signature}`;
  }

  /**
   * 验证面单打印 URL 签名
   */
  verifyPrintSignature(
    companyId: string,
    orderId: string,
    staffId: string,
    expires: string,
    signature: string,
  ): boolean {
    const expiresAt = parseInt(expires, 10);
    const payload = `${companyId}:${orderId}:${staffId}:${expiresAt}`;
    const expectedSig = createHmac('sha256', this.hmacSecret).update(payload).digest('hex');

    // 使用时序安全比较，防止 timing attack
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const actualBuf = Buffer.from(signature, 'hex');
    const comparableBuf =
      actualBuf.length === expectedBuf.length
        ? actualBuf
        : Buffer.alloc(expectedBuf.length);
    const signatureValid =
      timingSafeEqual(expectedBuf, comparableBuf) &&
      actualBuf.length === expectedBuf.length;

    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      return false;
    }

    return signatureValid;
  }

  /**
   * 获取面单打印数据
   * 返回面单图片 URL 和相关信息，供打印代理接口使用
   */
  async getWaybillPrintData(companyId: string, orderId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: {
        orderId_companyId: {
          orderId,
          companyId,
        },
      },
    });

    if (!shipment) {
      throw new NotFoundException('物流记录不存在');
    }

    if (!shipment.waybillNo || !shipment.waybillUrl) {
      throw new NotFoundException('该订单未生成电子面单');
    }

    return {
      waybillNo: shipment.waybillNo,
      waybillUrl: shipment.waybillUrl,
      carrierCode: shipment.carrierCode,
      carrierName: shipment.carrierName,
    };
  }

  async createCarrierWaybill(
    companyId: string,
    orderId: string,
    carrierCode: string,
    addressSnapshot: unknown,
    items: CarrierWaybillItem[],
    sfCustomerOrderId?: string,
  ) {
    const senderInfo = await this.getSenderInfo(companyId);

    // PC-1 前置校验：未结构化的地址禁止发货
    if (!senderInfo.senderProvince || !senderInfo.senderCity) {
      throw new BadRequestException(
        '企业发货地址不完整，请在「企业信息」页面补充省市区详细地址后再发货',
      );
    }

    const recipientInfo = this.parseAddressSnapshot(addressSnapshot);
    const result = await this.createCarrierWaybillWithAddresses({
      companyId,
      bizNo: orderId,
      sfCustomerOrderId,
      carrierCode,
      sender: {
        name: senderInfo.senderName,
        tel: senderInfo.senderPhone,
        province: senderInfo.senderProvince,
        city: senderInfo.senderCity,
        district: senderInfo.senderDistrict,
        detail: senderInfo.senderDetail,
      },
      receiver: {
        name: recipientInfo.name,
        tel: recipientInfo.phone,
        province: recipientInfo.province,
        city: recipientInfo.city,
        district: recipientInfo.district,
        detail: recipientInfo.detail,
      },
      items,
    });

    return {
      ...result,
      senderInfoSnapshot: senderInfo,
      receiverInfoSnapshot: recipientInfo,
    };
  }

  async createCarrierWaybillWithAddresses(input: {
    companyId: string;
    bizNo: string;
    orderId?: string;
    sfCustomerOrderId?: string;
    carrierCode: string;
    sender: CarrierWaybillAddress;
    receiver: CarrierWaybillAddress;
    items: CarrierWaybillItem[];
  }) {
    const companyId = input.companyId;
    const bizNo = input.bizNo || input.orderId;
    if (!bizNo) {
      throw new BadRequestException('面单业务单号缺失');
    }

    // 顺丰 cargoDesc ≤20 字：多商品订单用「首品名 等N件」摘要，避免拼接全部商品名超限
    // （共享层 SfExpressService.createOrder 还会再兜底截断 20 字）
    const firstItemName = input.items[0]?.name || '商品';
    const cargo =
      input.items.length > 1
        ? `${firstItemName} 等${input.items.length}件`
        : firstItemName;
    const totalWeightGram = this.calculateTotalWeightGram(input.items);
    const weightGramSent = Math.max(totalWeightGram, DEFAULT_SKU_WEIGHT_GRAM);
    const totalWeightKg = Math.max(totalWeightGram / GRAMS_PER_KG, 1);

    // 顺丰要求取消后的客户订单号不能复用；生成链路传入按尝试次数派生的短 ID。
    // 未传入时保持历史调用方（售后等）的 bizNo_companyId 兼容行为。
    const orderResult = await this.sfExpress.createOrder({
      orderId: input.sfCustomerOrderId ?? `${bizNo}_${companyId}`,
      sender: input.sender,
      receiver: input.receiver,
      cargo,
      totalWeight: totalWeightKg,
      packageCount: 1,
    });

    // 获取面单 PDF：顺丰返回临时 URL（1-2h 过期） → 下载 → 持久化到 OSS
    // OSS 失败不能回退 SF 临时 URL（写进 DB 是"定时炸弹"），留空让卖家点"重新打印"重试
    let waybillUrl = '';
    try {
      const printResult = await this.sfExpress.printWaybill(orderResult.waybillNo);
      try {
        const fetched = await fetchBinaryWithLimit(printResult.pdfUrl, {
          maxBytes: 10 * 1024 * 1024,
          timeoutMs: 15000,
          allowedContentTypes: ['application/pdf', 'application/octet-stream'],
        });
        const uploaded = await this.uploadService.uploadBuffer(
          fetched.buffer,
          'waybills',
          '.pdf',
          'application/pdf',
        );
        waybillUrl = uploaded.url;
      } catch (persistErr: any) {
        this.logger.error(
          `面单 PDF OSS 持久化失败（waybillUrl 留空，卖家需点"重新打印"）: bizNo=${bizNo}, waybillNo=${orderResult.waybillNo}, err=${persistErr.message}`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`面单打印失败（不阻塞发货）: ${err.message}`);
    }

    return {
      carrierCode: 'SF',
      carrierName: '顺丰速运',
      waybillNo: orderResult.waybillNo,
      waybillUrl,
      sfOrderId: orderResult.sfOrderId,
      weightGramSent,
      senderInfoSnapshot: input.sender,
      receiverInfoSnapshot: input.receiver,
    };
  }

  private normalizeReserveItemWeightGram(weightGram: unknown): number {
    const normalized = Number(weightGram);
    return Number.isFinite(normalized) && normalized > 0
      ? Math.ceil(normalized)
      : DEFAULT_SKU_WEIGHT_GRAM;
  }

  private normalizeSnapshotProduct(productSnapshot: unknown): Record<string, any> | null {
    if (!productSnapshot || Array.isArray(productSnapshot)) {
      return null;
    }
    if (typeof productSnapshot === 'string') {
      try {
        const parsed = JSON.parse(productSnapshot);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as Record<string, any>
          : null;
      } catch {
        return null;
      }
    }
    return typeof productSnapshot === 'object' ? productSnapshot as Record<string, any> : null;
  }

  private normalizePositiveInt(value: unknown): number {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized > 0
      ? Math.trunc(normalized)
      : 0;
  }

  private getBundleSnapshotWeightPerUnit(
    productSnapshot: unknown,
    orderItemQuantity: unknown,
  ): number | null {
    const snapshot = this.normalizeSnapshotProduct(productSnapshot);
    if (snapshot?.productType !== 'BUNDLE') {
      return null;
    }

    const bundleWeight = Number(snapshot.bundleTotalWeightGram);
    if (Number.isFinite(bundleWeight) && bundleWeight > 0) {
      return Math.ceil(bundleWeight);
    }

    const bundleItems = Array.isArray(snapshot.bundleItems) ? snapshot.bundleItems : [];
    if (bundleItems.length === 0) {
      return null;
    }

    const quantity = this.normalizePositiveInt(orderItemQuantity);
    const derivedWeight = bundleItems.reduce((sum: number, item: any) => {
      const weightGram = Number(item?.weightGram);
      if (!Number.isFinite(weightGram) || weightGram <= 0) {
        return sum;
      }

      const quantityPerBundle = this.normalizePositiveInt(item?.quantityPerBundle);
      if (quantityPerBundle > 0) {
        return sum + Math.ceil(weightGram) * quantityPerBundle;
      }

      const totalQuantity = this.normalizePositiveInt(item?.totalQuantity);
      if (totalQuantity > 0 && quantity > 0) {
        return sum + Math.ceil(weightGram) * Math.max(1, Math.round(totalQuantity / quantity));
      }

      return sum;
    }, 0);

    return derivedWeight > 0 ? derivedWeight : null;
  }

  private resolveOrderItemWeightGram(item: {
    quantity?: number;
    productSnapshot?: unknown;
    sku?: { weightGram?: unknown };
  }): number {
    const snapshotWeight = this.getBundleSnapshotWeightPerUnit(item.productSnapshot, item.quantity);
    if (snapshotWeight) {
      return snapshotWeight;
    }
    return this.normalizeReserveItemWeightGram(item.sku?.weightGram);
  }

  private calculateTotalWeightGram(items: CarrierWaybillItem[]): number {
    return items.reduce((sum, item) => {
      const quantity = Number.isFinite(Number(item.quantity)) && item.quantity > 0
        ? item.quantity
        : 0;
      const weightGram = Number(item.weightGram);
      if (Number.isFinite(weightGram) && weightGram > 0) {
        return sum + Math.ceil(weightGram) * quantity;
      }

      const legacyWeightKg = Number(item.weight);
      if (Number.isFinite(legacyWeightKg) && legacyWeightKg > 0) {
        return sum + Math.round(legacyWeightKg * GRAMS_PER_KG) * quantity;
      }

      return sum;
    }, 0);
  }

  async cancelCarrierWaybill(sfOrderId: string, waybillNo: string) {
    if (!sfOrderId && !waybillNo) {
      this.logger.warn('取消面单跳过: 缺少顺丰订单ID和运单号');
      return;
    }
    try {
      await this.cancelCarrierWaybillStrict(sfOrderId, waybillNo);
    } catch (err: any) {
      this.logger.warn(`取消面单调用顺丰失败（不阻塞本地清除）: ${err.message}`);
    }
  }

  async cancelCarrierWaybillStrict(sfOrderId: string, waybillNo: string) {
    if (!sfOrderId && !waybillNo) {
      this.logger.warn('取消面单跳过: 缺少顺丰订单ID和运单号');
      return;
    }
    const result = await this.sfExpress.cancelOrder(sfOrderId, waybillNo);
    if (result?.success === false) {
      throw new Error('顺丰取消面单失败');
    }
  }

  async recordWaybillPrintAccess(
    companyId: string,
    staffId: string,
    orderId: string,
    ip?: string,
    userAgent?: string,
  ) {
    try {
      await this.prisma.sellerAuditLog.create({
        data: {
          staffId,
          companyId,
          action: 'PRINT_WAYBILL',
          module: 'shipping',
          targetType: 'Order',
          targetId: orderId,
          ip: maskIp(ip),
          userAgent,
        },
      });
    } catch (err) {
      this.logger.error(`面单打印审计日志写入失败: ${(err as Error).message}`);
    }
  }

  /**
   * 取消面单
   * 仅在未发货（status 为 INIT）时允许取消
   */
  async cancelWaybill(companyId: string, orderId: string) {
    // 1. 读取面单信息（事务外，用于远端取消）
    const shipment = await this.prisma.shipment.findUnique({
      where: {
        orderId_companyId: { orderId, companyId },
      },
    });

    if (!shipment) {
      throw new NotFoundException('物流记录不存在');
    }
    if (!shipment.waybillNo) {
      throw new BadRequestException('该订单未生成面单，无法取消');
    }
    if (shipment.status !== 'INIT') {
      throw new BadRequestException('已发货的订单不可取消面单');
    }

    // 2. 用户主动取消必须严格确认远端取消成功，失败时保留本地面单字段
    await this.cancelCarrierWaybillStrict(shipment.sfOrderId ?? '', shipment.waybillNo);

    // 3. 远端取消后，清空本地记录
    const cancellationPayload = this.createWaybillCancellationPayload(
      shipment.rawCarrierPayload,
      shipment.sfOrderId,
      shipment.waybillNo,
    );

    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.shipment.updateMany({
        where: {
          id: shipment.id,
          status: 'INIT',
          waybillNo: shipment.waybillNo,
        },
        data: {
          waybillNo: null,
          waybillUrl: null,
          trackingNo: null,
          sfOrderId: null,
          rawCarrierPayload: cancellationPayload,
        },
      });

      if (cas.count === 0) {
        throw new BadRequestException('该订单面单状态已变更，请刷新后重试');
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    this.logger.log(
      `面单取消成功: orderId=${orderId}, waybillNo=${shipment.waybillNo}`,
    );

    return { ok: true };
  }

  private createWaybillCancellationPayload(
    rawCarrierPayload: unknown,
    sfOrderId: string | null,
    waybillNo: string,
  ): Prisma.InputJsonValue {
    return {
      waybillCancellation: {
        cancelledCount: Math.max(
          this.getCancelledWaybillCount(rawCarrierPayload),
          this.getCompletedWaybillAttempt(rawCarrierPayload),
          1,
        ),
        lastSfOrderId: sfOrderId ?? null,
        lastWaybillNo: waybillNo,
        cancelledAt: new Date().toISOString(),
      },
    };
  }

  private maskWaybillNo(waybillNo: string) {
    return maskTrackingNo(waybillNo) || waybillNo;
  }

  private async acquireWaybillGenerationLock(
    tx: Prisma.TransactionClient,
    resourceKey: string,
  ) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${SellerShippingService.WAYBILL_LOCK_NAMESPACE}),
        hashtext(${resourceKey})
      )
    `;
  }
}
