import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CsService } from './cs.service';
import { CsAgentService } from './cs-agent.service';
import { CsSendPayload, CsTypingPayload } from './types/cs.types';

interface AuthenticatedSocket extends Socket {
  data: {
    userId?: string;
    adminId?: string;
    isAgent: boolean;
  };
}

@WebSocketGateway({
  namespace: '/cs',
  cors: { origin: '*' },
})
export class CsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CsGateway.name);

  /** 坐席断线定时器：30秒内未重连则标记离线 */
  private agentDisconnectTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private csService: CsService,
    private agentService: CsAgentService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        client.disconnect();
        return;
      }

      // 尝试验证买家 JWT
      try {
        const payload = this.jwtService.verify(token, {
          secret: this.configService.get('JWT_SECRET'),
        });
        client.data = { userId: payload.sub, isAgent: false };
        client.join(`user:${payload.sub}`);
        this.logger.log(`买家已连接: ${payload.sub}`);
        return;
      } catch { /* not a buyer token */ }

      // 尝试验证管理员 JWT
      try {
        const payload = this.jwtService.verify(token, {
          secret: this.configService.get('ADMIN_JWT_SECRET'),
        });
        client.data = { adminId: payload.sub, isAgent: true };
        client.join(`agent:${payload.sub}`);
        client.join('agent:lobby');
        this.logger.log(`坐席已连接: ${payload.sub}`);

        // 清除断线定时器
        const timer = this.agentDisconnectTimers.get(payload.sub);
        if (timer) {
          clearTimeout(timer);
          this.agentDisconnectTimers.delete(payload.sub);
        }

        await this.agentService.updateStatus(payload.sub, 'ONLINE');
        return;
      } catch { /* not an admin token */ }

      client.disconnect();
    } catch (e) {
      this.logger.warn('连接认证失败', e);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (client.data?.isAgent && client.data.adminId) {
      const adminId = client.data.adminId;
      this.logger.log(`坐席断线: ${adminId}，30秒后标记离线`);

      const timer = setTimeout(async () => {
        await this.agentService.handleDisconnect(adminId);
        this.agentDisconnectTimers.delete(adminId);
        this.logger.log(`坐席已标记离线: ${adminId}`);
      }, 30_000);

      this.agentDisconnectTimers.set(adminId, timer);
    }
  }

  /** 用户/坐席发送消息 */
  @SubscribeMessage('cs:send')
  async handleSend(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: CsSendPayload) {
    const { sessionId, content, contentType } = data;

    if (client.data.isAgent && client.data.adminId) {
      const msg = await this.csService.handleAgentMessage(sessionId, client.data.adminId, content, contentType as any);
      this.server.to(`session:${sessionId}`).emit('cs:message', msg);
    } else if (client.data.userId) {
      client.join(`session:${sessionId}`);
      const result = await this.csService.handleUserMessage(sessionId, client.data.userId, content, contentType as any);

      this.server.to(`session:${sessionId}`).emit('cs:message', result.userMessage);

      if (result.aiReply) {
        this.server.to(`session:${sessionId}`).emit('cs:message', result.aiReply);
      }

      if (result.transferred) {
        const session = await this.csService.getAdminSessionDetail(sessionId);
        if (session.agentId) {
          this.server.to(`agent:${session.agentId}`).socketsJoin(`session:${sessionId}`);
          this.server.to(`session:${sessionId}`).emit('cs:agent_joined', {
            sessionId,
            agentName: '客服',
          });
        }
      } else if (result.routeResult?.shouldTransferToAgent) {
        this.server.to('agent:lobby').emit('cs:new_ticket', {
          sessionId,
          userId: client.data.userId,
          category: 'OTHER',
          waitingSince: new Date().toISOString(),
        });
        this.server.to(`session:${sessionId}`).emit('cs:message', {
          senderType: 'SYSTEM',
          content: '正在为您转接人工客服，请稍候...',
          contentType: 'TEXT',
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  /** 坐席领取会话 */
  @SubscribeMessage('cs:accept_ticket')
  async handleAcceptTicket(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { sessionId: string }) {
    if (!client.data.isAgent || !client.data.adminId) return;

    await this.csService.agentAcceptSession(data.sessionId, client.data.adminId);
    client.join(`session:${data.sessionId}`);

    this.server.to(`session:${data.sessionId}`).emit('cs:agent_joined', {
      sessionId: data.sessionId,
      agentName: '客服',
    });

    const queueCount = await this.agentService.getQueueCount();
    this.server.to('agent:lobby').emit('cs:queue_update', { queueCount });
  }

  /** 关闭会话 */
  @SubscribeMessage('cs:close_session')
  async handleCloseSession(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { sessionId: string }) {
    if (!client.data.isAgent) return;

    await this.csService.closeSession(data.sessionId);
    this.server.to(`session:${data.sessionId}`).emit('cs:session_closed', { sessionId: data.sessionId });
  }

  /** 正在输入 */
  @SubscribeMessage('cs:typing')
  handleTyping(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: CsTypingPayload) {
    const senderType = client.data.isAgent ? 'AGENT' : 'USER';
    client.to(`session:${data.sessionId}`).emit('cs:typing', { sessionId: data.sessionId, senderType });
  }

  /** 坐席更新在线状态 */
  @SubscribeMessage('cs:agent_status')
  async handleAgentStatus(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { status: string }) {
    if (!client.data.isAgent || !client.data.adminId) return;
    await this.agentService.updateStatus(client.data.adminId, data.status as any);
  }
}
