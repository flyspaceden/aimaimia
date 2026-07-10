import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationAudience,
  NotificationRecipientKind,
  NotificationSeverity,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { maskPhone } from '../../common/security/privacy-mask';
import { isBuyerNo, normalizeBuyerNo } from '../../common/utils/buyer-no.util';
import { CsMaskingService } from './cs-masking.service';
import { CreateCsOutreachDto } from './dto/cs-outreach.dto';

@Injectable()
export class CsOutreachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly maskingService: CsMaskingService,
  ) {}

  async searchBuyers(keyword?: string) {
    const text = keyword?.trim();
    const where: any = {
      status: 'ACTIVE',
      buyerNo: { not: null },
    };

    if (text) {
      const normalizedBuyerNo = normalizeBuyerNo(text);
      where.OR = [
        { buyerNo: normalizedBuyerNo },
        { id: text },
        {
          profile: {
            nickname: { contains: text, mode: 'insensitive' },
          },
        },
        {
          authIdentities: {
            some: { provider: 'PHONE', identifier: { contains: text } },
          },
        },
      ];
    }

    const users = await (this.prisma as any).user.findMany({
      where,
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        buyerNo: true,
        status: true,
        profile: { select: { nickname: true, avatarUrl: true } },
        authIdentities: {
          where: { provider: 'PHONE' },
          select: { identifier: true },
          take: 1,
        },
        memberProfile: { select: { tier: true } },
      },
    });

    return users.map((user: any) => ({
      id: user.id,
      buyerNo: user.buyerNo,
      nickname: user.profile?.nickname ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
      phone: maskPhone(user.authIdentities?.[0]?.identifier ?? null),
      memberTier: user.memberProfile?.tier ?? 'NORMAL',
      status: user.status,
    }));
  }

  async create(adminId: string, dto: CreateCsOutreachDto) {
    const buyerNo = normalizeBuyerNo(dto.buyerNo);
    if (!isBuyerNo(buyerNo)) {
      throw new BadRequestException('请输入有效的买家编号');
    }
    const initialMessage = dto.initialMessage?.trim();
    if (!initialMessage) {
      throw new BadRequestException('请输入初始消息');
    }
    const maskedMessage = this.maskingService.mask(initialMessage);
    if (!maskedMessage) {
      throw new BadRequestException('请输入初始消息');
    }

    return (this.prisma as any).$transaction(
      async (tx: any) => {
        const user = await tx.user.findUnique({
          where: { buyerNo },
          select: { id: true, buyerNo: true, status: true },
        });
        if (!user || user.status !== 'ACTIVE') {
          throw new BadRequestException('买家不存在或当前不可联系');
        }

        const activeSession = await tx.csSession.findFirst({
          where: {
            userId: user.id,
            status: { in: ['AI_HANDLING', 'QUEUING', 'AGENT_HANDLING'] },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, agentId: true },
        });

        if (activeSession) {
          if (activeSession.status === 'AGENT_HANDLING') {
            if (activeSession.agentId === adminId) {
              const outreach = await this.createAgentMessageAndInvite(
                tx,
                user.id,
                activeSession.id,
                adminId,
                maskedMessage,
                dto.inviteTitle,
                { source: 'ADMIN_OUTREACH', reused: true },
              );
              return { sessionId: activeSession.id, ...outreach, reused: true };
            }
            throw new BadRequestException('该买家已有其他客服正在处理中');
          }

          await this.reserveAgentSlot(tx, adminId);
          const claimed = await tx.csSession.updateMany({
            where: {
              id: activeSession.id,
              status: activeSession.status,
              agentId: activeSession.agentId,
            },
            data: {
              status: 'AGENT_HANDLING',
              agentId: adminId,
              agentJoinedAt: new Date(),
            },
          });
          if (claimed.count !== 1) {
            throw new BadRequestException('会话状态已变化，请重试');
          }

          const outreach = await this.createAgentMessageAndInvite(
            tx,
            user.id,
            activeSession.id,
            adminId,
            maskedMessage,
            dto.inviteTitle,
            { source: 'ADMIN_OUTREACH', claimedFrom: activeSession.status },
          );

          return {
            sessionId: activeSession.id,
            ...outreach,
            claimed: true,
          };
        }

        await this.reserveAgentSlot(tx, adminId);

        const session = await tx.csSession.create({
          data: {
            userId: user.id,
            source: 'ADMIN_OUTREACH',
            status: 'AGENT_HANDLING',
            agentId: adminId,
            agentJoinedAt: new Date(),
          },
        });

        const outreach = await this.createAgentMessageAndInvite(
          tx,
          user.id,
          session.id,
          adminId,
          maskedMessage,
          dto.inviteTitle,
          { source: 'ADMIN_OUTREACH' },
        );

        return {
          sessionId: session.id,
          ...outreach,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async createAgentMessageAndInvite(
    tx: any,
    userId: string,
    sessionId: string,
    adminId: string,
    content: string,
    inviteTitle?: string,
    metadata: Record<string, unknown> = { source: 'ADMIN_OUTREACH' },
  ) {
    const message = await tx.csMessage.create({
      data: {
        sessionId,
        senderType: 'AGENT',
        senderId: adminId,
        contentType: 'TEXT',
        content,
        metadata,
        routeLayer: 3,
      },
    });

    const action = { route: '/cs', params: { sessionId } };
    const notificationMessage = await tx.notificationMessage.create({
      data: {
        recipientKind: NotificationRecipientKind.BUYER_USER,
        recipientKey: this.recipientKey(userId),
        audience: NotificationAudience.BUYER_APP,
        category: 'system',
        eventType: 'cs_outreach_invite',
        title: inviteTitle?.trim() || '平台客服邀请沟通',
        body: '平台客服已发起一对一沟通，点击进入客服对话。',
        severity: NotificationSeverity.INFO,
        entityType: 'csSession',
        entityId: sessionId,
        action,
        metadata: {
          ...metadata,
          csMessageId: message.id,
        },
        idempotencyKey: `cs-outreach:${sessionId}:${message.id}`,
      },
    });

    return {
      inboxMessageId: notificationMessage.id,
      messageId: message.id,
      message,
    };
  }

  private recipientKey(userId: string) {
    return `buyer:${userId}`;
  }

  private async reserveAgentSlot(tx: any, adminId: string) {
    const status = await tx.csAgentStatus.findUnique({ where: { adminId } });
    if (!status) {
      try {
        await tx.csAgentStatus.create({
          data: {
            adminId,
            status: 'ONLINE',
            currentSessions: 1,
            lastActiveAt: new Date(),
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new BadRequestException('当前坐席会话数已变化，请重试');
        }
        throw error;
      }
      return;
    }
    if (status.currentSessions >= status.maxSessions) {
      throw new BadRequestException('当前坐席会话数已达上限');
    }
    const reserveResult = await tx.csAgentStatus.updateMany({
      where: {
        adminId,
        currentSessions: status.currentSessions,
      },
      data: {
        currentSessions: { increment: 1 },
        lastActiveAt: new Date(),
        status: 'ONLINE',
      },
    });
    if (reserveResult.count !== 1) {
      throw new BadRequestException('当前坐席会话数已变化，请重试');
    }
  }
}
