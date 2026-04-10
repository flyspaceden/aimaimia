import { INestApplication, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions, Server as IoServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

/**
 * Redis IoAdapter for Socket.IO
 *
 * S1 修复：支持多实例水平扩展
 * - 配置了 REDIS_URL 时启用 Redis pub/sub adapter，跨实例同步房间事件
 * - 未配置 REDIS_URL 时静默降级为单实例 in-memory adapter（开发环境）
 * - 启用前会预连接验证 Redis 可用，避免运行时报错
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  constructor(app: INestApplication) {
    super(app);
  }

  /**
   * 在 Nest 启动时调用一次，预连接 Redis
   * 失败则降级为单实例（不抛错）
   */
  async connectToRedis(redisUrl: string | undefined): Promise<void> {
    if (!redisUrl) {
      this.logger.warn('REDIS_URL 未配置，Socket.IO 运行在单实例模式（生产环境多实例部署必须配置）');
      return;
    }

    try {
      this.pubClient = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
      });
      // 显式 connect 验证可用
      await this.pubClient.connect();

      this.subClient = this.pubClient.duplicate();
      await this.subClient.connect();

      this.adapterConstructor = createAdapter(this.pubClient as any, this.subClient as any);
      this.logger.log('Socket.IO Redis Adapter 已启用，支持多实例水平扩展');
    } catch (e: any) {
      this.logger.warn(`Redis 不可用，Socket.IO 降级为单实例模式: ${e?.message || e}`);
      // 清理失败的客户端
      try { await this.pubClient?.quit(); } catch { /* ignore */ }
      try { await this.subClient?.quit(); } catch { /* ignore */ }
      this.pubClient = null;
      this.subClient = null;
      this.adapterConstructor = null;
    }
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server: IoServer = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
