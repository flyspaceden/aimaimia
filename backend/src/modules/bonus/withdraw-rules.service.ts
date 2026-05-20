import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateWithdrawRulesDto, WithdrawRules } from './dto/withdraw-rules.dto';

type RuleField = keyof WithdrawRules;

type RuleDefinition = {
  field: RuleField;
  defaultValue: WithdrawRules[RuleField];
  description: string;
};

const RULE_DEFINITIONS: Record<string, RuleDefinition> = {
  WITHDRAW_TAX_RATE: {
    field: 'withdrawTaxRate',
    defaultValue: 0.2,
    description: '提现代扣个税比例',
  },
  WITHDRAW_MIN_AMOUNT: {
    field: 'withdrawMinAmount',
    defaultValue: 10,
    description: '提现单笔最低（元）',
  },
  WITHDRAW_MAX_AMOUNT: {
    field: 'withdrawMaxAmount',
    defaultValue: 10000,
    description: '提现单笔最高（元）',
  },
  WITHDRAW_DAILY_MAX_COUNT: {
    field: 'withdrawDailyMaxCount',
    defaultValue: 3,
    description: '提现每日最多次数',
  },
  WITHDRAW_COOLDOWN_SECONDS: {
    field: 'withdrawCooldownSeconds',
    defaultValue: 60,
    description: '提现间冷却时间（秒）',
  },
  WITHDRAW_YEARLY_MAX_AMOUNT: {
    field: 'withdrawYearlyMaxAmount',
    defaultValue: 50000,
    description: '单用户年累计提现上限（元）',
  },
  DEDUCTION_RATIO_NORMAL: {
    field: 'deductionRatioNormal',
    defaultValue: 0.1,
    description: '普通用户抵扣比例上限',
  },
  DEDUCTION_RATIO_VIP: {
    field: 'deductionRatioVip',
    defaultValue: 0.15,
    description: 'VIP 用户抵扣比例上限',
  },
  DEDUCTION_MIN_ORDER_AMOUNT: {
    field: 'deductionMinOrderAmount',
    defaultValue: 0,
    description: '最低订单门槛（元）',
  },
  DEDUCTION_ALLOW_COUPON_STACK: {
    field: 'deductionAllowCouponStack',
    defaultValue: true,
    description: '是否允许与平台红包叠加',
  },
  WITHDRAW_PROVIDER_FEE_AMOUNT: {
    field: 'withdrawProviderFeeAmount',
    defaultValue: 0,
    description: '单笔通道手续费（元，v1.0=0）',
  },
  WITHDRAW_YEARLY_ALERT_THRESHOLD: {
    field: 'withdrawYearlyAlertThreshold',
    defaultValue: 0.8,
    description: '年累计达上限多少时告警（0-1）',
  },
};

const KEY_BY_FIELD = Object.fromEntries(
  Object.entries(RULE_DEFINITIONS).map(([key, def]) => [def.field, key]),
) as Record<RuleField, string>;

export const WITHDRAW_RULE_DEFAULTS = Object.fromEntries(
  Object.values(RULE_DEFINITIONS).map((def) => [def.field, def.defaultValue]),
) as unknown as WithdrawRules;

@Injectable()
export class WithdrawRulesService {
  constructor(private prisma: PrismaService) {}

  async getRules(): Promise<WithdrawRules> {
    const rows = await this.prisma.ruleConfig.findMany({
      where: { key: { in: Object.keys(RULE_DEFINITIONS) } },
    });
    const rules: WithdrawRules = { ...WITHDRAW_RULE_DEFAULTS };

    for (const row of rows) {
      const definition = RULE_DEFINITIONS[row.key];
      if (!definition) continue;

      const stored = this.unwrapStoredValue(row.value);
      if (stored !== undefined && stored !== null) {
        (rules as any)[definition.field] = stored;
      }
    }

    return rules;
  }

  async updateRules(dto: UpdateWithdrawRulesDto): Promise<WithdrawRules> {
    const nextRules = { ...(await this.getRules()), ...dto };
    this.validateRules(nextRules);

    for (const [field, value] of Object.entries(dto) as Array<[RuleField, unknown]>) {
      if (value === undefined) continue;

      const key = KEY_BY_FIELD[field];
      const definition = key ? RULE_DEFINITIONS[key] : undefined;
      if (!key || !definition) continue;

      await this.prisma.ruleConfig.upsert({
        where: { key },
        create: {
          key,
          value: {
            value,
            description: definition.description,
          },
        },
        update: {
          value: {
            value,
            description: definition.description,
          },
        },
      });
    }

    return this.getRules();
  }

  private unwrapStoredValue(value: unknown) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
      return (value as { value?: unknown }).value;
    }
    return value;
  }

  private validateRules(rules: WithdrawRules) {
    if (rules.withdrawMinAmount > rules.withdrawMaxAmount) {
      throw new BadRequestException('提现单笔最低金额不能高于最高金额');
    }
    if (rules.withdrawProviderFeeAmount >= rules.withdrawMinAmount) {
      throw new BadRequestException('提现通道手续费必须低于单笔最低提现金额');
    }
    if (rules.withdrawTaxRate < 0 || rules.withdrawTaxRate > 0.5) {
      throw new BadRequestException('提现个税比例必须在 0-0.5 之间');
    }
    if (rules.deductionRatioNormal < 0 || rules.deductionRatioNormal > 1) {
      throw new BadRequestException('普通用户抵扣比例必须在 0-1 之间');
    }
    if (rules.deductionRatioVip < 0 || rules.deductionRatioVip > 1) {
      throw new BadRequestException('VIP 用户抵扣比例必须在 0-1 之间');
    }
    if (rules.withdrawYearlyAlertThreshold < 0 || rules.withdrawYearlyAlertThreshold > 1) {
      throw new BadRequestException('年累计告警阈值必须在 0-1 之间');
    }
  }
}
