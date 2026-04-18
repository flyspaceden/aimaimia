import { Injectable, Logger } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import * as svgCaptcha from 'svg-captcha';
import { RedisCoordinatorService } from '../../common/infra/redis-coordinator.service';

@Injectable()
export class CaptchaService {
  private static readonly TTL_MS = 300_000; // 5 分钟过期
  private static readonly KEY_PREFIX = 'captcha:';
  private readonly logger = new Logger(CaptchaService.name);

  // Redis 不可用时的内存回退（开发环境）
  private readonly memoryStore = new Map<string, { text: string; expiresAt: number }>();

  constructor(private redis: RedisCoordinatorService) {}

  async generate(): Promise<{ captchaId: string; svg: string }> {
    const captcha = svgCaptcha.create({
      size: 4,
      noise: 1, // 降低干扰线（原 2 太乱）
      color: true,
      background: '#f0f0f0',
      ignoreChars: '0o1ilI', // 去掉易混淆的字符
      width: 120,
      height: 40,
      fontSize: 50,
    });

    const captchaId = createId();
    const key = `${CaptchaService.KEY_PREFIX}${captchaId}`;
    const text = captcha.text.toLowerCase();

    const stored = await this.redis.set(key, text, CaptchaService.TTL_MS);
    if (!stored) {
      // Redis 不可用，回退到内存存储
      this.memoryStore.set(captchaId, {
        text,
        expiresAt: Date.now() + CaptchaService.TTL_MS,
      });
      this.logger.warn(`Redis 不可用，验证码 ${captchaId} 存储在内存中`);
    }

    return { captchaId, svg: captcha.data };
  }

  async verify(captchaId: string, input: string): Promise<boolean> {
    const key = `${CaptchaService.KEY_PREFIX}${captchaId}`;

    // 先尝试 Redis（原子性读取并删除，防止并发重放）
    const stored = await this.redis.getdel(key);
    if (stored) {
      return stored === input.toLowerCase();
    }

    // 回退到内存
    const entry = this.memoryStore.get(captchaId);
    if (!entry) return false;
    this.memoryStore.delete(captchaId);
    if (Date.now() > entry.expiresAt) return false;
    return entry.text === input.toLowerCase();
  }
}
