import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CsAgentService } from './cs-agent.service';

/**
 * 会话定时清理服务（F1 修复）
 *
 * 解决问题：会话超时清理原本只在用户再次进入 createSession 时触发，
 * 用户一去不返的情况下，旧会话会永远留在 AI_HANDLING / QUEUING / AGENT_HANDLING 状态，
 * 污染统计、占用坐席名额、管理后台列表变脏。
 *
 * 策略：
 * - 每 10 分钟扫描一次
 * - AI_HANDLING 状态空闲超过 `SESSION_IDLE_TIMEOUT_MS` 自动关闭
 * - QUEUING 状态超过 30 分钟无坐席接入自动关闭（防止用户永远排队）
 * - AGENT_HANDLING 状态超过 60 分钟无消息自动关闭（防止坐席挂机）
 */
@Injectable()
export class CsCleanupService {
  private readonly logger = new Logger(CsCleanupService.name);

  private readonly AI_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;  // 2 小时
  private readonly QUEUING_TIMEOUT_MS = 30 * 60 * 1000;       // 30 分钟
  private readonly AGENT_IDLE_TIMEOUT_MS = 60 * 60 * 1000;    // 60 分钟

  constructor(
    private prisma: PrismaService,
    private agentService: CsAgentService,
  ) {}

  /** 每 10 分钟执行一次 */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupIdleSessions() {
    const now = Date.now();

    // 1. 清理 AI_HANDLING 超时会话
    const aiCutoff = new Date(now - this.AI_IDLE_TIMEOUT_MS);
    const aiStale = await this.findStaleSessions('AI_HANDLING', aiCutoff);

    // 2. 清理 QUEUING 超时会话（用户放弃等待）
    const queuingCutoff = new Date(now - this.QUEUING_TIMEOUT_MS);
    const queuingStale = await this.findStaleSessions('QUEUING', queuingCutoff);

    // 3. 清理 AGENT_HANDLING 超时会话（坐席未回复）
    const agentCutoff = new Date(now - this.AGENT_IDLE_TIMEOUT_MS);
    const agentStale = await this.findStaleSessions('AGENT_HANDLING', agentCutoff);

    const allStale = [...aiStale, ...queuingStale, ...agentStale];
    if (allStale.length === 0) {
      return;
    }

    this.logger.log(
      `会话清理: AI=${aiStale.length} QUEUING=${queuingStale.length} AGENT=${agentStale.length}`,
    );

    // 批量关闭会话 + 释放坐席
    for (const session of allStale) {
      try {
        await this.prisma.csSession.update({
          where: { id: session.id },
          data: { status: 'CLOSED', closedAt: new Date() },
        });

        // 释放坐席名额
        if (session.agentId) {
          await this.agentService.releaseAgent(session.agentId);
        }

        // 标记工单为已解决
        if (session.ticketId) {
          await this.prisma.csTicket.update({
            where: { id: session.ticketId },
            data: { status: 'RESOLVED', resolvedAt: new Date() },
          });
        }
      } catch (e: any) {
        this.logger.warn(`清理会话 ${session.id} 失败: ${e.message}`);
      }
    }
  }

  /**
   * 查找指定状态且最后活动时间早于 cutoff 的会话
   * 活动时间 = max(最后消息时间, 会话创建时间)
   */
  private async findStaleSessions(
    status: 'AI_HANDLING' | 'QUEUING' | 'AGENT_HANDLING',
    cutoff: Date,
  ) {
    const sessions = await this.prisma.csSession.findMany({
      where: { status },
      select: {
        id: true,
        agentId: true,
        ticketId: true,
        createdAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    return sessions.filter((s) => {
      const lastActivity = s.messages[0]?.createdAt ?? s.createdAt;
      return new Date(lastActivity).getTime() < cutoff.getTime();
    });
  }
}
