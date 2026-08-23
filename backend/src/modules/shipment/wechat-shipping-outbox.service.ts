import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptJsonValue } from '../../common/security/encryption';
import { maskPhone } from '../../common/security/privacy-mask';
import { sanitizeErrorForLog } from '../../common/logging/log-sanitizer';
import {
  WechatMiniProgramApiError,
  WechatMiniProgramApiService,
} from '../wechat-mini-program-platform/wechat-mini-program-api.service';

const UPLOAD_SHIPPING_PATH = '/wxa/sec/order/upload_shipping_info';
const LEASE_MS = 2 * 60 * 1000;
const BATCH_SIZE = 20;
const MAX_SHIPPING_ITEMS = 15;
const MAX_ITEM_DESC_CHARS = 120;

const REMOTE_ALREADY_APPLIED_CODES = new Set([10060023]);
const PERMANENT_WECHAT_CODES = new Set([
  10060001,
  10060002,
  10060003,
  10060004,
  10060005,
  10060006,
  10060007,
  10060008,
  10060009,
  10060014,
  10060020,
  10060024,
  10060025,
  10060026,
  10060031,
  268485194,
  268485195,
  268485196,
  268485197,
  268485216,
  268485224,
  268485226,
  268485227,
  268485228,
]);

type ShippingItem = {
  tracking_no: string;
  express_company: string;
  item_desc: string;
  contact?: { receiver_contact: string };
};

type ShippingPayload = {
  version: 1;
  order_key: {
    order_number_type: 2;
    transaction_id: string;
  };
  logistics_type: 1;
  delivery_mode: 1 | 2;
  is_all_delivered?: boolean;
  shipping_list: ShippingItem[];
  upload_time: string;
};

type SnapshotBuildResult =
  | { kind: 'NOT_ELIGIBLE' }
  | {
    kind: 'READY';
    checkoutSessionId: string;
    payerOpenId: string;
    payload: ShippingPayload;
    payloadHash: string;
  }
  | {
    kind: 'INVALID';
    checkoutSessionId: string;
    code: string;
    message: string;
  };

/**
 * 微信小程序交易发货同步的 durable outbox。
 *
 * 该服务只在原发货事务中构建并落库快照；真正的微信 HTTP 调用由 cron worker
 * 在事务外完成。一个 CheckoutSession 对应一笔微信支付，因此同一支付单下的
 * 多订单、多商户 Shipment 必须聚合后统一上报。
 */
