import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isBuyerNo, normalizeBuyerNo } from '../../common/utils/buyer-no.util';
import { CsMaskingService } from './cs-masking.service';
import { CreateCsOutreachDto } from './dto/cs-outreach.dto';

@Injectable()
export class CsOutreachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly maskingService: CsMaskingService,
  ) {}

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

        const message = await tx.csMessage.create({
          data: {
            sessionId: session.id,
            senderType: 'AGENT',
            senderId: adminId,
            contentType: 'TEXT',
            content: maskedMessage,
            metadata: { source: 'ADMIN_OUTREACH' },
            routeLayer: 3,
          },
        });

        const inboxMessage = await tx.inboxMessage.create({
          data: {
            userId: user.id,
            category: 'system',
            type: 'cs_outreach_invite',
            title: dto.inviteTitle?.trim() || '平台客服邀请沟通',
            content: '平台客服已发起一对一沟通，点击进入客服对话。',
            target: { route: '/cs', params: { sessionId: session.id } },
          },
        });

        return {
          sessionId: session.id,
          inboxMessageId: inboxMessage.id,
          messageId: message.id,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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
