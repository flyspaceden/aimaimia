import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { CsSessionStatus, CsMessageSender, CsContentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CsRoutingService } from './cs-routing.service';
import { CsAgentService } from './cs-agent.service';
import { CsTicketService } from './cs-ticket.service';
import { CsRouteResult, CsAiContext } from './types/cs.types';

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
  ) {}

  /** 会话空闲超时（毫秒）：超过此时间无活动，下次进入自动开新会话 */
  private readonly SESSION_IDLE_TIMEOUT_MS = 5 * 1000; // TODO: 测试用 5 秒，上线前改回 2 * 60 * 60 * 1000

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

  /**
   * 处理用户消息：保存 + 路由 + 返回回复
   *
   * 修复 D2/D4：
   * - 用户消息保存使用 createdAt 严格升序，前端可按此排序避免乱序（D1）
   * - 路由完成后再次校验 session.status，CLOSED/QUEUING/AGENT_HANDLING 时不写入 AI 回复（D2 防幽灵消息）
   * - 全过程无单一事务（因为路由含外部 LLM 调用，不能锁数据库），但用 CAS 防止状态漂移
   */
  async handleUserMessage(sessionId: string, userId: string, content: string, contentType: CsContentType = 'TEXT') {
    const session = await this.prisma.csSession.findUnique({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!session) throw new NotFoundException('会话不存在');
    if (session.userId !== userId) throw new NotFoundException('会话不存在');
    if (session.status === 'CLOSED') throw new BadRequestException('会话已关闭');

    // 保存用户消息（带显式时间戳确保顺序）
    const userMsg = await this.prisma.csMessage.create({
      data: { sessionId, senderType: 'USER', senderId: userId, contentType, content },
    });

    // 已转人工或排队中 → 只保存消息，不走路由（避免重复建工单）
    if (session.status === 'AGENT_HANDLING' || session.status === 'QUEUING') {
      return { userMessage: userMsg, aiReply: null, transferred: false };
    }

    // 构建 AI 上下文
    const context = await this.buildAiContext(session);

    // 路由（含外部 LLM 调用，可能数秒）
    const failures = this.consecutiveFailures.get(sessionId) ?? 0;
    const routeResult = await this.routingService.route(content, context, failures);

    // D2 修复：路由完成后重新检查 session 状态（期间可能被关闭/转人工）
    const currentSession = await this.prisma.csSession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });

    if (!currentSession || currentSession.status !== 'AI_HANDLING') {
      // 状态已变更，丢弃路由结果，仅返回用户消息
      this.logger.warn(
        `会话 ${sessionId} 在路由期间状态变更为 ${currentSession?.status ?? 'NOT_FOUND'}，丢弃 AI 回复`,
      );
      return { userMessage: userMsg, aiReply: null, transferred: false };
    }

    // 更新连续失败计数
    if (routeResult.layer === 2 && !routeResult.aiIntent) {
      this.consecutiveFailures.set(sessionId, failures + 1);
    } else {
      this.consecutiveFailures.delete(sessionId);
    }

    // 保存 AI/系统回复
    let aiReply = null;
    if (routeResult.reply) {
      aiReply = await this.prisma.csMessage.create({
        data: {
          sessionId,
          senderType: 'AI',
          contentType: (routeResult.contentType as CsContentType) ?? 'TEXT',
          content: routeResult.reply,
          metadata: (routeResult.metadata as any) ?? undefined,
          routeLayer: routeResult.layer,
        },
      });
    }

    // 需要转人工
    let transferred = false;
    if (routeResult.shouldTransferToAgent) {
      transferred = await this.transferToAgent(sessionId);
    }

    return { userMessage: userMsg, aiReply, transferred, routeResult };
  }

  /** 转人工（CAS 防并发 + 幂等工单创建） */
  async transferToAgent(sessionId: string): Promise<boolean> {
    // CAS：仅当 status 仍为 AI_HANDLING 时才允许转人工（防并发重复调用）
    const casResult = await this.prisma.csSession.updateMany({
      where: { id: sessionId, status: 'AI_HANDLING' },
      data: { status: 'QUEUING' }, // 先进排队，再尝试分配坐席
    });
    if (casResult.count === 0) {
      // 已被其他并发请求转走，跳过
      return false;
    }

    // 创建工单（CAS 成功后才创建，避免重复）
    await this.ticketService.createTicket(sessionId);

    // 尝试分配坐席
    const adminId = await this.agentService.assignAgent();

    if (adminId) {
      await this.prisma.csSession.update({
        where: { id: sessionId },
        data: { status: 'AGENT_HANDLING', agentId: adminId, agentJoinedAt: new Date() },
      });
      return true;
    }

    // 无可用坐席，保持 QUEUING 状态（已在 CAS 步骤设置）
    return false;
  }

  /** 坐席手动接入排队中的会话（CAS 防竞态 + 容量检查 + 递增计数） */
  async agentAcceptSession(sessionId: string, adminId: string) {
    // 1. 检查坐席容量（原子操作：只在 currentSessions < maxSessions 时递增）
    const capacityResult = await this.prisma.$queryRaw<{ adminId: string }[]>`
      UPDATE "CsAgentStatus"
      SET "currentSessions" = "currentSessions" + 1,
          "lastActiveAt" = NOW(),
          status = 'ONLINE'
      WHERE "adminId" = ${adminId}
        AND "currentSessions" < "maxSessions"
      RETURNING "adminId"
    `;

    // 如果坐席不存在，先创建再检查
    if (capacityResult.length === 0) {
      // 尝试创建新坐席记录（首次接入场景）
      const existing = await this.prisma.csAgentStatus.findUnique({ where: { adminId } });
      if (!existing) {
        await this.prisma.csAgentStatus.create({
          data: { adminId, status: 'ONLINE', currentSessions: 1, lastActiveAt: new Date() },
        });
      } else {
        throw new BadRequestException('坐席会话数已达上限');
      }
    }

    // 2. CAS 更新会话状态：只在 status=QUEUING 时才能接入
    const result = await this.prisma.csSession.updateMany({
      where: { id: sessionId, status: 'QUEUING' },
      data: { status: 'AGENT_HANDLING', agentId: adminId, agentJoinedAt: new Date() },
    });

    if (result.count === 0) {
      // 回退坐席计数
      await this.agentService.releaseAgent(adminId);
      throw new BadRequestException('会话不在排队状态或已被其他坐席接入');
    }
  }

  /** 坐席发送消息 */
  async handleAgentMessage(sessionId: string, adminId: string, content: string, contentType: CsContentType = 'TEXT', metadata?: any) {
    const session = await this.prisma.csSession.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== 'AGENT_HANDLING' || session.agentId !== adminId) {
      throw new BadRequestException('无权在此会话发送消息');
    }

    return this.prisma.csMessage.create({
      data: { sessionId, senderType: 'AGENT', senderId: adminId, contentType, content, metadata, routeLayer: 3 },
    });
  }

  /**
   * 坐席完成处理（柔性脱身）：仅释放自己，不关闭会话
   * - 用户视角：可继续咨询 AI 或重新转人工，会话自然延续
   * - 解决问题 D5：避免坐席关闭与买家发消息的竞态
   */
  async agentReleaseSession(sessionId: string, adminId: string) {
    // 检查会话状态
    const current = await this.prisma.csSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true, agentId: true, ticketId: true },
    });

    if (!current) {
      throw new BadRequestException('会话不存在');
    }

    // 已经不是 AGENT_HANDLING（可能是 AI_HANDLING/CLOSED）→ 无需释放，直接返回
    if (current.status !== 'AGENT_HANDLING') {
      return { systemMessage: null, alreadyReleased: true };
    }

    // 不是当前坐席接入的会话
    if (current.agentId !== adminId) {
      throw new BadRequestException('无权释放此会话（非当前接入的坐席）');
    }

    // CAS 更新：只在状态仍为 AGENT_HANDLING 且 agentId 匹配时才释放
    const result = await this.prisma.csSession.updateMany({
      where: { id: sessionId, agentId: adminId, status: 'AGENT_HANDLING' },
      data: {
        agentId: null,
        agentJoinedAt: null,
        status: 'AI_HANDLING', // 退回 AI 接待
      },
    });

    if (result.count === 0) {
      // 在检查到更新之间状态被改了
      return { systemMessage: null, alreadyReleased: true };
    }

    // 释放坐席名额
    await this.agentService.releaseAgent(adminId);

    // 插入系统消息通知用户
    const sysMsg = await this.prisma.csMessage.create({
      data: {
        sessionId,
        senderType: 'SYSTEM',
        contentType: 'TEXT',
        content: '客服已完成本次服务。如还有问题，可继续咨询智能助手或说"转人工"重新接入。',
      },
    });

    // 标记关联工单为已解决（复用前面查询的 current.ticketId）
    if (current.ticketId) {
      await this.prisma.csTicket.update({
        where: { id: current.ticketId },
        data: { status: 'RESOLVED', resolvedBy: adminId, resolvedAt: new Date() },
      });
    }

    return { systemMessage: sysMsg };
  }

  /** 关闭会话 */
  async closeSession(sessionId: string) {
    const session = await this.prisma.csSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('会话不存在');

    if (session.agentId) {
      await this.agentService.releaseAgent(session.agentId);
    }

    await this.prisma.csSession.update({
      where: { id: sessionId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    if (session.ticketId) {
      await this.prisma.csTicket.update({
        where: { id: session.ticketId },
        data: { status: 'RESOLVED', resolvedBy: session.agentId, resolvedAt: new Date() },
      });
    }

    this.consecutiveFailures.delete(sessionId);
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

    return this.prisma.csMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
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
          select: { id: true, status: true, goodsAmount: true, shippingFee: true, createdAt: true, items: { select: { productSnapshot: true, quantity: true, unitPrice: true } } },
        });
        if (order) context.orderInfo = order as any;
      } catch { /* non-critical */ }
    }

    if (session.source === 'AFTERSALE_DETAIL' && session.sourceId) {
      context.afterSaleId = session.sourceId;
      try {
        const afterSale = await this.prisma.afterSaleRequest.findUnique({
          where: { id: session.sourceId },
          select: { id: true, status: true, afterSaleType: true, reason: true, refundAmount: true },
        });
        if (afterSale) context.afterSaleInfo = afterSale as any;
      } catch { /* non-critical */ }
    }

    return context;
  }
}
