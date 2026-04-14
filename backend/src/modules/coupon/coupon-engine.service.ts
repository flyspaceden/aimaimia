import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InboxService } from '../inbox/inbox.service';

/**
 * 红包触发类型（与 Prisma enum CouponTriggerType 保持一致）
 * 当 Prisma Client 重新生成后可直接改为 import { CouponTriggerType } from '@prisma/client'
 */
type CouponTriggerType =
  | 'REGISTER'
  | 'FIRST_ORDER'
  | 'BIRTHDAY'
  | 'CHECK_IN'
  | 'INVITE'
  | 'REVIEW'
  | 'SHARE'
  | 'CUMULATIVE_SPEND'
  | 'WIN_BACK'
  | 'HOLIDAY'
  | 'FLASH'
  | 'MANUAL';

/** 每批处理的最大数量 */
const BATCH_SIZE = 200;

/** Serializable 事务最大重试次数 */
const MAX_RETRIES = 3;

/** 业务时区（用于生日类日期匹配） */
const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

/**
 * 平台红包自动发放引擎
 *
 * 职责：
 * 1. 事件驱动发放 — 由各业务模块调用 handleTrigger()
 * 2. 定时任务 — 生日红包、复购激励、红包过期、活动结束
 *
 * 注意：这是平台红包（Coupon）系统，与分润奖励（Reward）系统完全独立。
 * 红包只能在结算时抵扣，不能提现。
 */
@Injectable()
export class CouponEngineService {
  private readonly logger = new Logger(CouponEngineService.name);

  constructor(
    private prisma: PrismaService,
    private inboxService: InboxService,
  ) {}

  // ========== 事件驱动发放 ==========

