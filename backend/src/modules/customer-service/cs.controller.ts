import { Controller, Post, Get, Param, Body, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CsService } from './cs.service';
import { CsGateway } from './cs.gateway';
import { CreateCsSessionDto } from './dto/cs-create-session.dto';
import { SendCsMessageDto } from './dto/cs-send-message.dto';
import { SubmitCsRatingDto } from './dto/cs-submit-rating.dto';

@Controller('cs')
export class CsController {
  constructor(
    private csService: CsService,
    private csGateway: CsGateway,
  ) {}

  @Post('sessions')
  async createSession(@CurrentUser('sub') userId: string, @Body() dto: CreateCsSessionDto) {
    const result = await this.csService.createSession(userId, dto.source, dto.sourceId);

    // 如果旧会话被自动关闭（返回的是新会话），通知管理后台刷新
    if (!result.isExisting && this.csGateway.server) {
      this.csGateway.server.to('agent:lobby').emit('cs:queue_update', {});
    }

    return result;
  }

  @Get('sessions/active')
  getActiveSession(
    @CurrentUser('sub') userId: string,
    @Query('source') source: string,
    @Query('sourceId') sourceId?: string,
  ) {
    return this.csService.getActiveSession(userId, source, sourceId);
  }

  @Get('sessions/:id/messages')
  getMessages(@CurrentUser('sub') userId: string, @Param('id') sessionId: string) {
    return this.csService.getSessionMessages(sessionId, userId);
  }

  /** 买家通过 HTTP 发送消息（同时广播到 Socket.IO 供坐席接收） */
  @Post('sessions/:id/messages')
  async sendMessage(
    @CurrentUser('sub') userId: string,
    @Param('id') sessionId: string,
    @Body() dto: SendCsMessageDto,
  ) {
    const result = await this.csService.handleUserMessage(sessionId, userId, dto.content, dto.contentType);

    // HTTP→Socket.IO 桥接：将消息广播到会话房间，坐席实时收到
    const server = this.csGateway.server;
    if (server) {
      server.to(`session:${sessionId}`).emit('cs:message', result.userMessage);
      if (result.aiReply) {
        server.to(`session:${sessionId}`).emit('cs:message', result.aiReply);
      }
      if (result.transferred) {
        const session = await this.csService.getAdminSessionDetail(sessionId);
        if (session.agentId) {
          server.to(`agent:${session.agentId}`).socketsJoin(`session:${sessionId}`);
          server.to(`session:${sessionId}`).emit('cs:agent_joined', { sessionId, agentName: '客服' });
        }
      } else if (result.routeResult?.shouldTransferToAgent) {
        server.to('agent:lobby').emit('cs:new_ticket', {
          sessionId,
          userId,
          category: 'OTHER',
          waitingSince: new Date().toISOString(),
        });
        server.to(`session:${sessionId}`).emit('cs:message', {
          senderType: 'SYSTEM',
          content: '正在为您转接人工客服，请稍候...',
          contentType: 'TEXT',
          createdAt: new Date().toISOString(),
        });
      }
    }

    return { userMessage: result.userMessage, aiReply: result.aiReply, transferred: result.transferred };
  }

  /** 买家主动关闭会话 */
  @Post('sessions/:id/close')
  async closeSession(
    @CurrentUser('sub') userId: string,
    @Param('id') sessionId: string,
  ) {
    // 先验证归属
    const session = await this.csService.getSessionMessages(sessionId, userId);
    await this.csService.closeSession(sessionId);

    // 通知坐席
    const server = this.csGateway.server;
    if (server) {
      server.to(`session:${sessionId}`).emit('cs:session_closed', { sessionId });
    }

    return { ok: true };
  }

  @Post('sessions/:id/rating')
  submitRating(
    @CurrentUser('sub') userId: string,
    @Param('id') sessionId: string,
    @Body() dto: SubmitCsRatingDto,
  ) {
    return this.csService.submitRating(sessionId, userId, dto.score, dto.tags ?? [], dto.comment);
  }

  @Get('quick-entries')
  getQuickEntries() {
    return this.csService.getQuickEntries();
  }
}
