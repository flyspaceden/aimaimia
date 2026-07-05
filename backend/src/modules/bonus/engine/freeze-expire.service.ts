import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from './bonus-config.service';
import { PLATFORM_USER_ID, getAccountTypeForLedger, type RewardAccountTypeStr } from './constants';
import { ACTIVE_STATUSES, SUCCESS_STATUSES } from '../../after-sale/after-sale.constants';
import { NotificationService } from '../../notification/notification.service';

/**
 * 这些账户类型不走"FROZEN 等解锁"二段冻结，RETURN_FROZEN 一过退货窗口期就直接 AVAILABLE。
 * 适用于产业基金 / 慈善 / 科技 / 备用金 / 平台利润这类没有"祖辈 selfPurchaseCount 解锁"概念的账户。
 */
const NO_FURTHER_LOCK_TYPES: ReadonlySet<RewardAccountTypeStr> = new Set([
  'INDUSTRY_FUND',
  'CHARITY_FUND',
  'TECH_FUND',
  'RESERVE_FUND',
  'PLATFORM_PROFIT',
]);

/** 每批处理的最大数量 */
const BATCH_SIZE = 100;

const DIRECT_REFERRAL_ORIGINAL_SCHEMES = new Set([
  'VIP_DIRECT_REFERRAL',
  'NORMAL_DIRECT_REFERRAL',
]);

const DIRECT_REFERRAL_AUDIT_COPY_KEYS = [
  'sourceUserId',
  'directInviterUserId',
  'inviterTierAtOrder',
  'inviteeTierAtOrder',
  'profit',
  'ratio',
  'directReferralPool',
  'platformReason',
  'sourceRelation',
  'normalShareBindingId',
  'relationStatus',
  'sourceCode',
  'sourceCodeType',
  'configSnapshot',
  'releaseCondition',
] as const;

@Injectable()
export class FreezeExpireService {
  private readonly logger = new Logger(FreezeExpireService.name);

  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
    private notificationService: NotificationService,
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

    // 兜底过滤：产业基金/慈善/科技/备用金/平台利润这些 NO_FURTHER_LOCK_TYPES 账户
    // 设计上不会进 FROZEN（transitionReturnFrozenToFrozen 已单次 CAS 直转 AVAILABLE），
    // 但万一因异常卡在 FROZEN，本 cron 不能误把它们 VOIDED 归平台（资金安全防线）
    // 查询1: 有 expiresAt 的过期冻结奖励
    const expiredWithDate: any[] = await this.prisma.$queryRaw`
      SELECT id, "userId", "accountId", amount, meta
      FROM "RewardLedger"
      WHERE status = 'FROZEN'
        AND "entryType" = 'FREEZE'
        AND meta IS NOT NULL
        AND (meta->>'expiresAt') IS NOT NULL
        AND (meta->>'expiresAt')::timestamp <= NOW()
        AND COALESCE(meta->>'scheme', '') NOT IN ('VIP_DIRECT_REFERRAL', 'NORMAL_DIRECT_REFERRAL')
        AND COALESCE(meta->>'accountType', '') NOT IN ('INDUSTRY_FUND', 'CHARITY_FUND', 'TECH_FUND', 'RESERVE_FUND', 'PLATFORM_PROFIT')
      LIMIT ${BATCH_SIZE}
    `;

