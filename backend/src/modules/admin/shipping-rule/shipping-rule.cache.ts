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
    return raw ? (JSON.parse(raw) as ShippingRule[]) : null;
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
    return raw ? (JSON.parse(raw) as ShippingConfig) : null;
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
}
