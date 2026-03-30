import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService, BonusConfig } from './bonus-config.service';
import { NormalBroadcastService } from './normal-broadcast.service';
import { VipUpstreamService } from './vip-upstream.service';
import { PlatformSplitService } from './platform-split.service';
import { VipPlatformSplitService } from './vip-platform-split.service';
import { NormalUpstreamService } from './normal-upstream.service';
import { NormalPlatformSplitService } from './normal-platform-split.service';
import { RewardCalculatorService, OrderItemForCalc, OrderItemForPoolCalc, OrderItemForNormalCalc, PoolCalculation, NormalPoolCalculation, VipPoolCalculation } from './reward-calculator.service';
import { sanitizeErrorForLog } from '../../../common/logging/log-sanitizer';
import { NORMAL_ROOT_ID, MAX_BFS_ITERATIONS, MAX_TREE_DEPTH, BONUS_MIGRATION_DATE } from './constants';

/** 分流路由结果 */
type RoutingDecision = 'NORMAL_BROADCAST' | 'NORMAL_TREE' | 'VIP_UPSTREAM' | 'VIP_EXITED';

@Injectable()
export class BonusAllocationService {
  private readonly logger = new Logger(BonusAllocationService.name);

  constructor(
    private prisma: PrismaService,
    private configService: BonusConfigService,
    private calculator: RewardCalculatorService,
    private normalBroadcast: NormalBroadcastService,
    private vipUpstream: VipUpstreamService,
    private platformSplit: PlatformSplitService,
    private vipPlatformSplit: VipPlatformSplitService,
    private normalUpstream: NormalUpstreamService,
    private normalPlatformSplit: NormalPlatformSplitService,
  ) {}

