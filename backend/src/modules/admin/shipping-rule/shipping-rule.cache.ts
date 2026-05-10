import { Injectable } from '@nestjs/common';
import { ShippingRule } from '@prisma/client';
import { RedisCoordinatorService } from '../../../common/infra/redis-coordinator.service';

export type ShippingConfig = {
  defaultShippingFee?: number;
  freeShippingThreshold?: number;
};

@Injectable()
export class ShippingRuleCache {
  private static readonly RULES_KEY = 'shipping-rules:active';
  private static readonly CONFIG_KEY = 'shipping-config';
  private static readonly TTL_MS = 60_000;

  constructor(private readonly redis: RedisCoordinatorService) {}

  async getActiveRules(): Promise<ShippingRule[] | null> {
    const raw = await this.redis.get(ShippingRuleCache.RULES_KEY);
    if (!raw) {
      return null;
    }

    const parsed = this.parseJson(raw);
    if (!Array.isArray(parsed)) {
      await this.redis.del(ShippingRuleCache.RULES_KEY);
      return null;
    }

    return parsed as ShippingRule[];
  }

  async setActiveRules(rules: ShippingRule[]): Promise<void> {
    await this.redis.set(
      ShippingRuleCache.RULES_KEY,
      JSON.stringify(rules),
      ShippingRuleCache.TTL_MS,
    );
  }

  async getConfig(): Promise<ShippingConfig | null> {
    const raw = await this.redis.get(ShippingRuleCache.CONFIG_KEY);
    if (!raw) {
      return null;
    }

    const parsed = this.parseJson(raw);
    if (!this.isObject(parsed)) {
      await this.redis.del(ShippingRuleCache.CONFIG_KEY);
      return null;
    }

    return parsed as ShippingConfig;
  }

  async setConfig(cfg: ShippingConfig): Promise<void> {
    await this.redis.set(
      ShippingRuleCache.CONFIG_KEY,
      JSON.stringify(cfg),
      ShippingRuleCache.TTL_MS,
    );
  }

  async invalidate(): Promise<void> {
    await this.redis.del(
      ShippingRuleCache.RULES_KEY,
      ShippingRuleCache.CONFIG_KEY,
    );
  }

  private parseJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
