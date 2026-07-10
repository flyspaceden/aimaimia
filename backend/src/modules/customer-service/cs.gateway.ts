import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
  Ack,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { CsService } from './cs.service';
import { CsAgentService } from './cs-agent.service';
import { CsSendPayload, CsTypingPayload } from './types/cs.types';
import { CsPresenceService } from './cs-presence.service';
import { CsSocketAuthService } from './cs-socket-auth.service';

interface AuthenticatedSocket extends Socket {
  data: {
    userId?: string;
    adminId?: string;
    isAgent: boolean;
    canRead?: boolean;
    canManage?: boolean;
  };
}

type CsSendAck = (result: { ok: true; message: any } | { ok: false; error: string }) => void;

@WebSocketGateway({
  namespace: '/cs',
  cors: {
    origin: (process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS)?.split(',') || [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:8081',
    ],
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
  private activeAgentSocketIds = new Map<string, Set<string>>();

  constructor(
    private csService: CsService,
    private agentService: CsAgentService,
    private socketAuthService: CsSocketAuthService,
    private presenceService: CsPresenceService,
  ) {}

  afterInit(server: Server) {
    // Socket.IO middleware completes before the client-side `connect` event,
    // so an immediate join/send can never race the database-backed auth check.
    server.use(async (socket, next) => {
      try {
        await this.authenticateClient(socket as AuthenticatedSocket);
        next();
      } catch (error: any) {
        next(new Error(error?.message || '登录凭证无效'));
      }
    });
  }

  private async authenticateClient(client: AuthenticatedSocket) {
    const token = client.handshake.auth?.token;
    if (!token) throw new Error('缺少登录凭证');

    const identity = await this.socketAuthService.authenticate(token);
    client.data = 'userId' in identity
      ? { userId: identity.userId, isAgent: false }
      : {
          adminId: identity.adminId,
          isAgent: true,
          canRead: identity.canRead,
          canManage: identity.canManage,
        };
  }

  private async refreshClientIdentity(client: AuthenticatedSocket) {
    const previous = { ...client.data };
    try {
      await this.authenticateClient(client);
    } catch (error) {
      client.disconnect(true);
      throw error;
    }

    const identityChanged = previous.isAgent !== client.data.isAgent
      || (previous.userId && previous.userId !== client.data.userId)
      || (previous.adminId && previous.adminId !== client.data.adminId);
    if (identityChanged) {
      client.disconnect(true);
      throw new Error('客服连接身份不一致');
    }

    if (previous.isAgent && previous.canManage && !client.data.canManage && previous.adminId) {
      this.activeAgentSocketIds.delete(previous.adminId);
      await this.agentService.handleDisconnect(previous.adminId);
      const queueCount = await this.agentService.getQueueCount();
      this.server?.to('agent:lobby').emit('cs:queue_update', { queueCount });
    }
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      // Unit tests and non-Socket.IO adapters may call this hook directly.
      if (!client.data?.userId && !client.data?.adminId) {
        await this.authenticateClient(client);
      }

      if (!client.data.isAgent && client.data.userId) {
        client.join(`user:${client.data.userId}`);
        client.emit('cs:ready');
        this.logger.log(`买家已连接: ${client.data.userId}`);
        return;
      }

      const adminId = client.data.adminId!;
      client.join(`agent:${adminId}`);
      client.join('agent:lobby');
      this.logger.log(`客服管理员已连接: ${adminId}`);

      if (!client.data.canManage) {
        // 清理可能由历史权限留下的在线状态，但保留只读实时列表。
        await this.agentService.handleDisconnect(adminId);
        client.emit('cs:ready');
        return;
      }

      const activeSocketIds = this.activeAgentSocketIds.get(adminId) ?? new Set<string>();
      activeSocketIds.add(client.id);
      this.activeAgentSocketIds.set(adminId, activeSocketIds);

      // 清除断线定时器（重连场景）
      const existingTimer = this.agentDisconnectTimers.get(adminId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.agentDisconnectTimers.delete(adminId);
      }

      await this.agentService.updateStatus(adminId, 'ONLINE');

      // 重连时重新加入正在处理的会话房间
      const activeSessionIds = await this.agentService.getActiveSessionIds(adminId);
      for (const sid of activeSessionIds) {
        client.join(`session:${sid}`);
      }
      if (activeSessionIds.length > 0) {
        this.logger.log(`坐席 ${adminId} 重连，恢复 ${activeSessionIds.length} 个会话房间`);
      }
      client.emit('cs:ready');
    } catch (e) {
      this.logger.warn('连接认证失败', e);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    this.presenceService.markSocketDisconnected(client.id);

    if (client.data?.isAgent && client.data.adminId && client.data.canManage) {
      const adminId = client.data.adminId;
      const activeSocketIds = this.activeAgentSocketIds.get(adminId);
      activeSocketIds?.delete(client.id);
      if (activeSocketIds && activeSocketIds.size > 0) {
        this.logger.log(`坐席 ${adminId} 仍有 ${activeSocketIds.size} 个连接在线`);
        return;
      }
      this.activeAgentSocketIds.delete(adminId);
      this.logger.log(`坐席断线: ${adminId}，30秒后标记离线`);

      const existingTimer = this.agentDisconnectTimers.get(adminId);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(async () => {
        if ((this.activeAgentSocketIds.get(adminId)?.size ?? 0) > 0) return;
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

  /** 买家打开指定会话后加入房间，用于接收坐席主动回复 */
  @SubscribeMessage('cs:join_session')
  async handleJoinSession(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { sessionId: string }) {
    try {
      await this.refreshClientIdentity(client);
      const sessionId = data?.sessionId;
      if (!sessionId) {
        client.emit('cs:error', { message: '会话参数缺失' });
        return;
      }

      if (client.data.isAgent) {
        const session = await this.csService.getAdminSessionDetail(sessionId);
        if (session.agentId !== client.data.adminId) {
          client.emit('cs:error', { message: '无权加入此会话' });
          return;
        }
        client.join(`session:${sessionId}`);
        client.emit('cs:joined', { sessionId });
        return;
      }

      if (!client.data.userId) {
        client.emit('cs:error', { message: '未登录' });
        return;
      }

      await this.csService.getSessionMessages(sessionId, client.data.userId);
      client.join(`session:${sessionId}`);
      this.presenceService.markUserInSession(sessionId, client.data.userId, client.id);
      client.emit('cs:joined', { sessionId });
    } catch (error: any) {
      this.logger.error('加入客服会话失败', error?.message);
      client.emit('cs:error', { message: error?.message || '加入会话失败' });
    }
  }

  /** 用户/坐席发送消息 */
  @SubscribeMessage('cs:send')
  async handleSend(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: CsSendPayload,
    @Ack() ack?: CsSendAck,
  ) {
    try {
      await this.refreshClientIdentity(client);
      const { sessionId, content, contentType } = data;

      // 内容长度校验
      if (!content || content.length > 5000) {
        client.emit('cs:error', { message: '消息内容无效或超长' });
        ack?.({ ok: false, error: '消息内容无效或超长' });
        return;
      }

      if (client.data.isAgent && client.data.adminId) {
        if (!client.data.canManage) {
          client.emit('cs:error', { message: '暂无客服会话操作权限' });
          ack?.({ ok: false, error: '暂无客服会话操作权限' });
          return;
        }
        // 坐席发消息：广播给房间内其他人（排除发送者自己，前端已本地添加）
        const msg = await this.csService.handleAgentMessage(sessionId, client.data.adminId, content, contentType as any);
        client.to(`session:${sessionId}`).emit('cs:message', msg);
        ack?.({ ok: true, message: msg });
      } else if (client.data.userId) {
        // 通过 handleUserMessage 的内部校验确认归属
        const result = await this.csService.handleUserMessage(sessionId, client.data.userId, content, contentType as any);

        // 校验通过后才加入房间
        client.join(`session:${sessionId}`);
        this.presenceService.markUserInSession(sessionId, client.data.userId, client.id);

        this.server.to(`session:${sessionId}`).emit('cs:message', result.userMessage);
        ack?.({ ok: true, message: result.userMessage });

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
        }
      }
    } catch (error: any) {
      this.logger.error('消息处理失败', error?.message);
      const errorMessage = error?.message || '消息发送失败';
      client.emit('cs:error', { message: errorMessage });
      ack?.({ ok: false, error: errorMessage });
    }
  }

  isUserInSession(sessionId: string, userId: string): boolean {
    return this.presenceService.isUserInSession(sessionId, userId);
  }

  emitMessageToSession(sessionId: string, message: unknown) {
    this.server?.to(`session:${sessionId}`).emit('cs:message', message);
  }

  private async requireManagePermission(client: AuthenticatedSocket): Promise<boolean> {
    await this.refreshClientIdentity(client);
    if (client.data.isAgent && client.data.adminId && client.data.canManage) return true;
    client.emit('cs:error', { message: '暂无客服会话操作权限' });
    return false;
  }

  /** 坐席领取会话 */
  @SubscribeMessage('cs:accept_ticket')
  async handleAcceptTicket(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { sessionId: string }) {
    try {
      if (!(await this.requireManagePermission(client))) return;
      const adminId = client.data.adminId!;

      await this.csService.agentAcceptSession(data.sessionId, adminId);
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
      if (!(await this.requireManagePermission(client))) return;
      const adminId = client.data.adminId!;

      const result = await this.csService.agentReleaseSession(data.sessionId, adminId);

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
      if (!(await this.requireManagePermission(client))) return;

      await this.csService.closeSession(data.sessionId, client.data.adminId);
      this.server.to(`session:${data.sessionId}`).emit('cs:session_closed', { sessionId: data.sessionId });
    } catch (error: any) {
      this.logger.error('关闭会话失败', error?.message);
      client.emit('cs:error', { message: error?.message || '关闭失败' });
    }
  }

  /** 正在输入 */
  @SubscribeMessage('cs:typing')
  handleTyping(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: CsTypingPayload) {
    if (!client.rooms.has(`session:${data.sessionId}`)) return;
    const senderType = client.data.isAgent ? 'AGENT' : 'USER';
    client.to(`session:${data.sessionId}`).emit('cs:typing', { sessionId: data.sessionId, senderType });
  }

  /** 坐席更新在线状态 */
  @SubscribeMessage('cs:agent_status')
  async handleAgentStatus(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { status: string }) {
    try {
      if (!(await this.requireManagePermission(client))) return;
      await this.agentService.updateStatus(client.data.adminId!, data.status as any);
    } catch (error: any) {
      this.logger.error('更新坐席状态失败', error?.message);
    }
  }
}