  /**
   * 处理触发事件，检查是否有匹配的活动需要发放红包
   * 被各业务模块在适当时机调用（注册、首单、签到、邀请、好评等）
   *
   * @param userId    触发用户 ID
   * @param triggerType 触发类型
   * @param context   触发上下文（各触发类型不同，详见 triggerConfig 校验逻辑）
   */
  async handleTrigger(
    userId: string,
    triggerType: CouponTriggerType,
    context?: Record<string, any>,
  ): Promise<void> {
    this.logger.log(
      `处理触发事件：userId=${userId}, type=${triggerType}, context=${JSON.stringify(context ?? {})}`,
    );

    try {
      // 1. 查找匹配的 ACTIVE 活动（AUTO 发放模式）
      const now = new Date();
      // Prisma 不支持字段间比较（issuedCount < totalQuota），
      // 所以先查出所有匹配活动，再在应用层过滤配额
      const campaigns = await this.prisma.couponCampaign.findMany({
        where: {
          triggerType,
          distributionMode: 'AUTO',
          status: 'ACTIVE',
          startAt: { lte: now },
          endAt: { gt: now },
        },
      });

      // 额外过滤：issuedCount < totalQuota（Prisma 不支持字段间比较，应用层过滤）
      const eligibleCampaigns = campaigns.filter(
        (c) => c.issuedCount < c.totalQuota,
      );

      if (eligibleCampaigns.length === 0) {
        this.logger.debug(
          `无匹配活动：triggerType=${triggerType}`,
        );
        return;
      }

      this.logger.log(
        `找到 ${eligibleCampaigns.length} 个匹配活动，开始逐个发放`,
      );

      // 2. 对每个活动尝试发放
      for (const campaign of eligibleCampaigns) {
        try {
          // 校验触发条件配置
          if (!this.checkTriggerConfig(triggerType, campaign.triggerConfig, context)) {
            this.logger.debug(
              `活动 ${campaign.id} 触发条件不满足，跳过`,
            );
            continue;
          }

          await this.issueWithRetry(campaign.id, userId);
        } catch (err) {
          // 单个活动发放失败不影响其他活动
          this.logger.error(
            `活动 ${campaign.id} 发放失败：userId=${userId}, error=${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `handleTrigger 异常：userId=${userId}, type=${triggerType}, error=${(err as Error).message}`,
      );
    }
  }

  // ========== 定时任务 ==========

  /**
   * 每天 0:00 — 生日红包
   * 查找今天过生日的用户，为每人触发 BIRTHDAY 事件
   */
  @Cron('0 0 * * *', { timeZone: BUSINESS_TIME_ZONE })
  async handleBirthdayCoupons(): Promise<void> {
    this.logger.log('开始处理生日红包...');

    try {
      const now = new Date();
      const dateParts = new Intl.DateTimeFormat('en-US', {
        timeZone: BUSINESS_TIME_ZONE,
        month: 'numeric',
        day: 'numeric',
      }).formatToParts(now);
      const month = Number(
        dateParts.find((part) => part.type === 'month')?.value || now.getMonth() + 1,
      );
      const day = Number(
        dateParts.find((part) => part.type === 'day')?.value || now.getDate(),
      );

      let successCount = 0;
      let failCount = 0;
      let offset = 0;

      // 分页处理所有生日用户，避免单批 LIMIT 遗漏
      while (true) {
        const birthdayUsers: { userId: string }[] = await this.prisma.$queryRaw`
          SELECT "userId"
          FROM "UserProfile"
          WHERE "birthday" IS NOT NULL
            AND EXTRACT(MONTH FROM "birthday") = ${month}
            AND EXTRACT(DAY FROM "birthday") = ${day}
          LIMIT ${BATCH_SIZE}
          OFFSET ${offset}
        `;

        if (birthdayUsers.length === 0) {
          if (offset === 0) {
            this.logger.log('今天无生日用户');
          }
          break;
        }

        if (offset === 0) {
          this.logger.log(`找到生日用户，开始分批发放红包`);
        }

        for (const { userId } of birthdayUsers) {
          try {
            await this.handleTrigger(userId, 'BIRTHDAY');
            successCount++;
          } catch (err) {
            failCount++;
            this.logger.error(
              `生日红包发放失败：userId=${userId}, error=${(err as Error).message}`,
            );
          }
        }

        // 如果本批不足 BATCH_SIZE，说明已处理完所有用户
        if (birthdayUsers.length < BATCH_SIZE) break;
        offset += BATCH_SIZE;
      }

      if (successCount > 0 || failCount > 0) {
        this.logger.log(
          `生日红包处理完成：成功 ${successCount}，失败 ${failCount}`,
        );
      }
    } catch (err) {
      this.logger.error(`生日红包定时任务异常：${(err as Error).message}`);
    }
  }

  /**
   * 每天 1:00 — 复购激励（WIN_BACK）
   * 查找 WIN_BACK 类型活动，根据 triggerConfig.inactiveDays 找到沉默用户
   */
  @Cron('0 1 * * *')
  async handleWinBackCoupons(): Promise<void> {
    this.logger.log('开始处理复购激励红包...');

    try {
      const now = new Date();

      // 查找活跃的 WIN_BACK 活动
      const winBackCampaigns = await this.prisma.couponCampaign.findMany({
        where: {
          triggerType: 'WIN_BACK',
          distributionMode: 'AUTO',
          status: 'ACTIVE',
          startAt: { lte: now },
          endAt: { gt: now },
        },
      });

      // 应用层过滤配额
      const eligibleCampaigns = winBackCampaigns.filter(
        (c) => c.issuedCount < c.totalQuota,
      );

      if (eligibleCampaigns.length === 0) {
        this.logger.log('无活跃的复购激励活动');
        return;
      }

      for (const campaign of eligibleCampaigns) {
        try {
          await this.processWinBackCampaign(campaign, now);
        } catch (err) {
          this.logger.error(
            `复购激励活动 ${campaign.id} 处理失败：${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`复购激励定时任务异常：${(err as Error).message}`);
    }
  }

  /**
   * 每小时整点 — 红包过期
   * 将已过期的 AVAILABLE 实例批量更新为 EXPIRED
   */
  @Cron('0 * * * *')
  async expireCoupons(): Promise<void> {
    this.logger.log('开始检查红包过期...');

    try {
      const now = new Date();

      const result = await this.prisma.couponInstance.updateMany({
        where: {
          status: 'AVAILABLE',
          expiresAt: { lt: now },
        },
        data: {
          status: 'EXPIRED',
        },
      });

      if (result.count > 0) {
        this.logger.log(`已过期 ${result.count} 张红包`);

        // C12: 红包过期通知（批量查询刚过期的用户，逐个通知）
        const expiredInstances = await this.prisma.couponInstance.findMany({
          where: { status: 'EXPIRED', expiresAt: { gte: new Date(now.getTime() - 60 * 60_000) } },
          select: { userId: true },
          distinct: ['userId'],
          take: 100,
        });
        for (const instance of expiredInstances) {
          this.inboxService.send({
            userId: instance.userId,
            category: 'transaction',
            type: 'coupon_expired',
            title: '红包已过期',
            content: '您有红包已过期失效，请关注有效期及时使用。',
            target: { route: '/coupons' },
          }).catch(() => {});
        }
      } else {
        this.logger.debug('无需过期的红包');
      }
    } catch (err) {
      this.logger.error(`红包过期定时任务异常：${(err as Error).message}`);
    }
  }

  /**
   * 每小时第 30 分 — 活动结束
   * 将已过结束时间的 ACTIVE 活动更新为 ENDED
   */
  @Cron('30 * * * *')
  async endCampaigns(): Promise<void> {
    this.logger.log('开始检查活动结束...');

    try {
      const now = new Date();

      const result = await this.prisma.couponCampaign.updateMany({
        where: {
          status: 'ACTIVE',
          endAt: { lt: now },
        },
        data: {
          status: 'ENDED',
        },
      });

      if (result.count > 0) {
        this.logger.log(`已结束 ${result.count} 个活动`);
      } else {
        this.logger.debug('无需结束的活动');
      }
    } catch (err) {
      this.logger.error(`活动结束定时任务异常：${(err as Error).message}`);
    }
  }

  // ========== 内部方法 ==========

  /**
   * 带重试的发放（处理 Serializable 隔离级别的 P2034 序列化错误）
   */
  private async issueWithRetry(
    campaignId: string,
    userId: string,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.issueSingle(campaignId, userId);
      } catch (err) {
        const isPrismaSerializationError =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2034';

        if (isPrismaSerializationError && attempt < MAX_RETRIES) {
          this.logger.warn(
            `发放序列化冲突（P2034），重试 ${attempt}/${MAX_RETRIES}：campaignId=${campaignId}, userId=${userId}`,
          );
          // 短暂随机退避
          await this.sleep(50 * attempt + Math.random() * 100);
          continue;
        }

        throw err;
      }
    }
    return false;
  }

  /**
   * 单次发放（Serializable 事务）
   *
   * 在事务内完成：
   * 1. 校验活动状态（ACTIVE + 有效期）
   * 2. 校验配额（issuedCount < totalQuota）
   * 3. 校验每人限领（已领取数 < maxPerUser）
   * 4. CAS 递增 issuedCount
   * 5. 创建 CouponInstance（快照数据）
   *
   * @returns true 表示成功发放，false 表示因限制跳过（非异常情况）
   */
  private async issueSingle(
    campaignId: string,
    userId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();

        // 1. 查询活动并校验
        const campaign = await tx.couponCampaign.findUnique({
          where: { id: campaignId },
        });

        if (!campaign) {
          this.logger.warn(`活动不存在：${campaignId}`);
          return false;
        }

        if (campaign.status !== 'ACTIVE') {
          this.logger.debug(`活动 ${campaignId} 非 ACTIVE 状态（${campaign.status}），跳过`);
          return false;
        }

        if (now < campaign.startAt || now > campaign.endAt) {
          this.logger.debug(`活动 ${campaignId} 不在有效期内，跳过`);
          return false;
        }

        // 2. 校验配额
        if (campaign.issuedCount >= campaign.totalQuota) {
          this.logger.debug(`活动 ${campaignId} 配额已满，跳过`);
          return false;
        }

        // 3. 校验每人限领
        const userCount = await tx.couponInstance.count({
          where: {
            campaignId,
            userId,
          },
        });

        if (userCount >= campaign.maxPerUser) {
          this.logger.debug(
            `用户 ${userId} 已达活动 ${campaignId} 领取上限（${userCount}/${campaign.maxPerUser}），跳过`,
          );
          return false;
        }

        // 4. CAS 递增 issuedCount（乐观锁防止超发）
        const updated = await tx.couponCampaign.updateMany({
          where: {
            id: campaignId,
            issuedCount: campaign.issuedCount, // CAS 条件
          },
          data: {
            issuedCount: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          // CAS 失败 — 并发修改，将在上层重试
          throw new Prisma.PrismaClientKnownRequestError(
            '发放 CAS 冲突',
            { code: 'P2034', clientVersion: '' },
          );
        }

        // 5. 计算过期时间
        let expiresAt: Date;
        if (campaign.validDays > 0) {
          expiresAt = new Date(
            now.getTime() + campaign.validDays * 24 * 60 * 60 * 1000,
          );
        } else {
          // validDays=0 表示跟随活动结束时间
          expiresAt = campaign.endAt;
        }

        // 6. 创建红包实例（快照数据，避免活动修改后影响已发放红包）
        await tx.couponInstance.create({
          data: {
            campaignId,
            userId,
            status: 'AVAILABLE',
            discountType: campaign.discountType,
            discountValue: campaign.discountValue,
            maxDiscountAmount: campaign.maxDiscountAmount,
            minOrderAmount: campaign.minOrderAmount,
            issuedAt: now,
            expiresAt,
          },
        });

        this.logger.log(
          `红包发放成功：活动 ${campaignId}（${campaign.name}）→ 用户 ${userId}，` +
          `类型=${campaign.discountType}，面值=${campaign.discountValue}，过期=${expiresAt.toISOString()}`,
        );

        // C12: 红包到账通知
        setImmediate(() => {
          this.inboxService.send({
            userId,
            category: 'transaction',
            type: 'coupon_granted',
            title: '红包到账',
            content: `您收到一张${campaign.discountType === 'FIXED' ? campaign.discountValue.toFixed(2) + '元' : campaign.discountValue + '折'}红包，快去使用吧！`,
            target: { route: '/coupons' },
          }).catch(() => {});
        });

        return true;
      },
      {
        timeout: 10000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * 校验触发条件配置
   *
   * 根据不同 triggerType，检查 context 是否满足 campaign.triggerConfig 中的条件。
   * triggerConfig 为 JSON 字段，各类型的预期结构：
   * - CHECK_IN:         { requiredDays: number }      — 连续签到天数
   * - CUMULATIVE_SPEND: { spendThreshold: number }    — 累计消费阈值（元）
   * - WIN_BACK:         { inactiveDays: number }      — 沉默天数
   * - 其他类型无额外配置要求
   */
  private checkTriggerConfig(
    triggerType: CouponTriggerType,
    triggerConfig: any,
    context?: Record<string, any>,
  ): boolean {
    switch (triggerType) {
      case 'CHECK_IN': {
        // 校验连续签到天数是否达标
        const requiredDays = triggerConfig?.requiredDays;
        const consecutiveDays = context?.consecutiveDays;
        if (requiredDays && consecutiveDays != null) {
          return consecutiveDays >= requiredDays;
        }
        // 无配置要求则默认通过
        return true;
      }

      case 'CUMULATIVE_SPEND': {
        // 校验累计消费是否达标
        const spendThreshold = triggerConfig?.spendThreshold;
        const totalSpent = context?.totalSpent;
        if (spendThreshold && totalSpent != null) {
          return totalSpent >= spendThreshold;
        }
        return true;
      }

      // WIN_BACK 的 inactiveDays 在 processWinBackCampaign 中已处理
      // REGISTER / FIRST_ORDER / BIRTHDAY / INVITE / REVIEW / SHARE / HOLIDAY / FLASH 无额外条件
      default:
        return true;
    }
  }

  /**
   * 处理单个复购激励活动
   *
   * 逻辑：
   * 1. 从 triggerConfig 获取 inactiveDays（沉默天数阈值）
   * 2. 查询最后一次下单时间超过 inactiveDays 天的用户
   * 3. 排除已领过该活动红包的用户
   * 4. 为符合条件的用户发放红包
   */
  private async processWinBackCampaign(
    campaign: any,
    now: Date,
  ): Promise<void> {
    const inactiveDays = (campaign.triggerConfig as any)?.inactiveDays;
    if (!inactiveDays || inactiveDays <= 0) {
      this.logger.warn(
        `复购激励活动 ${campaign.id} 缺少有效的 inactiveDays 配置，跳过`,
      );
      return;
    }

    // 计算沉默截止时间
    const cutoffDate = new Date(
      now.getTime() - inactiveDays * 24 * 60 * 60 * 1000,
    );

    let successCount = 0;
    let failCount = 0;
    let offset = 0;

    // 分页处理所有沉默用户
    while (true) {
      const inactiveUsers: { userId: string }[] = await this.prisma.$queryRaw`
        SELECT sub."userId"
        FROM (
          SELECT o."userId", MAX(o."createdAt") AS "lastOrderAt"
          FROM "Order" o
          WHERE o.status IN ('PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED')
          GROUP BY o."userId"
          HAVING MAX(o."createdAt") < ${cutoffDate}
        ) sub
        WHERE sub."userId" NOT IN (
          SELECT ci."userId"
          FROM "CouponInstance" ci
          WHERE ci."campaignId" = ${campaign.id}
        )
        LIMIT ${BATCH_SIZE}
        OFFSET ${offset}
      `;

      if (inactiveUsers.length === 0) {
        if (offset === 0) {
          this.logger.log(
            `复购激励活动 ${campaign.id} 无符合条件的沉默用户`,
          );
        }
        break;
      }

      if (offset === 0) {
        this.logger.log(
          `复购激励活动 ${campaign.id}：开始处理沉默用户（${inactiveDays} 天未下单）`,
        );
      }

      for (const { userId } of inactiveUsers) {
        try {
          const issued = await this.issueWithRetry(campaign.id, userId);
          if (issued) successCount++;
        } catch (err) {
          failCount++;
          this.logger.error(
            `复购激励发放失败：活动 ${campaign.id}, userId=${userId}, error=${(err as Error).message}`,
          );
        }
      }

      if (inactiveUsers.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
    }

    if (successCount > 0 || failCount > 0) {
      this.logger.log(
        `复购激励活动 ${campaign.id} 处理完成：成功 ${successCount}，失败 ${failCount}`,
      );
    }
  }

  /**
   * 异步等待（用于重试退避）
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
