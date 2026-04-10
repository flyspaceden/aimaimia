import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
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
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8081'],
    credentials: true,
  },
})
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class CsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CsGateway.name);

  /** 坐席断线定时器：30秒内未重连则标记离线 */
  private agentDisconnectTimers = new Map<string, NodeJS.Timeout>();

  /** Redis pub/sub clients for Socket.IO adapter */
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  constructor(
    private csService: CsService,
    private agentService: CsAgentService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * S1 修复：Server 初始化时附加 Redis Adapter，支持多实例水平扩展
   * - 没有 REDIS_URL 时降级为单实例模式（开发环境）
   */
  afterInit(server: Server) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL 未配置，Socket.IO 运行在单实例模式（生产环境必须配置）');
      return;
    }

    try {
      this.pubClient = new Redis(redisUrl, { lazyConnect: false });
      this.subClient = this.pubClient.duplicate();

      this.pubClient.on('error', (err) => {
        this.logger.error(`Redis pub client 错误: ${err.message}`);
      });
      this.subClient.on('error', (err) => {
        this.logger.error(`Redis sub client 错误: ${err.message}`);
      });

      // 注意：socket.io-redis-adapter 需要 ioredis 实例（不是 node-redis）
      server.adapter(createAdapter(this.pubClient as any, this.subClient as any));
      this.logger.log('Socket.IO Redis Adapter 已启用，支持多实例水平扩展');
    } catch (e: any) {
      this.logger.error(`Redis Adapter 初始化失败，降级为单实例模式: ${e.message}`);
    }
  }

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

        // 清除断线定时器（重连场景）
        const existingTimer = this.agentDisconnectTimers.get(payload.sub);
        if (existingTimer) {
          clearTimeout(existingTimer);
          this.agentDisconnectTimers.delete(payload.sub);
        }

        await this.agentService.updateStatus(payload.sub, 'ONLINE');

        // 重连时重新加入正在处理的会话房间
        const activeSessionIds = await this.agentService.getActiveSessionIds(payload.sub);
        for (const sid of activeSessionIds) {
          client.join(`session:${sid}`);
        }
        if (activeSessionIds.length > 0) {
          this.logger.log(`坐席 ${payload.sub} 重连，恢复 ${activeSessionIds.length} 个会话房间`);
        }

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
        try {
          await this.agentService.handleDisconnect(adminId);
          // 通知其他坐席排队数更新（会话已退回排队）
          const queueCount = await this.agentService.getQueueCount();
          this.server?.to('agent:lobby').emit('cs:queue_update', { queueCount });
        } catch (e) {
          this.logger.error(`坐席离线处理失败: ${adminId}`, e);
        }
        this.agentDisconnectTimers.delete(adminId);
      }, 30_000);

      this.agentDisconnectTimers.set(adminId, timer);
    }
  }

  /** 用户/坐席发送消息 */
  @SubscribeMessage('cs:send')
  async handleSend(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: CsSendPayload) {
    try {
      const { sessionId, content, contentType } = data;

      // 内容长度校验
      if (!content || content.length > 5000) {
        client.emit('cs:error', { message: '消息内容无效或超长' });
        return;
      }

      if (client.data.isAgent && client.data.adminId) {
        // 坐席发消息：广播给房间内其他人（排除发送者自己，前端已本地添加）
        const msg = await this.csService.handleAgentMessage(sessionId, client.data.adminId, content, contentType as any);
        client.to(`session:${sessionId}`).emit('cs:message', msg);
      } else if (client.data.userId) {
        // 先验证归属再加入房间
        const session = await this.csService.getActiveSession(client.data.userId, '', undefined);
        // 通过 handleUserMessage 的内部校验确认归属
        const result = await this.csService.handleUserMessage(sessionId, client.data.userId, content, contentType as any);

        // 校验通过后才加入房间
        client.join(`session:${sessionId}`);

        this.server.to(`session:${sessionId}`).emit('cs:message', result.userMessage);

        if (result.aiReply) {
          this.server.to(`session:${sessionId}`).emit('cs:message', result.aiReply);
        }

        if (result.transferred) {
          const sessionDetail = await this.csService.getAdminSessionDetail(sessionId);
          if (sessionDetail.agentId) {
            this.server.to(`agent:${sessionDetail.agentId}`).socketsJoin(`session:${sessionId}`);
            this.server.to(`session:${sessionId}`).emit('cs:agent_joined', {
              sessionId,
              agentName: '客服',
            });
          }
        } else if (result.routeResult?.shouldTransferToAgent) {
          // 获取用户详情用于通知
          let userNickname = '用户';
          try {
            const detail = await this.csService.getAdminSessionDetail(sessionId);
            userNickname = (detail.user as any)?.profile?.nickname || '用户';
          } catch { /* non-critical */ }

          this.server.to('agent:lobby').emit('cs:new_ticket', {
            sessionId,
            userId: client.data.userId,
            userNickname,
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
    } catch (error: any) {
      this.logger.error('消息处理失败', error?.message);
      client.emit('cs:error', { message: error?.message || '消息发送失败' });
    }
  }

  /** 坐席领取会话 */
  @SubscribeMessage('cs:accept_ticket')
  async handleAcceptTicket(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { sessionId: string }) {
    try {
      if (!client.data.isAgent || !client.data.adminId) return;

      await this.csService.agentAcceptSession(data.sessionId, client.data.adminId);
      client.join(`session:${data.sessionId}`);

      this.server.to(`session:${data.sessionId}`).emit('cs:agent_joined', {
        sessionId: data.sessionId,
        agentName: '客服',
      });

      const queueCount = await this.agentService.getQueueCount();
      this.server.to('agent:lobby').emit('cs:queue_update', { queueCount });
    } catch (error: any) {
      this.logger.error('领取会话失败', error?.message);
      client.emit('cs:error', { message: error?.message || '领取失败' });
    }
  }

  /** 坐席完成处理（柔性脱身，会话保留） */
  @SubscribeMessage('cs:release_session')
  async handleReleaseSession(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { sessionId: string }) {
    try {
      if (!client.data.isAgent || !client.data.adminId) return;

      const result = await this.csService.agentReleaseSession(data.sessionId, client.data.adminId);

      // 通知会话房间内所有人（坐席端清除选中、用户端显示系统消息）
      this.server.to(`session:${data.sessionId}`).emit('cs:agent_released', {
        sessionId: data.sessionId,
        systemMessage: result.systemMessage,
      });

      // 坐席自己离开 session 房间
      client.leave(`session:${data.sessionId}`);
    } catch (error: any) {
      this.logger.error('释放会话失败', error?.message);
      client.emit('cs:error', { message: error?.message || '释放失败' });
    }
  }

  /** 强制关闭会话（高权限，特殊情况使用） */
  @SubscribeMessage('cs:close_session')
  async handleCloseSession(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { sessionId: string }) {
    try {
      if (!client.data.isAgent) return;

      await this.csService.closeSession(data.sessionId);
      this.server.to(`session:${data.sessionId}`).emit('cs:session_closed', { sessionId: data.sessionId });
    } catch (error: any) {
      this.logger.error('关闭会话失败', error?.message);
      client.emit('cs:error', { message: error?.message || '关闭失败' });
    }
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
    try {
      if (!client.data.isAgent || !client.data.adminId) return;
      await this.agentService.updateStatus(client.data.adminId, data.status as any);
    } catch (error: any) {
      this.logger.error('更新坐席状态失败', error?.message);
    }
  }
}
