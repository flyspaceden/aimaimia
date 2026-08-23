import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { sanitizeErrorForLog } from '../../common/logging/log-sanitizer';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WechatMiniProgramApiError,
  WechatMiniProgramApiService,
} from '../wechat-mini-program-platform/wechat-mini-program-api.service';
import type { NotificationEvent, NotificationMessageDraft } from '../notification/notification.types';
import {
  MINI_PROGRAM_SUBSCRIPTION_KEYS,
  RecordMiniProgramSubscriptionConsentsDto,
} from './dto/mini-program-subscription.dto';

type SubscriptionKey = typeof MINI_PROGRAM_SUBSCRIPTION_KEYS[number];
type ConsentStatus = 'ACCEPTED' | 'REJECTED' | 'BANNED' | 'FILTERED';
type FieldMap = Partial<Record<'reference' | 'status' | 'remark' | 'time', string>>;
type TemplateDefinition = {
  key: SubscriptionKey;
  label: string;
  description: string;
  templateId: string;
  fields: FieldMap;
  configured: boolean;
};

const EVENT_TEMPLATE_KEY: Record<string, SubscriptionKey> = {
  'order.shipped': 'ORDER_SHIPPED',
  'afterSale.approved': 'AFTER_SALE_RESULT',
  'afterSale.rejected': 'AFTER_SALE_RESULT',
  'afterSale.returnRequired': 'AFTER_SALE_RESULT',
  'afterSale.receivedBySeller': 'AFTER_SALE_RESULT',
  'afterSale.sellerRejectedReturn': 'AFTER_SALE_RESULT',
  'afterSale.replacementShipped': 'AFTER_SALE_RESULT',
  'afterSale.arbitrationResolved': 'AFTER_SALE_RESULT',
  'afterSale.closedByTimeout': 'AFTER_SALE_RESULT',
  'afterSale.refunded': 'AFTER_SALE_RESULT',
  'withdraw.paid': 'WITHDRAW_RESULT',
  'withdraw.failed': 'WITHDRAW_RESULT',
  'withdraw.rejected': 'WITHDRAW_RESULT',
};

const STATUS_TEXT: Record<string, string> = {
  'order.shipped': '已发货',
  'afterSale.approved': '已通过',
  'afterSale.rejected': '未通过',
  'afterSale.returnRequired': '待寄回',
  'afterSale.receivedBySeller': '已收货',
  'afterSale.sellerRejectedReturn': '验收未通过',
  'afterSale.replacementShipped': '换货已发出',
  'afterSale.arbitrationResolved': '仲裁已处理',
  'afterSale.closedByTimeout': '已超时关闭',
  'afterSale.refunded': '已退款',
  'withdraw.paid': '已到账',
  'withdraw.failed': '打款失败',
  'withdraw.rejected': '审核未通过',
};

const PERMANENT_WECHAT_ERRORS = new Set([40003, 40037, 43101]);