  /**
   * 订单确认收货后触发分润分配（主入口）
   * 全流程在一个事务中执行，保证原子性
   */
  async allocateForOrder(orderId: string): Promise<void> {
    this.logger.log(`开始分润分配：订单 ${orderId}`);

    // 1. 查询订单（含商品成本）
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            sku: {
              select: {
                cost: true, // SKU 自身的成本字段优先
                product: { select: { cost: true } },
              },
            },
          },
        },
      },
    });

    if (!order) {
      this.logger.warn(`订单 ${orderId} 不存在，跳过分配`);
      return;
    }

    // Phase 4：VIP 礼包订单不参与分润（不创建有效消费记录、不递增 selfPurchaseCount）
    if (order.bizType === 'VIP_PACKAGE') {
      this.logger.log(`订单 ${orderId} 为 VIP_PACKAGE，跳过分润分配`);
      return;
    }

    if (order.status !== 'RECEIVED') {
      this.logger.warn(`订单 ${orderId} 状态为 ${order.status}，非 RECEIVED，跳过`);
      return;
    }

    // 2. 读取当前分润配置
    const config = await this.configService.getConfig();

    // 3. 构建订单项（含 companyId，用于普通用户六分计算）
    //    排除抽奖奖品项（isPrize=true），奖品不产生利润不参与分配
    const calcItems: OrderItemForPoolCalc[] = order.items
      .filter((item) => !item.isPrize)
      .map((item) => ({
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        cost: item.sku?.cost ?? item.sku?.product?.cost ?? null,
        companyId: item.companyId ?? null,
      }));

    // 4. 分流判定（先于零利润判断，确保使用正确的公式）
    const routing = await this.determineRouting(order.userId, order.createdAt);
    this.logger.log(`订单 ${orderId} 分流结果：${routing}`);

    // 5. 根据路由结果选择正确的 calculator 做零利润判断
    let pools: PoolCalculation | null = null;
    let vipPools: VipPoolCalculation | null = null;
    let isZeroProfit = false;

    if (routing === 'NORMAL_TREE') {
      // 普通树使用六分公式判断利润
      const normalPools = this.calculator.calculateNormal(calcItems, config);
      isZeroProfit = normalPools.profit <= 0;
    } else if (routing === 'VIP_UPSTREAM' || routing === 'VIP_EXITED') {
      // VIP 路由使用新的六分公式
      vipPools = this.calculator.calculateVip(calcItems, config);
      isZeroProfit = vipPools.profit <= 0;
    } else {
      // NORMAL_BROADCAST 遗留路径使用旧公式
      pools = this.calculator.calculate(calcItems, config);
      isZeroProfit = pools.rewardPool <= 0;
    }

    // M03 修复：零利润订单创建幂等标记记录，防止系统重启后重复检查
    if (isZeroProfit) {
      const zeroKey = `ALLOC:ORDER_RECEIVED:${orderId}:ZERO_PROFIT`;
      const existing = await this.prisma.rewardAllocation.findFirst({
        where: { idempotencyKey: zeroKey },
      });
      if (!existing) {
        try {
          await this.prisma.rewardAllocation.create({
            data: {
              triggerType: 'ORDER_RECEIVED',
              orderId,
              ruleType: 'ZERO_PROFIT',
              ruleVersion: config.ruleVersion,
              meta: { reason: '订单利润为零，无分润', routing },
              idempotencyKey: zeroKey,
            },
          });
          this.logger.log(`订单 ${orderId} 利润为零（路由=${routing}），已创建标记记录`);
        } catch (err: any) {
          // 并发场景：唯一约束拦截
          if (err?.code === 'P2002') {
            this.logger.warn(`订单 ${orderId} 零利润标记已被并发创建，跳过`);
          } else {
            throw err;
          }
        }
      } else {
        this.logger.log(`订单 ${orderId} 零利润标记已存在，跳过`);
      }
      return;
    }

    // 6. 幂等保护：各分配方法使用精确幂等键（NORMAL_BROADCAST / VIP_UPSTREAM / PLATFORM_SPLIT），
    //    并发场景由 P2002 唯一约束违反兜底（见下方 catch 块）

    // 6-8. 在事务中执行分配
    // H06 修复：添加超时、隔离级别和完善的错误处理（含死锁重试）
    let vipAncestorUserId: string | null = null;
    const MAX_RETRIES = 1; // P2034 死锁/超时最多重试 1 次

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            // 6. 路由到对应分配服务
            if (routing === 'VIP_UPSTREAM') {
              const resolvedVipPools = vipPools!;
              vipAncestorUserId = await this.executeVipUpstreamSixWay(tx, orderId, order.userId, order.totalAmount, resolvedVipPools, config);
              // VIP 平台六分分润（默认50/10/2/2/6，可配置）
              await this.executeVipPlatformSplit(tx, orderId, resolvedVipPools, config.ruleVersion);
            } else if (routing === 'VIP_EXITED') {
              // VIP 已退出（解锁完毕），仍是VIP身份，奖励归平台（不回普通树）
              const resolvedVipPools = vipPools!;
              const exitedKey = `ALLOC:ORDER_RECEIVED:${orderId}:VIP_EXITED`;
              await tx.rewardAllocation.create({
                data: {
                  triggerType: 'ORDER_RECEIVED',
                  orderId,
                  ruleType: 'VIP_UPSTREAM',
                  ruleVersion: config.ruleVersion,
                  meta: {
                    routing: 'VIP_EXITED',
                    userId: order.userId,
                    reason: 'VIP用户已完成全部层级解锁并退出，奖励归平台',
                    profit: resolvedVipPools.profit,
                    rewardPool: resolvedVipPools.rewardPool,
                  },
                  idempotencyKey: exitedKey,
                },
              });
              if (resolvedVipPools.rewardPool > 0) {
                await this.normalUpstream.creditToPlatform(
                  tx, exitedKey, orderId, resolvedVipPools.rewardPool, 'vip_exited',
                );
              }
              await this.executeVipPlatformSplit(tx, orderId, resolvedVipPools, config.ruleVersion);
            } else if (routing === 'NORMAL_TREE') {
              // 普通树分配：六分计算 + 奖励上溯 + 平台五池分割
              await this.executeNormalTree(tx, orderId, order.userId, order.totalAmount, calcItems, config);
            } else {
              // 向后兼容：旧的 NORMAL_BROADCAST
              const resolvedPools = pools!;
              await this.executeNormalBroadcast(tx, orderId, order.userId, order.totalAmount, resolvedPools, config);
              await this.executePlatformSplit(tx, orderId, resolvedPools, config.ruleVersion);
            }
          },
          {
            timeout: 30000,                                    // 事务超时 30 秒
            maxWait: 5000,                                     // 等待连接池最多 5 秒
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable, // 可序列化隔离级别
          },
        );
        // 事务成功，跳出重试循环
        break;
      } catch (err: any) {
        const isPrismaError = err instanceof Prisma.PrismaClientKnownRequestError;

        // 幂等保护：并发请求可能通过事务外的检查，被 @unique 约束拦截
        if (isPrismaError && err.code === 'P2002' && (err?.meta?.target as string[])?.includes('idempotencyKey')) {
          this.logger.warn(`订单 ${orderId} 并发重复分配被唯一约束拦截，跳过`);
          return;
        }

        // P2034：事务冲突或写冲突（Serializable 隔离级别下常见）——可重试
        if (isPrismaError && err.code === 'P2034') {
          if (attempt < MAX_RETRIES) {
            this.logger.warn(
              `订单 ${orderId} 分润事务冲突（P2034），第 ${attempt + 1} 次重试...`,
            );
            // 短暂随机退避后重试，避免并发再次冲突
            await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
            continue;
          }
          // 重试耗尽仍失败
          this.logger.error(
            `订单 ${orderId} 分润事务冲突（P2034）重试耗尽，分配失败`,
          );
          throw new InternalServerErrorException('分润分配暂时繁忙，请稍后重试');
        }

        // P2028：事务 API 错误（底层连接中断等不可恢复错误）
        if (isPrismaError && err.code === 'P2028') {
          this.logger.error(
            `订单 ${orderId} 分润事务 API 错误（P2028）：${err.message}`,
          );
          throw new InternalServerErrorException('分润分配服务异常，请联系管理员');
        }

        // 其他未预期错误直接抛出
        throw err;
      }
    }

    // 8. 异步出局判定（不阻塞主流程）
    if (vipAncestorUserId) {
      this.vipUpstream.checkExit(vipAncestorUserId, config).catch((err) => {
        const safeErr = sanitizeErrorForLog(err);
        this.logger.error(`出局判定失败: ${safeErr.message}`, safeErr.stack);
      });
    }

    this.logger.log(`订单 ${orderId} 分润分配完成（${routing}）`);
  }

  /**
   * 退款回滚：作废该订单的所有分润记录
   */
  async rollbackForOrder(orderId: string): Promise<void> {
    this.logger.log(`开始退款回滚：订单 ${orderId}`);

    const refundKey = `ALLOC:REFUND:${orderId}`;

    // 查询该订单的所有分配记录
    const allocations = await this.prisma.rewardAllocation.findMany({
      where: { orderId },
      include: { ledgers: true },
    });

    if (allocations.length === 0) {
      this.logger.log(`订单 ${orderId} 无分润记录，跳过回滚`);
      return;
    }

    const MAX_ROLLBACK_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_ROLLBACK_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
        // 创建退款回滚的 RewardAllocation
        await tx.rewardAllocation.create({
          data: {
            triggerType: 'REFUND',
            orderId,
            ruleType: 'NORMAL_BROADCAST', // 标识用，实际是回滚
            ruleVersion: 'rollback',
            meta: { rollbackAllocations: allocations.map((a) => a.id) },
            idempotencyKey: refundKey,
          },
        });

        // 批量作废 Ledger 并按 accountId 聚合回扣余额（替代双重嵌套循环）
        const nonVoidedLedgers = allocations
          .flatMap((a) => a.ledgers)
          .filter((l: any) => l.status !== 'VOIDED');

        if (nonVoidedLedgers.length > 0) {
          // 仅回滚可逆状态（AVAILABLE/FROZEN/RETURN_FROZEN）。WITHDRAWN 等状态保留，后续走追缴流程。
          const reversibleLedgers = nonVoidedLedgers.filter((l: any) =>
            l.status === 'AVAILABLE' || l.status === 'FROZEN' || l.status === 'RETURN_FROZEN',
          );
          const withdrawnLedgers = nonVoidedLedgers.filter((l: any) => l.status === 'WITHDRAWN');

          if (withdrawnLedgers.length > 0) {
            this.logger.warn(
              `订单 ${orderId} 存在 ${withdrawnLedgers.length} 条已提现分润流水，保留 WITHDRAWN 状态等待追缴`,
            );
          }

          // 1. 批量作废可逆状态的 ledger（N×M → 1 次）
          if (reversibleLedgers.length > 0) {
            const ledgerIds = reversibleLedgers.map((l: any) => l.id);
            await tx.rewardLedger.updateMany({
              where: {
                id: { in: ledgerIds },
                status: { in: ['AVAILABLE', 'FROZEN', 'RETURN_FROZEN'] }, // S18修复：限定来源状态
              },
              data: { status: 'VOIDED', entryType: 'VOID' },
            });
          }

          // 2. 按 accountId 聚合 AVAILABLE 和 FROZEN 金额
          // RETURN_FROZEN 未计入 RewardAccount（对用户不可见），无需扣减账户
          const availableByAccount = new Map<string, number>();
          const frozenByAccount = new Map<string, number>();
          for (const ledger of nonVoidedLedgers) {
            if ((ledger as any).status === 'AVAILABLE') {
              availableByAccount.set(
                (ledger as any).accountId,
                (availableByAccount.get((ledger as any).accountId) ?? 0) + (ledger as any).amount,
              );
            } else if ((ledger as any).status === 'FROZEN') {
              frozenByAccount.set(
                (ledger as any).accountId,
                (frozenByAccount.get((ledger as any).accountId) ?? 0) + (ledger as any).amount,
              );
            }
            // RETURN_FROZEN: 已作废但无需扣减账户（分配时未计入 frozen）
          }

          // 3. 每个 account 一次 balance decrement
          for (const [accountId, amount] of availableByAccount) {
            const cas = await tx.rewardAccount.updateMany({
              where: { id: accountId, balance: { gte: amount } },
              data: { balance: { decrement: amount } },
            });
            if (cas.count === 0) {
              const account = await tx.rewardAccount.findUnique({
                where: { id: accountId },
                select: { balance: true },
              });
              this.logger.error(
                `[M2] 回滚扣减可用余额失败：accountId=${accountId}, amount=${amount}, balance=${account?.balance ?? 'N/A'}`,
              );
              throw new InternalServerErrorException('分润回滚账户余额异常，请联系管理员');
            }
          }

          // 4. 每个 account 一次 frozen decrement（CAS 守卫，避免并发/脏数据导致负数）
          for (const [accountId, amount] of frozenByAccount) {
            const cas = await tx.rewardAccount.updateMany({
              where: { id: accountId, frozen: { gte: amount } },
              data: { frozen: { decrement: amount } },
            });
            if (cas.count === 0) {
              const account = await tx.rewardAccount.findUnique({
                where: { id: accountId },
                select: { frozen: true },
              });
              this.logger.error(
                `[M2] 回滚扣减冻结余额失败：accountId=${accountId}, amount=${amount}, frozen=${account?.frozen ?? 'N/A'}`,
              );
              throw new InternalServerErrorException('分润回滚冻结余额异常，请联系管理员');
            }
          }
        }

        // VIP 有效消费作废 + 回扣 selfPurchaseCount（P0-3A）
        const vipOrder = await tx.vipEligibleOrder.findUnique({
          where: { orderId },
        });
        if (vipOrder && vipOrder.valid) {
          await tx.vipEligibleOrder.update({
            where: { id: vipOrder.id },
            data: { valid: false, invalidReason: 'REFUND' },
          });
          // 回扣 VipProgress.selfPurchaseCount
          await tx.vipProgress.updateMany({
            where: { userId: vipOrder.userId, selfPurchaseCount: { gt: 0 } },
            data: { selfPurchaseCount: { decrement: 1 } },
          });
        }

        // 普通广播队列失效（P0-3B）
        await tx.normalQueueMember.updateMany({
          where: { orderId },
          data: { active: false },
        });

        // 普通树有效消费作废 + 回扣 selfPurchaseCount
        const normalOrder = await tx.normalEligibleOrder.findUnique({
          where: { orderId },
        });
        if (normalOrder && normalOrder.valid) {
          await tx.normalEligibleOrder.update({
            where: { id: normalOrder.id },
            data: { valid: false },
          });
          // 回扣 NormalProgress.selfPurchaseCount（CAS: gt:0 防负数）
          const normalCas = await tx.normalProgress.updateMany({
            where: { userId: normalOrder.userId, selfPurchaseCount: { gt: 0 } },
            data: { selfPurchaseCount: { decrement: 1 } },
          });
          if (normalCas.count === 0) {
            this.logger.warn(
              `普通树回滚：用户 ${normalOrder.userId} selfPurchaseCount 已为 0，跳过回扣`,
            );
          }
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (err: any) {
        if (err?.code === 'P2002' && err?.meta?.target?.includes('idempotencyKey')) {
          this.logger.warn(`订单 ${orderId} 并发重复回滚被唯一约束拦截，跳过`);
          return;
        }
        if (err?.code === 'P2034') {
          if (attempt < MAX_ROLLBACK_RETRIES) {
            this.logger.warn(
              `订单 ${orderId} 退款回滚事务冲突（P2034），第 ${attempt + 1} 次重试...`,
            );
            await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
            continue;
          }
          this.logger.error(`订单 ${orderId} 退款回滚事务冲突（P2034）重试耗尽`);
          throw new InternalServerErrorException('退款回滚暂时繁忙，请稍后重试');
        }
        throw err;
      }
    }

    // 结构化审计：记录回滚摘要到日志（AdminAuditLog 需 adminUserId FK，
    // 退款回滚由系统/买家触发无 admin 上下文，使用 Logger 结构化记录替代）
    const voidedCount = allocations.reduce(
      (sum, a) => sum + a.ledgers.filter((l: any) => ['AVAILABLE', 'FROZEN'].includes(l.status)).length,
      0,
    );
    const totalAmount = allocations.reduce(
      (sum, a) =>
        sum + a.ledgers
          .filter((l: any) => ['AVAILABLE', 'FROZEN'].includes(l.status))
          .reduce((s: number, l: any) => s + l.amount, 0),
      0,
    );
    this.logger.warn(
      `[AUDIT] 订单 ${orderId} 退款回滚完成 — 作废 ${voidedCount} 条流水，回扣 ${totalAmount} 元，` +
      `涉及 ${allocations.length} 个 Allocation: [${allocations.map((a) => a.id).join(', ')}]`,
    );
  }

  /**
   * 分流判定逻辑：
   * - 旧订单（createdAt < BONUS_MIGRATION_DATE）且非 VIP → NORMAL_BROADCAST
   * - VIP 会员 + 未退出 → VIP_UPSTREAM（所有金额均走VIP树分配）
   * - VIP 会员 + 已退出 → VIP_EXITED（奖励归平台）
   * - 其他情况 → NORMAL_TREE
   */
  private async determineRouting(
    userId: string,
    orderCreatedAt: Date,
  ): Promise<RoutingDecision> {
    // 查买家会员信息
    const member = await this.prisma.memberProfile.findUnique({
      where: { userId },
    });

    // 非 VIP 用户的旧订单走 NORMAL_BROADCAST（迁移日期之前）
    if ((!member || member.tier !== 'VIP') && orderCreatedAt < BONUS_MIGRATION_DATE) {
      return 'NORMAL_BROADCAST';
    }

    if (!member || member.tier !== 'VIP') {
      return 'NORMAL_TREE';
    }

    // VIP 已退出（解锁完 15 层）：仍然是 VIP 身份，不回普通树，奖励归平台
    // 需求文档第9条："成为VIP后不再参与普通奖励"
    const vipProgress = await this.prisma.vipProgress.findUnique({
      where: { userId },
    });

    if (vipProgress?.exitedAt) {
      return 'VIP_EXITED';
    }

    return 'VIP_UPSTREAM';
  }

  /**
   * 执行普通广播分配
   * 创建 RewardAllocation 后调用 NormalBroadcastService 完成滑动窗口分配
   */
  private async executeNormalBroadcast(
    tx: any,
    orderId: string,
    userId: string,
    orderAmount: number,
    pools: PoolCalculation,
    config: import('./bonus-config.service').BonusConfig,
  ): Promise<void> {
    const idempotencyKey = `ALLOC:ORDER_RECEIVED:${orderId}:NORMAL_BROADCAST`;

    const allocation = await tx.rewardAllocation.create({
      data: {
        triggerType: 'ORDER_RECEIVED',
        orderId,
        ruleType: 'NORMAL_BROADCAST',
        ruleVersion: config.ruleVersion,
        meta: {
          routing: 'NORMAL_BROADCAST',
          userId,
          profit: pools.profit,
          rebatePool: pools.rebatePool,
          rewardPool: pools.rewardPool,
          configSnapshot: pools.configSnapshot,
        },
        idempotencyKey,
      },
    });

    // 调用普通广播分配服务
    const distributed = await this.normalBroadcast.distribute(
      tx,
      allocation.id,
      orderId,
      userId,
      orderAmount,
      pools.rewardPool,
      config,
    );

    this.logger.log(`普通广播分配完成：${idempotencyKey}，分配 ${distributed}/${pools.rewardPool} 元`);
  }

  /**
   * 执行 VIP 上溯分配（六分公式版本）
   * 创建 RewardAllocation 后调用 VipUpstreamService 完成祖先分配
   * 若 k > VIP_MAX_LAYERS 则奖励归平台
   */
  private async executeVipUpstreamSixWay(
    tx: any,
    orderId: string,
    userId: string,
    orderAmount: number,
    pools: VipPoolCalculation,
    config: import('./bonus-config.service').BonusConfig,
  ): Promise<string | null> {
    const idempotencyKey = `ALLOC:ORDER_RECEIVED:${orderId}:VIP_UPSTREAM`;

    const allocation = await tx.rewardAllocation.create({
      data: {
        triggerType: 'ORDER_RECEIVED',
        orderId,
        ruleType: 'VIP_UPSTREAM',
        ruleVersion: config.ruleVersion,
        meta: {
          routing: 'VIP_UPSTREAM',
          userId,
          profit: pools.profit,
          rewardPool: pools.rewardPool,
          configSnapshot: pools.configSnapshot,
        },
        idempotencyKey,
      },
    });

    const { result, ancestorUserId } = await this.vipUpstream.distribute(
      tx,
      allocation.id,
      orderId,
      userId,
      orderAmount,
      pools.rewardPool,
      config,
    );

    // VIP k > maxLayers：奖励归平台（不降级到普通广播，VIP/Normal 完全隔离）
    if (result === 'downgrade_normal') {
      this.logger.log(`VIP 上溯超出最大层级，奖励归平台：订单 ${orderId}`);
      if (pools.rewardPool > 0) {
        await this.normalUpstream.creditToPlatform(
          tx, allocation.id, orderId, pools.rewardPool, 'vip_over_max_layers',
        );
      }
    }

    this.logger.log(`VIP 上溯完成（六分）：${idempotencyKey}，结果=${result}`);
    return ancestorUserId;
  }

  /**
   * 执行 VIP 平台六分分割
   * 处理除奖励外的 5 个池（platformProfit / industryFund / charityFund / techFund / reserveFund）
   */
  private async executeVipPlatformSplit(
    tx: any,
    orderId: string,
    pools: VipPoolCalculation,
    ruleVersion: string,
  ): Promise<void> {
    const idempotencyKey = `ALLOC:ORDER_RECEIVED:${orderId}:VIP_PLATFORM_SPLIT`;

    const allocation = await tx.rewardAllocation.create({
      data: {
        triggerType: 'ORDER_RECEIVED',
        orderId,
        ruleType: 'VIP_PLATFORM_SPLIT',
        ruleVersion,
        meta: {
          platformProfit: pools.platformProfit,
          industryFund: pools.industryFund,
          charityFund: pools.charityFund,
          techFund: pools.techFund,
          reserveFund: pools.reserveFund,
          configSnapshot: pools.configSnapshot,
        },
        idempotencyKey,
      },
    });

    await this.vipPlatformSplit.split(tx, allocation.id, orderId, {
      platformProfit: pools.platformProfit,
      industryFund: pools.industryFund,
      charityFund: pools.charityFund,
      techFund: pools.techFund,
      reserveFund: pools.reserveFund,
    }, pools.companyProfitShares);

    this.logger.log(
      `VIP平台六分完成：platform=${pools.platformProfit}，industry=${pools.industryFund}，charity=${pools.charityFund}，tech=${pools.techFund}，reserve=${pools.reserveFund}`,
    );
  }

  /**
   * 执行 VIP 上溯分配
   * 创建 RewardAllocation 后调用 VipUpstreamService 完成祖先分配
   * 若 k > VIP_MAX_LAYERS 则降级为普通广播
   * @deprecated 使用 executeVipUpstreamSixWay() 替代
   */
  private async executeVipUpstream(
    tx: any,
    orderId: string,
    userId: string,
    orderAmount: number,
    pools: PoolCalculation,
    config: import('./bonus-config.service').BonusConfig,
  ): Promise<string | null> {
    const idempotencyKey = `ALLOC:ORDER_RECEIVED:${orderId}:VIP_UPSTREAM`;

    const allocation = await tx.rewardAllocation.create({
      data: {
        triggerType: 'ORDER_RECEIVED',
        orderId,
        ruleType: 'VIP_UPSTREAM',
        ruleVersion: config.ruleVersion,
        meta: {
          routing: 'VIP_UPSTREAM',
          userId,
          profit: pools.profit,
          rebatePool: pools.rebatePool,
          rewardPool: pools.rewardPool,
          configSnapshot: pools.configSnapshot,
        },
        idempotencyKey,
      },
    });

    const { result, ancestorUserId } = await this.vipUpstream.distribute(
      tx,
      allocation.id,
      orderId,
      userId,
      orderAmount,
      pools.rewardPool,
      config,
    );

    // VIP k > maxLayers：奖励归平台（不降级到普通广播，VIP/Normal 完全隔离）
    if (result === 'downgrade_normal') {
      this.logger.log(`VIP 上溯超出最大层级，奖励归平台：订单 ${orderId}`);
      if (pools.rewardPool > 0) {
        await this.normalUpstream.creditToPlatform(
          tx, allocation.id, orderId, pools.rewardPool, 'vip_over_max_layers',
        );
      }
    }

    this.logger.log(`VIP 上溯完成：${idempotencyKey}，结果=${result}`);
    return ancestorUserId;
  }

  /**
   * 执行平台分润
   * 创建 RewardAllocation 后调用 PlatformSplitService 完成入账
   * @deprecated VIP 路由已改用 executeVipPlatformSplit()。仅 NORMAL_BROADCAST 遗留路径使用。
   */
  private async executePlatformSplit(
    tx: any,
    orderId: string,
    pools: PoolCalculation,
    ruleVersion: string,
  ): Promise<void> {
    const idempotencyKey = `ALLOC:ORDER_RECEIVED:${orderId}:PLATFORM_SPLIT`;

    const allocation = await tx.rewardAllocation.create({
      data: {
        triggerType: 'ORDER_RECEIVED',
        orderId,
        ruleType: 'PLATFORM_SPLIT',
        ruleVersion,
        meta: {
          platformPool: pools.platformPool,
          fundPool: pools.fundPool,
          pointsPool: pools.pointsPool,
          configSnapshot: pools.configSnapshot,
        },
        idempotencyKey,
      },
    });

    await this.platformSplit.split(tx, allocation.id, orderId, {
      platformPool: pools.platformPool,
      fundPool: pools.fundPool,
      pointsPool: pools.pointsPool,
    });

    this.logger.log(
      `平台分润完成：platform=${pools.platformPool}，fund=${pools.fundPool}，points=${pools.pointsPool}`,
    );
  }

  /**
   * 执行普通树分配
   * 1. 确保用户入树
   * 2. 六分利润计算
   * 3. 奖励 16% 上溯分配
   * 4. 其余 5 池平台分割
   */
  private async executeNormalTree(
    tx: any,
    orderId: string,
    userId: string,
    orderAmount: number,
    items: OrderItemForNormalCalc[],
    config: BonusConfig,
  ): Promise<void> {
    // 1. 确保用户入树（首次消费自动加入普通树）
    await this.ensureNormalTreeEnrollment(tx, userId, config);

    // 2. 六分利润计算
    const normalPools = this.calculator.calculateNormal(items, config);

    if (normalPools.profit <= 0) {
      this.logger.log(`订单 ${orderId} 普通树利润为零，跳过分配`);
      return;
    }

    // 3. 创建 RewardAllocation
    const idempotencyKey = `ALLOC:ORDER_RECEIVED:${orderId}:NORMAL_TREE`;
    const allocation = await tx.rewardAllocation.create({
      data: {
        triggerType: 'ORDER_RECEIVED',
        orderId,
        ruleType: 'NORMAL_TREE',
        ruleVersion: config.ruleVersion,
        meta: {
          routing: 'NORMAL_TREE',
          userId,
          profit: normalPools.profit,
          pools: {
            platformProfit: normalPools.platformProfit,
            rewardPool: normalPools.rewardPool,
            industryFund: normalPools.industryFund,
            charityFund: normalPools.charityFund,
            techFund: normalPools.techFund,
            reserveFund: normalPools.reserveFund,
          },
          configSnapshot: normalPools.configSnapshot,
        },
        idempotencyKey,
      },
    });

    // 4. 奖励 16% 上溯分配
    const { result } = await this.normalUpstream.distribute(
      tx, allocation.id, orderId, userId, orderAmount, normalPools.rewardPool, config,
    );
    this.logger.log(`普通树奖励分配完成：${idempotencyKey}，结果=${result}`);

    // 5. 其余 5 池平台分割
    await this.normalPlatformSplit.split(
      tx, allocation.id, orderId,
      {
        platformProfit: normalPools.platformProfit,
        industryFund: normalPools.industryFund,
        charityFund: normalPools.charityFund,
        techFund: normalPools.techFund,
        reserveFund: normalPools.reserveFund,
      },
      normalPools.companyProfitShares,
    );

    this.logger.log(`普通树分配全部完成：订单 ${orderId}，利润 ${normalPools.profit} 元`);
  }

  /**
   * 确保用户已加入普通树
   * 首次消费时自动创建 NormalProgress + 分配树节点
   */
  private async ensureNormalTreeEnrollment(
    tx: any,
    userId: string,
    config: BonusConfig,
  ): Promise<void> {
    let progress = await tx.normalProgress.findUnique({ where: { userId } });

    if (!progress) {
      // 创建 NormalProgress
      progress = await tx.normalProgress.create({
        data: { userId },
      });

      // 分配普通树节点（轮询平衡插入）
      await this.assignNormalTreeNodeInline(tx, userId, config);
      this.logger.log(`用户 ${userId} 首次入普通树，已分配节点`);
    } else if (!progress.treeNodeId) {
      // 有进度但无节点（异常恢复）
      await this.assignNormalTreeNodeInline(tx, userId, config);
      this.logger.log(`用户 ${userId} 普通树进度存在但无节点，已补充分配`);
    }
  }

  /**
   * 普通树轮询平衡插入算法（内联避免循环依赖）
   *
   * 单棵树、单个平台根节点（NORMAL_ROOT），按层级从上到下、按位置从左到右依次填充。
   * 为避免并发下位置争抢导致 parent.childrenCount 漂移，使用事务级 advisory lock 串行插入。
   * 算法：
   * 1. 从 level=1 开始搜索活跃层
   * 2. nodeCount = 当前层节点数, parentCount = 上层节点数
   * 3. maxNodes = parentCount × branchFactor
   * 4. 若 nodeCount < maxNodes → 活跃层
   *    - round = floor(nodeCount / parentCount)
   *    - parentIndex = nodeCount % parentCount
   *    - 获取上层父节点（按 createdAt 排序）[parentIndex]
   *    - position = round
   *    - 先创建 NormalTreeNode，再原子递增 parent.childrenCount
   *    - 更新 MemberProfile.normalTreeNodeId + normalJoinedAt
   *    - 更新 NormalProgress.treeNodeId
   * 5. 层满则 level++ 继续
   */
  private async assignNormalTreeNodeInline(
    tx: any,
    userId: string,
    config: BonusConfig,
  ): Promise<void> {
    const branchFactor = config.normalBranchFactor;

    // 串行化普通树插入：避免并发扫描同一空位导致 position 冲突和 childrenCount 漂移
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(2026022801)');

    // 确保普通树根节点存在
    let rootNode = await tx.normalTreeNode.findFirst({
      where: { rootId: NORMAL_ROOT_ID, level: 0 },
    });
    if (!rootNode) {
      rootNode = await tx.normalTreeNode.create({
        data: { rootId: NORMAL_ROOT_ID, userId: null, level: 0, position: 0 },
      });
      this.logger.log('创建普通树根节点 NORMAL_ROOT');
    }

    // 从 level=1 开始逐层搜索
    for (let level = 1; level <= MAX_TREE_DEPTH; level++) {
      const nodeCount = await tx.normalTreeNode.count({
        where: { rootId: NORMAL_ROOT_ID, level },
      });
      const parentCount = await tx.normalTreeNode.count({
        where: { rootId: NORMAL_ROOT_ID, level: level - 1 },
      });

      if (parentCount === 0) {
        // 上层无节点（不应该发生，根节点保证 level 0 存在）
        this.logger.error(`普通树 level=${level - 1} 无节点，无法插入`);
        return;
      }

      const maxNodes = parentCount * branchFactor;

      if (nodeCount < maxNodes) {
        // 当前层有空位，执行插入
        const parentIndex = nodeCount % parentCount;
        const position = Math.floor(nodeCount / parentCount);

        // 获取上层第 parentIndex 个父节点（按 createdAt 排序确保确定性顺序）
        const parentNode = await tx.normalTreeNode.findFirst({
          where: { rootId: NORMAL_ROOT_ID, level: level - 1 },
          orderBy: { createdAt: 'asc' },
          skip: parentIndex,
        });

        if (!parentNode) {
          this.logger.error(`普通树 level=${level - 1} 第 ${parentIndex} 个父节点不存在`);
          return;
        }

        // 先创建节点，确保唯一位置占位成功后再更新 childrenCount
        const newNode = await tx.normalTreeNode.create({
          data: {
            rootId: NORMAL_ROOT_ID,
            userId,
            parentId: parentNode.id,
            level,
            position,
          },
        });

        // 原子递增 parent.childrenCount
        await tx.normalTreeNode.update({
          where: { id: parentNode.id },
          data: { childrenCount: { increment: 1 } },
        });

        // 更新 MemberProfile（如不存在则 upsert 创建，防止注册时未创建的遗留数据）
        const updateResult = await tx.memberProfile.updateMany({
          where: { userId },
          data: {
            normalTreeNodeId: newNode.id,
            normalJoinedAt: new Date(),
          },
        });
        if (updateResult.count === 0) {
          await tx.memberProfile.upsert({
            where: { userId },
            create: {
              userId,
              normalTreeNodeId: newNode.id,
              normalJoinedAt: new Date(),
            },
            update: {
              normalTreeNodeId: newNode.id,
              normalJoinedAt: new Date(),
            },
          });
          this.logger.warn(`用户 ${userId} 无 MemberProfile，已自动创建并关联普通树节点`);
        }

        // 更新 NormalProgress
        await tx.normalProgress.update({
          where: { userId },
          data: { treeNodeId: newNode.id },
        });

        this.logger.log(
          `普通树插入：用户 ${userId} → level=${level}, parentId=${parentNode.id}, position=${position}`,
        );
        return;
      }
      // 层满，继续下一层
    }

    this.logger.error(`普通树已满（MAX_TREE_DEPTH=${MAX_TREE_DEPTH}），无法为用户 ${userId} 分配节点`);
  }
}
