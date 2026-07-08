import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CAPTAIN_SEAFOOD_CONFIG_KEY,
  cloneCaptainSeafoodConfig,
  DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
  unwrapRuleConfigValue,
  validateCaptainSeafoodConfig,
} from './captain.constants';
import type { CaptainSeafoodConfig } from './captain.types';

@Injectable()
export class CaptainConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<CaptainSeafoodConfig> {
    const row = await this.prisma.ruleConfig.findUnique({
      where: { key: CAPTAIN_SEAFOOD_CONFIG_KEY },
    });
    if (!row) {
      return cloneCaptainSeafoodConfig(DEFAULT_CAPTAIN_SEAFOOD_CONFIG);
    }

    const rawConfig = unwrapRuleConfigValue<unknown>(row.value);
    const config = validateCaptainSeafoodConfig(rawConfig);
    return cloneCaptainSeafoodConfig(config);
  }

  async getSnapshot(): Promise<CaptainSeafoodConfig> {
    return this.getConfig();
  }
}
