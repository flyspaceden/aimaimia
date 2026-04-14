import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

type FixedWindowConsumeResult = {
  allowed: boolean;
  count: number;
  ttlSec: number;
};

@Injectable()
export class RedisCoordinatorService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCoordinatorService.name);
  private readonly client: Redis | null;
  private readonly prefix: string;
  private redisUnavailableLogged = false;

  constructor(private readonly config: ConfigService) {
    this.prefix = this.config.get<string>('REDIS_KEY_PREFIX', 'nongmai');
    const redisUrl = this.config.get<string>('REDIS_URL');

    if (!redisUrl) {
      this.client = null;
      return;
    }

    this.client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    });

    this.client.on('error', (err) => {
      if (!this.redisUnavailableLogged) {
        this.redisUnavailableLogged = true;
        this.logger.warn(`Redis 不可用，将回退本地/数据库限流与锁逻辑: ${err.message}`);
      }
    });
  }

  isEnabled(): boolean {
    return !!this.client;
  }

  async consumeFixedWindow(
    rawKey: string,
    limit: number,
    ttlSec: number,
  ): Promise<FixedWindowConsumeResult | null> {
    if (!this.client) return null;
    const key = this.key(rawKey);
    try {
      await this.ensureConnected();
      const result = await this.client.eval(
        `
          local c = redis.call('INCR', KEYS[1])
          if c == 1 then
            redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
          end
          local ttl = redis.call('TTL', KEYS[1])
          return { c, ttl }
        `,
        1,
        key,
        String(ttlSec),
      ) as [number, number];

      const count = Number(result?.[0] ?? 0);
      const ttl = Math.max(1, Number(result?.[1] ?? ttlSec));
      return {
        allowed: count <= limit,
        count,
        ttlSec: ttl,
      };
    } catch (err: any) {
      this.logRedisFallbackOnce(err);
      return null;
    }
  }

  async rollbackFixedWindow(rawKey: string, ttlSec: number): Promise<number | null> {
    if (!this.client) return null;
    const key = this.key(rawKey);
    try {
      await this.ensureConnected();
      const result = await this.client.eval(
        `
          local current = tonumber(redis.call('GET', KEYS[1]) or '0')
          if current <= 0 then
            return 0
          end

          current = redis.call('DECR', KEYS[1])
          if current <= 0 then
            redis.call('DEL', KEYS[1])
            return 0
          end

          local ttl = redis.call('TTL', KEYS[1])
          if ttl < 0 then
            redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
          end

          return current
        `,
        1,
        key,
        String(ttlSec),
      );
      return Number(result ?? 0);
    } catch (err: any) {
      this.logRedisFallbackOnce(err);
      return null;
    }
  }

  async acquireLock(rawKey: string, owner: string, ttlMs: number): Promise<boolean | null> {
    if (!this.client) return null;
    const key = this.key(rawKey);
    try {
      await this.ensureConnected();
      const result = await this.client.set(key, owner, 'PX', ttlMs, 'NX');
      return result === 'OK';
    } catch (err: any) {
      this.logRedisFallbackOnce(err);
      return null;
    }
  }

  async releaseLock(rawKey: string, owner: string): Promise<void> {
    if (!this.client) return;
    const key = this.key(rawKey);
    try {
      await this.ensureConnected();
      await this.client.eval(
        `
          if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
          end
          return 0
        `,
        1,
        key,
        owner,
      );
    } catch (err: any) {
      this.logRedisFallbackOnce(err);
    }
  }

  async getPttl(rawKey: string): Promise<number | null> {
    if (!this.client) return null;
    try {
      await this.ensureConnected();
      const ttl = await this.client.pttl(this.key(rawKey));
      return ttl;
    } catch (err: any) {
      this.logRedisFallbackOnce(err);
      return null;
    }
  }

  async set(rawKey: string, value: string, ttlMs?: number): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.ensureConnected();
      if (ttlMs && ttlMs > 0) {
        await this.client.set(this.key(rawKey), value, 'PX', ttlMs);
      } else {
        await this.client.set(this.key(rawKey), value);
      }
      return true;
    } catch (err: any) {
      this.logRedisFallbackOnce(err);
      return false;
    }
  }

  async get(rawKey: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      await this.ensureConnected();
      return await this.client.get(this.key(rawKey));
    } catch (err: any) {
      this.logRedisFallbackOnce(err);
      return null;
    }
  }

  /** 原子性 GET + DEL：读取并删除，防止并发重放 */
  async getdel(rawKey: string): Promise<string | null> {
    if (!this.client) return null;
    const key = this.key(rawKey);
    try {
      await this.ensureConnected();
      const result = await this.client.eval(
        `
          local v = redis.call('GET', KEYS[1])
          if v then
            redis.call('DEL', KEYS[1])
          end
          return v
        `,
        1,
        key,
      );
      return result as string | null;
    } catch (err: any) {
      this.logRedisFallbackOnce(err);
      return null;
    }
  }

  async del(...rawKeys: string[]): Promise<void> {
    if (!this.client || rawKeys.length === 0) return;
    try {
      await this.ensureConnected();
      await this.client.del(...rawKeys.map((k) => this.key(k)));
    } catch (err: any) {
      this.logRedisFallbackOnce(err);
    }
  }

  async onModuleDestroy() {
    if (!this.client) return;
    await this.client.quit().catch(() => this.client?.disconnect());
  }

  private key(rawKey: string): string {
    return `${this.prefix}:${rawKey}`;
  }

  private async ensureConnected() {
    if (!this.client) return;
    if (this.client.status === 'ready' || this.client.status === 'connect') return;
    await this.client.connect().catch(() => undefined);
  }

  private logRedisFallbackOnce(err: any) {
    if (this.redisUnavailableLogged) return;
    this.redisUnavailableLogged = true;
    this.logger.warn(`Redis 操作失败，回退本地/数据库逻辑: ${err?.message ?? 'unknown error'}`);
  }
}
