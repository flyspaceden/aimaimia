import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import { CreateShippingRuleDto } from './dto/create-shipping-rule.dto';
import { UpdateShippingRuleDto } from './dto/update-shipping-rule.dto';
import { PreviewShippingDto } from './dto/preview-shipping.dto';

const GRAMS_PER_KG = 1000;

@Injectable()
export class ShippingRuleService {
  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
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

    const created = await this.prisma.shippingRule.create({
      data: {
        name: dto.name.trim(),
        regionCodes: dto.regionCodes ?? [],
        minAmount: dto.minAmount,
        maxAmount: dto.maxAmount,
        minWeight: dto.minWeight === undefined ? undefined : this.kgToGram(dto.minWeight),
        maxWeight: dto.maxWeight === undefined ? undefined : this.kgToGram(dto.maxWeight),
        fee: dto.fee,
        priority: dto.priority ?? 0,
      },
    });
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

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.regionCodes !== undefined) data.regionCodes = dto.regionCodes;
    if (dto.minAmount !== undefined) data.minAmount = dto.minAmount;
    if (dto.maxAmount !== undefined) data.maxAmount = dto.maxAmount;
    if (dto.minWeight !== undefined) data.minWeight = this.kgToGram(dto.minWeight);
    if (dto.maxWeight !== undefined) data.maxWeight = this.kgToGram(dto.maxWeight);
    if (dto.fee !== undefined) data.fee = dto.fee;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.shippingRule.update({
      where: { id },
      data,
    });
    return this.normalizeRuleWeightUnit(updated);
  }

  /** 删除运费规则（硬删除）
   *  ShippingRule 无外键引用，可直接删除。历史订单的运费已落库到 Order.shippingFee，不依赖此表。
   */
  async remove(id: string) {
    const rule = await this.prisma.shippingRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('运费规则不存在');

    await this.prisma.shippingRule.delete({ where: { id } });
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
    tx?: any,
  ): Promise<number> {
    const prisma = tx || this.prisma;

    const rules = await prisma.shippingRule.findMany({
      where: { isActive: true },
      orderBy: { priority: 'desc' },
    });

    for (const rule of rules) {
      // 地区匹配：空数组 = 全国适用
      if (rule.regionCodes.length > 0 && regionCode) {
        // 匹配省级前缀（前2位行政区划码）
        const provinceCode = regionCode.slice(0, 2);
        // regionCodes 可能存 "11"（2位省码）或 "110000"（6位区划码），统一比较前2位
        const matches = rule.regionCodes.some(
          (rc: string) => rc.slice(0, 2) === provinceCode,
        );
        if (!matches) continue;
      } else if (rule.regionCodes.length > 0 && !regionCode) {
        // 规则限定了地区但未提供地区码，跳过
        continue;
      }

      // 金额匹配
      if (rule.minAmount !== null && goodsAmount < rule.minAmount) continue;
      if (rule.maxAmount !== null && goodsAmount >= rule.maxAmount) continue;

      // 重量匹配
      if (totalWeight !== undefined) {
        if (rule.minWeight !== null && totalWeight < rule.minWeight) continue;
        if (rule.maxWeight !== null && totalWeight >= rule.maxWeight) continue;
      }

      // 全部匹配，返回运费
      return rule.fee;
    }

    // 无匹配规则，使用默认运费
    const sysConfig = await this.bonusConfig.getSystemConfig();
    return sysConfig.defaultShippingFee;
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
