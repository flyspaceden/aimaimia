import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ProductImageBudgetLedgerType, ProductImageOptimizationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Integer-cents budget boundary for a future paid background provider. The
 * deterministic white-background task never calls this service.
 */
@Injectable()
export class ProductImageBudgetService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async reserve(companyId: string, optimizationId: string, expectedCostCents: number) {
    this.assertPaidGenerationEnabled();
    if (!Number.isInteger(expectedCostCents) || expectedCostCents <= 0) {
      throw new BadRequestException('背景生成预估成本必须为正整数分');
    }
    const perTaskCap = this.getPositiveInt('AI_PRODUCT_IMAGE_PER_TASK_CAP_CENTS', 50);
    if (expectedCostCents > perTaskCap) throw new ConflictException('单次背景生成成本超过平台上限');
    const version = this.config.get<string>('AI_PRODUCT_IMAGE_BUDGET_VERSION', 'v1');
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    // A missing/zero daily cap must never mean unlimited spend. Paid image
    // generation stays unavailable until an operator explicitly sets one.
    const dailyCap = this.getRequiredPositiveInt('AI_PRODUCT_IMAGE_DAILY_BUDGET_CENTS');

    return this.prisma.$transaction(async (tx) => {
      const task = await tx.productImageOptimization.findFirst({
        where: { id: optimizationId, companyId, status: { in: [ProductImageOptimizationStatus.QUEUED, ProductImageOptimizationStatus.RUNNING] } },
        select: { id: true },
      });
      if (!task) throw new ConflictException('任务当前状态不能预占付费背景额度');
      const existing = await tx.productImageBudgetLedger.findUnique({
        where: { optimizationId_type: { optimizationId, type: ProductImageBudgetLedgerType.RESERVED } },
      });
      if (existing) return existing;
      const entries = await tx.productImageBudgetLedger.findMany({
        where: { companyId, createdAt: { gte: startOfDay } },
        select: { optimizationId: true, type: true, amountCents: true },
      });
      const dailyCommitted = this.calculateCommittedCents(entries);
      if (dailyCommitted + expectedCostCents > dailyCap) {
        throw new ConflictException('今日商品视觉付费额度已用尽');
      }
      const ledger = await tx.productImageBudgetLedger.create({
        data: {
          companyId,
          optimizationId,
          type: ProductImageBudgetLedgerType.RESERVED,
          amountCents: expectedCostCents,
          budgetVersion: version,
          idempotencyKey: `reserve:${optimizationId}:${version}`,
        },
      });
      await tx.productImageOptimization.update({ where: { id: optimizationId }, data: { reservedCostCents: expectedCostCents } });
      return ledger;
    }, { isolationLevel: 'Serializable' as any });
  }

  async settle(companyId: string, optimizationId: string, actualCostCents: number) {
    if (!Number.isInteger(actualCostCents) || actualCostCents <= 0) throw new BadRequestException('实际成本必须为正整数分');
    return this.closeReservation(companyId, optimizationId, ProductImageBudgetLedgerType.SETTLED, actualCostCents);
  }

  async release(companyId: string, optimizationId: string) {
    return this.closeReservation(companyId, optimizationId, ProductImageBudgetLedgerType.RELEASED);
  }

  private async closeReservation(
    companyId: string,
    optimizationId: string,
    type: 'SETTLED' | 'RELEASED',
    amountCents?: number,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const reserved = await tx.productImageBudgetLedger.findUnique({
          where: { optimizationId_type: { optimizationId, type: ProductImageBudgetLedgerType.RESERVED } },
        });
        if (!reserved || reserved.companyId !== companyId) throw new ConflictException('不存在可关闭的背景额度预占');
        if (amountCents !== undefined && amountCents > reserved.amountCents) {
          throw new ConflictException('供应商实际成本超过预占额度，需人工对账');
        }
        const terminal = await tx.productImageBudgetLedger.findMany({
          where: { optimizationId, type: { in: [ProductImageBudgetLedgerType.RELEASED, ProductImageBudgetLedgerType.SETTLED] } },
        });
        if (terminal.length > 0) {
          if (terminal[0].type === type) return terminal[0];
          throw new ConflictException('该背景额度预占已以相反终态关闭，需人工对账');
        }
        const finalAmount = amountCents ?? reserved.amountCents;
        const ledger = await tx.productImageBudgetLedger.create({
          data: {
            companyId,
            optimizationId,
            type,
            amountCents: finalAmount,
            budgetVersion: reserved.budgetVersion,
            idempotencyKey: `${type.toLowerCase()}:${optimizationId}:${reserved.budgetVersion}`,
          },
        });
        await tx.productImageOptimization.update({
          where: { id: optimizationId },
          data: type === ProductImageBudgetLedgerType.SETTLED
            ? { actualCostCents: finalAmount }
            : { reservedCostCents: 0 },
        });
        return ledger;
      }, { isolationLevel: 'Serializable' as any });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const terminal = await this.prisma.productImageBudgetLedger.findFirst({
          where: { optimizationId, type: { in: [ProductImageBudgetLedgerType.RELEASED, ProductImageBudgetLedgerType.SETTLED] } },
        });
        if (terminal?.type === type) return terminal;
        if (terminal) throw new ConflictException('该背景额度预占已以相反终态关闭，需人工对账');
      }
      throw error;
    }
  }

  private calculateCommittedCents(entries: Array<{ optimizationId: string; type: ProductImageBudgetLedgerType; amountCents: number }>) {
    const byTask = new Map<string, { reserved?: number; released?: number; settled?: number }>();
    for (const entry of entries) {
      const totals = byTask.get(entry.optimizationId) ?? {};
      if (entry.type === ProductImageBudgetLedgerType.RESERVED) totals.reserved = entry.amountCents;
      if (entry.type === ProductImageBudgetLedgerType.RELEASED) totals.released = entry.amountCents;
      if (entry.type === ProductImageBudgetLedgerType.SETTLED) totals.settled = entry.amountCents;
      byTask.set(entry.optimizationId, totals);
    }
    return [...byTask.values()].reduce((sum, entry) => sum + (entry.settled ?? Math.max(0, (entry.reserved ?? 0) - (entry.released ?? 0))), 0);
  }

  private assertPaidGenerationEnabled() {
    if (this.config.get('AI_PRODUCT_IMAGE_ENABLED', 'false') !== 'true'
      || this.config.get('AI_PRODUCT_IMAGE_BACKGROUND_ENABLED', 'false') !== 'true') {
      throw new ServiceUnavailableException('付费商品背景生成尚未启用');
    }
  }

  private getPositiveInt(key: string, fallback: number) {
    const value = Number(this.config.get(key, String(fallback)));
    if (!Number.isInteger(value) || value < 0) throw new BadRequestException(`${key} 必须为非负整数分`);
    return value;
  }

  private getRequiredPositiveInt(key: string) {
    const raw = this.config.get<string | undefined>(key);
    const value = Number(raw);
    if (!raw || !Number.isInteger(value) || value <= 0) {
      throw new ServiceUnavailableException(`${key} 必须显式配置为正整数分`);
    }
    return value;
  }
}
