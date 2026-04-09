import { Injectable, Logger } from '@nestjs/common';
import { CsAgentOnlineStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CsAgentService {
  private readonly logger = new Logger(CsAgentService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 原子分配坐席：UPDATE ... WHERE + RETURNING 确保不会超额分配
   * 返回 adminId，无可用坐席返回 null
   */
  async assignAgent(): Promise<string | null> {
    // 原子操作：在单条 UPDATE 中同时选择和递增，避免 SELECT+UPDATE 竞态
    const result = await this.prisma.$queryRaw<{ adminId: string }[]>`
      UPDATE "CsAgentStatus"
      SET "currentSessions" = "currentSessions" + 1,
          "lastActiveAt" = NOW()
      WHERE "adminId" = (
        SELECT "adminId" FROM "CsAgentStatus"
        WHERE status = 'ONLINE' AND "currentSessions" < "maxSessions"
        ORDER BY "currentSessions" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "adminId"
    `;

    if (result.length === 0) return null;
    return result[0].adminId;
  }

  /** 坐席结束会话时递减 currentSessions */
  async releaseAgent(adminId: string) {
    await this.prisma.csAgentStatus.updateMany({
      where: { adminId, currentSessions: { gt: 0 } },
      data: { currentSessions: { decrement: 1 }, lastActiveAt: new Date() },
    });
  }

  /** 更新坐席在线状态 */
  async updateStatus(adminId: string, status: CsAgentOnlineStatus) {
    return this.prisma.csAgentStatus.upsert({
      where: { adminId },
      create: { adminId, status, lastActiveAt: new Date() },
      update: { status, lastActiveAt: new Date() },
    });
  }

  /** 坐席断线：标记离线 + 将其 AGENT_HANDLING 会话退回 QUEUING */
  async handleDisconnect(adminId: string) {
    // 1. 将该坐席正在处理的会话退回排队
    await this.prisma.csSession.updateMany({
      where: { agentId: adminId, status: 'AGENT_HANDLING' },
      data: { status: 'QUEUING', agentId: null, agentJoinedAt: null },
    });

    // 2. 标记离线，重置会话计数
    await this.prisma.csAgentStatus.updateMany({
      where: { adminId },
      data: { status: 'OFFLINE', currentSessions: 0, lastActiveAt: new Date() },
    });
  }

  /** 获取坐席正在处理的会话 ID 列表（重连时加入房间用） */
  async getActiveSessionIds(adminId: string): Promise<string[]> {
    const sessions = await this.prisma.csSession.findMany({
      where: { agentId: adminId, status: 'AGENT_HANDLING' },
      select: { id: true },
    });
    return sessions.map((s) => s.id);
  }

  /** 获取排队会话数 */
  async getQueueCount(): Promise<number> {
    return this.prisma.csSession.count({ where: { status: 'QUEUING' } });
  }

  /** 获取所有坐席状态 */
  async getAllAgentStatus() {
    return this.prisma.csAgentStatus.findMany({ orderBy: { lastActiveAt: 'desc' } });
  }
}
