import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { Kuaidi100WaybillService } from '../../shipment/kuaidi100-waybill.service';
import { Kuaidi100Service } from '../../shipment/kuaidi100.service';
import { maskIp, maskTrackingNo } from '../../../common/security/privacy-mask';
import { decryptJsonValue } from '../../../common/security/encryption';
import { SellerRiskControlService } from '../risk-control/seller-risk-control.service';

@Injectable()
export class SellerShippingService {
  private readonly logger = new Logger(SellerShippingService.name);
  private readonly apiPrefix: string;
  private readonly hmacSecret: string;
  private static readonly WAYBILL_LOCK_NAMESPACE = 'seller-waybill-order';

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private sellerRiskControl: SellerRiskControlService,
    private kuaidi100Waybill: Kuaidi100WaybillService,
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

    // 优先使用独立字段，fallback 从 regionText 解析
    let province = addr.province || '';
    let city = addr.city || '';
    let district = addr.district || '';
    const detail = addr.detail || '';

    if (!province && addr.regionText) {
      const m = addr.regionText.match(
        /^(.+?(?:省|自治区|市))(.+?(?:市|自治州|地区|盟))(.+?(?:区|县|市|旗))?/,
      );
      if (m) {
        province = m[1] || '';
        city = m[2] || '';
        district = m[3] || '';
      } else {
        province = addr.regionText;
      }
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
    let createdWaybill: { carrierCode: string; waybillNo: string; taskId?: string } | null = null;

    try {
      return await this.prisma.$transaction(async (tx) => {
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
            sku: { select: { product: { select: { title: true } } } },
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

        const items = orderItems.map((item) => ({
          name: item.sku?.product?.title || '商品',
          quantity: item.quantity,
        }));

        const waybillResult = await this.createCarrierWaybill(
          companyId,
          carrierCode,
          order.addressSnapshot,
          items,
        );
        createdWaybill = {
          carrierCode: waybillResult.carrierCode,
          waybillNo: waybillResult.waybillNo,
          taskId: waybillResult.taskId,
        };

        if (existingShipment) {
          const cas = await tx.shipment.updateMany({
            where: {
              id: existingShipment.id,
              waybillNo: null,
            },
            data: {
              waybillNo: waybillResult.waybillNo,
              waybillUrl: waybillResult.waybillUrl,
              carrierCode: waybillResult.carrierCode,
              carrierName: waybillResult.carrierName,
              kuaidi100TaskId: waybillResult.taskId,
            },
          });

          if (cas.count === 0) {
            throw new BadRequestException('该订单已生成面单，请勿重复操作');
          }
        } else {
          await tx.shipment.create({
            data: {
              orderId,
              companyId,
              carrierCode: waybillResult.carrierCode,
              carrierName: waybillResult.carrierName,
              waybillNo: waybillResult.waybillNo,
              waybillUrl: waybillResult.waybillUrl,
              kuaidi100TaskId: waybillResult.taskId,
              status: 'INIT',
              senderInfoSnapshot: waybillResult.senderInfoSnapshot as Prisma.InputJsonValue,
              receiverInfoSnapshot: waybillResult.receiverInfoSnapshot as Prisma.InputJsonValue,
            },
          });
        }

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
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      await this.rollbackCreatedWaybill(createdWaybill);
      throw error;
    }
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
    carrierCode: string,
    addressSnapshot: unknown,
    items: Array<{ name: string; quantity: number; weight?: number }>,
  ) {
    const senderInfo = await this.getSenderInfo(companyId);
    const recipientInfo = this.parseAddressSnapshot(addressSnapshot);
    const cargo = items.map((i) => i.name).join(', ');
    const totalWeight = items.reduce((sum, i) => sum + (i.weight || 0), 0);

    const waybillResult = await this.kuaidi100Waybill.createWaybill({
      carrierCode,
      senderName: senderInfo.senderName,
      senderPhone: senderInfo.senderPhone,
      senderAddress: senderInfo.senderAddress,
      recipientName: recipientInfo.name,
      recipientPhone: recipientInfo.phone,
      recipientAddress: recipientInfo.fullAddress,
      cargo,
      weight: totalWeight > 0 ? totalWeight : undefined,
      count: 1,
    });

    const carrierName =
      Kuaidi100Service.CARRIER_NAME_MAP[carrierCode.toUpperCase()] || carrierCode;

    return {
      carrierCode: carrierCode.toUpperCase(),
      carrierName,
      waybillNo: waybillResult.waybillNo,
      waybillUrl: waybillResult.waybillImageUrl,
      taskId: waybillResult.taskId,
      senderInfoSnapshot: senderInfo,
      receiverInfoSnapshot: recipientInfo,
    };
  }

  async cancelCarrierWaybill(carrierCode: string, waybillNo: string) {
    if (!carrierCode || !waybillNo) {
      this.logger.warn('取消面单跳过: 缺少快递编码或运单号');
      return;
    }
    try {
      await this.kuaidi100Waybill.cancelWaybill(carrierCode, waybillNo);
    } catch (err: any) {
      this.logger.warn(`取消面单调用快递100失败（不阻塞本地清除）: ${err.message}`);
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

    // 2. 先调快递100取消（best-effort）
    await this.cancelCarrierWaybill(shipment.carrierCode, shipment.waybillNo);

    // 3. 远端取消后，清空本地记录
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
          kuaidi100TaskId: null,
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

  private async rollbackCreatedWaybill(
    waybill: { carrierCode: string; waybillNo: string; taskId?: string } | null,
  ) {
    if (!waybill) return;
    await this.cancelCarrierWaybill(waybill.carrierCode, waybill.waybillNo);
  }
}
