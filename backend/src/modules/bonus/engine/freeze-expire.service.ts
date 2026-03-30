import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from './bonus-config.service';
import { PLATFORM_USER_ID, getAccountTypeForScheme } from './constants';
import { ACTIVE_STATUSES } from '../../after-sale/after-sale.constants';

/** 每批处理的最大数量 */
const BATCH_SIZE = 100;

@Injectable()
export class FreezeExpireService {
  private readonly logger = new Logger(FreezeExpireService.name);

  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
  ) {}

  /**
   * 每小时检查并过期冻结奖励
   *
   * 查找 status=FROZEN + entryType=FREEZE + meta.expiresAt <= now() 的 ledger，
   * 逐条在独立 Serializable 事务中处理，确保错误隔离。
   *
   * 处理逻辑：
   * 1. CAS 更新 ledger → VOIDED/VOID
   * 2. 根据 scheme 判断账户类型（NORMAL_TREE→NORMAL_REWARD, VIP_UPSTREAM→VIP_REWARD）
   * 3. 扣减用户 frozen 余额
   * 4. 创建 PLATFORM_PROFIT ledger + increment 余额（过期奖励归平台）
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleFreezeExpire(): Promise<void> {
    this.logger.log('开始检查冻结奖励过期...');

    // 获取配置的冻结过期天数
    const config = await this.bonusConfig.getConfig();
    const vipFreezeDays = config.vipFreezeDays;
    const normalFreezeDays = config.normalFreezeDays;
    const maxFreezeDays = Math.max(vipFreezeDays, normalFreezeDays);

    // 查询1: 有 expiresAt 的过期冻结奖励
    const expiredWithDate: any[] = await this.prisma.$queryRaw`
      SELECT id, "userId", "accountId", amount, meta
      FROM "RewardLedger"
      WHERE status = 'FROZEN'
        AND "entryType" = 'FREEZE'
        AND meta IS NOT NULL
        AND (meta->>'expiresAt') IS NOT NULL
        AND (meta->>'expiresAt')::timestamp <= NOW()
      LIMIT ${BATCH_SIZE}
    `;

    // 查询2: 无 expiresAt 的旧冻结奖励，基于 createdAt + maxFreezeDays 判断过期
    const expiredWithoutDate: any[] = await this.prisma.$queryRaw`
      SELECT id, "userId", "accountId", amount, meta
      FROM "RewardLedger"
      WHERE status = 'FROZEN'
        AND "entryType" = 'FREEZE'
        AND (meta IS NULL OR (meta->>'expiresAt') IS NULL)
        AND "createdAt" <= NOW() - MAKE_INTERVAL(days => ${maxFreezeDays})
      LIMIT ${BATCH_SIZE}
    `;

    const expiredLedgers = [...expiredWithDate, ...expiredWithoutDate];

    if (expiredLedgers.length === 0) {
      this.logger.log('无过期冻结奖励');
      return;
    }

    this.logger.log(`发现 ${expiredLedgers.length} 条过期冻结奖励，开始处理`);

    let successCount = 0;
    let failCount = 0;

    for (const ledger of expiredLedgers) {
      try {
        await this.expireSingleLedger(ledger);
        successCount++;
      } catch (err) {
        failCount++;
        this.logger.error(
          `冻结奖励过期处理失败：ledgerId=${ledger.id}, error=${(err as Error).message}`,
        );
        // 单条失败不影响其他
      }
    }

    this.logger.log(
      `冻结奖励过期处理完成：成功 ${successCount}，失败 ${failCount}`,
    );
  }

  /**
   * 每 10 分钟检查 RETURN_FROZEN → FROZEN 转换
   *
   * 条件：
   * 1. 关联订单的 returnWindowExpiresAt < NOW()（退货窗口已过期）
   * 2. 该订单无进行中的售后申请（AfterSaleRequest.status in ACTIVE_STATUSES）
   *
   * 满足条件时 CAS 更新 RETURN_FROZEN → FROZEN（进入正常冻结机制）
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleReturnFreezeExpire(): Promise<void> {
    this.logger.log('开始检查售后保护冻结（RETURN_FROZEN → FROZEN）...');

    // 查找退货窗口已过期的 RETURN_FROZEN 奖励
    // 通过 refType='ORDER' + refId 关联订单
    const candidates: Array<{
      id: string;
      userId: string;
      accountId: string;
      amount: number;
      meta: any;
      refId: string;
    }> = await this.prisma.$queryRaw`
      SELECT rl.id, rl."userId", rl."accountId", rl.amount, rl.meta, rl."refId"
      FROM "RewardLedger" rl
      JOIN "Order" o ON rl."refId" = o.id
      WHERE rl.status = 'RETURN_FROZEN'
        AND rl."entryType" = 'FREEZE'
        AND rl."refType" = 'ORDER'
        AND o."returnWindowExpiresAt" IS NOT NULL
        AND o."returnWindowExpiresAt" < NOW()
      LIMIT ${BATCH_SIZE}
    `;

    if (candidates.length === 0) {
      this.logger.log('无需转换的售后保护冻结奖励');
      return;
    }

    this.logger.log(`发现 ${candidates.length} 条候选 RETURN_FROZEN 奖励，逐条检查售后状态`);

    // 批量查询关联订单是否有进行中的售后
    const orderIds = [...new Set(candidates.map((c) => c.refId))];
    const activeAfterSales = await this.prisma.afterSaleRequest.findMany({
      where: {
        orderId: { in: orderIds },
        status: { in: [...ACTIVE_STATUSES] },
      },
      select: { orderId: true },
    });
    const ordersWithActiveAfterSale = new Set(activeAfterSales.map((a) => a.orderId));

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (const candidate of candidates) {
      // 有进行中售后 → 跳过
      if (ordersWithActiveAfterSale.has(candidate.refId)) {
        skipCount++;
        continue;
      }

      try {
        await this.transitionReturnFrozenToFrozen(candidate);
        successCount++;
      } catch (err) {
        failCount++;
        this.logger.error(
          `RETURN_FROZEN→FROZEN 转换失败：ledgerId=${candidate.id}, error=${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `售后保护冻结检查完成：转换 ${successCount}，跳过(有活跃售后) ${skipCount}，失败 ${failCount}`,
    );
  }

  /**
   * 单条 RETURN_FROZEN → FROZEN 转换（独立 Serializable 事务）
   *
   * RETURN_FROZEN 期间不计入 RewardAccount.frozen，
   * 转换为 FROZEN 时需 increment frozen 使其对用户可见。
   */
  private async transitionReturnFrozenToFrozen(
    ledger: { id: string; userId: string; accountId: string; amount: number; meta: any },
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // CAS 更新：仅当仍为 RETURN_FROZEN 时才转换
        const cas = await tx.rewardLedger.updateMany({
          where: {
            id: ledger.id,
            status: 'RETURN_FROZEN',
            entryType: 'FREEZE',
          },
          data: { status: 'FROZEN' },
        });

        if (cas.count === 0) {
          this.logger.log(`奖励 ${ledger.id} 已非 RETURN_FROZEN 状态，跳过`);
          return;
        }

        // RETURN_FROZEN 期间未计入账户 frozen，现在转为 FROZEN 需要计入
        const scheme = (ledger.meta as any)?.scheme;
        const accountType = getAccountTypeForScheme(scheme);
        await tx.rewardAccount.updateMany({
          where: { userId: ledger.userId, type: accountType },
          data: { frozen: { increment: ledger.amount } },
        });

        this.logger.log(
          `RETURN_FROZEN→FROZEN：ledger ${ledger.id}，${ledger.amount} 元，用户 ${ledger.userId}，frozen +${ledger.amount}`,
        );
      },
      {
        timeout: 10000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * 处理单条过期冻结奖励（独立 Serializable 事务）
   */
  private async expireSingleLedger(ledger: any): Promise<void> {
    const meta = ledger.meta as any;
    const scheme = meta?.scheme;

    // 根据 scheme 判断账户类型
    const accountType = getAccountTypeForScheme(scheme);

    await this.prisma.$transaction(
      async (tx) => {
        // 1. CAS 更新 ledger → VOIDED/VOID（只处理 FROZEN 状态，防止并发重复处理）
        const cas = await tx.rewardLedger.updateMany({
          where: {
            id: ledger.id,
            status: 'FROZEN',
            entryType: 'FREEZE',
          },
          data: {
            status: 'VOIDED',
            entryType: 'VOID',
          },
        });

        if (cas.count === 0) {
          // 已被其他进程处理（解锁或已过期），跳过
          this.logger.log(`冻结奖励 ${ledger.id} 已非 FROZEN 状态，跳过`);
          return;
        }

        // 2. 扣减用户 frozen 余额（CAS 防负数）
        const accountCas = await tx.rewardAccount.updateMany({
          where: {
            userId: ledger.userId,
            type: accountType,
            frozen: { gte: ledger.amount },
          },
          data: { frozen: { decrement: ledger.amount } },
        });

        if (accountCas.count === 0) {
          this.logger.warn(
            `用户 ${ledger.userId} ${accountType} 冻结余额不足 ${ledger.amount}，可能已被并发处理`,
          );
        }

        // 3. 过期奖励归平台：创建 PLATFORM_PROFIT ledger
        let platformAccount = await tx.rewardAccount.findUnique({
          where: { userId_type: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' } },
        });
        if (!platformAccount) {
          platformAccount = await tx.rewardAccount.create({
            data: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' },
          });
        }

        await tx.rewardLedger.create({
          data: {
            accountId: platformAccount.id,
            userId: PLATFORM_USER_ID,
            entryType: 'RELEASE',
            amount: ledger.amount,
            status: 'AVAILABLE',
            refType: 'FREEZE_EXPIRE',
            refId: ledger.id,
            meta: {
              scheme: 'FREEZE_EXPIRE',
              originalScheme: scheme,
              expiredUserId: ledger.userId,
              originalLedgerId: ledger.id,
            },
          },
        });

        await tx.rewardAccount.update({
          where: { id: platformAccount.id },
          data: { balance: { increment: ledger.amount } },
        });

        this.logger.log(
          `冻结奖励过期：ledger ${ledger.id}，${ledger.amount} 元（${scheme}），用户 ${ledger.userId} → 平台`,
        );
      },
      {
        timeout: 10000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }
}
