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
import { SfExpressService, SfTrackingEvent } from './sf-express.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private sfExpress: SfExpressService,
    private notificationService: NotificationService,
  ) {}

  private summarizeShipmentStatus(statuses: string[]): string {
    if (statuses.length === 0) return 'INIT';
    if (statuses.every((status) => status === 'DELIVERED')) return 'DELIVERED';
    if (statuses.some((status) => status === 'IN_TRANSIT')) {
      return 'IN_TRANSIT';
    }
    if (statuses.some((status) => status === 'SHIPPED')) return 'SHIPPED';
    if (statuses.some((status) => status === 'INIT')) return 'INIT';
    return statuses[0];
  }

  private parseEventTime(raw: string | undefined | null): { date: Date; valid: boolean } {
    if (!raw || typeof raw !== 'string') return { date: new Date(), valid: false };
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const date = new Date(normalized);
    if (isNaN(date.getTime())) {
      return { date: new Date(), valid: false };
    }
    return { date, valid: true };
  }

  private filterFreshEventsForShipment<T extends SfTrackingEvent>(
    events: T[] | undefined,
    shipment: { id: string; createdAt?: Date | null; shippedAt?: Date | null },
  ): T[] {
    if (!events?.length) return events ?? [];

    // 优先以 shippedAt 为基准（语义更准：发货前的事件不可信）；
    // shippedAt 为 null（历史脏数据 / 异常路径）时回退 createdAt
    const reference = shipment.shippedAt ?? shipment.createdAt;
    if (!reference) return events;

    // SF 沙箱“全流程调测”会把同一沙箱运单的历史样例路由一并推送过来；
    // 这些 acceptTime 早于当前 Shipment 发货时间，不能污染当前订单状态。
    // 1 小时容差覆盖 SF 服务器时钟偏差 + 揽件事件可能略早于点击发货按钮的极端情况。
    const toleranceMs = 60 * 60 * 1000;
    const earliestAllowed = reference.getTime() - toleranceMs;
    const freshEvents = events.filter((event) => {
      const parsed = this.parseEventTime(event.time);
      if (!parsed.valid) return true;
      return parsed.date.getTime() >= earliestAllowed;
    });

    if (freshEvents.length !== events.length) {
      this.logger.warn(
        `过滤 SF 旧路由事件: shipmentId=${shipment.id}, dropped=${events.length - freshEvents.length}, kept=${freshEvents.length}`,
      );
    }

    return freshEvents;
  }

  /**
   * 顺丰推送进来后找不到 Shipment 时的兜底：尝试匹配 AfterSaleRequest 上的
   * returnWaybillNo / replacementWaybillNo / sellerReturnWaybillNo。
   *
   * 命中后过滤沙箱旧路由（基准时间各取面单生成时间），追加去重后写到对应
   * JSON 字段。返回 true 表示已处理（外层 callback 可直接 return ok）。
   */
  private async tryAppendAfterSaleTrackingEvents(
    trackingNo: string,
    events: SfTrackingEvent[] | undefined,
  ): Promise<boolean> {
    if (!events || events.length === 0) return false;

    const afterSale = await this.prisma.afterSaleRequest.findFirst({
      where: {
        OR: [
          { returnWaybillNo: trackingNo },
          { replacementWaybillNo: trackingNo },
          { sellerReturnWaybillNo: trackingNo },
        ],
      },
    });
    if (!afterSale) return false;

    type Kind = 'return' | 'replacement' | 'sellerReturn';
    const kind: Kind =
      afterSale.returnWaybillNo === trackingNo
        ? 'return'
        : afterSale.replacementWaybillNo === trackingNo
          ? 'replacement'
          : 'sellerReturn';

    // 基准时间：买家寄回用面单生成时刻；其他用 updatedAt 兜底
    const referenceTime: Date =
      kind === 'return'
        ? (afterSale.returnShippedAt ?? afterSale.approvedAt ?? afterSale.createdAt)
        : (afterSale.updatedAt ?? afterSale.createdAt);
    const earliestAllowed = referenceTime.getTime() - 60 * 60 * 1000; // 1h 容差

    const freshEvents = events.filter((e) => {
      const t = new Date(e.time).getTime();
      return Number.isFinite(t) ? t >= earliestAllowed : true;
    });

    if (freshEvents.length === 0) {
      this.logger.warn(
        `跳过 SF 沙箱旧路由(after-sale): afterSaleId=${afterSale.id}, kind=${kind}, dropped=${events.length}`,
      );
      return true; // 命中但全是旧事件，吞掉不抛错
    }

    const fieldName =
      kind === 'return'
        ? 'returnTrackingEvents'
        : kind === 'replacement'
          ? 'replacementTrackingEvents'
          : 'sellerReturnTrackingEvents';

    // 读现有 events，append + 去重 by (time + opCode)
    const existing = ((afterSale as any)[fieldName] as any[]) ?? [];
    const merged = [...existing];
    for (const e of freshEvents) {
      const dup = merged.some(
        (x) => x.time === e.time && String(x.opCode ?? '') === String(e.opCode ?? ''),
      );
      if (!dup) merged.push({ ...e });
    }
    merged.sort((a, b) => String(a.time).localeCompare(String(b.time)));

    await this.prisma.afterSaleRequest.update({
      where: { id: afterSale.id },
      data: { [fieldName]: merged as any },
    });

    this.logger.log(
      `SF 推送已写入售后单: afterSaleId=${afterSale.id}, kind=${kind}, appended=${freshEvents.length}, total=${merged.length}`,
    );
    return true;
  }

  private mapIncomingStatus(
    status: string,
    currentStatus: string,
    events?: SfTrackingEvent[],
    options?: { staleEventsDropped?: boolean },
  ): string {
    const eventWithBusinessOpCode = events?.find((event) => {
      const opCode = event.opCode ? String(event.opCode) : '';
      return Boolean(opCode && opCode !== '8000' && SfExpressService.OP_CODE_MAP[opCode]);
    });
    if (eventWithBusinessOpCode?.opCode) {
      return SfExpressService.OP_CODE_MAP[String(eventWithBusinessOpCode.opCode)];
    }

    if (
      options?.staleEventsDropped &&
      (status === 'DELIVERED' || status === 'EXCEPTION')
    ) {
      return currentStatus;
    }

    return status === 'DELIVERED' ? 'DELIVERED'
      : status === 'IN_TRANSIT' ? 'IN_TRANSIT'
      : status === 'SHIPPED' ? 'SHIPPED'
      : status === 'EXCEPTION' ? 'EXCEPTION'
      : currentStatus;
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
    events?: SfTrackingEvent[],
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

    // Bug 12+14: SF 推送过来的 mailno 是我们生成面单时的 waybillNo（不是 trackingNo）
    // 同时兼容 trackingNo 字段（历史数据 / 手填运单号场景）
    // 优先匹配最新创建的（防 SF 复用旧运单号 / 历史脏数据误更新）
    const shipment = await this.prisma.shipment.findFirst({
      where: { OR: [{ waybillNo: trackingNo }, { trackingNo }] },
      orderBy: { createdAt: 'desc' },
    });
    if (!shipment) {
      // Fallback：售后单（退/换货）单号不在 Shipment 表，单独存在 AfterSaleRequest，
      // 推送进来时这里兜底匹配 + 落库，避免退货物流轨迹永久丢失。
      const handledByAfterSale = await this.tryAppendAfterSaleTrackingEvents(
        trackingNo,
        events,
      );
      if (handledByAfterSale) {
        return { ok: true };
      }
      throw new NotFoundException('物流单号未找到');
    }

    const incomingEventCount = events?.length ?? 0;
    const freshEvents = this.filterFreshEventsForShipment(events, shipment);
    const onlyStaleIncomingEvents = incomingEventCount > 0 && freshEvents.length === 0;
    const staleEventsDropped = incomingEventCount > 0 && freshEvents.length !== incomingEventCount;
    if (onlyStaleIncomingEvents) {
      this.logger.warn(
        `跳过 SF 旧路由回调: shipmentId=${shipment.id}, trackingNo=${maskTrackingNo(trackingNo) ?? 'N/A'}, rawStatus=${sanitizeStringForLog(status, { maxStringLength: 64 })}`,
      );
      return { ok: true };
    }

    const shipmentStatus = this.mapIncomingStatus(status, shipment.status, freshEvents, {
      staleEventsDropped,
    });

    // 面单已生成、卖家未确认发货的窗口期：SF 已下单且可能开始推真实路由（揽件中），
    // 但商家流程上 Shipment 仍要保持 INIT 等待"确认发货"动作，否则 seller-orders.service.ts
    // 的 CAS where status=INIT 会失败、卡住卖家发货按钮（审计 HIGH）。
    // 处理：仅写轨迹事件，不动 Shipment.status，不联动 Order.status。
    const isPreShipmentWindow =
      shipment.status === 'INIT' && !shipment.shippedAt;

    // C7修复：Serializable 隔离 + CAS 防止与 confirmReceive 竞态导致重复状态转换
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Bug 93 加固：Shipment.status 单调性保护
          // 真实风险：WaybillRoute 推 opCode=80 → DELIVERED 后，OrderState 推送强制 IN_TRANSIT (parseOrderStates 默认值)
          // 旧代码无 CAS 直接 update → 已签收 Shipment 被降级为 IN_TRANSIT，与 Order.status=DELIVERED 不一致
          //
          // 规则：DELIVERED 是终态，不允许降级。其他状态间允许转换（派件异常 → 重新派件 → 签收 是合法序列）
          // EXCEPTION 不视为终态（SF 实际可以 36 派件异常 → 30 重新派件 → 80 签收）
          if (isPreShipmentWindow) {
            this.logger.log(
              `Shipment ${shipment.id} 处于"已生成面单/未确认发货"窗口期，仅记录轨迹不推进状态`,
            );
            // 仍然写事件（轨迹保留），但不动 status / Order
          } else if (shipment.status === 'DELIVERED' && shipmentStatus !== 'DELIVERED') {
            this.logger.warn(
              `跳过 Shipment 降级: id=${shipment.id}, current=DELIVERED, incoming=${shipmentStatus} (rawStatus=${status})`,
            );
            // 仍然写事件（轨迹保留），但不动 status
          } else {
            // CAS：只在状态实际变化时更新，幂等回调走空更新分支不写 deliveredAt
            const cas = await tx.shipment.updateMany({
              where: {
                id: shipment.id,
                status: { not: 'DELIVERED' },
              },
              data: {
                status: shipmentStatus as any,
                deliveredAt: shipmentStatus === 'DELIVERED' ? new Date() : undefined,
              },
            });
            if (cas.count === 0) {
              this.logger.log(
                `Shipment ${shipment.id} 状态在事务期间已变为 DELIVERED，本次更新跳过`,
              );
            }
          }

          // 写入物流轨迹事件（去重）
          if (events?.length) {
            const existingEvents = await tx.shipmentTrackingEvent.findMany({
              where: { shipmentId: shipment.id },
              select: { occurredAt: true, message: true },
            });
            const existingKeys = new Set(
              existingEvents.map((e) => `${e.occurredAt.toISOString()}|${e.message}`),
            );
            const newEvents = freshEvents.filter((e) => {
              const key = `${this.parseEventTime(e.time).date.toISOString()}|${e.message}`;
              return !existingKeys.has(key);
            });

            if (newEvents.length > 0) {
              await tx.shipmentTrackingEvent.createMany({
                data: newEvents.map((e) => ({
                  shipmentId: shipment.id,
                  occurredAt: this.parseEventTime(e.time).date,
                  message: e.message,
                  location: e.location || null,
                  statusCode: shipmentStatus,
                })),
              });
            }
          }

          // 如果全部包裹均签收，CAS 更新 Order 状态为 DELIVERED
          // 窗口期跳过：Shipment.status 还没动，本包裹仍是 INIT，不应推动 Order.DELIVERED
          if (!isPreShipmentWindow && shipmentStatus === 'DELIVERED') {
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
                    await this.notificationService.emit({
                      eventType: 'order.delivered',
                      aggregateType: 'order',
                      aggregateId: shipment.orderId,
                      idempotencyKey: `order:${shipment.orderId}:delivered`,
                      actor: { kind: 'system' },
                      payload: {
                        orderId: shipment.orderId,
                        buyerUserId: orderForNotify.userId,
                      },
                    }, tx as any);
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
          const statusOrCode = String(
            freshEvents.find((event) => event.opCode)?.opCode || status || shipmentStatus,
          );
          await this.notificationService.emit({
            eventType: 'logistics.exception',
            aggregateType: 'shipment',
            aggregateId: shipment.id,
            idempotencyKey: `shipment:${shipment.id}:exception:${statusOrCode}`,
            actor: { kind: 'system' },
            payload: {
              shipmentId: shipment.id,
              orderId: shipment.orderId,
              buyerUserId: orderForNotify.userId,
            },
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
    events: SfTrackingEvent[] | undefined,
    rawPayload: any,
  ) {
    // Bug 87: 认证已在 controller 用 URL token + timingSafeEqual 完成，service 层不再做签名校验
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
      // Bug 13+14: 优先用 waybillNo（顺丰下单返回的真实运单号），fallback 到 trackingNo（历史数据）
      const trackingNumber = shipment.waybillNo || shipment.trackingNo;

      // 跳过没有任何运单号的包裹
      if (!trackingNumber) {
        results.push({
          shipmentId: shipment.id,
          carrierCode: shipment.carrierCode,
          trackingNo: null,
          updated: false,
        });
        continue;
      }

      // 调用顺丰丰桥查询路由
      const trackingResult = await this.sfExpress.queryRoutes(trackingNumber);

      if (!trackingResult) {
        results.push({
          shipmentId: shipment.id,
          carrierCode: shipment.carrierCode,
          trackingNo: trackingNumber,
          updated: false,
        });
        continue;
      }

      // 过滤出本地尚不存在的新事件（按时间+内容去重）
      const freshEvents = this.filterFreshEventsForShipment(trackingResult.events, shipment);
      if (trackingResult.events.length > 0 && freshEvents.length === 0) {
        results.push({
          shipmentId: shipment.id,
          carrierCode: shipment.carrierCode,
          trackingNo: trackingNumber,
          updated: false,
          status: shipment.status,
          eventsAdded: 0,
        });
        continue;
      }

      const existingEventKeys = new Set(
        shipment.trackingEvents.map((e) => `${e.occurredAt.toISOString()}|${e.message}`),
      );
      const newEvents = freshEvents.filter((e) => {
        const eventTime = this.parseEventTime(e.time).date;
        const key = `${eventTime.toISOString()}|${e.message}`;
        return !existingEventKeys.has(key);
      });

      // 更新物流状态和事件
      const newStatus = this.mapIncomingStatus(
        trackingResult.status,
        shipment.status,
        freshEvents,
        {
          staleEventsDropped:
            trackingResult.events.length > 0 &&
            freshEvents.length !== trackingResult.events.length,
        },
      );
      // 窗口期：面单已生成但卖家未确认发货时，主动查询同样只写轨迹不动状态（审计 HIGH）
      const isPreShipmentWindow =
        shipment.status === 'INIT' && !shipment.shippedAt;
      const shouldUpdateStatus =
        !isPreShipmentWindow &&
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
              occurredAt: this.parseEventTime(e.time).date,
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
