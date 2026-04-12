import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeStringForLog } from '../../common/logging/log-sanitizer';
import { maskTrackingNo } from '../../common/security/privacy-mask';
import { getConfigValue } from '../after-sale/after-sale.utils';
import { AFTER_SALE_CONFIG_KEYS } from '../after-sale/after-sale.constants';
import { SfExpressService } from './sf-express.service';
import { InboxService } from '../inbox/inbox.service';

@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private sfExpress: SfExpressService,
    private inboxService: InboxService,
  ) {}

  private summarizeShipmentStatus(statuses: string[]): string {
    if (statuses.length === 0) return 'INIT';
    if (statuses.every((status) => status === 'DELIVERED')) return 'DELIVERED';
    if (statuses.some((status) => status === 'IN_TRANSIT' || status === 'SHIPPED')) {
      return 'IN_TRANSIT';
    }
    if (statuses.some((status) => status === 'INIT')) return 'INIT';
    return statuses[0];
  }

  /**
   * 物流回调签名校验（HMAC-SHA256）
   * - 生产环境：LOGISTICS_WEBHOOK_SECRET 必须配置，缺失则拒绝请求
   * - 开发环境：未配置时跳过，便于本地联调
   */
  private verifyCallbackSignature(
    rawPayload: any,
    payloadFallback: Record<string, unknown>,
    headerSignature?: string,
  ): boolean {
    const secret = this.configService.get<string>('LOGISTICS_WEBHOOK_SECRET');
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('LOGISTICS_WEBHOOK_SECRET 未配置，生产环境拒绝物流回调');
        return false;
      }
      this.logger.warn('开发环境跳过物流回调签名验证（LOGISTICS_WEBHOOK_SECRET 未配置）');
      return true;
    }

    const payload = rawPayload && typeof rawPayload === 'object'
      ? rawPayload
      : payloadFallback;
    if (!payload || typeof payload !== 'object') {
      this.logger.warn('物流回调缺少可验签 payload');
      return false;
    }

    const { signature: payloadSignature, ...body } = payload as Record<string, unknown>;
    const providedSignature =
      typeof headerSignature === 'string' && headerSignature
        ? headerSignature
        : (typeof payloadSignature === 'string' ? payloadSignature : undefined);
    if (!providedSignature) {
      this.logger.warn('物流回调缺少 signature');
      return false;
    }

    const canonicalPayload = JSON.stringify(body, Object.keys(body).sort());
    const expected = crypto.createHmac('sha256', secret).update(canonicalPayload).digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(providedSignature, 'utf8'),
        Buffer.from(expected, 'utf8'),
      );
    } catch {
      return false;
    }
  }

  /** 查询订单物流信息 */
  async getByOrderId(orderId: string, userId: string) {
    // 验证订单归属
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw new NotFoundException('订单未找到');

    const shipments = await this.prisma.shipment.findMany({
      where: { orderId },
      include: {
        trackingEvents: { orderBy: { occurredAt: 'desc' } },
      },
      orderBy: [{ shippedAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (shipments.length === 0) return null;

    const mappedShipments = shipments.map((shipment) => ({
      id: shipment.id,
      companyId: shipment.companyId,
      carrierCode: shipment.carrierCode,
      carrierName: shipment.carrierName,
      trackingNo: shipment.trackingNo,
      trackingNoMasked: maskTrackingNo(shipment.trackingNo) ?? null,
      status: shipment.status,
      shippedAt: shipment.shippedAt?.toISOString() || null,
      deliveredAt: shipment.deliveredAt?.toISOString() || null,
      events: shipment.trackingEvents.map((e) => ({
        id: e.id,
        occurredAt: e.occurredAt.toISOString(),
        message: e.message,
        location: e.location,
        statusCode: e.statusCode,
      })),
    }));
    const primaryShipment = mappedShipments[0];
    const allEvents = mappedShipments
      .flatMap((shipment) =>
        shipment.events.map((event) => ({
          ...event,
          shipmentId: shipment.id,
          carrierName: shipment.carrierName,
          trackingNo: shipment.trackingNoMasked || shipment.trackingNo,
        })),
      )
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const summaryStatus = this.summarizeShipmentStatus(
      mappedShipments.map((shipment) => shipment.status),
    );
    const multiPackage = mappedShipments.length > 1;

    return {
      id: primaryShipment.id,
      carrierCode: multiPackage ? 'MULTI' : primaryShipment.carrierCode,
      carrierName: multiPackage ? `${mappedShipments.length}个包裹` : primaryShipment.carrierName,
      trackingNo: multiPackage ? '多包裹' : primaryShipment.trackingNo,
      trackingNoMasked: multiPackage ? null : primaryShipment.trackingNoMasked,
      status: summaryStatus,
      shippedAt: primaryShipment.shippedAt,
      deliveredAt: summaryStatus === 'DELIVERED' ? primaryShipment.deliveredAt : null,
      events: allEvents,
      shipments: mappedShipments,
    };
  }

  /**
   * P1-2: 物流状态回调 stub
   * 接收物流服务商推送的状态变更，更新 Shipment + Order 状态
   * 生产环境需对接真实物流 API（快递100/菜鸟等）
   */
  async handleCallback(
    trackingNo: string,
    status: string,
    events?: Array<{ time: string; message: string; location?: string }>,
    rawPayload?: any,
    headerSignature?: string,
    options?: { skipSignatureVerification?: boolean },
  ) {
    // 快递100回调通过订阅机制保证来源可信，跳过通用签名验证
    if (!options?.skipSignatureVerification) {
      if (!this.verifyCallbackSignature(rawPayload, { trackingNo, status, events }, headerSignature)) {
        throw new UnauthorizedException('物流回调签名验证失败');
      }
    }

    const shipment = await this.prisma.shipment.findFirst({ where: { trackingNo } });
    if (!shipment) throw new NotFoundException('物流单号未找到');

    const shipmentStatus = status === 'DELIVERED' ? 'DELIVERED' : status === 'IN_TRANSIT' ? 'IN_TRANSIT' : shipment.status;

    // C7修复：Serializable 隔离 + CAS 防止与 confirmReceive 竞态导致重复状态转换
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // 更新 Shipment 状态
          await tx.shipment.update({
            where: { id: shipment.id },
            data: {
              status: shipmentStatus as any,
              deliveredAt: status === 'DELIVERED' ? new Date() : undefined,
            },
          });

          // 写入物流轨迹事件（去重）
          if (events?.length) {
            const existingEvents = await tx.shipmentTrackingEvent.findMany({
              where: { shipmentId: shipment.id },
              select: { occurredAt: true, message: true },
            });
            const existingKeys = new Set(
              existingEvents.map((e) => `${e.occurredAt.toISOString()}|${e.message}`),
            );
            const newEvents = events.filter((e) => {
              const key = `${new Date(e.time).toISOString()}|${e.message}`;
              return !existingKeys.has(key);
            });

            if (newEvents.length > 0) {
              await tx.shipmentTrackingEvent.createMany({
                data: newEvents.map((e) => ({
                  shipmentId: shipment.id,
                  occurredAt: new Date(e.time),
                  message: e.message,
                  location: e.location || null,
                  statusCode: status,
                })),
              });
            }
          }

          // 如果全部包裹均签收，CAS 更新 Order 状态为 DELIVERED
          if (status === 'DELIVERED') {
            const undeliveredCount = await tx.shipment.count({
              where: {
                orderId: shipment.orderId,
                status: { not: 'DELIVERED' },
              },
            });
            if (undeliveredCount === 0) {
              // 读取退货窗口配置
              const returnWindowDays = await getConfigValue(
                tx as any,
                AFTER_SALE_CONFIG_KEYS.RETURN_WINDOW_DAYS,
                7,
              );
              const now = new Date();
              const returnWindowExpiresAt = new Date(
                now.getTime() + returnWindowDays * 24 * 60 * 60 * 1000,
              );
              const casResult = await tx.order.updateMany({
                where: { id: shipment.orderId, status: 'SHIPPED' },
                data: {
                  status: 'DELIVERED',
                  deliveredAt: now,
                  returnWindowExpiresAt,
                },
              });
              // CAS 成功时才记录状态历史（count === 0 说明订单已不在 SHIPPED 状态，跳过即可）
              if (casResult.count > 0) {
                await tx.orderStatusHistory.create({
                  data: {
                    orderId: shipment.orderId,
                    fromStatus: 'SHIPPED',
                    toStatus: 'DELIVERED',
                    reason: '物流签收',
                  },
                });

                // 发送签收通知给买家
                try {
                  const orderForNotify = await tx.order.findUnique({
                    where: { id: shipment.orderId },
                    select: { userId: true },
                  });
                  if (orderForNotify) {
                    await this.inboxService.send({
                      userId: orderForNotify.userId,
                      category: 'order',
                      type: 'delivered',
                      title: '包裹已送达',
                      content: '您的包裹已签收，请确认收货。如有问题可申请售后。',
                      target: { route: '/orders/[id]', params: { id: shipment.orderId } },
                    });
                  }
                } catch (notifyErr: any) {
                  this.logger.warn(`签收通知发送失败: ${notifyErr.message}`);
                }
              }
            }
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        // 事务成功，跳出重试循环
        break;
      } catch (e: any) {
        // P2034: Serializable 事务序列化冲突，可安全重试
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(`handleCallback 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: trackingNo=${maskTrackingNo(trackingNo) ?? 'N/A'}`);
          continue;
        }
        throw e;
      }
    }

    // EXCEPTION 状态即时通知买家
    if (shipmentStatus === 'EXCEPTION') {
      try {
        const orderForNotify = await this.prisma.order.findUnique({
          where: { id: shipment.orderId },
          select: { userId: true },
        });
        if (orderForNotify) {
          await this.inboxService.send({
            userId: orderForNotify.userId,
            category: 'order',
            type: 'logistics_exception',
            title: '物流异常',
            content: '您的包裹物流出现异常（退签/退回），请联系客服处理。',
            target: { route: '/orders/[id]', params: { id: shipment.orderId } },
          });
        }
      } catch (notifyErr: any) {
        this.logger.warn(`物流异常通知发送失败: ${notifyErr.message}`);
      }
    }

    this.logger.log(`物流回调处理完成: ${maskTrackingNo(trackingNo) ?? 'N/A'} → ${sanitizeStringForLog(status, { maxStringLength: 64 })}`);
    return { ok: true };
  }

  async handleSfCallback(
    trackingNo: string,
    status: string,
    events: Array<{ time: string; message: string; location?: string }> | undefined,
    rawPayload: any,
    bodyStr?: string,
    pushDigest?: string,
  ) {
    // 验证顺丰推送签名
    if (bodyStr && !this.sfExpress.verifyPushSignature(bodyStr, pushDigest)) {
      throw new UnauthorizedException('顺丰推送签名验证失败');
    }

    return this.handleCallback(
      trackingNo,
      status,
      events,
      rawPayload,
      undefined,
      { skipSignatureVerification: true },
    );
  }

  /**
   * 通过顺丰丰桥主动查询物流轨迹并更新本地数据
   * @param orderId 订单ID
   * @param userId 当前用户ID（用于校验订单归属）
   */
  async queryTracking(orderId: string, userId: string) {
    // 验证订单归属
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw new NotFoundException('订单未找到');

    const shipments = await this.prisma.shipment.findMany({
      where: { orderId },
      include: {
        trackingEvents: { orderBy: { occurredAt: 'desc' } },
      },
    });

    if (shipments.length === 0) {
      return { updated: false, message: '该订单暂无物流信息' };
    }

    const results: Array<{
      shipmentId: string;
      carrierCode: string;
      trackingNo: string | null;
      updated: boolean;
      status?: string;
      eventsAdded?: number;
    }> = [];

    for (const shipment of shipments) {
      // 跳过没有运单号的包裹
      if (!shipment.trackingNo) {
        results.push({
          shipmentId: shipment.id,
          carrierCode: shipment.carrierCode,
          trackingNo: null,
          updated: false,
        });
        continue;
      }

      // 调用顺丰丰桥查询路由
      const trackingResult = await this.sfExpress.queryRoutes(shipment.trackingNo);

      if (!trackingResult) {
        results.push({
          shipmentId: shipment.id,
          carrierCode: shipment.carrierCode,
          trackingNo: shipment.trackingNo,
          updated: false,
        });
        continue;
      }

      // 过滤出本地尚不存在的新事件（按时间+内容去重）
      const existingEventKeys = new Set(
        shipment.trackingEvents.map((e) => `${e.occurredAt.toISOString()}|${e.message}`),
      );
      const newEvents = trackingResult.events.filter((e) => {
        const eventTime = new Date(e.time);
        const key = `${eventTime.toISOString()}|${e.message}`;
        return !existingEventKeys.has(key);
      });

      // 更新物流状态和事件
      const newStatus = trackingResult.status;
      const shouldUpdateStatus =
        shipment.status !== 'DELIVERED' && // 已签收的不回退
        newStatus !== shipment.status;

      await this.prisma.$transaction(async (tx) => {
        // 更新 Shipment 状态
        if (shouldUpdateStatus) {
          await tx.shipment.update({
            where: { id: shipment.id },
            data: {
              status: newStatus as any,
              deliveredAt: newStatus === 'DELIVERED' ? new Date() : undefined,
            },
          });
        }

        // 写入新的物流轨迹事件
        if (newEvents.length > 0) {
          await tx.shipmentTrackingEvent.createMany({
            data: newEvents.map((e) => ({
              shipmentId: shipment.id,
              occurredAt: new Date(e.time),
              message: e.message,
              location: e.location || null,
              statusCode: newStatus,
            })),
          });
        }

        // 如果签收，检查是否所有包裹都已签收，联动 Order 状态
        if (newStatus === 'DELIVERED' && shouldUpdateStatus) {
          const undeliveredCount = await tx.shipment.count({
            where: {
              orderId: shipment.orderId,
              status: { not: 'DELIVERED' },
            },
          });
          if (undeliveredCount === 0) {
            const returnWindowDays = await getConfigValue(
              tx as any,
              AFTER_SALE_CONFIG_KEYS.RETURN_WINDOW_DAYS,
              7,
            );
            const now = new Date();
            const returnWindowExpiresAt = new Date(
              now.getTime() + returnWindowDays * 24 * 60 * 60 * 1000,
            );
            const casResult = await tx.order.updateMany({
              where: { id: shipment.orderId, status: 'SHIPPED' },
              data: {
                status: 'DELIVERED',
                deliveredAt: now,
                returnWindowExpiresAt,
              },
            });
            if (casResult.count > 0) {
              await tx.orderStatusHistory.create({
                data: {
                  orderId: shipment.orderId,
                  fromStatus: 'SHIPPED',
                  toStatus: 'DELIVERED',
                  reason: '物流签收（主动查询）',
                },
              });
            }
          }
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      results.push({
        shipmentId: shipment.id,
        carrierCode: shipment.carrierCode,
        trackingNo: shipment.trackingNo,
        updated: shouldUpdateStatus || newEvents.length > 0,
        status: newStatus,
        eventsAdded: newEvents.length,
      });
    }

    // 查询更新后的完整物流信息返回给前端
    return this.getByOrderId(orderId, userId);
  }
}
