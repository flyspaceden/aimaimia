import { Injectable } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import * as svgCaptcha from 'svg-captcha';
import { RedisCoordinatorService } from '../../common/infra/redis-coordinator.service';

@Injectable()
export class CaptchaService {
  private static readonly TTL_MS = 300_000; // 5 分钟过期
  private static readonly KEY_PREFIX = 'captcha:';

  constructor(private redis: RedisCoordinatorService) {}

  async generate(): Promise<{ captchaId: string; svg: string }> {
    const captcha = svgCaptcha.create({
      size: 4,
      noise: 2,
      color: true,
      background: '#f0f0f0',
    });

    const captchaId = createId();
    const key = `${CaptchaService.KEY_PREFIX}${captchaId}`;
    await this.redis.set(key, captcha.text.toLowerCase(), CaptchaService.TTL_MS);

    return { captchaId, svg: captcha.data };
  }

  async verify(captchaId: string, input: string): Promise<boolean> {
    const key = `${CaptchaService.KEY_PREFIX}${captchaId}`;
    const stored = await this.redis.get(key);
    if (!stored) return false;
    await this.redis.del(key);
    return stored === input.toLowerCase();
  }
}
