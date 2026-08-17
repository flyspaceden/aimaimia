import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import type { CaptainSeafoodConfig } from '../../captain/captain.types';
import {
  PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS,
  ProfitSafetyCandidateChange,
  ProfitSafetyService,
} from '../../profit/profit-safety.service';
import { ProfitSafetyViolationError } from '../../profit/profit-safety-validator';
import { validateConfigValue } from './config-validation';
import {
  BatchUpdateConfigDto,
  RollbackConfigVersionDto,
  UpdateConfigDto,
} from './dto/admin-config.dto';
import {
  MarkupRepricePlan,
  ProductPricingService,
} from '../../product/product-pricing.service';

type VersionAssessment = {
  rollbackAllowed: boolean;
  rollbackBlockedReason: string | null;
};

@Injectable()
export class AdminConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusConfig: BonusConfigService,
    private readonly profitSafety: ProfitSafetyService,
    private readonly productPricing: ProductPricingService,
  ) {}

  findAll() {
    return this.prisma.ruleConfig.findMany();
  }

  async findByKey(key: string) {
    const config = await this.prisma.ruleConfig.findUnique({ where: { key } });
    if (!config) throw new NotFoundException(`配置项 ${key} 不存在`);
    return config;
  }

  async update(key: string, dto: UpdateConfigDto, adminUserId: string) {
    const actualValue = this.unwrapValue(dto.value);
    const validationError = validateConfigValue(key, actualValue);
    if (validationError) throw new BadRequestException(validationError);

    let pricingPlan: MarkupRepricePlan | undefined;
    const output = await this.executeSafety(() => this.profitSafety.withCandidateChange(async (tx) => {
      if (key === 'MARKUP_RATE') {
        pricingPlan = await this.productPricing.buildMarkupRepricePlan(tx, Number(actualValue));
        this.productPricing.assertMarkupRepriceConfirmed(
          pricingPlan,
          dto.repriceExisting,
          dto.markupPreviewToken,
        );
      }
      return {
        ruleUpdates: { [key]: actualValue },
        ...(pricingPlan ? { skuUpserts: pricingPlan.profitSafetySkus } : {}),
        createdByAdminId: adminUserId,
        changeNote: dto.changeNote || `更新配置项 ${key}`,
      };
    }, async (tx, context) => {
      this.validateAfterSaleWindowCoverage(
        context.candidateSnapshot,
      );
      this.bonusConfig.validateSnapshotRatios(context.candidateSnapshot);
      await (tx as any).ruleConfig.upsert({
        where: { key },
        update: { value: dto.value },
        create: { key, value: dto.value },
      });
      const markupReprice = pricingPlan
        ? await this.productPricing.applyMarkupReprice(tx, pricingPlan)
        : undefined;
      return { ok: true, markupReprice };
    }));

    this.bonusConfig.invalidateCache();
    return {
      ok: true,
      version: (output.ruleVersion as any).version,
      ...(output.result.markupReprice
        ? { markupReprice: output.result.markupReprice }
        : {}),
    };
  }

  async batchUpdate(dto: BatchUpdateConfigDto, adminUserId: string) {
    const ruleUpdates: Record<string, unknown> = {};
    for (const update of dto.updates) {
      const actualValue = this.unwrapValue(update.value);
      const validationError = validateConfigValue(update.key, actualValue);
      if (validationError) {
        throw new BadRequestException(`[${update.key}] ${validationError}`);
      }
      ruleUpdates[update.key] = actualValue;
    }

    const markupValue = Object.prototype.hasOwnProperty.call(ruleUpdates, 'MARKUP_RATE')
      ? Number(ruleUpdates.MARKUP_RATE)
      : undefined;
    let pricingPlan: MarkupRepricePlan | undefined;
    const output = await this.executeSafety(() => this.profitSafety.withCandidateChange(async (tx) => {
      if (markupValue !== undefined) {
        pricingPlan = await this.productPricing.buildMarkupRepricePlan(tx, markupValue);
        this.productPricing.assertMarkupRepriceConfirmed(
          pricingPlan,
          dto.repriceExisting,
          dto.markupPreviewToken,
        );
      }
      return {
        ruleUpdates,
        ...(pricingPlan ? { skuUpserts: pricingPlan.profitSafetySkus } : {}),
        createdByAdminId: adminUserId,
        changeNote: dto.changeNote
          || `批量更新 ${dto.updates.length} 个配置项：${dto.updates.map((item) => item.key).join(', ')}`,
      };
    }, async (tx, context) => {
      this.validateAfterSaleWindowCoverage(
        context.candidateSnapshot,
      );
      this.bonusConfig.validateSnapshotRatios(context.candidateSnapshot);
      for (const update of dto.updates) {
        await (tx as any).ruleConfig.upsert({
          where: { key: update.key },
          update: { value: update.value },
          create: { key: update.key, value: update.value },
        });
      }
      const markupReprice = pricingPlan
        ? await this.productPricing.applyMarkupReprice(tx, pricingPlan)
        : undefined;
      return { ok: true, markupReprice };
    }));

    this.bonusConfig.invalidateCache();
    return {
      ok: true,
      version: (output.ruleVersion as any).version,
      updated: dto.updates.length,
      ...(output.result.markupReprice
        ? { markupReprice: output.result.markupReprice }
        : {}),
    };
  }

  async getProfitSafetySummary() {
    return this.profitSafety.getCurrentSummary();
  }

  async previewProfitSafety(input: unknown) {
    const context = await this.profitSafety.previewContext(
      this.normalizePreview(input),
    );
    // 实时预览必须执行与最终保存相同的快照级业务校验。
    // ProfitSafetyValidator 负责逐 SKU 利润底线；这里补齐七分总和、
    // 队列比例不得超过平台份额以及售后窗口覆盖等最终态约束。
    this.validateAfterSaleWindowCoverage(context.candidateSnapshot);
    this.bonusConfig.validateSnapshotRatios(context.candidateSnapshot);
    return context.summary;
  }

  previewMarkupReprice(markupRate: number) {
    return this.productPricing.previewMarkupReprice(markupRate);
  }

  async findVersions(page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const [versions, total] = await Promise.all([
      this.prisma.ruleVersion.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          createdByAdmin: {
            select: { id: true, username: true, realName: true },
          },
        },
      }),
      this.prisma.ruleVersion.count(),
    ]);
    const pricingPlans = new Map<number, Promise<MarkupRepricePlan>>();
    const items = await Promise.all(versions.map(async (version) => ({
      ...version,
      ...(await this.assessVersion(version, undefined, pricingPlans)),
    })));
    return { items, total, page, pageSize };
  }

  async findVersionById(id: string) {
    const version = await this.prisma.ruleVersion.findUnique({
      where: { id },
      include: {
        createdByAdmin: {
          select: { id: true, username: true, realName: true },
        },
      },
    });
    if (!version) throw new NotFoundException('版本不存在');
    return { ...version, ...(await this.assessVersion(version)) };
  }

  async rollbackToVersion(
    versionId: string,
    adminUserId: string,
    dto: RollbackConfigVersionDto = {},
  ) {
    const version = await this.prisma.ruleVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('版本不存在');

    const snapshot = this.unwrapSnapshot(version.snapshot);
    const assessment = await this.assessVersion(version, snapshot);
    if (!assessment.rollbackAllowed) {
      throw new BadRequestException(assessment.rollbackBlockedReason);
    }

    const rollbackMarkupRate = Number(snapshot.MARKUP_RATE);
    let pricingPlan: MarkupRepricePlan | undefined;
    const output = await this.executeSafety(() => this.profitSafety.withCandidateChange(async (tx) => {
      if (Number.isFinite(rollbackMarkupRate)) {
        pricingPlan = await this.productPricing.buildMarkupRepricePlan(tx, rollbackMarkupRate);
        this.productPricing.assertMarkupRepriceConfirmed(
          pricingPlan,
          dto.repriceExisting,
          dto.markupPreviewToken,
        );
      }
      return {
        replaceRuleSnapshot: snapshot,
        ...(pricingPlan ? { skuUpserts: pricingPlan.profitSafetySkus } : {}),
        createdByAdminId: adminUserId,
        changeNote: `回滚到版本 ${version.version}`,
      };
    }, async (tx, context) => {
      this.validateAfterSaleWindowCoverage(
        context.candidateSnapshot,
      );
      this.bonusConfig.validateSnapshotRatios(context.candidateSnapshot);
      await (tx as any).ruleConfig.deleteMany();
      for (const [key, value] of Object.entries(context.candidateSnapshot)) {
        await (tx as any).ruleConfig.create({ data: { key, value } });
      }
      const markupReprice = pricingPlan
        ? await this.productPricing.applyMarkupReprice(tx, pricingPlan)
        : undefined;
      return { ok: true, markupReprice };
    }));

    this.bonusConfig.invalidateCache();
    return {
      ok: true,
      version: (output.ruleVersion as any).version,
      ...(output.result.markupReprice
        ? { markupReprice: output.result.markupReprice }
        : {}),
    };
  }

  private async assessVersion(
    version: any,
    preparedSnapshot?: Record<string, unknown>,
    pricingPlans: Map<number, Promise<MarkupRepricePlan>> = new Map(),
  ): Promise<VersionAssessment> {
    if (version?.isComplete !== true) {
      return { rollbackAllowed: false, rollbackBlockedReason: '该版本是不完整历史快照，不允许回滚' };
    }
    const snapshot = preparedSnapshot ?? this.unwrapSnapshot(version.snapshot);
    const missingKeys = PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS.filter(
      (key) => !Object.prototype.hasOwnProperty.call(snapshot, key),
    );
    if (missingKeys.length > 0) {
      return {
        rollbackAllowed: false,
        rollbackBlockedReason: `该版本缺少完整配置：${missingKeys.join(', ')}`,
      };
    }
    const captain = snapshot.CAPTAIN_SEAFOOD_CONFIG as any;
    if (captain?.schemaVersion === 2 && captain?.enabled === true) {
      return { rollbackAllowed: false, rollbackBlockedReason: '该版本启用了销售额口径 V2 团长配置' };
    }
    try {
      this.validateAfterSaleWindowCoverage(snapshot);
      this.bonusConfig.validateSnapshotRatios(snapshot);
    } catch {
      return { rollbackAllowed: false, rollbackBlockedReason: '该版本的利润分配比例总和不合法' };
    }
    try {
      const markupRate = Number(snapshot.MARKUP_RATE);
      let pricingPlan: MarkupRepricePlan | undefined;
      if (Number.isFinite(markupRate)) {
        let planPromise = pricingPlans.get(markupRate);
        if (!planPromise) {
          planPromise = this.productPricing.previewMarkupRepricePlan(markupRate);
          pricingPlans.set(markupRate, planPromise);
        }
        pricingPlan = await planPromise;
      }
      const summary = await this.profitSafety.preview({
        replaceRuleSnapshot: snapshot,
        ...(pricingPlan ? { skuUpserts: pricingPlan.profitSafetySkus } : {}),
      });
      if (!summary.safe) {
        return { rollbackAllowed: false, rollbackBlockedReason: '该版本在当前商品经济数据下会突破利润安全底线' };
      }
    } catch {
      return { rollbackAllowed: false, rollbackBlockedReason: '该版本无法通过当前利润安全校验' };
    }
    return { rollbackAllowed: true, rollbackBlockedReason: null };
  }

  private normalizePreview(input: unknown): ProfitSafetyCandidateChange {
    const payload = input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, any>
      : {};
    const ruleUpdates: Record<string, unknown> = {};
    if (Array.isArray(payload.updates)) {
      for (const update of payload.updates) {
        if (typeof update?.key === 'string') {
          ruleUpdates[update.key] = this.unwrapValue(update.value);
        }
      }
    }
    if (payload.ruleUpdates && typeof payload.ruleUpdates === 'object') {
      for (const [key, value] of Object.entries(payload.ruleUpdates)) {
        ruleUpdates[key] = this.unwrapValue(value);
      }
    }
    return {
      ...(Object.keys(ruleUpdates).length > 0 ? { ruleUpdates } : {}),
      ...(payload.captainConfig ? { captainConfig: payload.captainConfig as CaptainSeafoodConfig } : {}),
    };
  }

  private unwrapSnapshot(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, this.unwrapValue(item)]),
    );
  }

  private unwrapValue(value: any): unknown {
    return value !== null
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.prototype.hasOwnProperty.call(value, 'value')
      ? value.value
      : value;
  }

  private validateAfterSaleWindowCoverage(
    snapshot: Record<string, unknown>,
  ): void {
    const returnWindowDays = Number(
      snapshot.RETURN_WINDOW_DAYS,
    );
    const normalReturnDays = Number(
      snapshot.NORMAL_RETURN_DAYS,
    );
    if (
      Number.isFinite(returnWindowDays) &&
      Number.isFinite(normalReturnDays) &&
      returnWindowDays < normalReturnDays
    ) {
      throw new BadRequestException({
        code: 'AFTER_SALE_WINDOW_COVERAGE_INVALID',
        message:
          '退货申请时限不能短于普通商品质量退换货时限，否则奖励可能在合法售后结束前释放',
        returnWindowDays,
        normalReturnDays,
      });
    }
  }

  private async executeSafety<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ProfitSafetyViolationError) {
        throw new BadRequestException(error.toResponse());
      }
      throw error;
    }
  }
}
