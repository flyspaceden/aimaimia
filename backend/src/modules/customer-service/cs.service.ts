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

  /** 创建客服会话 */
  async createSession(userId: string, source: string, sourceId?: string) {
    const existing = await this.prisma.csSession.findFirst({
      where: {
        userId,
        source: source as any,
        sourceId: sourceId || null,
        status: { in: ['AI_HANDLING', 'QUEUING', 'AGENT_HANDLING'] },
      },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (existing) {
      return { sessionId: existing.id, isExisting: true };
    }

    const session = await this.prisma.csSession.create({
      data: { userId, source: source as any, sourceId: sourceId || null },
    });

    return { sessionId: session.id, isExisting: false };
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

  /** 处理用户消息：保存 + 路由 + 返回回复 */
  async handleUserMessage(sessionId: string, userId: string, content: string, contentType: CsContentType = 'TEXT') {
    const session = await this.prisma.csSession.findUnique({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!session) throw new NotFoundException('会话不存在');
    if (session.userId !== userId) throw new NotFoundException('会话不存在');
    if (session.status === 'CLOSED') throw new BadRequestException('会话已关闭');

    // 保存用户消息
    const userMsg = await this.prisma.csMessage.create({
      data: { sessionId, senderType: 'USER', senderId: userId, contentType, content },
    });

    // 已转人工或排队中 → 只保存消息，不走路由（避免重复建工单）
    if (session.status === 'AGENT_HANDLING' || session.status === 'QUEUING') {
      return { userMessage: userMsg, aiReply: null, transferred: false };
    }

    // 构建 AI 上下文
    const context = await this.buildAiContext(session);

    // 路由
    const failures = this.consecutiveFailures.get(sessionId) ?? 0;
    const routeResult = await this.routingService.route(content, context, failures);

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