@Injectable()
export class WechatShippingOutboxService {
  private readonly logger = new Logger(WechatShippingOutboxService.name);
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wechatApi: WechatMiniProgramApiService,
  ) {}

  async enqueueForOrderTx(
    tx: Prisma.TransactionClient,
    orderId: string,
    options: { force?: boolean } = {},
  ): Promise<{ enqueued: boolean; reason?: string }> {
    const snapshot = await this.buildSnapshot(tx, orderId);
    if (snapshot.kind === 'NOT_ELIGIBLE') {
      return { enqueued: false, reason: 'NOT_MINI_PROGRAM_WECHAT_PAYMENT' };
    }

    if (snapshot.kind === 'INVALID') {
      await tx.wechatShippingOutbox.upsert({
        where: { checkoutSessionId: snapshot.checkoutSessionId },
        create: {
          checkoutSessionId: snapshot.checkoutSessionId,
          status: 'FAILED',
          payloadHash: createHash('sha256').update(snapshot.code).digest('hex'),
          payload: { version: 1, invalid: true } as Prisma.InputJsonValue,
          lastErrorCode: snapshot.code,
          lastError: snapshot.message,
        },
        update: {
          status: 'FAILED',
          generation: { increment: 1 },
          payloadHash: createHash('sha256').update(snapshot.code).digest('hex'),
          payload: { version: 1, invalid: true } as Prisma.InputJsonValue,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: snapshot.code,
          lastError: snapshot.message,
          succeededAt: null,
        },
      });
      return { enqueued: false, reason: snapshot.code };
    }

    const current = await tx.wechatShippingOutbox.findUnique({
      where: { checkoutSessionId: snapshot.checkoutSessionId },
      select: { payloadHash: true },
    });
    if (!options.force && current?.payloadHash === snapshot.payloadHash) {
      return { enqueued: false, reason: 'UNCHANGED_SNAPSHOT' };
    }

    await tx.wechatShippingOutbox.upsert({
      where: { checkoutSessionId: snapshot.checkoutSessionId },
      create: {
        checkoutSessionId: snapshot.checkoutSessionId,
        status: 'PENDING',
        payloadHash: snapshot.payloadHash,
        payload: snapshot.payload as unknown as Prisma.InputJsonValue,
        nextAttemptAt: new Date(),
      },
      update: {
        status: 'PENDING',
        generation: { increment: 1 },
        payloadHash: snapshot.payloadHash,
        payload: snapshot.payload as unknown as Prisma.InputJsonValue,
        attemptCount: 0,
        nextAttemptAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastError: null,
        succeededAt: null,
      },
    });
    return { enqueued: true };
  }

  /**
   * 管理端人工重试：重新从当前订单/包裹构建可信快照，不复用失败记录中的
   * 任意 payload。事务只负责重置 outbox，真实微信调用仍由后台消费者完成。
   */
  async retryForOrder(orderId: string): Promise<{ enqueued: boolean; reason?: string }> {
    return this.prisma.$transaction(
      (tx) => this.enqueueForOrderTx(tx, orderId, { force: true }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processPendingBatch(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const now = new Date();
      const candidates = await this.prisma.wechatShippingOutbox.findMany({
        where: {
          OR: [
            { status: 'PENDING', nextAttemptAt: { lte: now } },
            { status: 'PROCESSING', leaseExpiresAt: { lt: now } },
          ],
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
        take: BATCH_SIZE,
        select: { id: true, generation: true },
      });

      for (const candidate of candidates) {
        await this.claimAndProcess(candidate.id, candidate.generation).catch((error) => {
          this.logger.error(
            `微信发货 outbox 处理异常: outboxId=${this.maskId(candidate.id)}, ${sanitizeErrorForLog(error).message}`,
          );
        });
      }
    } finally {
      this.processing = false;
    }
  }

  private async claimAndProcess(id: string, generation: number): Promise<void> {
    const leaseToken = randomUUID();
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const claimed = await this.prisma.wechatShippingOutbox.updateMany({
      where: {
        id,
        generation,
        OR: [
          { status: 'PENDING', nextAttemptAt: { lte: now } },
          { status: 'PROCESSING', leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: 'PROCESSING',
        leaseToken,
        leaseExpiresAt,
      },
    });
    if (claimed.count !== 1) return;

    const outbox = await this.prisma.wechatShippingOutbox.findFirst({
      where: { id, generation, status: 'PROCESSING', leaseToken },
      select: {
        id: true,
        checkoutSessionId: true,
        generation: true,
        payloadHash: true,
        payload: true,
        attemptCount: true,
      },
    });
    if (!outbox) return;

    try {
      const current = await this.buildSnapshotForCheckoutSession(
        this.prisma,
        outbox.checkoutSessionId,
      );
      if (current.kind === 'NOT_ELIGIBLE') {
        await this.markFailed(
          outbox,
          leaseToken,
          'STALE_SHIPPING_SNAPSHOT',
          '当前订单已取消、退款或不再满足微信交易发货条件',
        );
        return;
      }
      if (current.kind === 'INVALID') {
        await this.markFailed(outbox, leaseToken, current.code, current.message);
        return;
      }
      if (current.payloadHash !== outbox.payloadHash) {
        await this.replaceStaleSnapshot(outbox, leaseToken, current);
        return;
      }

      const payload = this.parsePayload(outbox.payload);
      if (
        this.hashPayload(payload) !== outbox.payloadHash
        || current.payload.order_key.transaction_id !== payload.order_key.transaction_id
      ) {
        await this.markFailed(outbox, leaseToken, 'PAYLOAD_HASH_MISMATCH', '发货快照完整性校验失败');
        return;
      }

      const requestBody = {
        order_key: payload.order_key,
        logistics_type: payload.logistics_type,
        delivery_mode: payload.delivery_mode,
        ...(payload.delivery_mode === 2
          ? { is_all_delivered: payload.is_all_delivered === true }
          : {}),
        shipping_list: payload.shipping_list,
        upload_time: payload.upload_time,
        payer: { openid: current.payerOpenId },
      };
      await this.wechatApi.postJson<{ errcode: number; errmsg: string }>(
        UPLOAD_SHIPPING_PATH,
        requestBody,
      );
      await this.markSucceeded(outbox, leaseToken, null);
    } catch (error) {
      if (error instanceof WechatMiniProgramApiError) {
        if (REMOTE_ALREADY_APPLIED_CODES.has(error.errcode)) {
          await this.markSucceeded(outbox, leaseToken, String(error.errcode));
          return;
        }
        if (PERMANENT_WECHAT_CODES.has(error.errcode)) {
          await this.markFailed(
            outbox,
            leaseToken,
            String(error.errcode),
            '微信拒绝该发货快照，需人工核查',
          );
          return;
        }
      }
      await this.scheduleRetry(outbox, leaseToken, error);
    }
  }

  private async markSucceeded(
    outbox: { id: string; generation: number },
    leaseToken: string,
    remoteCode: string | null,
  ): Promise<void> {
    await this.prisma.wechatShippingOutbox.updateMany({
      where: {
        id: outbox.id,
        generation: outbox.generation,
        status: 'PROCESSING',
        leaseToken,
      },
      data: {
        status: 'SUCCEEDED',
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: remoteCode,
        lastError: null,
        succeededAt: new Date(),
      },
    });
  }

  private async replaceStaleSnapshot(
    outbox: { id: string; generation: number },
    leaseToken: string,
    current: Extract<SnapshotBuildResult, { kind: 'READY' }>,
  ): Promise<void> {
    await this.prisma.wechatShippingOutbox.updateMany({
      where: {
        id: outbox.id,
        generation: outbox.generation,
        status: 'PROCESSING',
        leaseToken,
      },
      data: {
        status: 'PENDING',
        generation: { increment: 1 },
        payloadHash: current.payloadHash,
        payload: current.payload as unknown as Prisma.InputJsonValue,
        attemptCount: 0,
        nextAttemptAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: 'STALE_SNAPSHOT_REBUILT',
        lastError: null,
        succeededAt: null,
      },
    });
  }

  private async markFailed(
    outbox: { id: string; generation: number },
    leaseToken: string,
    code: string,
    message: string,
  ): Promise<void> {
    await this.prisma.wechatShippingOutbox.updateMany({
      where: {
        id: outbox.id,
        generation: outbox.generation,
        status: 'PROCESSING',
        leaseToken,
      },
      data: {
        status: 'FAILED',
        attemptCount: { increment: 1 },
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: code.slice(0, 64),
        lastError: message.slice(0, 500),
      },
    });
  }

  private async scheduleRetry(
    outbox: { id: string; generation: number; attemptCount: number },
    leaseToken: string,
    error: unknown,
  ): Promise<void> {
    const nextAttemptCount = outbox.attemptCount + 1;
    const safeError = sanitizeErrorForLog(error).message.slice(0, 500);
    const retryDelayMs = this.retryDelayMs(nextAttemptCount);
    await this.prisma.wechatShippingOutbox.updateMany({
      where: {
        id: outbox.id,
        generation: outbox.generation,
        status: 'PROCESSING',
        leaseToken,
      },
      data: {
        status: 'PENDING',
        attemptCount: { increment: 1 },
        nextAttemptAt: new Date(Date.now() + retryDelayMs),
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: error instanceof WechatMiniProgramApiError
          ? String(error.errcode)
          : 'TRANSIENT_ERROR',
        lastError: safeError,
      },
    });
  }

  private async buildSnapshot(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<SnapshotBuildResult> {
    const orderRef = await tx.order.findUnique({
      where: { id: orderId },
      select: { checkoutSessionId: true },
    });
    if (!orderRef?.checkoutSessionId) return { kind: 'NOT_ELIGIBLE' };

    return this.buildSnapshotForCheckoutSession(tx, orderRef.checkoutSessionId);
  }

  private async buildSnapshotForCheckoutSession(
    client: Pick<Prisma.TransactionClient, 'checkoutSession'> | Pick<PrismaService, 'checkoutSession'>,
    checkoutSessionId: string,
  ): Promise<SnapshotBuildResult> {
    const session = await client.checkoutSession.findUnique({
      where: { id: checkoutSessionId },
      select: {
        id: true,
        paymentChannel: true,
        paymentScene: true,
        providerTxnId: true,
        miniProgramPayerOpenId: true,
        orders: {
          where: { deletedAt: null },
          select: {
            id: true,
            status: true,
            fulfillmentMode: true,
            addressSnapshot: true,
            items: {
              where: { deletedAt: null },
              select: { companyId: true, quantity: true, productSnapshot: true },
            },
            shipments: {
              orderBy: [{ shippedAt: 'asc' }, { createdAt: 'asc' }],
              select: {
                id: true,
                companyId: true,
                carrierCode: true,
                trackingNo: true,
                waybillNo: true,
                status: true,
                shippedAt: true,
                receiverInfoSnapshot: true,
              },
            },
          },
        },
      },
    });
    if (
      !session
      || session.paymentChannel !== 'WECHAT_PAY'
      || session.paymentScene !== 'MINI_PROGRAM'
    ) {
      return { kind: 'NOT_ELIGIBLE' };
    }
    if (!session.providerTxnId) {
      return this.invalid(session.id, 'PROVIDER_TXN_ID_MISSING', '微信支付单号缺失');
    }
    if (!session.miniProgramPayerOpenId) {
      return this.invalid(session.id, 'PAYER_OPENID_MISSING', '小程序支付身份快照缺失');
    }
    if (session.orders.some(
      (order) => order.fulfillmentMode === 'PICKUP'
        && order.status !== 'CANCELED'
        && order.status !== 'REFUNDED',
    )) {
      return { kind: 'NOT_ELIGIBLE' };
    }

    const activeOrders = session.orders.filter(
      (order) => order.status !== 'CANCELED' && order.status !== 'REFUNDED',
    );
    const expectedShipments = activeOrders.flatMap((order) =>
      order.shipments.map((shipment) => ({ order, shipment })),
    );
    const shipped = expectedShipments.filter(({ shipment }) =>
      Boolean(shipment.shippedAt)
      && ['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'EXCEPTION'].includes(shipment.status),
    );
    if (shipped.length === 0) return { kind: 'NOT_ELIGIBLE' };
    if (shipped.length > MAX_SHIPPING_ITEMS) {
      return this.invalid(session.id, 'TOO_MANY_PACKAGES', '同一微信支付单的包裹数超过 15 个');
    }

    const shippingList: ShippingItem[] = [];
    for (const { order, shipment } of shipped) {
      const trackingNo = String(shipment.waybillNo || shipment.trackingNo || '').trim();
      const carrierCode = String(shipment.carrierCode || '').trim();
      if (!trackingNo || trackingNo.length > 128 || !carrierCode || carrierCode.length > 128) {
        return this.invalid(session.id, 'INVALID_LOGISTICS_ID', '物流公司编码或运单号无效');
      }
      const item: ShippingItem = {
        tracking_no: trackingNo,
        express_company: carrierCode,
        item_desc: this.buildItemDescription(order.items, shipment.companyId),
      };
      if (carrierCode.toUpperCase() === 'SF') {
        const receiverContact = this.resolveMaskedReceiverContact(
          shipment.receiverInfoSnapshot,
          order.addressSnapshot,
        );
        if (!receiverContact) {
          return this.invalid(session.id, 'SF_CONTACT_MISSING', '顺丰发货缺少可用的脱敏收件联系方式');
        }
        item.contact = { receiver_contact: receiverContact };
      }
      shippingList.push(item);
    }

    const expectedCompanyKeys = activeOrders.flatMap((order) => {
      const companyIds = [...new Set(
        order.items.map((item) => item.companyId).filter((value): value is string => Boolean(value)),
      )];
      return companyIds.length > 0
        ? companyIds.map((companyId) => `${order.id}:${companyId}`)
        : order.shipments.map((shipment) => `${order.id}:${shipment.companyId}`);
    });
    const actualCompanyKeys = new Set(
      expectedShipments.map(({ order, shipment }) => `${order.id}:${shipment.companyId}`),
    );
    const hasMissingShipment = expectedCompanyKeys.some((key) => !actualCompanyKeys.has(key));
    const isAllDelivered = !hasMissingShipment
      && expectedCompanyKeys.length > 0
      && expectedShipments.length > 0
      && expectedShipments.every(({ shipment }) =>
        Boolean(shipment.shippedAt)
        && ['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'EXCEPTION'].includes(shipment.status),
      );
    const expectedPackageCount = Math.max(expectedCompanyKeys.length, expectedShipments.length);
    const deliveryMode: 1 | 2 = expectedPackageCount === 1 && isAllDelivered ? 1 : 2;
    const stablePayload = {
      version: 1 as const,
      order_key: {
        order_number_type: 2 as const,
        transaction_id: session.providerTxnId,
      },
      logistics_type: 1 as const,
      delivery_mode: deliveryMode,
      ...(deliveryMode === 2 ? { is_all_delivered: isAllDelivered } : {}),
      shipping_list: shippingList,
    };
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(stablePayload))
      .digest('hex');
    return {
      kind: 'READY',
      checkoutSessionId: session.id,
      payerOpenId: session.miniProgramPayerOpenId,
      payloadHash,
      payload: {
        ...stablePayload,
        upload_time: new Date().toISOString(),
      },
    };
  }

  private hashPayload(payload: ShippingPayload): string {
    const { upload_time: _uploadTime, ...stablePayload } = payload;
    return createHash('sha256').update(JSON.stringify(stablePayload)).digest('hex');
  }

  private buildItemDescription(
    items: Array<{ companyId: string | null; quantity: number; productSnapshot: unknown }>,
    companyId: string,
  ): string {
    const scoped = items.filter((item) => item.companyId === companyId);
    const source = scoped.length > 0 ? scoped : items;
    const parts = source.map((item) => {
      const snapshot = this.parseJsonObject(item.productSnapshot);
      const title = typeof snapshot?.title === 'string' && snapshot.title.trim()
        ? snapshot.title.trim()
        : '爱买买商品';
      return `${title}*${Math.max(1, Number(item.quantity) || 1)}件`;
    });
    const value = parts.length > 0 ? parts.join('，') : '爱买买商品';
    return Array.from(value).slice(0, MAX_ITEM_DESC_CHARS).join('');
  }

  private resolveMaskedReceiverContact(
    receiverSnapshot: unknown,
    addressSnapshot: unknown,
  ): string | null {
    const receiver = this.parseJsonObject(decryptJsonValue(receiverSnapshot));
    const address = this.parseJsonObject(decryptJsonValue(addressSnapshot));
    const raw = [
      receiver?.tel,
      receiver?.phone,
      receiver?.recipientPhone,
      address?.phone,
      address?.recipientPhone,
      address?.tel,
    ].find((value) => typeof value === 'string' && value.trim());
    return typeof raw === 'string' ? maskPhone(raw) : null;
  }

  private parsePayload(value: unknown): ShippingPayload {
    const raw = this.parseJsonObject(value);
    const key = this.parseJsonObject(raw?.order_key);
    if (
      raw?.version !== 1
      || key?.order_number_type !== 2
      || typeof key.transaction_id !== 'string'
      || !key.transaction_id
      || raw.logistics_type !== 1
      || (raw.delivery_mode !== 1 && raw.delivery_mode !== 2)
      || !Array.isArray(raw.shipping_list)
      || raw.shipping_list.length < 1
      || raw.shipping_list.length > MAX_SHIPPING_ITEMS
      || typeof raw.upload_time !== 'string'
      || !Number.isFinite(Date.parse(raw.upload_time))
    ) {
      throw new Error('微信发货 outbox 快照格式无效');
    }
    if (raw.delivery_mode === 2 && typeof raw.is_all_delivered !== 'boolean') {
      throw new Error('微信拆包发货快照缺少完成标记');
    }
    if (raw.delivery_mode === 1 && raw.shipping_list.length !== 1) {
      throw new Error('微信统一发货快照只能包含一个物流单');
    }
    for (const candidate of raw.shipping_list) {
      const item = this.parseJsonObject(candidate);
      const trackingNo = typeof item?.tracking_no === 'string' ? item.tracking_no.trim() : '';
      const expressCompany = typeof item?.express_company === 'string'
        ? item.express_company.trim()
        : '';
      const itemDesc = typeof item?.item_desc === 'string' ? item.item_desc.trim() : '';
      if (
        !trackingNo
        || trackingNo.length > 128
        || !expressCompany
        || expressCompany.length > 128
        || !itemDesc
        || Array.from(itemDesc).length > MAX_ITEM_DESC_CHARS
      ) {
        throw new Error('微信发货 outbox 物流条目无效');
      }
      if (item?.contact !== undefined) {
        const contact = this.parseJsonObject(item.contact);
        const receiverContact = typeof contact?.receiver_contact === 'string'
          ? contact.receiver_contact.trim()
          : '';
        if (!receiverContact || receiverContact.length > 1024 || /^\d{11}$/.test(receiverContact)) {
          throw new Error('微信发货 outbox 联系方式未正确脱敏');
        }
      }
    }
    return raw as unknown as ShippingPayload;
  }

  private parseJsonObject(value: unknown): Record<string, any> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, any>;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as Record<string, any>
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  private invalid(
    checkoutSessionId: string,
    code: string,
    message: string,
  ): SnapshotBuildResult {
    return { kind: 'INVALID', checkoutSessionId, code, message };
  }

  private retryDelayMs(attempt: number): number {
    const minutes = [1, 2, 5, 10, 30, 60, 120, 240];
    return minutes[Math.min(attempt - 1, minutes.length - 1)] * 60 * 1000;
  }

  private maskId(value: string): string {
    if (value.length <= 8) return '[ID_MASKED]';
    return `${value.slice(0, 4)}***${value.slice(-4)}`;
  }
}