@Injectable()
export class MiniProgramSubscriptionService {
  private readonly logger = new Logger(MiniProgramSubscriptionService.name);
  private readonly staleProcessingMs = 5 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly wechat: WechatMiniProgramApiService,
  ) {}

  getTemplatesForClient() {
    return this.templateDefinitions().map(({ fields: _fields, ...definition }) => definition);
  }

  async recordConsents(
    userId: string,
    authContext: { sessionId?: string; authIdentityId?: string },
    dto: RecordMiniProgramSubscriptionConsentsDto,
  ) {
    const appId = this.wechat.getAppId();
    if (!this.wechat.isAvailable() || !appId) {
      throw new ServiceUnavailableException('微信小程序服务未配置');
    }
    if (!authContext.sessionId || !authContext.authIdentityId) {
      throw new BadRequestException('当前会话不是可验证的微信小程序会话');
    }
    const definitions = new Map(this.templateDefinitions().map((item) => [item.key, item]));
    const seen = new Set<string>();
    for (const item of dto.results) {
      if (seen.has(item.key)) throw new BadRequestException('同一订阅用途不能重复提交');
      seen.add(item.key);
      const definition = definitions.get(item.key);
      if (!definition?.configured || definition.templateId !== item.templateId) {
        throw new BadRequestException('订阅消息模板与服务端配置不一致');
      }
    }

    const identity = await this.prisma.authIdentity.findFirst({
      where: {
        id: authContext.authIdentityId,
        userId,
        provider: 'WECHAT',
        appId,
        verified: true,
      },
      select: { id: true },
    });
    if (!identity) throw new BadRequestException('微信小程序登录身份不匹配');

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.results) {
        await (tx as any).miniProgramSubscriptionConsent.upsert({
          where: {
            userId_clientRequestId_templateKey: {
              userId,
              clientRequestId: dto.clientRequestId,
              templateKey: item.key,
            },
          },
          update: {},
          create: {
            userId,
            authIdentityId: identity.id,
            appId,
            templateKey: item.key,
            templateId: item.templateId,
            status: this.consentStatus(item.status),
            clientRequestId: dto.clientRequestId,
          },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { recorded: dto.results.length };
  }

  async enqueueFromNotification(event: NotificationEvent, message: NotificationMessageDraft) {
    if (message.recipientKind !== 'BUYER_USER' || message.audience !== 'BUYER_APP') return null;
    const templateKey = EVENT_TEMPLATE_KEY[event.eventType];
    if (!templateKey) return null;
    const definition = this.templateDefinitions().find((item) => item.key === templateKey);
    const idempotencyKey = `mini-sub:${message.idempotencyKey}:${templateKey}`;
    const eventTime = definition?.fields.time
      ? await this.resolveEventTime(event)
      : new Date();
    const data = definition
      ? this.buildWechatData(definition.fields, event, message, eventTime)
      : {};
    const page = this.resolvePage(message);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const client = tx as any;
          const existing = await client.miniProgramSubscriptionOutbox.findUnique({ where: { idempotencyKey } });
          if (existing) return existing;
          if (!definition?.configured || !this.wechat.isAvailable()) {
            return client.miniProgramSubscriptionOutbox.create({
              data: {
                userId: message.recipientKey,
                eventType: event.eventType,
                aggregateType: event.aggregateType,
                aggregateId: event.aggregateId,
                templateKey,
                templateId: definition?.templateId || null,
                page,
                data,
                idempotencyKey,
                status: 'SKIPPED',
                processedAt: new Date(),
                lastErrorCode: 'TEMPLATE_NOT_CONFIGURED',
                lastError: '订阅消息模板或微信服务未配置',
              },
            });
          }
          const consent = await client.miniProgramSubscriptionConsent.findFirst({
            where: {
              userId: message.recipientKey,
              templateKey,
              templateId: definition.templateId,
              status: 'ACCEPTED',
              consumedAt: null,
              reservedOutboxId: null,
            },
            orderBy: { createdAt: 'asc' },
          });
          const outbox = await client.miniProgramSubscriptionOutbox.create({
            data: {
              userId: message.recipientKey,
              consentId: consent?.id || null,
              eventType: event.eventType,
              aggregateType: event.aggregateType,
              aggregateId: event.aggregateId,
              templateKey,
              templateId: definition.templateId,
              page,
              data,
              idempotencyKey,
              status: consent ? 'PENDING' : 'SKIPPED',
              ...(consent ? {} : {
                processedAt: new Date(),
                lastErrorCode: 'NO_ACCEPTED_CONSENT',
                lastError: '用户未授予本次订阅消息发送机会',
              }),
            },
          });
          if (consent) {
            const reserved = await client.miniProgramSubscriptionConsent.updateMany({
              where: { id: consent.id, reservedOutboxId: null, consumedAt: null, status: 'ACCEPTED' },
              data: { reservedOutboxId: outbox.id, reservedAt: new Date() },
            });
            if (reserved.count !== 1) throw new Error('MINI_SUBSCRIPTION_CONSENT_RACE');
          }
          return outbox;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error: any) {
        // 两个不同事件可能同时选中同一份一次性授权；同一个事件的
        // idempotencyKey 也可能被并发创建。两种情况都会由数据库唯一约束
        // 返回 P2002，必须回到 Serializable 事务重新读取，而不是让站内
        // 通知主流程因为订阅消息这个附加能力失败。
        if (
          (
            error?.code === 'P2002'
            || error?.code === 'P2034'
            || error?.message === 'MINI_SUBSCRIPTION_CONSENT_RACE'
          )
          && attempt < 2
        ) continue;
        throw error;
      }
    }
    throw new Error('MINI_SUBSCRIPTION_ENQUEUE_RETRY_EXHAUSTED');
  }

  @Cron('*/15 * * * * *')
  async dispatchPending(limit = 30) {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.staleProcessingMs);
    const rows = await (this.prisma as any).miniProgramSubscriptionOutbox.findMany({
      where: {
        OR: [
          { status: 'PENDING', runAt: { lte: now } },
          { status: 'PROCESSING', processingAt: { lt: staleBefore } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(Math.floor(limit) || 30, 1), 100),
    });
    for (const row of rows) {
      try {
        await this.dispatchOne(row);
      } catch (error) {
        this.logger.warn(`小程序订阅消息发送任务失败: outboxId=${this.maskId(row.id)}, error=${sanitizeErrorForLog(error).message}`);
      }
    }
  }

  private async dispatchOne(row: any) {
    const claimedAt = new Date();
    const claimed = await (this.prisma as any).miniProgramSubscriptionOutbox.updateMany({
      where: {
        id: row.id,
        status: row.status,
        attempts: row.attempts,
        runAt: row.runAt,
        updatedAt: row.updatedAt,
      },
      data: { status: 'PROCESSING', processingAt: claimedAt, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return;
    const attempt = row.attempts + 1;
    try {
      const consent = row.consentId
        ? await (this.prisma as any).miniProgramSubscriptionConsent.findUnique({ where: { id: row.consentId } })
        : null;
      if (!consent || consent.reservedOutboxId !== row.id || consent.consumedAt || consent.status !== 'ACCEPTED') {
        await this.finish(row.id, claimedAt, 'SKIPPED', 'CONSENT_UNAVAILABLE', '订阅授权已不可用', false);
        return;
      }
      const identity = await this.prisma.authIdentity.findFirst({
        where: {
          id: consent.authIdentityId,
          userId: row.userId,
          provider: 'WECHAT',
          appId: consent.appId,
          verified: true,
        },
        select: { identifier: true },
      });
      if (!identity?.identifier || consent.appId !== this.wechat.getAppId()) {
        await this.finish(row.id, claimedAt, 'SKIPPED', 'IDENTITY_UNAVAILABLE', '小程序收件身份已不可用', true);
        return;
      }
      await this.wechat.postJson('/cgi-bin/message/subscribe/send', {
        touser: identity.identifier,
        template_id: row.templateId,
        ...(row.page ? { page: row.page } : {}),
        data: row.data,
        miniprogram_state: this.miniProgramState(),
        lang: 'zh_CN',
      });
      await this.finish(row.id, claimedAt, 'SENT', null, null, true);
    } catch (error) {
      const code = error instanceof WechatMiniProgramApiError ? String(error.errcode) : 'UPSTREAM_ERROR';
      const permanent = error instanceof WechatMiniProgramApiError && PERMANENT_WECHAT_ERRORS.has(error.errcode);
      if (permanent) {
        await this.finish(row.id, claimedAt, error.errcode === 43101 ? 'SKIPPED' : 'FAILED', code, '微信订阅消息已拒绝或配置无效', true);
        return;
      }
      if (attempt >= 5) {
        // 网络错误时无法证明微信是否已经接收。达到重试上限后宁可终止并
        // 消费这次一次性授权，也不能把同一授权重新分配给另一个事件，
        // 否则可能产生重复订阅消息。
        await this.finish(
          row.id,
          claimedAt,
          'FAILED',
          code,
          sanitizeErrorForLog(error).message.slice(0, 500),
          true,
        );
        return;
      }
      await (this.prisma as any).miniProgramSubscriptionOutbox.updateMany({
        where: { id: row.id, status: 'PROCESSING', processingAt: claimedAt },
        data: {
          status: 'PENDING',
          lastErrorCode: code,
          lastError: sanitizeErrorForLog(error).message.slice(0, 500),
          runAt: new Date(Date.now() + Math.min(5 * 60_000, 2 ** attempt * 1000)),
        },
      });
    }
  }

  private async finish(
    outboxId: string,
    claimedAt: Date,
    status: 'SENT' | 'FAILED' | 'SKIPPED',
    code: string | null,
    message: string | null,
    consumeConsent: boolean,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const client = tx as any;
      const updated = await client.miniProgramSubscriptionOutbox.updateMany({
        where: { id: outboxId, status: 'PROCESSING', processingAt: claimedAt },
        data: { status, processedAt: new Date(), lastErrorCode: code, lastError: message },
      });
      if (updated.count !== 1 || !consumeConsent) return;
      await client.miniProgramSubscriptionConsent.updateMany({
        where: { reservedOutboxId: outboxId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private templateDefinitions(): TemplateDefinition[] {
    return [
      this.definition('ORDER_SHIPPED', '订单发货提醒', '订单发货后通知你查看物流'),
      this.definition('AFTER_SALE_RESULT', '售后结果提醒', '售后审核、寄回与退款进度'),
      this.definition('WITHDRAW_RESULT', '提现结果提醒', '微信提现到账或失败结果'),
    ];
  }

  private definition(key: SubscriptionKey, label: string, description: string): TemplateDefinition {
    const prefix = `WECHAT_MINIAPP_SUBSCRIBE_${key}`;
    const templateId = this.config.get<string>(`${prefix}_TEMPLATE_ID`, '').trim();
    const fields = this.parseFields(this.config.get<string>(`${prefix}_FIELDS`, ''));
    return {
      key,
      label,
      description,
      templateId,
      fields,
      configured: this.wechat.isAvailable() && Boolean(templateId) && Object.keys(fields).length >= 2,
    };
  }

  private parseFields(raw: string): FieldMap {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const allowedSemantic = new Set(['reference', 'status', 'remark', 'time']);
      const result: FieldMap = {};
      for (const [semantic, keyword] of Object.entries(parsed)) {
        if (allowedSemantic.has(semantic) && typeof keyword === 'string'
          && /^(thing|character_string|phrase|time|date|amount|number)\d+$/.test(keyword)) {
          result[semantic as keyof FieldMap] = keyword;
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  private buildWechatData(
    fields: FieldMap,
    event: NotificationEvent,
    message: NotificationMessageDraft,
    eventTime = new Date(),
  ) {
    const semantic: Record<keyof FieldMap, string> = {
      reference: this.shortReference(message.entityId || event.aggregateId),
      status: (STATUS_TEXT[event.eventType] || '进度已更新').slice(0, 10),
      remark: message.body.replace(/\s+/g, '').slice(0, 20),
      time: this.shanghaiTime(eventTime),
    };
    return Object.fromEntries(Object.entries(fields).map(([key, keyword]) => [
      keyword,
      { value: semantic[key as keyof FieldMap] },
    ]));
  }

  private async resolveEventTime(event: NotificationEvent): Promise<Date> {
    // 提现模板的字段名称是“申请时间”，必须使用提现申请创建时间，不能把
    // 打款成功/失败或后台拒绝的处理时间伪装成申请时间。其他事件暂时以
    // 通知生成时间为准，直到其事件契约提供明确的业务时间。
    if (event.eventType.startsWith('withdraw.')) {
      const request = await this.prisma.withdrawRequest.findUnique({
        where: { id: event.aggregateId },
        select: { createdAt: true },
      });
      if (request?.createdAt) return request.createdAt;
    }
    return new Date();
  }

  private resolvePage(message: NotificationMessageDraft): string | null {
    const params = message.action?.params || {};
    if (message.action?.routeKey === 'ORDER_DETAIL' && params.id) {
      return `packages/orders/order-detail/index?id=${encodeURIComponent(params.id)}`;
    }
    if (message.action?.routeKey === 'AFTER_SALE_DETAIL' && params.id) {
      return `packages/after-sales/after-sale-detail/index?id=${encodeURIComponent(params.id)}`;
    }
    if (message.action?.routeKey === 'WALLET') return 'packages/member/wallet/index';
    return null;
  }

  private consentStatus(status: 'accept' | 'reject' | 'ban' | 'filter'): ConsentStatus {
    if (status === 'accept') return 'ACCEPTED';
    if (status === 'ban') return 'BANNED';
    if (status === 'filter') return 'FILTERED';
    return 'REJECTED';
  }

  private miniProgramState(): 'developer' | 'trial' | 'formal' {
    const value = this.config.get<string>('WECHAT_MINIAPP_SUBSCRIBE_STATE', 'formal').trim();
    if (value === 'develop') return 'developer';
    return value === 'developer' || value === 'trial' ? value : 'formal';
  }

  private shortReference(value: string) {
    const safe = value.replace(/[^A-Za-z0-9_-]/g, '');
    return safe.length > 16 ? `${safe.slice(0, 6)}-${safe.slice(-8)}` : safe || '详情见小程序';
  }

  private shanghaiTime(date: Date) {
    const shifted = new Date(date.getTime() + 8 * 60 * 60_000);
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')} ${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
  }

  private maskId(value: string) {
    return value.length > 10 ? `${value.slice(0, 4)}***${value.slice(-4)}` : '[ID]';
  }
}
