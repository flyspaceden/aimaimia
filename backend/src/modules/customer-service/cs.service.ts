import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { CsSessionStatus, CsMessageSender, CsContentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CsRoutingService } from './cs-routing.service';
import { CsAgentService } from './cs-agent.service';
import { CsTicketService } from './cs-ticket.service';
import { CsMaskingService } from './cs-masking.service';
import { CsRouteResult, CsAiContext } from './types/cs.types';
import { NotificationService } from '../notification/notification.service';
import { CsPresenceService } from './cs-presence.service';

type BuyerSessionScope = 'active' | 'history' | 'all';

const BUYER_ACTIVE_SESSION_STATUSES: CsSessionStatus[] = ['AI_HANDLING', 'QUEUING', 'AGENT_HANDLING'];
const BUYER_UNREAD_SENDERS: CsMessageSender[] = ['AI', 'AGENT', 'SYSTEM'];

@Injectable()
export class CsService {
  private readonly logger = new Logger(CsService.name);

  /** 追踪每个会话的 AI 连续失败次数 */
  private consecutiveFailures = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private routingService: CsRoutingService,
    private agentService: CsAgentService,
    private ticketService: CsTicketService,
    private maskingService: CsMaskingService,
    private notificationService: NotificationService,
    private presenceService: CsPresenceService,
  ) {}

  /** 会话空闲超时（毫秒）：超过此时间无活动，下次进入自动开新会话 */
  private readonly SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

  /**
   * 创建客服会话（超过 2 小时无活动的旧会话自动关闭）
   *
   * 修复 D3：用 Serializable 隔离级别 + 重试机制防止并发创建重复会话
   * - 同一用户多端同时点客服 → 两个事务争抢，一个成功，另一个收到序列化冲突错误
   * - 失败的事务重试一次，第二次会找到已创建的会话并复用
   */
  async createSession(userId: string, source: string, sourceId?: string) {
    const tryCreate = async (): Promise<{ sessionId: string; isExisting: boolean }> => {
      return this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.csSession.findFirst({
            where: {
              userId,
              source: source as any,
              sourceId: sourceId || null,
              status: { in: ['AI_HANDLING', 'QUEUING', 'AGENT_HANDLING'] },
            },
            include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
          });

          if (existing) {
            // 检查会话是否已超时：以最后一条消息时间或会话创建时间为准
            const lastActivity = existing.messages[0]?.createdAt ?? existing.createdAt;
            const idleMs = Date.now() - new Date(lastActivity).getTime();

            if (idleMs <= this.SESSION_IDLE_TIMEOUT_MS) {
              return { sessionId: existing.id, isExisting: true };
            }

            // 超时：在事务内静默关闭旧会话
            await tx.csSession.update({
              where: { id: existing.id },
              data: { status: 'CLOSED', closedAt: new Date() },
            });
            if (existing.agentId) {
              await tx.csAgentStatus.updateMany({
                where: { adminId: existing.agentId, currentSessions: { gt: 0 } },
                data: { currentSessions: { decrement: 1 }, lastActiveAt: new Date() },
              });
            }
            if (existing.ticketId) {
              await tx.csTicket.update({
                where: { id: existing.ticketId },
                data: {
                  status: 'RESOLVED',
                  resolvedBy: existing.agentId,
                  resolvedAt: new Date(),
                },
              });
            }
            this.logger.log(`会话 ${existing.id} 空闲超时，已自动关闭`);
          }

          const session = await tx.csSession.create({
            data: { userId, source: source as any, sourceId: sourceId || null },
          });

          return { sessionId: session.id, isExisting: false };
        },
        { isolationLevel: 'Serializable' },
      );
    };

    try {
      return await tryCreate();
    } catch (err: any) {
      // Postgres 序列化冲突（并发创建会话）→ 重试一次，第二次会找到已创建的会话
      if (err?.code === 'P2034' || err?.message?.includes('serialization')) {
        this.logger.warn(`createSession 序列化冲突，重试: ${userId}/${source}/${sourceId}`);
        return await tryCreate();
      }
      throw err;
    }
  }

  /** 获取用户活跃会话 */
  async getActiveSession(userId: string, source: string, sourceId?: string) {
    return this.prisma.csSession.findFirst({
      where: {
        userId,
        source: source as any,
        sourceId: sourceId || null,
        status: { in: ['AI_HANDLING', 'QUEUING', 'AGENT_HANDLING'] },
      },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        ticket: true,
      },
    });
  }

  /** 获取买家客服会话列表（进行中/历史），用于 App 客服中心入口 */
  async getBuyerSessionList(
    userId: string,
    params: { scope?: BuyerSessionScope | string; page?: number; pageSize?: number },
  ) {
    const scope: BuyerSessionScope =
      params.scope === 'history' ? 'history' : params.scope === 'all' ? 'all' : 'active';
    const page = Number.isFinite(params.page) && Number(params.page) > 0 ? Number(params.page) : 1;
    const pageSize = Number.isFinite(params.pageSize) && Number(params.pageSize) > 0
      ? Math.min(Number(params.pageSize), 50)
      : 20;

    const where: any = { userId };
    if (scope === 'active') {
      where.status = { in: BUYER_ACTIVE_SESSION_STATUSES };
    } else if (scope === 'history') {
      where.status = 'CLOSED';
    }

    const sessions = await this.prisma.csSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        ticket: { select: { id: true, category: true, priority: true } },
      },
    });

    const sortedSessions = [...sessions].sort((a: any, b: any) => {
      const bTime = new Date(b.messages?.[0]?.createdAt ?? b.createdAt).getTime();
      const aTime = new Date(a.messages?.[0]?.createdAt ?? a.createdAt).getTime();
      return bTime - aTime;
    });
    const pageStart = (page - 1) * pageSize;
    const pagedSessions = sortedSessions.slice(pageStart, pageStart + pageSize);

    const items = await Promise.all(
      pagedSessions.map(async (session: any) => {
        const unreadWhere: any = {
          sessionId: session.id,
          senderType: { in: BUYER_UNREAD_SENDERS },
        };
        if (session.buyerLastReadAt) {
          unreadWhere.createdAt = { gt: session.buyerLastReadAt };
        }

        const unreadCount = await this.prisma.csMessage.count({ where: unreadWhere });
        const { messages, ...summary } = session;

        return {
          ...summary,
          lastMessage: messages[0] ?? null,
          unreadCount,
        };
      }),
    );

    return { items, page, pageSize };
  }

  /** 获取买家自有会话的权威状态，供通知深链接和历史会话初始化。 */
  async getBuyerSessionDetail(sessionId: string, userId: string) {
    const session = await this.prisma.csSession.findFirst({
      where: { id: sessionId, userId },
      select: {
        id: true,
        status: true,
        source: true,
        sourceId: true,
        agentId: true,
        closedAt: true,
      },
    });
    if (!session) throw new NotFoundException('会话不存在');
    return session;
  }

  /** 标记买家已读到当前时间，只允许会话持有人调用 */
  async markBuyerSessionRead(sessionId: string, userId: string) {
    const session = await this.prisma.csSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true },
    });
    if (!session || session.userId !== userId) throw new NotFoundException('会话不存在');

    return this.prisma.csSession.update({
      where: { id: sessionId },
      data: { buyerLastReadAt: new Date() },
      select: { id: true, buyerLastReadAt: true },
    });
  }

  /**
   * 处理用户消息：保存 + 路由 + 返回回复
   *
   * 修复 D2/D4：
   * - 用户消息保存使用 createdAt 严格升序，前端可按此排序避免乱序（D1）
   * - 路由完成后再次校验 session.status，CLOSED/QUEUING/AGENT_HANDLING 时不写入 AI 回复（D2 防幽灵消息）
   * - 全过程无单一事务（因为路由含外部 LLM 调用，不能锁数据库），但用 CAS 防止状态漂移
   */
  async handleUserMessage(sessionId: string, userId: string, content: string, contentType: CsContentType = 'TEXT') {
    // Sec1: 写入前对用户消息脱敏（身份证/银行卡/手机号/邮箱）
    const maskedContent = this.maskingService.mask(content);
    const { session, userMsg } = await this.prisma.$transaction(async (tx) => {
      // 与 closeSession 串行化，避免状态校验后会话被关闭再写入消息。
      await tx.$queryRaw`SELECT "id" FROM "CsSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const lockedSession = await tx.csSession.findUnique({
        where: { id: sessionId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });

      if (!lockedSession) throw new NotFoundException('会话不存在');
      if (lockedSession.userId !== userId) throw new NotFoundException('会话不存在');
      if (lockedSession.status === 'CLOSED') throw new BadRequestException('会话已关闭');

      const persistedMessage = await tx.csMessage.create({
        data: { sessionId, senderType: 'USER', senderId: userId, contentType, content: maskedContent },
      });
      return { session: lockedSession, userMsg: persistedMessage };
    });
    this.presenceService.markUserActiveInSession(sessionId, userId);

    // 已转人工或排队中 → 只保存消息，不走路由（避免重复建工单）
    if (session.status === 'AGENT_HANDLING' || session.status === 'QUEUING') {
      return { userMessage: userMsg, aiReply: null, transferred: false };
    }

    // 构建 AI 上下文
    const context = await this.buildAiContext(session);

    // 路由（含外部 LLM 调用，可能数秒）
    // Sec1: 路由也用脱敏后的内容，防止敏感信息泄漏给 LLM
    const failures = this.consecutiveFailures.get(sessionId) ?? 0;
    const routeResult = await this.routingService.route(maskedContent, context, failures);

    // 路由可能耗时数秒；在短事务内重新锁行，并把状态校验与 AI 回复落库合并为原子操作。
    const finalizedRoute = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CsSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const currentSession = await tx.csSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });
      if (!currentSession || currentSession.status !== 'AI_HANDLING') {
        return { status: currentSession?.status ?? null, aiReply: null, valid: false as const };
      }

      const aiReply = routeResult.reply
        ? await tx.csMessage.create({
            data: {
              sessionId,
              senderType: 'AI',
              contentType: (routeResult.contentType as CsContentType) ?? 'TEXT',
              content: routeResult.reply,
              metadata: (routeResult.metadata as any) ?? undefined,
              routeLayer: routeResult.layer,
            },
          })
        : null;
      return { status: currentSession.status, aiReply, valid: true as const };
    });

    if (!finalizedRoute.valid) {
      // 状态已变更，丢弃路由结果，仅返回用户消息
      this.logger.warn(
        `会话 ${sessionId} 在路由期间状态变更为 ${finalizedRoute.status ?? 'NOT_FOUND'}，丢弃 AI 回复`,
      );
      return { userMessage: userMsg, aiReply: null, transferred: false };
    }

    // 更新连续失败计数
    if (routeResult.layer === 2 && !routeResult.aiIntent) {
      this.consecutiveFailures.set(sessionId, failures + 1);
    } else {
      this.consecutiveFailures.delete(sessionId);
    }

    const aiReply = finalizedRoute.aiReply;

    // 需要转人工
    let transferred = false;
    if (routeResult.shouldTransferToAgent) {
      transferred = await this.transferToAgent(sessionId);
    }

    return { userMessage: userMsg, aiReply, transferred, routeResult };
  }

  /** 转人工（CAS 防并发 + 幂等工单创建） */
  async transferToAgent(sessionId: string): Promise<boolean> {
    const ticketId = await this.ticketService.createTransferTicket(sessionId);
    if (!ticketId) return false;

    // 坐席名额预占和会话归属必须同时成功或同时回滚。
    return this.prisma.$transaction(async (tx) => {
      const adminId = await this.agentService.assignAgent(tx);
      if (!adminId) return false;

      const assigned = await tx.csSession.updateMany({
        where: { id: sessionId, status: 'QUEUING', agentId: null },
        data: { status: 'AGENT_HANDLING', agentId: adminId, agentJoinedAt: new Date() },
      });

      if (assigned.count === 0) {
        await this.agentService.releaseAgent(adminId, tx);
        return false;
      }
      return true;
    });
  }

  /** 坐席手动接入排队中的会话（CAS 防竞态 + 容量检查 + 递增计数） */
  async agentAcceptSession(sessionId: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. 检查坐席容量（原子操作：只在 currentSessions < maxSessions 时递增）
      const capacityResult = await tx.$queryRaw<{ adminId: string }[]>`
        UPDATE "CsAgentStatus"
        SET "currentSessions" = "currentSessions" + 1,
            "lastActiveAt" = NOW(),
            status = 'ONLINE'
        WHERE "adminId" = ${adminId}
          AND "currentSessions" < "maxSessions"
        RETURNING "adminId"
      `;

      // 如果坐席不存在，先创建再检查。后续 CAS 失败时会一并回滚。
      if (capacityResult.length === 0) {
        const existing = await tx.csAgentStatus.findUnique({ where: { adminId } });
        if (!existing) {
          await tx.csAgentStatus.create({
            data: { adminId, status: 'ONLINE', currentSessions: 1, lastActiveAt: new Date() },
          });
        } else {
          throw new BadRequestException('坐席会话数已达上限');
        }
      }

      // 2. CAS 更新会话状态：只在 status=QUEUING 时才能接入
      const result = await tx.csSession.updateMany({
        where: { id: sessionId, status: 'QUEUING' },
        data: { status: 'AGENT_HANDLING', agentId: adminId, agentJoinedAt: new Date() },
      });

      if (result.count === 0) {
        throw new BadRequestException('会话不在排队状态或已被其他坐席接入');
      }
    });
  }

  /** 坐席发送消息 */
  async handleAgentMessage(sessionId: string, adminId: string, content: string, contentType: CsContentType = 'TEXT', metadata?: any) {
    // Sec1: 坐席消息也脱敏（防止坐席误发包含用户敏感信息的内容）
    const maskedContent = this.maskingService.mask(content);
    const { session, message } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CsSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const lockedSession = await tx.csSession.findUnique({ where: { id: sessionId } });
      if (
        !lockedSession
        || lockedSession.status !== 'AGENT_HANDLING'
        || lockedSession.agentId !== adminId
      ) {
        throw new BadRequestException('无权在此会话发送消息');
      }

      const persistedMessage = await tx.csMessage.create({
        data: { sessionId, senderType: 'AGENT', senderId: adminId, contentType, content: maskedContent, metadata, routeLayer: 3 },
      });
      return { session: lockedSession, message: persistedMessage };
    });
    if (!this.presenceService.isUserInSession(sessionId, session.userId)) {
      try {
        await this.notificationService.emit({
          eventType: 'cs.agentReplyOffline',
          aggregateType: 'csSession',
          aggregateId: sessionId,
          idempotencyKey: `cs:${sessionId}:${message.id}:agent-reply-offline`,
          actor: { kind: 'admin', id: adminId },
          payload: {
            sessionId,
            userId: session.userId,
            messageId: message.id,
          },
        });
      } catch (error: any) {
        // 消息已经提交，通知降级不能让坐席误以为发送失败并重复发送。
        this.logger.error(`客服消息 ${message.id} 离线通知写入失败`, error?.stack || error);
      }
    }
    return message;
  }

  /**
   * 坐席完成处理（柔性脱身）：仅释放自己，不关闭会话
   * - 用户视角：可继续咨询 AI 或重新转人工，会话自然延续
   * - 解决问题 D5：避免坐席关闭与买家发消息的竞态
   */
  async agentReleaseSession(sessionId: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CsSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const current = await tx.csSession.findUnique({
        where: { id: sessionId },
        select: { id: true, status: true, agentId: true, ticketId: true },
      });

      if (!current) throw new BadRequestException('会话不存在');
      if (current.status !== 'AGENT_HANDLING') {
        return { systemMessage: null, alreadyReleased: true };
      }
      if (current.agentId !== adminId) {
        throw new BadRequestException('无权释放此会话（非当前接入的坐席）');
      }

      const result = await tx.csSession.updateMany({
        where: { id: sessionId, agentId: adminId, status: 'AGENT_HANDLING' },
        data: {
          agentId: null,
          agentJoinedAt: null,
          status: 'AI_HANDLING',
        },
      });
      if (result.count === 0) {
        return { systemMessage: null, alreadyReleased: true };
      }

      await this.agentService.releaseAgent(adminId, tx);
      const systemMessage = await tx.csMessage.create({
        data: {
          sessionId,
          senderType: 'SYSTEM',
          contentType: 'TEXT',
          content: '客服已完成本次服务。如还有问题，可继续咨询智能助手或说"转人工"重新接入。',
        },
      });

      if (current.ticketId) {
        await tx.csTicket.update({
          where: { id: current.ticketId },
          data: { status: 'RESOLVED', resolvedBy: adminId, resolvedAt: new Date() },
        });
      }

      return { systemMessage };
    });
  }

  /** 关闭会话。只有抢到状态转换的一方执行释放席位、解决工单等副作用。 */
  async closeSession(sessionId: string, expectedAgentId?: string): Promise<{ alreadyClosed: boolean }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const session = await this.prisma.csSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundException('会话不存在');
      if (session.status === 'CLOSED') return { alreadyClosed: true };

      if (
        expectedAgentId
        && (session.status !== 'AGENT_HANDLING' || session.agentId !== expectedAgentId)
      ) {
        throw new BadRequestException('无权关闭此会话');
      }

      const didClose = await this.prisma.$transaction(async (tx) => {
        const closed = await tx.csSession.updateMany({
          where: {
            id: sessionId,
            status: session.status,
            agentId: session.agentId,
            ...(expectedAgentId ? { agentId: expectedAgentId } : {}),
          },
          data: { status: 'CLOSED', closedAt: new Date() },
        });

        if (closed.count === 0) return false;

        if (session.agentId) {
          await this.agentService.releaseAgent(session.agentId, tx);
        }

        if (session.ticketId) {
          await tx.csTicket.update({
            where: { id: session.ticketId },
            data: { status: 'RESOLVED', resolvedBy: session.agentId, resolvedAt: new Date() },
          });
        }
        return true;
      });

      if (!didClose) continue;

      this.consecutiveFailures.delete(sessionId);
      return { alreadyClosed: false };
    }

    throw new BadRequestException('会话状态已变化，请重试');
  }

  /** 提交满意度评价 */
  async submitRating(sessionId: string, userId: string, score: number, tags: string[], comment?: string) {
    const session = await this.prisma.csSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new NotFoundException('会话不存在');

    return this.prisma.csRating.create({
      data: { sessionId, userId, score, tags, comment },
    });
  }

  /** 获取会话消息列表 */
  async getSessionMessages(sessionId: string, userId: string) {
    const session = await this.prisma.csSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new NotFoundException('会话不存在');
    this.presenceService.markUserActiveInSession(sessionId, userId);

    const messages = await this.prisma.csMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    const lastReadAt = messages[messages.length - 1]?.createdAt;
    if (lastReadAt) {
      await this.prisma.csSession.update({
        where: { id: sessionId },
        data: { buyerLastReadAt: lastReadAt },
        select: { id: true },
      });
    }

    return messages;
  }

  /** 获取快捷入口配置（买家端） */
  async getQuickEntries() {
    return this.prisma.csQuickEntry.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** 获取统计数据 */
  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalSessions, aiResolved, agentHandled, avgRating, queueCount] = await Promise.all([
      this.prisma.csSession.count({ where: { createdAt: { gte: today } } }),
      this.prisma.csSession.count({ where: { createdAt: { gte: today }, status: 'CLOSED', agentId: null } }),
      this.prisma.csSession.count({ where: { createdAt: { gte: today }, agentId: { not: null } } }),
      this.prisma.csRating.aggregate({ where: { createdAt: { gte: today } }, _avg: { score: true } }),
      this.prisma.csSession.count({ where: { status: 'QUEUING' } }),
    ]);

    const aiResolveRate = totalSessions > 0 ? Math.round((aiResolved / totalSessions) * 100) : 0;

    return { totalSessions, aiResolveRate, agentHandled, avgRating: avgRating._avg.score ?? 0, queueCount };
  }

  // --- Admin queries ---

  async getAdminSessionList(params: { status?: string; page?: number; pageSize?: number }) {
    const { status, page = 1, pageSize = 50 } = params;
    const where: any = {};
    if (status) where.status = status;

    return this.prisma.csSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { include: { profile: { select: { nickname: true, avatarUrl: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        ticket: { select: { id: true, category: true, priority: true } },
      },
    });
  }

  async getAdminSessionDetail(sessionId: string) {
    return this.prisma.csSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        user: {
          include: {
            profile: true,
            orders: { orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, status: true, goodsAmount: true, createdAt: true } },
          },
        },
        messages: { orderBy: { createdAt: 'asc' } },
        ticket: true,
        rating: true,
      },
    });
  }

  /**
   * U7 修复：构建 AI 上下文，注入完整订单信息
   * - 订单基本信息 + 状态 + 金额
   * - 订单商品清单（名称 + 数量 + 价格）
   * - 物流信息（承运商 + 单号 + 发货/送达时间 + 状态）
   * - 卖家名称
   * - 售后申请（如有）
   * - 收货地址（脱敏后的省市）
   */
  private async buildAiContext(session: any): Promise<CsAiContext> {
    const context: CsAiContext = {
      source: session.source,
      conversationHistory: session.messages.map((m: any) => ({
        role: m.senderType === 'USER' ? 'user' as const : 'assistant' as const,
        content: m.content,
      })),
    };

    if (session.source === 'ORDER_DETAIL' && session.sourceId) {
      context.orderId = session.sourceId;
      try {
        const order = await this.prisma.order.findUnique({
          where: { id: session.sourceId },
          select: {
            id: true,
            status: true,
            totalAmount: true,
            goodsAmount: true,
            shippingFee: true,
            discountAmount: true,
            paidAt: true,
            deliveredAt: true,
            createdAt: true,
            addressSnapshot: true,
            items: {
              select: {
                productSnapshot: true,
                quantity: true,
                unitPrice: true,
              },
            },
            shipments: {
              select: {
                carrierName: true,
                trackingNo: true,
                waybillNo: true,
                status: true,
                shippedAt: true,
                deliveredAt: true,
                company: { select: { name: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            afterSaleRequests: {
              select: {
                id: true,
                status: true,
                afterSaleType: true,
                reason: true,
                refundAmount: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });

        if (order) {
          // 精简成 AI 友好的结构：去掉冗余字段，提取商品名称
          const items = order.items.map((item: any) => {
            const snapshot = item.productSnapshot as any;
            return {
              name: snapshot?.title ?? snapshot?.name ?? '商品',
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            };
          });

          const address = order.addressSnapshot as any;
          const addressSummary = address
            ? `${address.province ?? ''}${address.city ?? ''}${address.district ?? ''}`.trim() || null
            : null;

          const shipment = order.shipments?.[0];
          const shipmentInfo = shipment
            ? {
                carrier: shipment.carrierName,
                carrierCompany: shipment.company?.name,
                trackingNo: shipment.trackingNo || shipment.waybillNo,
                status: shipment.status,
                shippedAt: shipment.shippedAt,
                deliveredAt: shipment.deliveredAt,
              }
            : null;

          const afterSale = order.afterSaleRequests?.[0];

          context.orderInfo = {
            id: order.id,
            status: order.status,
            totalAmount: order.totalAmount,
            goodsAmount: order.goodsAmount,
            shippingFee: order.shippingFee,
            discountAmount: order.discountAmount,
            paidAt: order.paidAt,
            deliveredAt: order.deliveredAt,
            createdAt: order.createdAt,
            itemCount: items.length,
            items,
            address: addressSummary,
            shipment: shipmentInfo,
            pendingAfterSale: afterSale
              ? {
                  id: afterSale.id,
                  status: afterSale.status,
                  type: afterSale.afterSaleType,
                  reason: afterSale.reason,
                  refundAmount: afterSale.refundAmount,
                }
              : null,
          } as any;
        }
      } catch (e: any) {
        this.logger.warn(`构建订单上下文失败 ${session.sourceId}: ${e?.message}`);
      }
    }

    if (session.source === 'AFTERSALE_DETAIL' && session.sourceId) {
      context.afterSaleId = session.sourceId;
      try {
        const afterSale = await this.prisma.afterSaleRequest.findUnique({
          where: { id: session.sourceId },
          select: {
            id: true,
            status: true,
            afterSaleType: true,
            reason: true,
            refundAmount: true,
            createdAt: true,
            order: {
              select: {
                id: true,
                status: true,
                totalAmount: true,
                items: {
                  select: {
                    productSnapshot: true,
                    quantity: true,
                  },
                },
              },
            },
          },
        });
        if (afterSale) {
          const items = afterSale.order?.items.map((item: any) => {
            const snapshot = item.productSnapshot as any;
            return {
              name: snapshot?.title ?? snapshot?.name ?? '商品',
              quantity: item.quantity,
            };
          }) ?? [];
          context.afterSaleInfo = {
            id: afterSale.id,
            status: afterSale.status,
            type: afterSale.afterSaleType,
            reason: afterSale.reason,
            refundAmount: afterSale.refundAmount,
            createdAt: afterSale.createdAt,
            orderId: afterSale.order?.id,
            orderStatus: afterSale.order?.status,
            orderItems: items,
          } as any;
        }
      } catch (e: any) {
        this.logger.warn(`构建售后上下文失败 ${session.sourceId}: ${e?.message}`);
      }
    }

    return context;
  }
}
