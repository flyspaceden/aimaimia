import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * B6: 游客数据清理服务
 *
 * HC-8 安全执行要求：
 * - dry-run 确认影响范围
 * - 分批删除（100 条/批），间隔 1 秒
 * - 删除前导出 JSON 可回滚日志
 * - 级联处理关联表（Prisma onDelete: Cascade 自动处理部分，其余手动清理）
 *
 * 使用方式：通过管理后台 API 手动触发，不自动执行
 */

const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 1000;

export interface GuestCleanupResult {
  mode: 'dry-run' | 'execute';
  /** 符合清理条件的游客用户总数 */
  totalFound: number;
  /** 实际删除数量（dry-run 时为 0） */
  totalDeleted: number;
  /** 跳过的用户（有订单/企业关联等，不可删除） */
  skippedCount: number;
  /** 导出的 JSON 备份数据（仅 execute 模式） */
  exportedUsers?: GuestUserExport[];
  /** 错误信息 */
  errors: string[];
  /** 操作管理员 ID */
  triggeredBy?: string;
  /** 操作时间 */
  triggeredAt?: string;
}

interface GuestUserExport {
  id: string;
  status: string;
  createdAt: string;
  authIdentities: Array<{ id: string; provider: string; identifier: string }>;
  hasProfile: boolean;
  sessionCount: number;
  cartItems: Array<{ id: string; skuId: string; quantity: number; isPrize: boolean }>;
}

