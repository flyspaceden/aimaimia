import { Injectable, Logger } from '@nestjs/common';
import { CsAgentOnlineStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CsAgentService {
  private readonly logger = new Logger(CsAgentService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 分配坐席：从 ONLINE 且未满的坐席中选 currentSessions 最少的
   * 返回 adminId，无可用坐席返回 null
   */
  async assignAgent(): Promise<string | null> {
    // 使用原始查询确保 currentSessions < maxSessions 条件
    const result = await this.prisma.$queryRaw<{ adminId: string }[]>`
      SELECT "adminId" FROM "CsAgentStatus"
      WHERE status = 'ONLINE' AND "currentSessions" < "maxSessions"
      ORDER BY "currentSessions" ASC
      LIMIT 1
    `;

    if (result.length === 0) return null;

    const adminId = result[0].adminId;

    // 原子递增 currentSessions
    await this.prisma.csAgentStatus.update({
      where: { adminId },
      data: { currentSessions: { increment: 1 }, lastActiveAt: new Date() },
    });

    return adminId;
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

  /** 坐席断线：标记离线 */
  async handleDisconnect(adminId: string) {
    await this.prisma.csAgentStatus.updateMany({
      where: { adminId },
      data: { status: 'OFFLINE', lastActiveAt: new Date() },
    });
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