    // 查询2: 无 expiresAt 的旧冻结奖励，基于 createdAt + maxFreezeDays 判断过期
    // 注：Prisma 将 JS number 映射为 PostgreSQL bigint，而 make_interval(days => int) 只接受 int 重载
    // PostgreSQL 18 对函数签名匹配更严格，必须显式 ::int 强制转换（PG 14 宽松会隐式转换）
    const expiredWithoutDate: any[] = await this.prisma.$queryRaw`
      SELECT id, "userId", "accountId", amount, meta
      FROM "RewardLedger"
      WHERE status = 'FROZEN'
        AND "entryType" = 'FREEZE'
        AND (meta IS NULL OR (meta->>'expiresAt') IS NULL)
        AND "createdAt" <= NOW() - MAKE_INTERVAL(days => ${maxFreezeDays}::int)
        AND COALESCE(meta->>'scheme', '') NOT IN ('VIP_DIRECT_REFERRAL', 'NORMAL_DIRECT_REFERRAL')
        AND COALESCE(meta->>'accountType', '') NOT IN ('INDUSTRY_FUND', 'CHARITY_FUND', 'TECH_FUND', 'RESERVE_FUND', 'PLATFORM_PROFIT')
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
   * 每 10 分钟检查普通/VIP 直推佣金 FROZEN → AVAILABLE。
   *
   * 直推佣金付款后立即冻结，必须等订单确认收货且退货窗口结束后，
   * 且没有成功售后，才释放给直推人。
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleVipDirectReferralRelease(): Promise<void> {
    this.logger.log('开始检查直推佣金冻结释放...');

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
      WHERE rl.status = 'FROZEN'
        AND rl."entryType" = 'FREEZE'
        AND rl."refType" = 'ORDER'
        AND rl.meta->>'scheme' IN ('VIP_DIRECT_REFERRAL', 'NORMAL_DIRECT_REFERRAL')
        AND o.status = 'RECEIVED'
        AND o."returnWindowExpiresAt" IS NOT NULL
        AND o."returnWindowExpiresAt" < NOW()
      LIMIT ${BATCH_SIZE}
    `;

    if (candidates.length === 0) {
      this.logger.log('无需释放的直推佣金');
      return;
    }

