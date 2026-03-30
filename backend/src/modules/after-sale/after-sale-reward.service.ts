import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PLATFORM_USER_ID, getAccountTypeForScheme } from '../bonus/engine/constants';

/** P2034 序列化冲突重试次数 */
const MAX_RETRIES = 3;

/**
 * 售后奖励归平台服务
 *
 * 当售后成功（退款到账 REFUNDED 或换货完成 COMPLETED）时，
 * 将该订单关联的所有分润奖励作废归平台。
 *
 * 处理状态：
 * - RETURN_FROZEN → VOIDED（正常路径：退货保护期内售后成功）
 * - FROZEN → VOIDED（防御路径：保护期已过但售后仍在进行）
 * - AVAILABLE → VOIDED（极端防御：已释放但售后成功，需回收）
 */
@Injectable()
export class AfterSaleRewardService {
  private readonly logger = new Logger(AfterSaleRewardService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 售后成功后作废该订单的所有分润奖励
   *
   * @param orderId 关联订单 ID
   */
  async voidRewardsForOrder(orderId: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            // 1. 查找该订单的所有分润奖励（RETURN_FROZEN / FROZEN / AVAILABLE）
            const ledgers = await tx.rewardLedger.findMany({
              where: {
                refType: 'ORDER',
                refId: orderId,
                entryType: 'FREEZE',
                status: { in: ['RETURN_FROZEN', 'FROZEN'] },
              },
            });

            // 防御性查找：已释放为 AVAILABLE 的奖励（RELEASE 类型）
            const releasedLedgers = await tx.rewardLedger.findMany({
              where: {
                refType: 'ORDER',
                refId: orderId,
                entryType: 'RELEASE',
                status: 'AVAILABLE',
              },
            });

            if (releasedLedgers.length > 0) {
              this.logger.warn(
                `订单 ${orderId} 有 ${releasedLedgers.length} 条已释放(AVAILABLE)奖励需回收，进入防御回收流程`,
              );
            }

            const allLedgers = [...ledgers, ...releasedLedgers];

            if (allLedgers.length === 0) {
              this.logger.log(`订单 ${orderId} 无待作废的分润奖励`);
              return;
            }

            this.logger.log(
              `订单 ${orderId} 发现 ${allLedgers.length} 条分润奖励待作废 ` +
              `(RETURN_FROZEN: ${ledgers.filter((l) => l.status === 'RETURN_FROZEN').length}, ` +
              `FROZEN: ${ledgers.filter((l) => l.status === 'FROZEN').length}, ` +
              `AVAILABLE: ${releasedLedgers.length})`,
            );

            // 确保平台 PLATFORM_PROFIT 账户存在
            let platformAccount = await tx.rewardAccount.findUnique({
              where: { userId_type: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' } },
            });
            if (!platformAccount) {
              platformAccount = await tx.rewardAccount.create({
                data: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' },
              });
            }

            // 2. 逐条 CAS 作废
            for (const ledger of allLedgers) {
              const originalStatus = ledger.status;
              const originalEntryType = ledger.entryType;

              // CAS 更新原记录 → VOIDED/VOID
              const cas = await tx.rewardLedger.updateMany({
                where: {
                  id: ledger.id,
                  status: originalStatus as any,
                  entryType: originalEntryType as any,
                },
                data: {
                  status: 'VOIDED',
                  entryType: 'VOID',
                },
              });

              if (cas.count === 0) {
                this.logger.log(
                  `奖励 ${ledger.id} 已非 ${originalStatus} 状态，跳过`,
                );
                continue;
              }

              // 3. 扣减用户账户余额
              const scheme = (ledger.meta as any)?.scheme;
              const accountType = getAccountTypeForScheme(scheme);

              if (originalStatus === 'AVAILABLE') {
                // 已释放的奖励：扣减 balance
                await tx.rewardAccount.updateMany({
                  where: {
                    userId: ledger.userId,
                    type: accountType,
                    balance: { gte: ledger.amount },
                  },
                  data: { balance: { decrement: ledger.amount } },
                });
              } else if (originalStatus === 'FROZEN') {
                // FROZEN：已计入账户 frozen，需扣减
                await tx.rewardAccount.updateMany({
                  where: {
                    userId: ledger.userId,
                    type: accountType,
                    frozen: { gte: ledger.amount },
                  },
                  data: { frozen: { decrement: ledger.amount } },
                });
              }
              // RETURN_FROZEN：未计入账户余额，无需扣减

              // 4. 创建平台收入 VOID 记录
              await tx.rewardLedger.create({
                data: {
                  accountId: platformAccount.id,
                  userId: PLATFORM_USER_ID,
                  entryType: 'RELEASE',
                  amount: ledger.amount,
                  status: 'AVAILABLE',
                  refType: 'AFTER_SALE',
                  refId: orderId,
                  meta: {
                    scheme: 'AFTER_SALE_VOID',
                    originalUserId: ledger.userId,
                    originalLedgerId: ledger.id,
                    originalStatus,
                    originalScheme: scheme,
                    reason: '售后成功，奖励归平台',
                  },
                },
              });

              // 增加平台账户余额
              await tx.rewardAccount.update({
                where: { id: platformAccount.id },
                data: { balance: { increment: ledger.amount } },
              });

              this.logger.log(
                `作废奖励：ledger ${ledger.id}，${ledger.amount} 元（${originalStatus}→VOIDED），` +
                `用户 ${ledger.userId} → 平台`,
              );
            }
          },
          {
            timeout: 30000,
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        return; // 成功退出重试循环
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `voidRewardsForOrder 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: orderId=${orderId}`,
          );
          continue;
        }
        this.logger.error(
          `售后奖励作废失败: orderId=${orderId}, error=${(err as Error).message}`,
        );
        throw err;
      }
    }
  }
}
