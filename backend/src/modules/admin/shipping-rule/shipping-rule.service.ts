import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, ShippingRule } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import { CreateShippingRuleDto } from './dto/create-shipping-rule.dto';
import { UpdateShippingRuleDto } from './dto/update-shipping-rule.dto';
import { PreviewShippingDto } from './dto/preview-shipping.dto';
import { ShippingRuleCache } from './shipping-rule.cache';

const GRAMS_PER_KG = 1000;

export type ShippingCalculationResult = {
  fee: number;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
  billingWeightKg: number;
  formula: string;
  fallbackUsed: boolean;
};

type ShippingRuleFormulaInput = {
  name: string;
  firstWeightKg: number;
  firstFee: number;
  additionalWeightKg: number;
  additionalFee: number;
  minChargeWeightKg: number;
};

@Injectable()
export class ShippingRuleService {
  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
    private cache: ShippingRuleCache,
  ) {}

  /** 运费规则列表 */
  async findAll(page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.shippingRule.findMany({
        skip,
        take: pageSize,
        orderBy: { priority: 'desc' },
      }),
      this.prisma.shippingRule.count(),
    ]);

    // 管理端接口统一返回 kg，数据库内部按 g 存储。
    return {
      items: items.map((item) => this.normalizeRuleWeightUnit(item)),
      total,
      page,
      pageSize,
    };
  }

  /** 新增运费规则 */
  async create(dto: CreateShippingRuleDto) {
    this.validateRuleBounds(dto);
    this.validateFormulaInput(dto);

    const created = await this.prisma.shippingRule.create({
      data: {
        name: dto.name.trim(),
        regionCodes: dto.regionCodes ?? [],
        minAmount: dto.minAmount,
        maxAmount: dto.maxAmount,
        minWeight: dto.minWeight === undefined ? undefined : this.kgToGram(dto.minWeight),
        maxWeight: dto.maxWeight === undefined ? undefined : this.kgToGram(dto.maxWeight),
        fee: dto.fee,
        firstWeightKg: dto.firstWeightKg,
        firstFee: dto.firstFee,
        additionalWeightKg: dto.additionalWeightKg,
        additionalFee: dto.additionalFee,
        minChargeWeightKg: dto.minChargeWeightKg,
        priority: dto.priority ?? 0,
      },
    });
    await this.cache.invalidate();
    return this.normalizeRuleWeightUnit(created);
  }

  /** 编辑运费规则 */
  async update(id: string, dto: UpdateShippingRuleDto) {
    const rule = await this.prisma.shippingRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('运费规则不存在');

    // 部分更新时按“更新后值”做边界校验，避免写入非法区间。
    const effective = {
      fee: dto.fee ?? rule.fee,
      minAmount: dto.minAmount ?? (rule.minAmount ?? undefined),
      maxAmount: dto.maxAmount ?? (rule.maxAmount ?? undefined),
      minWeight: dto.minWeight ?? (rule.minWeight === null ? undefined : this.gramToKg(rule.minWeight)),
      maxWeight: dto.maxWeight ?? (rule.maxWeight === null ? undefined : this.gramToKg(rule.maxWeight)),
    };
    this.validateRuleBounds(effective);
    const effectiveIsActive = dto.isActive ?? rule.isActive;
    if (effectiveIsActive) {
      this.validateFormulaInput({
        name: dto.name?.trim() ?? rule.name,
        firstWeightKg: dto.firstWeightKg ?? rule.firstWeightKg,
        firstFee: dto.firstFee ?? rule.firstFee,
        additionalWeightKg: dto.additionalWeightKg ?? rule.additionalWeightKg,
        additionalFee: dto.additionalFee ?? rule.additionalFee,
        minChargeWeightKg: dto.minChargeWeightKg ?? rule.minChargeWeightKg,
      });
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.regionCodes !== undefined) data.regionCodes = dto.regionCodes;
    if (dto.minAmount !== undefined) data.minAmount = dto.minAmount;
    if (dto.maxAmount !== undefined) data.maxAmount = dto.maxAmount;
    if (dto.minWeight !== undefined) data.minWeight = this.kgToGram(dto.minWeight);
    if (dto.maxWeight !== undefined) data.maxWeight = this.kgToGram(dto.maxWeight);
    if (dto.fee !== undefined) data.fee = dto.fee;
    if (dto.firstWeightKg !== undefined) data.firstWeightKg = dto.firstWeightKg;
    if (dto.firstFee !== undefined) data.firstFee = dto.firstFee;
    if (dto.additionalWeightKg !== undefined) data.additionalWeightKg = dto.additionalWeightKg;
    if (dto.additionalFee !== undefined) data.additionalFee = dto.additionalFee;
    if (dto.minChargeWeightKg !== undefined) data.minChargeWeightKg = dto.minChargeWeightKg;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.shippingRule.update({
      where: { id },
      data,
    });
    await this.cache.invalidate();
    return this.normalizeRuleWeightUnit(updated);
  }

  /** 删除运费规则（硬删除）
   *  ShippingRule 无外键引用，可直接删除。历史订单的运费已落库到 Order.shippingFee，不依赖此表。
   */
  async remove(id: string) {
    const rule = await this.prisma.shippingRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('运费规则不存在');

    await this.prisma.shippingRule.delete({ where: { id } });
    await this.cache.invalidate();
    return { ok: true };
  }

  /** 运费预览测试：传入金额/地区/重量，返回匹配的运费 */
  async preview(input: PreviewShippingDto) {
    const fee = await this.calculateShippingFee(
      input.goodsAmount,
      input.regionCode,
      input.totalWeight === undefined ? undefined : this.kgToGram(input.totalWeight),
    );
    return { fee, input };
  }

  /**
   * 运费计算引擎（供 OrderService 调用）
   * totalWeight 单位：g（克）
   * 按 priority 降序匹配第一条符合所有维度的规则
   */
  async calculateShippingFee(
    goodsAmount: number,
    regionCode?: string,
    totalWeight?: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const detail = await this.calculateShippingDetail(
      goodsAmount,
      regionCode,
      totalWeight,
      tx,
    );
    return detail.fee;
  }

  /**
   * 顺丰风格平台统一计价引擎。
   * totalWeightGram 单位：g（克）；缺省按 0g 处理，只允许全国规则匹配缺省 regionCode。
   */
  async calculateShippingDetail(
    _goodsAmount: number,
    regionCode?: string,
    totalWeightGram?: number,
    tx?: Prisma.TransactionClient,
  ): Promise<ShippingCalculationResult> {
    const rules = await this.getActiveRules(tx);
    const safeWeightGram = Math.max(0, Math.round(totalWeightGram ?? 0));

    const candidates = rules
      .filter((rule) => rule.isActive)
      .filter((rule) => this.regionMatches(rule.regionCodes, regionCode))
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.id.localeCompare(b.id);
      });
    const matched = candidates[0] ?? null;

    if (!matched) {
      const sysConfig = await this.bonusConfig.getSystemConfig();
      const defaultShippingFee = sysConfig.defaultShippingFee;
      const fallbackWeightKg = Math.max(safeWeightGram, GRAMS_PER_KG) / GRAMS_PER_KG;
      return {
        fee: defaultShippingFee,
        matchedRuleId: null,
        matchedRuleName: null,
        billingWeightKg: fallbackWeightKg,
        formula: `fallback DEFAULT_SHIPPING_FEE = ${defaultShippingFee}`,
        fallbackUsed: true,
      };
    }

    return this.calculateByRule(matched, safeWeightGram);
  }

  private async getActiveRules(
    tx?: Prisma.TransactionClient,
  ): Promise<ShippingRule[]> {
    if (tx) {
      return tx.shippingRule.findMany({
        where: { isActive: true },
        orderBy: [{ priority: 'desc' }, { id: 'asc' }],
      });
    }

    const cached = await this.cache.getActiveRules();
    if (cached) {
      return cached;
    }

    const rules = await this.prisma.shippingRule.findMany({
      where: { isActive: true },
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    });
    await this.cache.setActiveRules(rules);
    return rules;
  }

  private calculateByRule(
    rule: ShippingRule,
    totalWeightGram: number,
  ): ShippingCalculationResult {
    this.validateFormulaRule(rule);

    const billingWeightG = Math.max(
      totalWeightGram,
      Math.round(rule.minChargeWeightKg * GRAMS_PER_KG),
    );
    const firstWeightG = Math.round(rule.firstWeightKg * GRAMS_PER_KG);
    const additionalUnitG = Math.round(rule.additionalWeightKg * GRAMS_PER_KG);
    const firstFeeCent = Math.round(rule.firstFee * 100);
    const additionalFeeCent = Math.round(rule.additionalFee * 100);

    let feeCent: number;
    let formula: string;
    if (billingWeightG <= firstWeightG) {
      feeCent = firstFeeCent;
      formula = `${rule.firstFee} = ${feeCent / 100}`;
    } else {
      const extraUnits = Math.ceil((billingWeightG - firstWeightG) / additionalUnitG);
      feeCent = firstFeeCent + extraUnits * additionalFeeCent;
      formula =
        `${rule.firstFee} + ceil((${billingWeightG}g - ${firstWeightG}g) / ` +
        `${additionalUnitG}g) * ${rule.additionalFee} = ${feeCent / 100}`;
    }

    return {
      fee: feeCent / 100,
      matchedRuleId: rule.id,
      matchedRuleName: rule.name,
      billingWeightKg: billingWeightG / GRAMS_PER_KG,
      formula,
      fallbackUsed: false,
    };
  }

  private validateFormulaRule(rule: ShippingRule) {
    this.validateFormulaInput(rule);
  }

  private validateFormulaInput(rule: ShippingRuleFormulaInput) {
    const invalidFields: string[] = [];
    if (!this.isFiniteGreaterThanZero(rule.firstWeightKg)) {
      invalidFields.push('首重重量');
    }
    if (!this.isFiniteGreaterThanZero(rule.firstFee)) {
      invalidFields.push('首重费用');
    }
    if (!this.isFiniteGreaterThanZero(rule.additionalWeightKg)) {
      invalidFields.push('续重重量');
    }
    if (!this.isFiniteNonNegative(rule.additionalFee)) {
      invalidFields.push('续重费用');
    }
    if (!this.isFiniteNonNegative(rule.minChargeWeightKg)) {
      invalidFields.push('最低计费重量');
    }

    if (invalidFields.length > 0) {
      throw new BadRequestException(
        `运费规则「${rule.name}」配置无效：${invalidFields.join('、')}必须为有效数字，且首重重量/首重费用/续重重量必须大于 0，续重费用/最低计费重量不能小于 0`,
      );
    }
  }

  private isFiniteGreaterThanZero(value: number): boolean {
    return Number.isFinite(value) && value > 0;
  }

  private isFiniteNonNegative(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
  }

  private regionMatches(regionCodes: string[], regionCode?: string): boolean {
    if (regionCodes.length === 0) {
      return true;
    }
    if (!regionCode) {
      return false;
    }
    const provinceCode = regionCode.slice(0, 2);
    return regionCodes.some((code) => code.slice(0, 2) === provinceCode);
  }

  private validateRuleBounds(input: {
    fee: number;
    minAmount?: number;
    maxAmount?: number;
    minWeight?: number;
    maxWeight?: number;
  }) {
    if (input.fee < 0) throw new BadRequestException('运费不能为负数');
    if (
      input.minAmount !== undefined &&
      input.maxAmount !== undefined &&
      input.minAmount >= input.maxAmount
    ) {
      throw new BadRequestException('金额下限必须小于上限');
    }
    if (
      input.minWeight !== undefined &&
      input.maxWeight !== undefined &&
      input.minWeight >= input.maxWeight
    ) {
      throw new BadRequestException('重量下限必须小于上限');
    }
  }

  private kgToGram(weightKg: number): number {
    return Math.round(weightKg * GRAMS_PER_KG);
  }

  private gramToKg(weightGram: number): number {
    return weightGram / GRAMS_PER_KG;
  }

  private normalizeRuleWeightUnit<T extends { minWeight: number | null; maxWeight: number | null }>(
    rule: T,
  ): T {
    return {
      ...rule,
      minWeight: rule.minWeight === null ? null : this.gramToKg(rule.minWeight),
      maxWeight: rule.maxWeight === null ? null : this.gramToKg(rule.maxWeight),
    };
  }
}