@Injectable()
export class GuestCleanupService {
  private readonly logger = new Logger(GuestCleanupService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 查找所有符合清理条件的游客用户
   * 条件：AuthIdentity.provider = GUEST，且无有效订单，无企业关联
   *
   * 业务规则：有订单/企业/提现/VIP 购买记录的游客用户不删除
   * —— 即使部分关联表没有 onDelete: Restrict，也保留这些有商业交互的用户
   */
  private async findCleanableGuestUsers(): Promise<string[]> {
    const guestIdentities = await this.prisma.authIdentity.findMany({
      where: { provider: 'GUEST' },
      select: { userId: true },
    });
    const guestUserIds = [...new Set(guestIdentities.map((i) => i.userId))];

    if (guestUserIds.length === 0) return [];

    // 排除有订单的用户（onDelete: Restrict）
    const usersWithOrders = await this.prisma.order.findMany({
      where: { userId: { in: guestUserIds } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const orderUserIds = new Set(usersWithOrders.map((o) => o.userId));

    // 排除有企业关联的用户（onDelete: Restrict）
    const usersWithCompany = await this.prisma.companyStaff.findMany({
      where: { userId: { in: guestUserIds } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const companyUserIds = new Set(usersWithCompany.map((c) => c.userId));

    // 排除有提现记录的用户（业务规则：保留有金融交互的用户）
    const usersWithWithdrawals = await this.prisma.withdrawRequest.findMany({
      where: { userId: { in: guestUserIds } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const withdrawUserIds = new Set(usersWithWithdrawals.map((w) => w.userId));

    // 排除有 VIP 购买记录的用户（业务规则：保留有付费记录的用户）
    const usersWithVip = await this.prisma.vipPurchase.findMany({
      where: { userId: { in: guestUserIds } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const vipUserIds = new Set(usersWithVip.map((v) => v.userId));

    return guestUserIds.filter(
      (id) =>
        !orderUserIds.has(id) &&
        !companyUserIds.has(id) &&
        !withdrawUserIds.has(id) &&
        !vipUserIds.has(id),
    );
  }

  /**
   * 导出待删除用户数据（用于回滚）
   */
  private async exportUsers(userIds: string[]): Promise<GuestUserExport[]> {
    const exports: GuestUserExport[] = [];

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      const users = await this.prisma.user.findMany({
        where: { id: { in: batch } },
        include: {
          authIdentities: { select: { id: true, provider: true, identifier: true } },
          profile: { select: { id: true } },
          sessions: { select: { id: true } },
          cart: {
            include: {
              items: { select: { id: true, skuId: true, quantity: true, isPrize: true } },
            },
          },
        },
      });

      for (const user of users) {
        exports.push({
          id: user.id,
          status: user.status,
          createdAt: user.createdAt.toISOString(),
          authIdentities: user.authIdentities.map((ai) => ({
            id: ai.id,
            provider: ai.provider,
            identifier: ai.identifier,
          })),
          hasProfile: !!user.profile,
          sessionCount: user.sessions.length,
          cartItems: user.cart?.items?.map((ci) => ({
            id: ci.id,
            skuId: ci.skuId,
            quantity: ci.quantity,
            isPrize: ci.isPrize ?? false,
          })) ?? [],
        });
      }
    }

    return exports;
  }

  /**
   * 执行游客数据清理
   * @param dryRun true=仅统计不删除, false=实际执行删除
   * @param adminUserId 触发操作的管理员 ID
   */
  async cleanup(dryRun: boolean = true, adminUserId?: string): Promise<GuestCleanupResult> {
    this.logger.log(JSON.stringify({
      action: 'guest_cleanup_start',
      mode: dryRun ? 'dry-run' : 'execute',
      adminUserId: adminUserId ?? null,
    }));

    const result: GuestCleanupResult = {
      mode: dryRun ? 'dry-run' : 'execute',
      totalFound: 0,
      totalDeleted: 0,
      skippedCount: 0,
      errors: [],
      triggeredBy: adminUserId,
      triggeredAt: new Date().toISOString(),
    };

    try {
      // 1. 查找所有 GUEST 身份用户
      const allGuestIdentities = await this.prisma.authIdentity.findMany({
        where: { provider: 'GUEST' },
        select: { userId: true },
      });
      const allGuestCount = new Set(allGuestIdentities.map((i) => i.userId)).size;

      // 2. 筛选可安全删除的用户
      const cleanableIds = await this.findCleanableGuestUsers();
      result.totalFound = cleanableIds.length;
      result.skippedCount = allGuestCount - cleanableIds.length;

      this.logger.log(JSON.stringify({
        action: 'guest_cleanup_scan',
        totalGuests: allGuestCount,
        cleanable: cleanableIds.length,
        skipped: result.skippedCount,
      }));

      if (dryRun || cleanableIds.length === 0) {
        return result;
      }

      // 3. 导出待删除数据（可回滚日志）
      result.exportedUsers = await this.exportUsers(cleanableIds);

      // 4. 分批删除（每批包裹在事务中，保证原子性）
      for (let i = 0; i < cleanableIds.length; i += BATCH_SIZE) {
        const batch = cleanableIds.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(cleanableIds.length / BATCH_SIZE);

        try {
          await this.prisma.$transaction(async (tx) => {
            // 手动清理所有没有 onDelete: Cascade 的关联表
            // 以下模型的 user 关系没有 onDelete 规则或为默认行为，需手动删除

            // 认证/会话相关（无 Cascade 的）
            await tx.loginEvent.deleteMany({ where: { userId: { in: batch } } });

            // 用户档案相关
            await tx.memberProfile.deleteMany({ where: { userId: { in: batch } } });

            // 分润/奖励相关
            await tx.normalProgress.deleteMany({ where: { userId: { in: batch } } });
            await tx.vipProgress.deleteMany({ where: { userId: { in: batch } } });
            await tx.normalEligibleOrder.deleteMany({ where: { userId: { in: batch } } });
            await tx.vipEligibleOrder.deleteMany({ where: { userId: { in: batch } } });
            await tx.normalQueueMember.deleteMany({ where: { userId: { in: batch } } });

            // 奖励账户（先删 Ledger 再删 Account）
            const rewardAccounts = await tx.rewardAccount.findMany({
              where: { userId: { in: batch } },
              select: { id: true },
            });
            if (rewardAccounts.length > 0) {
              await tx.rewardLedger.deleteMany({
                where: { accountId: { in: rewardAccounts.map((a) => a.id) } },
              });
              await tx.rewardAccount.deleteMany({ where: { userId: { in: batch } } });
            }

            // 抽奖/红包
            await tx.lotteryRecord.deleteMany({ where: { userId: { in: batch } } });
            await tx.couponInstance.deleteMany({ where: { userId: { in: batch } } });
            await tx.couponTriggerEvent.deleteMany({ where: { userId: { in: batch } } });

            // 结算/支付
            await tx.checkoutSession.deleteMany({ where: { userId: { in: batch } } });
            await tx.paymentGroup.deleteMany({ where: { userId: { in: batch } } });

            // AI 会话
            await tx.aiSession.deleteMany({ where: { userId: { in: batch } } });

            // 社交/游戏化
            await tx.booking.deleteMany({ where: { userId: { in: batch } } });
            await tx.inboxMessage.deleteMany({ where: { userId: { in: batch } } });
            await tx.taskCompletion.deleteMany({ where: { userId: { in: batch } } });
            await tx.checkIn.deleteMany({ where: { userId: { in: batch } } });

            // 售后申请
            await tx.afterSaleRequest.deleteMany({ where: { userId: { in: batch } } });

            // 推荐链接（inviter 侧）
            await tx.referralLink.deleteMany({ where: { inviterUserId: { in: batch } } });

            // 最后删除 User（触发 Cascade 级联删除 AuthIdentity/Session/Device/UserProfile/Cart/Address 等）
            const deleted = await tx.user.deleteMany({
              where: { id: { in: batch } },
            });

            result.totalDeleted += deleted.count;

            this.logger.log(JSON.stringify({
              action: 'guest_cleanup_batch',
              batch: batchNum,
              totalBatches,
              deletedInBatch: deleted.count,
              totalDeleted: result.totalDeleted,
              adminUserId: adminUserId ?? null,
            }));
          }, { timeout: 30000 }); // 30 秒事务超时
        } catch (err: any) {
          const errMsg = `Batch ${batchNum}: ${err?.message}`;
          result.errors.push(errMsg);
          this.logger.error(JSON.stringify({
            action: 'guest_cleanup_batch_error',
            batch: batchNum,
            error: err?.message,
            userIds: batch,
          }));
        }

        // 批间延迟，避免持续占用数据库资源
        if (i + BATCH_SIZE < cleanableIds.length) {
          await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
        }
      }

      this.logger.log(JSON.stringify({
        action: 'guest_cleanup_complete',
        totalDeleted: result.totalDeleted,
        errors: result.errors.length,
        adminUserId: adminUserId ?? null,
      }));
    } catch (err: any) {
      result.errors.push(err?.message ?? 'unknown error');
      this.logger.error(JSON.stringify({
        action: 'guest_cleanup_error',
        error: err?.message,
      }));
    }

    return result;
  }
}