    const orderIds = [...new Set(candidates.map((candidate) => candidate.refId))];
    const afterSales = await this.prisma.afterSaleRequest.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, status: true },
    });

    const statusesByOrder = new Map<string, string[]>();
    for (const row of afterSales) {
      const list = statusesByOrder.get(row.orderId) ?? [];
      list.push(row.status);
      statusesByOrder.set(row.orderId, list);
    }

    const activeStatuses = new Set<string>([...ACTIVE_STATUSES]);
    const successStatuses = new Set<string>([...SUCCESS_STATUSES]);
    let released = 0;
    let voided = 0;
    let skipped = 0;
    let failed = 0;

    for (const candidate of candidates) {
      const statuses = statusesByOrder.get(candidate.refId) ?? [];
      if (statuses.some((status) => activeStatuses.has(status))) {
        skipped++;
        continue;
      }

      try {
        if (statuses.some((status) => successStatuses.has(status))) {
          await this.voidVipDirectReferralLedgerToPlatform(candidate);
          voided++;
        } else {
          await this.releaseVipDirectReferralLedger(candidate);
          released++;
        }
      } catch (err) {
        failed++;
        this.logger.error(
          `直推佣金释放处理失败：ledgerId=${candidate.id}, error=${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `直推佣金冻结释放完成：释放 ${released}，作废 ${voided}，跳过 ${skipped}，失败 ${failed}`,
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
    // 先在事务外确定账户类型 → 决定单次 CAS 的目标状态
    // 产业基金/慈善/科技/备用金/平台利润 → 直接 RETURN_FROZEN → AVAILABLE（无 FROZEN 中间态，避免被 handleFrozenExpire 误判）
    // VIP_REWARD / NORMAL_REWARD → RETURN_FROZEN → FROZEN（等解锁或 expiresAt 作废，原行为）
    const accountType = getAccountTypeForLedger(ledger.meta);
    const directToAvailable = NO_FURTHER_LOCK_TYPES.has(accountType);

    await this.prisma.$transaction(
      async (tx) => {
        // 单次 CAS：根据 accountType 决定一步到位写哪个状态
        const cas = await tx.rewardLedger.updateMany({
          where: {
            id: ledger.id,
            status: 'RETURN_FROZEN',
            entryType: 'FREEZE',
          },
          data: directToAvailable
            ? { status: 'AVAILABLE', entryType: 'RELEASE' }
            : { status: 'FROZEN' },
        });

        if (cas.count === 0) {
          this.logger.log(`奖励 ${ledger.id} 已非 RETURN_FROZEN 状态，跳过`);
          return;
        }

        // 更新对应账户字段
        await tx.rewardAccount.updateMany({
          where: { userId: ledger.userId, type: accountType as any },
          data: directToAvailable
            ? { balance: { increment: ledger.amount } }
            : { frozen: { increment: ledger.amount } },
        });

        this.logger.log(
          directToAvailable
            ? `RETURN_FROZEN→AVAILABLE（${accountType}）：ledger ${ledger.id}，${ledger.amount} 元，用户 ${ledger.userId}，balance +${ledger.amount}`
            : `RETURN_FROZEN→FROZEN：ledger ${ledger.id}，${ledger.amount} 元，用户 ${ledger.userId}，frozen +${ledger.amount}`,
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
    const scheme = meta?.scheme; // 仅用于审计 meta

    // 根据 meta 判断账户类型（兼容 INDUSTRY_FUND 等）
    const accountType = getAccountTypeForLedger(meta);

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

        await this.notificationService.emit({
          eventType: 'reward.expired',
          aggregateType: 'rewardLedger',
          aggregateId: ledger.id,
          idempotencyKey: `reward:${ledger.id}:expired`,
          actor: { kind: 'system' },
          payload: {
            ledgerId: ledger.id,
            userId: ledger.userId,
            amount: ledger.amount,
          },
        }, tx as any);
      },
      {
        timeout: 10000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  private async releaseVipDirectReferralLedger(
    ledger: { id: string; userId: string; accountId: string; amount: number; meta: any; refId: string },
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: ledger.refId },
          select: { status: true, returnWindowExpiresAt: true },
        });
        const now = new Date();
        if (
          !order ||
          order.status !== 'RECEIVED' ||
          !order.returnWindowExpiresAt ||
          order.returnWindowExpiresAt >= now
        ) {
          this.logger.log(`直推佣金 ${ledger.id} 订单状态或退货窗口未满足释放条件，跳过`);
          return;
        }

        const afterSales = await tx.afterSaleRequest.findMany({
          where: { orderId: ledger.refId },
          select: { status: true },
        });
        const activeStatuses = new Set<string>([...ACTIVE_STATUSES]);
        const successStatuses = new Set<string>([...SUCCESS_STATUSES]);
        if (
          afterSales.some((row) => activeStatuses.has(row.status)) ||
          afterSales.some((row) => successStatuses.has(row.status))
        ) {
          this.logger.log(`直推佣金 ${ledger.id} 事务内发现活跃/成功售后，跳过释放`);
          return;
        }

        const nextMeta = {
          ...(ledger.meta ?? {}),
          releasedAt: now.toISOString(),
          releaseReason: 'RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
        };

        const cas = await tx.rewardLedger.updateMany({
          where: {
            id: ledger.id,
            status: 'FROZEN',
            entryType: 'FREEZE',
          },
          data: {
            status: 'AVAILABLE',
            entryType: 'RELEASE',
            meta: nextMeta,
          },
        });

        if (cas.count === 0) {
          this.logger.log(`直推佣金 ${ledger.id} 已非 FROZEN/FREEZE 状态，跳过释放`);
          return;
        }

        const accountCas = await tx.rewardAccount.updateMany({
          where: { id: ledger.accountId, frozen: { gte: ledger.amount } },
          data: {
            frozen: { decrement: ledger.amount },
            balance: { increment: ledger.amount },
          },
        });

        if (accountCas.count === 0) {
          throw new Error(`直推佣金释放账户冻结余额不足：accountId=${ledger.accountId}`);
        }
      },
      {
        timeout: 10000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  private async voidVipDirectReferralLedgerToPlatform(
    ledger: { id: string; userId: string; accountId: string; amount: number; meta: any; refId: string },
  ): Promise<void> {
    const originalScheme = this.readDirectReferralOriginalScheme(ledger.meta);
    const voidScheme = this.getDirectReferralVoidScheme(originalScheme);
    const nextMeta = {
      ...(ledger.meta ?? {}),
      voidedAt: new Date().toISOString(),
      voidReason: 'SUCCESS_AFTER_SALE_BACKSTOP',
    };

    await this.prisma.$transaction(
      async (tx) => {
        const cas = await tx.rewardLedger.updateMany({
          where: {
            id: ledger.id,
            status: 'FROZEN',
            entryType: 'FREEZE',
          },
          data: {
            status: 'VOIDED',
            entryType: 'VOID',
            meta: nextMeta,
          },
        });

        if (cas.count === 0) {
          this.logger.log(`直推佣金 ${ledger.id} 已非 FROZEN/FREEZE 状态，跳过作废`);
          return;
        }

        const accountCas = await tx.rewardAccount.updateMany({
          where: { id: ledger.accountId, frozen: { gte: ledger.amount } },
          data: { frozen: { decrement: ledger.amount } },
        });
        if (accountCas.count === 0) {
          throw new Error(`直推佣金作废账户冻结余额不足：accountId=${ledger.accountId}`);
        }

        let platformAccount = await tx.rewardAccount.findUnique({
          where: { userId_type: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' } },
        });
        if (!platformAccount) {
          platformAccount = await tx.rewardAccount.create({
            data: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' },
          });
        }

        const sourceMeta = (ledger.meta ?? {}) as Record<string, any>;
        const mirrorMeta: Record<string, any> = {
          scheme: voidScheme,
          originalScheme,
          accountType: 'PLATFORM_PROFIT',
          routedToPlatform: true,
          originalLedgerId: ledger.id,
          originalReceiverUserId: ledger.userId,
          sourceOrderId: sourceMeta.sourceOrderId ?? ledger.refId,
          voidSource: 'SUCCESS_AFTER_SALE_BACKSTOP',
          reason: originalScheme === 'NORMAL_DIRECT_REFERRAL'
            ? '售后成功兜底作废，普通直推佣金归平台'
            : '售后成功兜底作废，VIP直推佣金归平台',
        };
        for (const key of DIRECT_REFERRAL_AUDIT_COPY_KEYS) {
          if (sourceMeta[key] !== undefined) {
            mirrorMeta[key] = sourceMeta[key];
          }
        }

        await tx.rewardLedger.create({
          data: {
            accountId: platformAccount.id,
            userId: PLATFORM_USER_ID,
            entryType: 'RELEASE',
            amount: ledger.amount,
            status: 'AVAILABLE',
            refType: 'AFTER_SALE',
            refId: ledger.refId,
            meta: mirrorMeta,
          },
        });

        await tx.rewardAccount.update({
          where: { id: platformAccount.id },
          data: { balance: { increment: ledger.amount } },
        });
      },
      {
        timeout: 10000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  private readDirectReferralOriginalScheme(meta: any): 'VIP_DIRECT_REFERRAL' | 'NORMAL_DIRECT_REFERRAL' {
    const scheme = meta?.scheme;
    if (scheme === 'NORMAL_DIRECT_REFERRAL') {
      return 'NORMAL_DIRECT_REFERRAL';
    }
    return DIRECT_REFERRAL_ORIGINAL_SCHEMES.has(scheme)
      ? scheme
      : 'VIP_DIRECT_REFERRAL';
  }

  private getDirectReferralVoidScheme(
    originalScheme: 'VIP_DIRECT_REFERRAL' | 'NORMAL_DIRECT_REFERRAL',
  ): 'VIP_DIRECT_REFERRAL_VOID' | 'NORMAL_DIRECT_REFERRAL_VOID' {
    return originalScheme === 'NORMAL_DIRECT_REFERRAL'
      ? 'NORMAL_DIRECT_REFERRAL_VOID'
      : 'VIP_DIRECT_REFERRAL_VOID';
  }
}
