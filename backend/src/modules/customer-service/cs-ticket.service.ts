import { Injectable, Logger } from '@nestjs/common';
import { CsTicketCategory, CsTicketPriority, CsTicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CsTicketService {
  private readonly logger = new Logger(CsTicketService.name);

  private readonly QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  private readonly SUMMARY_MODEL = process.env.AI_CS_SUMMARY_MODEL || 'qwen-flash';

  constructor(private prisma: PrismaService) {}

  /** 为转人工的会话创建工单 */
  async createTicket(sessionId: string, category: CsTicketCategory = 'OTHER'): Promise<string> {
    const session = await this.prisma.csSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    // 根据来源决定优先级
    let priority: CsTicketPriority = 'MEDIUM';
    if (category === 'PAYMENT') priority = 'HIGH';

    // 尝试生成 AI 摘要
    let summary: string | undefined;
    try {
      summary = await this.generateSummary(session.messages.map((m) => ({
        role: m.senderType === 'USER' ? 'user' : 'assistant',
        content: m.content,
      })));
    } catch (e) {
      this.logger.warn('AI 摘要生成失败，跳过', e);
    }

    const ticket = await this.prisma.csTicket.create({
      data: {
        userId: session.userId,
        category,
        priority,
        summary,
        relatedOrderId: session.source === 'ORDER_DETAIL' ? session.sourceId : undefined,
        relatedAfterSaleId: session.source === 'AFTERSALE_DETAIL' ? session.sourceId : undefined,
      },
    });

    // 将会话关联到工单
    await this.prisma.csSession.update({
      where: { id: sessionId },
      data: { ticketId: ticket.id },
    });

    return ticket.id;
  }

  /** 调用 LLM 生成对话摘要 */
  private async generateSummary(messages: { role: string; content: string }[]): Promise<string> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error('DASHSCOPE_API_KEY not set');

    const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join('\n');

    // 10秒超时保护
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    let data: any;
    try {
      const response = await fetch(this.QWEN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.SUMMARY_MODEL,
          messages: [
            {
              role: 'system',
              content: '你是客服系统的摘要助手。请用一句话总结以下客服对话的核心问题，不超过100字。',
            },
            { role: 'user', content: conversationText },
          ],
          max_tokens: 200,
        }),
      });
      data = await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
    return data.choices?.[0]?.message?.content?.trim() || '（无法生成摘要）';
  }

  // --- Admin CRUD ---

  async findAll(params: {
    page?: number;
    pageSize?: number;
    status?: CsTicketStatus;
    category?: CsTicketCategory;
    priority?: CsTicketPriority;
  }) {
    const { page = 1, pageSize = 20, status, category, priority } = params;
    const where: any = {};
    if (status) where.status = status;
    if (category) where.category = category;
    if (priority) where.priority = priority;

    const [items, total] = await Promise.all([
      this.prisma.csTicket.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { include: { profile: { select: { nickname: true, avatarUrl: true } } } },
          sessions: { select: { id: true, status: true, createdAt: true } },
        },
      }),
      this.prisma.csTicket.count({ where }),
    ]);

    return { items, total };
  }

  async update(id: string, data: { status?: CsTicketStatus; priority?: CsTicketPriority }, adminId?: string) {
    const updateData: any = { ...data };
    if (data.status === 'RESOLVED') {
      updateData.resolvedBy = adminId;
      updateData.resolvedAt = new Date();
    }
    return this.prisma.csTicket.update({ where: { id }, data: updateData });
  }
}
