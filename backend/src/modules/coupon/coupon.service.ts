import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CouponEngineService } from './coupon-engine.service';
import { TriggerShareDto } from './dto/trigger-share.dto';
import { TriggerReviewDto } from './dto/trigger-review.dto';

/**
 * 平台红包核心服务
 *
 * 注意：这是平台红包（Coupon）系统，与分润奖励（Reward）系统完全独立。
 * 红包只能在结算时抵扣，不能提现。
 */
@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);

  constructor(
    private prisma: PrismaService,
    private couponEngine: CouponEngineService,
  ) {}

  // ========== 买家端方法 ==========

  /**
   * 查询当前可领取的红包活动列表
   * 条件：状态为 ACTIVE、发放方式为 CLAIM、在有效期内、配额未满
   */
  async getAvailableCampaigns(userId: string) {
    const now = new Date();

    const campaigns = await this.prisma.couponCampaign.findMany({
      where: {
        status: 'ACTIVE',
        distributionMode: 'CLAIM',
        startAt: { lte: now },
        endAt: { gte: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 查询用户已领取数量（批量查询优化）
    const campaignIds = campaigns.map((c) => c.id);
    const userClaimed = await this.prisma.couponInstance.groupBy({
      by: ['campaignId'],
      where: {
        userId,
        campaignId: { in: campaignIds },
      },
      _count: { id: true },
    });
    const claimedMap = new Map(
      userClaimed.map((c) => [c.campaignId, c._count.id]),
    );

    return campaigns
      .filter((c) => c.issuedCount < c.totalQuota) // 配额未满
      .map((c) => {
        const userClaimedCount = claimedMap.get(c.id) || 0;
        return {
          id: c.id,
          name: c.name,
          description: c.description,
          discountType: c.discountType,
          discountValue: c.discountValue,
          maxDiscountAmount: c.maxDiscountAmount,
          minOrderAmount: c.minOrderAmount,
          remainingQuota: c.totalQuota - c.issuedCount,
          userClaimedCount,
          maxPerUser: c.maxPerUser,
          startAt: c.startAt.toISOString(),
          endAt: c.endAt.toISOString(),
          distributionMode: c.distributionMode,
          // 是否还能领：配额充足且未超过每人限领数
          canClaim: userClaimedCount < c.maxPerUser,
        };
      });
  }

  /**
   * 查询用户的红包列表（支持状态筛选）
   */
  async getMyCoupons(userId: string, status?: string) {
    const where: any = { userId };
    if (status) {
      where.status = status;
    }

    const instances = await this.prisma.couponInstance.findMany({
      where,
      include: {
        campaign: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return instances.map((inst) => ({
      id: inst.id,
      campaignId: inst.campaignId,
      campaignName: inst.campaign.name,
      discountType: inst.discountType,
      discountValue: inst.discountValue,
      maxDiscountAmount: inst.maxDiscountAmount,
      minOrderAmount: inst.minOrderAmount,
      status: inst.status,
      issuedAt: inst.issuedAt.toISOString(),
      expiresAt: inst.expiresAt.toISOString(),
      usedAt: inst.usedAt?.toISOString() || null,
      usedOrderId: inst.usedOrderId,
      usedAmount: inst.usedAmount,
    }));
  }

  /** 上报分享事件并触发 SHARE 红包（同日同场景去重） */
  async triggerShareEvent(userId: string, dto: TriggerShareDto) {
    const scene = (dto.scene || 'generic').trim().slice(0, 32) || 'generic';
    const targetId = (dto.targetId || 'global').trim().slice(0, 64) || 'global';
    const day = new Date().toISOString().slice(0, 10);
    const eventKey = `${day}:${scene}:${targetId}`;

    const inserted = await this.insertTriggerEventOnce(
      userId,
      'SHARE',
      eventKey,
      { scene, targetId, day },
    );

    if (!inserted) {
      return { triggered: false, reason: 'DUPLICATE', eventKey };
    }

    this.couponEngine.handleTrigger(userId, 'SHARE', { scene, targetId, day }).catch((err: any) => {
      this.logger.warn(`SHARE 红包触发失败: userId=${userId}, eventKey=${eventKey}, error=${err?.message}`);
    });

    return { triggered: true, reason: 'TRIGGERED', eventKey };
  }

  /** 上报评价事件并触发 REVIEW 红包（按 orderId 去重） */
  async triggerReviewEvent(userId: string, dto: TriggerReviewDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      select: { id: true, userId: true, status: true },
    });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('订单不存在');
    }
    if (order.status !== 'RECEIVED') {
      throw new BadRequestException('仅已确认收货订单可触发评价奖励');
    }

    const eventKey = `order:${dto.orderId}`;
    const reviewId = dto.reviewId?.trim();

    const inserted = await this.insertTriggerEventOnce(
      userId,
      'REVIEW',
      eventKey,
      { orderId: dto.orderId, reviewId: reviewId || null },
    );

    if (!inserted) {
      return { triggered: false, reason: 'DUPLICATE', eventKey };
    }

    this.couponEngine
      .handleTrigger(userId, 'REVIEW', {
        orderId: dto.orderId,
        reviewId: reviewId || null,
      })
      .catch((err: any) => {
        this.logger.warn(`REVIEW 红包触发失败: userId=${userId}, orderId=${dto.orderId}, error=${err?.message}`);
      });

    return { triggered: true, reason: 'TRIGGERED', eventKey };
  }

  /**
   * 用户领取红包
   *
   * 使用 Serializable 隔离级别防止超发和并发重复领取：
   * 1. 校验活动状态和有效期
   * 2. 校验总配额
   * 3. 校验每人限领数
   * 4. CAS 更新 issuedCount
   * 5. 创建 CouponInstance
   */
  async claimCoupon(userId: string, campaignId: string) {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this._claimCouponTx(userId, campaignId);
      } catch (err: any) {
        // P2034 序列化冲突：重试
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2034' &&
          attempt < MAX_RETRIES
        ) {
          const delay = 50 * attempt + Math.random() * 100;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        // P2002 唯一约束冲突：并发重复领取
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException('您已领取过该活动红包');
        }
        throw err;
      }
    }
  }

  /** 领取红包事务（内部方法） */
  private async _claimCouponTx(userId: string, campaignId: string) {
    const now = new Date();

    return this.prisma.$transaction(
      async (tx) => {
        // 1. 查询活动（事务内读取，确保隔离性）
        const campaign = await tx.couponCampaign.findUnique({
          where: { id: campaignId },
        });
        if (!campaign) {
          throw new NotFoundException('红包活动不存在');
        }

        // 2. 校验活动状态
        if (campaign.status !== 'ACTIVE') {
          throw new BadRequestException('该活动当前不可领取');
        }
        if (campaign.distributionMode !== 'CLAIM') {
          throw new BadRequestException('该活动不支持用户自行领取');
        }
        if (now < campaign.startAt || now > campaign.endAt) {
          throw new BadRequestException('该活动不在有效期内');
        }

        // 3. 校验总配额
        if (campaign.issuedCount >= campaign.totalQuota) {
          throw new BadRequestException('红包已领完');
        }

        // 4. 校验每人限领数
        const userClaimedCount = await tx.couponInstance.count({
          where: { campaignId, userId },
        });
        if (userClaimedCount >= campaign.maxPerUser) {
          throw new BadRequestException(
            `每人限领 ${campaign.maxPerUser} 张，您已领取 ${userClaimedCount} 张`,
          );
        }

        // 5. CAS 更新已发放数量（防止超发）
        const updated = await tx.couponCampaign.updateMany({
          where: {
            id: campaignId,
            issuedCount: campaign.issuedCount, // CAS：版本号匹配
          },
          data: {
            issuedCount: { increment: 1 },
          },
        });
        if (updated.count === 0) {
          throw new ConflictException('领取冲突，请重试');
        }

        // 6. 计算过期时间
        let expiresAt: Date;
        if (campaign.validDays > 0) {
          expiresAt = new Date(now.getTime() + campaign.validDays * 24 * 60 * 60 * 1000);
        } else {
          // validDays=0 时跟随活动结束时间
          expiresAt = campaign.endAt;
        }

        // 7. 创建红包实例（冗余快照关键抵扣信息）
        const instance = await tx.couponInstance.create({
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
          `用户 ${userId} 成功领取红包活动 ${campaignId}，实例 ${instance.id}`,
        );

        return {
          id: instance.id,
          campaignName: campaign.name,
          discountType: instance.discountType,
          discountValue: instance.discountValue,
          maxDiscountAmount: instance.maxDiscountAmount,
          minOrderAmount: instance.minOrderAmount,
          expiresAt: instance.expiresAt.toISOString(),
        };
      },
      {
        // Serializable 隔离级别：防止并发超发
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * 结算时查询可用红包列表
   * 返回用户所有 AVAILABLE 状态红包，并标注是否满足当前订单条件及预估折扣
   */
  async getCheckoutEligible(
    userId: string,
    params: {
      orderAmount: number;
      categoryIds: string[];
      companyIds: string[];
    },
  ) {
    const now = new Date();
    const { orderAmount, categoryIds, companyIds } = params;

    // 查询所有可用且未过期的红包实例
    const instances = await this.prisma.couponInstance.findMany({
      where: {
        userId,
        status: 'AVAILABLE',
        expiresAt: { gt: now },
      },
      include: {
        campaign: {
          select: {
            name: true,
            applicableCategories: true,
            applicableCompanyIds: true,
            stackable: true,
            stackGroup: true,
          },
        },
      },
      orderBy: { expiresAt: 'asc' }, // 先过期的排前面
    });

    return instances.map((inst) => {
      const { eligible, reason } = this.checkEligibility(
        inst,
        orderAmount,
        categoryIds,
        companyIds,
      );
      const estimatedDiscount = eligible
        ? this.calculateDiscount(inst, orderAmount)
        : 0;

      return {
        id: inst.id,
        campaignId: inst.campaignId,
        campaignName: inst.campaign.name,
        discountType: inst.discountType,
        discountValue: inst.discountValue,
        maxDiscountAmount: inst.maxDiscountAmount,
        minOrderAmount: inst.minOrderAmount,
        status: inst.status,
        issuedAt: inst.issuedAt.toISOString(),
        expiresAt: inst.expiresAt.toISOString(),
        usedAt: null,
        usedOrderId: null,
        usedAmount: null,
        estimatedDiscount,
        eligible,
        ineligibleReason: reason,
        // 叠加信息（供前端判断叠加规则）
        stackable: inst.campaign.stackable,
        stackGroup: inst.campaign.stackGroup,
      };
    });
  }

  // ========== 结算集成方法 ==========

  /**
   * 校验并锁定红包（AVAILABLE → RESERVED）
   *
   * 在 Serializable 事务中执行：
   * 1. 校验红包归属、状态、过期时间、最低消费
   * 2. 校验品类/店铺约束
   * 3. 校验叠加规则
   * 4. 计算各红包抵扣金额
   * 5. 总抵扣不超过订单金额
   * 6. CAS 更新状态
   */
  async validateAndReserveCoupons(
    userId: string,
    couponInstanceIds: string[],
    orderAmount: number,
    categoryIds: string[],
    companyIds: string[],
  ): Promise<{
    totalDiscount: number;
    perCouponAmounts: Array<{ couponInstanceId: string; discountAmount: number }>;
  }> {
    if (!couponInstanceIds || couponInstanceIds.length === 0) {
      return { totalDiscount: 0, perCouponAmounts: [] };
    }

    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();

        // 1. 查询所有红包实例（含活动信息）
        const instances = await tx.couponInstance.findMany({
          where: { id: { in: couponInstanceIds } },
          include: {
            campaign: {
              select: {
                applicableCategories: true,
                applicableCompanyIds: true,
                stackable: true,
                stackGroup: true,
              },
            },
          },
        });

        // 校验数量匹配
        if (instances.length !== couponInstanceIds.length) {
          const foundIds = new Set(instances.map((i) => i.id));
          const missing = couponInstanceIds.filter((id) => !foundIds.has(id));
          throw new NotFoundException(`红包不存在: ${missing.join(', ')}`);
        }

        // 2. 逐个校验
        for (const inst of instances) {
          // 归属校验
          if (inst.userId !== userId) {
            throw new BadRequestException(`红包 ${inst.id} 不属于当前用户`);
          }
          // 状态校验
          if (inst.status !== 'AVAILABLE') {
            throw new BadRequestException(
              `红包 ${inst.id} 当前状态为 ${inst.status}，无法使用`,
            );
          }
          // 过期校验
          if (inst.expiresAt <= now) {
            throw new BadRequestException(`红包 ${inst.id} 已过期`);
          }
          // 最低消费校验
          if (orderAmount < inst.minOrderAmount) {
            throw new BadRequestException(
              `红包 ${inst.id} 需最低消费 ${inst.minOrderAmount} 元`,
            );
          }
          // 品类约束校验
          const { eligible, reason } = this.checkEligibility(
            inst,
            orderAmount,
            categoryIds,
            companyIds,
          );
          if (!eligible) {
            throw new BadRequestException(`红包 ${inst.id}: ${reason}`);
          }
        }

        // 3. 叠加规则校验
        this.validateStackRules(instances);

        // 4. 计算各红包抵扣金额
        const perCouponAmounts: Array<{
          couponInstanceId: string;
          discountAmount: number;
        }> = [];

        let totalDiscount = 0;
        for (const inst of instances) {
          let discount = this.calculateDiscount(inst, orderAmount);
          // 确保总抵扣不超过订单金额（不能产生负数支付）
          if (totalDiscount + discount > orderAmount) {
            discount = Math.max(0, orderAmount - totalDiscount);
          }
          totalDiscount += discount;
          perCouponAmounts.push({
            couponInstanceId: inst.id,
            discountAmount: discount,
          });
        }

        // 5. CAS 批量更新状态：AVAILABLE → RESERVED
        const updateResult = await tx.couponInstance.updateMany({
          where: {
            id: { in: couponInstanceIds },
            status: 'AVAILABLE', // CAS 条件：只有 AVAILABLE 才能锁定
            expiresAt: { gt: now }, // 防止读校验后到写入前过期的竞态
          },
          data: {
            status: 'RESERVED',
          },
        });

        // CAS 失败检测：如果更新数量不匹配，说明有并发修改
        if (updateResult.count !== couponInstanceIds.length) {
          throw new ConflictException(
            `红包锁定冲突：期望锁定 ${couponInstanceIds.length} 张，实际 ${updateResult.count} 张，请重试`,
          );
        }

        this.logger.log(
          `用户 ${userId} 锁定 ${couponInstanceIds.length} 张红包，总抵扣 ${totalDiscount} 元`,
        );

        return { totalDiscount, perCouponAmounts };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * 确认红包使用（RESERVED → USED）+ 创建使用记录
   * 在支付回调中调用，此时订单已创建
   */
  async confirmCouponUsage(
    couponInstanceIds: string[],
    orderId: string,
    amounts: Array<{ couponInstanceId: string; discountAmount: number }>,
  ) {
    if (!couponInstanceIds || couponInstanceIds.length === 0) return;

    const now = new Date();
    const amountMap = new Map(
      amounts.map((a) => [a.couponInstanceId, a.discountAmount]),
    );

    await this.prisma.$transaction(
      async (tx) => {
        for (const instanceId of couponInstanceIds) {
          const discountAmount = amountMap.get(instanceId) || 0;

          // CAS 更新：RESERVED → USED
          const updated = await tx.couponInstance.updateMany({
            where: {
              id: instanceId,
              status: 'RESERVED', // CAS：只有 RESERVED 才能确认
            },
            data: {
              status: 'USED',
              usedAt: now,
              usedOrderId: orderId,
              usedAmount: discountAmount,
            },
          });

          if (updated.count === 0) {
            this.logger.warn(
              `红包 ${instanceId} 确认使用失败：状态不为 RESERVED`,
            );
            continue; // 幂等处理：可能已经被确认过
          }

          // 创建使用记录
          await tx.couponUsageRecord.create({
            data: {
              couponInstanceId: instanceId,
              orderId,
              discountAmount,
            },
          });
        }

        this.logger.log(
          `订单 ${orderId} 确认使用 ${couponInstanceIds.length} 张红包`,
        );
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * 释放已锁定的红包（RESERVED → AVAILABLE）
   * 在 CheckoutSession 过期或取消时调用
   */
  async releaseCoupons(couponInstanceIds: string[]) {
    if (!couponInstanceIds || couponInstanceIds.length === 0) return;

    const result = await this.prisma.couponInstance.updateMany({
      where: {
        id: { in: couponInstanceIds },
        status: 'RESERVED', // 只释放 RESERVED 状态的
      },
      data: {
        status: 'AVAILABLE',
      },
    });

    if (result.count < couponInstanceIds.length) {
      this.logger.warn(
        `红包部分释放：请求 ${couponInstanceIds.length} 张，实际 ${result.count} 张`,
      );
    } else {
      this.logger.log(
        `释放 ${result.count}/${couponInstanceIds.length} 张红包`,
      );
    }
  }

  // ========== 管理端方法 ==========

  /** 红包活动列表（分页+筛选） */
  async getCampaigns(filters: {
    page?: number;
    pageSize?: number;
    status?: string;
    triggerType?: string;
    keyword?: string;
  }) {
    const { page = 1, pageSize = 20, status, triggerType, keyword } = filters;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (status) where.status = status;
    if (triggerType) where.triggerType = triggerType;
    if (keyword) {
      where.name = { contains: keyword, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      this.prisma.couponCampaign.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.couponCampaign.count({ where }),
    ]);

    return {
      items: items.map((c) => ({
        ...c,
        startAt: c.startAt.toISOString(),
        endAt: c.endAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        remainingQuota: c.totalQuota - c.issuedCount,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 活动详情 */
  async getCampaignById(id: string) {
    const campaign = await this.prisma.couponCampaign.findUnique({
      where: { id },
    });
    if (!campaign) {
      throw new NotFoundException('红包活动不存在');
    }

    // 统计该活动下各状态实例数
    const statusCounts = await this.prisma.couponInstance.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: { id: true },
    });
    const statusMap: Record<string, number> = {};
    for (const sc of statusCounts) {
      statusMap[sc.status] = sc._count.id;
    }

    return {
      ...campaign,
      startAt: campaign.startAt.toISOString(),
      endAt: campaign.endAt.toISOString(),
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
      remainingQuota: campaign.totalQuota - campaign.issuedCount,
      instanceStats: statusMap,
    };
  }

  /** 创建红包活动 */
  async createCampaign(
    dto: {
      name: string;
      description?: string;
      triggerType: string;
      distributionMode: string;
      triggerConfig?: any;
      discountType: string;
      discountValue: number;
      maxDiscountAmount?: number;
      minOrderAmount?: number;
      applicableCategories?: string[];
      applicableCompanyIds?: string[];
      stackable?: boolean;
      stackGroup?: string;
      totalQuota: number;
      maxPerUser?: number;
      validDays?: number;
      startAt: string;
      endAt: string;
    },
    adminId: string,
  ) {
    // 校验时间逻辑
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt <= startAt) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }

    // 校验百分比折扣值
    if (dto.discountType === 'PERCENT') {
      if (dto.discountValue <= 0 || dto.discountValue > 100) {
        throw new BadRequestException('百分比折扣值必须在 0-100 之间');
      }
    }

    const campaign = await this.prisma.couponCampaign.create({
      data: {
        name: dto.name,
        description: dto.description,
        status: 'DRAFT',
        triggerType: dto.triggerType as any,
        distributionMode: dto.distributionMode as any,
        triggerConfig: dto.triggerConfig || Prisma.JsonNull,
        discountType: dto.discountType as any,
        discountValue: dto.discountValue,
        maxDiscountAmount: dto.maxDiscountAmount,
        minOrderAmount: dto.minOrderAmount ?? 0,
        applicableCategories: dto.applicableCategories || [],
        applicableCompanyIds: dto.applicableCompanyIds || [],
        stackable: dto.stackable ?? true,
        stackGroup: dto.stackGroup,
        totalQuota: dto.totalQuota,
        maxPerUser: dto.maxPerUser ?? 1,
        validDays: dto.validDays ?? 7,
        startAt,
        endAt,
        createdBy: adminId,
      },
    });

    this.logger.log(`管理员 ${adminId} 创建红包活动 ${campaign.id}: ${campaign.name}`);

    return campaign;
  }

  /**
   * 更新红包活动
   * ACTIVE 状态下限制可修改字段（不能修改抵扣规则和配额上限）
   */
  async updateCampaign(id: string, dto: Record<string, any>) {
    const campaign = await this.prisma.couponCampaign.findUnique({
      where: { id },
    });
    if (!campaign) {
      throw new NotFoundException('红包活动不存在');
    }

    // ACTIVE 状态限制修改范围
    if (campaign.status === 'ACTIVE') {
      const restrictedFields = [
        'discountType',
        'discountValue',
        'maxDiscountAmount',
        'minOrderAmount',
        'triggerType',
        'distributionMode',
      ];
      for (const field of restrictedFields) {
        if (dto[field] !== undefined) {
          throw new BadRequestException(
            `活动进行中不允许修改 ${field}，请先暂停活动`,
          );
        }
      }
      // totalQuota 只能增加不能减少
      if (dto.totalQuota !== undefined && dto.totalQuota < campaign.issuedCount) {
        throw new BadRequestException(
          `总配额不能低于已发放数量 ${campaign.issuedCount}`,
        );
      }
    }

    // 构建更新数据
    const data: any = {};
    const allowedFields = [
      'name',
      'description',
      'triggerType',
      'distributionMode',
      'triggerConfig',
      'discountType',
      'discountValue',
      'maxDiscountAmount',
      'minOrderAmount',
      'applicableCategories',
      'applicableCompanyIds',
      'stackable',
      'stackGroup',
      'totalQuota',
      'maxPerUser',
      'validDays',
    ];
    for (const field of allowedFields) {
      if (dto[field] !== undefined) {
        data[field] = dto[field];
      }
    }
    if (dto.startAt) data.startAt = new Date(dto.startAt);
    if (dto.endAt) data.endAt = new Date(dto.endAt);

    // 时间校验
    const newStart = data.startAt || campaign.startAt;
    const newEnd = data.endAt || campaign.endAt;
    if (newEnd <= newStart) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }

    return this.prisma.couponCampaign.update({
      where: { id },
      data,
    });
  }

  /**
   * 更新活动状态
   * 状态转换规则：
   * - DRAFT → ACTIVE
   * - ACTIVE → PAUSED / ENDED
   * - PAUSED → ACTIVE / ENDED
   * - ENDED 为终态，不可修改
   */
  async updateCampaignStatus(id: string, newStatus: string) {
    const campaign = await this.prisma.couponCampaign.findUnique({
      where: { id },
    });
    if (!campaign) {
      throw new NotFoundException('红包活动不存在');
    }

    // 校验状态转换合法性
    const validTransitions: Record<string, string[]> = {
      DRAFT: ['ACTIVE'],
      ACTIVE: ['PAUSED', 'ENDED'],
      PAUSED: ['ACTIVE', 'ENDED'],
      ENDED: [], // 终态
    };

    const allowed = validTransitions[campaign.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `不允许从 ${campaign.status} 转换到 ${newStatus}`,
      );
    }

    return this.prisma.couponCampaign.update({
      where: { id },
      data: { status: newStatus as any },
    });
  }

  /** 查询活动下的红包实例列表（发放记录） */
  async getCampaignInstances(
    campaignId: string,
    pagination: { page?: number; pageSize?: number; status?: string },
  ) {
    const { page = 1, pageSize = 20, status } = pagination;
    const skip = (page - 1) * pageSize;

    const where: any = { campaignId };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.couponInstance.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              profile: { select: { nickname: true } },
            },
          },
        },
      }),
      this.prisma.couponInstance.count({ where }),
    ]);

    return {
      items: items.map((inst) => ({
        id: inst.id,
        userId: inst.userId,
        userName: inst.user.profile?.nickname || inst.userId.slice(0, 8),
        status: inst.status,
        discountType: inst.discountType,
        discountValue: inst.discountValue,
        issuedAt: inst.issuedAt.toISOString(),
        expiresAt: inst.expiresAt.toISOString(),
        usedAt: inst.usedAt?.toISOString() || null,
        usedOrderId: inst.usedOrderId,
        usedAmount: inst.usedAmount,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 查询活动下的使用记录 */
  async getCampaignUsage(
    campaignId: string,
    pagination: { page?: number; pageSize?: number },
  ) {
    const { page = 1, pageSize = 20 } = pagination;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.couponUsageRecord.findMany({
        where: {
          couponInstance: { campaignId },
        },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          couponInstance: {
            select: {
              id: true,
              userId: true,
              discountType: true,
              discountValue: true,
              user: {
                select: {
                  id: true,
                  profile: { select: { nickname: true } },
                },
              },
            },
          },
          order: {
            select: {
              id: true,
              totalAmount: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.couponUsageRecord.count({
        where: { couponInstance: { campaignId } },
      }),
    ]);

    return {
      items: items.map((r: any) => ({
        id: r.id,
        couponInstanceId: r.couponInstanceId,
        userId: r.couponInstance?.userId,
        userName:
          r.couponInstance?.user?.profile?.nickname ||
          r.couponInstance?.userId?.slice(0, 8),
        orderId: r.orderId,
        orderTotal: r.order?.totalAmount,
        orderStatus: r.order?.status,
        discountAmount: r.discountAmount,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 全局红包实例列表（发放记录） */
  async getInstances(pagination: {
    page?: number;
    pageSize?: number;
    status?: string;
    userId?: string;
  }) {
    const { page = 1, pageSize = 20, status, userId } = pagination;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const [items, total] = await Promise.all([
      this.prisma.couponInstance.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          campaign: { select: { id: true, name: true } },
          user: {
            select: {
              id: true,
              profile: { select: { nickname: true } },
            },
          },
        },
      }),
      this.prisma.couponInstance.count({ where }),
    ]);

    return {
      items: items.map((inst) => ({
        id: inst.id,
        campaignId: inst.campaignId,
        campaign: inst.campaign,
        userId: inst.userId,
        user: inst.user,
        status: inst.status,
        discountType: inst.discountType,
        discountValue: inst.discountValue,
        maxDiscountAmount: inst.maxDiscountAmount,
        minOrderAmount: inst.minOrderAmount,
        issuedAt: inst.issuedAt.toISOString(),
        expiresAt: inst.expiresAt.toISOString(),
        usedAt: inst.usedAt?.toISOString() || null,
        usedOrderId: inst.usedOrderId,
        usedAmount: inst.usedAmount,
        createdAt: inst.createdAt.toISOString(),
        updatedAt: inst.updatedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 全局红包使用记录 */
  async getUsageRecords(pagination: {
    page?: number;
    pageSize?: number;
    orderId?: string;
    userId?: string;
  }) {
    const { page = 1, pageSize = 20, orderId, userId } = pagination;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (orderId) where.orderId = orderId;
    if (userId) where.couponInstance = { userId };

    const [items, total] = await Promise.all([
      this.prisma.couponUsageRecord.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          couponInstance: {
            select: {
              id: true,
              campaign: { select: { id: true, name: true } },
              user: {
                select: {
                  id: true,
                  profile: { select: { nickname: true } },
                },
              },
            },
          },
          order: {
            select: {
              id: true,
            },
          },
        },
      }),
      this.prisma.couponUsageRecord.count({ where }),
    ]);

    return {
      items: items.map((record) => ({
        id: record.id,
        couponInstanceId: record.couponInstanceId,
        couponInstance: record.couponInstance,
        orderId: record.orderId,
        order: record.order,
        discountAmount: record.discountAmount,
        createdAt: record.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 管理员手动发放红包给指定用户
   * 使用 Serializable 隔离级别防止超发
   */
  async manualIssue(
    campaignId: string,
    userIds: string[],
    adminId: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();

        // 查询活动
        const campaign = await tx.couponCampaign.findUnique({
          where: { id: campaignId },
        });
        if (!campaign) {
          throw new NotFoundException('红包活动不存在');
        }
        if (campaign.status !== 'ACTIVE' && campaign.status !== 'DRAFT') {
          throw new BadRequestException('只有草稿或进行中的活动可以手动发放');
        }

        // 校验配额
        const requiredQuota = userIds.length;
        if (campaign.issuedCount + requiredQuota > campaign.totalQuota) {
          throw new BadRequestException(
            `配额不足：剩余 ${campaign.totalQuota - campaign.issuedCount}，需要 ${requiredQuota}`,
          );
        }

        // 校验用户存在且未超限领
        const existingCounts = await tx.couponInstance.groupBy({
          by: ['userId'],
          where: {
            campaignId,
            userId: { in: userIds },
          },
          _count: { id: true },
        });
        const countMap = new Map(
          existingCounts.map((e) => [e.userId, e._count.id]),
        );

        const skippedUsers: string[] = [];
        const issuedUsers: string[] = [];

        for (const userId of userIds) {
          const userCount = countMap.get(userId) || 0;
          if (userCount >= campaign.maxPerUser) {
            skippedUsers.push(userId);
            continue;
          }
          issuedUsers.push(userId);
        }

        if (issuedUsers.length === 0) {
          throw new BadRequestException('所有用户均已达到领取上限');
        }

        // 计算过期时间
        let expiresAt: Date;
        if (campaign.validDays > 0) {
          expiresAt = new Date(
            now.getTime() + campaign.validDays * 24 * 60 * 60 * 1000,
          );
        } else {
          expiresAt = campaign.endAt;
        }

        // 批量创建实例
        await tx.couponInstance.createMany({
          data: issuedUsers.map((userId) => ({
            campaignId,
            userId,
            status: 'AVAILABLE' as const,
            discountType: campaign.discountType,
            discountValue: campaign.discountValue,
            maxDiscountAmount: campaign.maxDiscountAmount,
            minOrderAmount: campaign.minOrderAmount,
            issuedAt: now,
            expiresAt,
          })),
        });

        // CAS 更新已发放数量
        const updated = await tx.couponCampaign.updateMany({
          where: {
            id: campaignId,
            issuedCount: campaign.issuedCount,
          },
          data: {
            issuedCount: { increment: issuedUsers.length },
          },
        });
        if (updated.count === 0) {
          throw new ConflictException('发放冲突，请重试');
        }

        this.logger.log(
          `管理员 ${adminId} 手动发放活动 ${campaignId} 给 ${issuedUsers.length} 位用户`,
        );

        return {
          issued: issuedUsers.length,
          skipped: skippedUsers.length,
          skippedUsers,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * 撤回红包实例（仅 AVAILABLE 状态可撤回）
   */
  async revokeInstance(instanceId: string) {
    const updated = await this.prisma.couponInstance.updateMany({
      where: {
        id: instanceId,
        status: 'AVAILABLE',
      },
      data: { status: 'REVOKED' },
    });

    if (updated.count === 0) {
      const current = await this.prisma.couponInstance.findUnique({
        where: { id: instanceId },
        select: { status: true },
      });
      if (!current) {
        throw new NotFoundException('红包实例不存在');
      }
      throw new BadRequestException(
        `只有可用状态的红包可以撤回，当前状态: ${current.status}`,
      );
    }

    this.logger.log(`红包实例 ${instanceId} 已撤回`);

    return { success: true };
  }

  /** 红包数据统计总览 */
  async getStats() {
    const now = new Date();

    // 活动统计
    const [totalCampaigns, activeCampaigns] = await Promise.all([
      this.prisma.couponCampaign.count(),
      this.prisma.couponCampaign.count({ where: { status: 'ACTIVE' } }),
    ]);

    // 实例统计
    const instanceStats = await this.prisma.couponInstance.groupBy({
      by: ['status'],
      _count: { id: true },
    });
    const statusMap: Record<string, number> = {};
    let totalIssued = 0;
    for (const s of instanceStats) {
      statusMap[s.status] = s._count.id;
      totalIssued += s._count.id;
    }
    const totalUsed = statusMap['USED'] || 0;

    // 总抵扣金额
    const totalDiscountResult = await this.prisma.couponUsageRecord.aggregate({
      _sum: { discountAmount: true },
    });
    const totalDiscountAmount = totalDiscountResult._sum.discountAmount || 0;

    // 使用率
    const usageRate = totalIssued > 0 ? totalUsed / totalIssued : 0;

    // 近 7 天趋势
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 近7天发放
    const recentInstances = await this.prisma.couponInstance.findMany({
      where: { issuedAt: { gte: sevenDaysAgo } },
      select: { issuedAt: true, status: true },
    });

    // 近7天使用记录
    const recentUsage = await this.prisma.couponUsageRecord.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
      select: { createdAt: true, discountAmount: true },
    });

    // 按天聚合
    const dailyMap = new Map<
      string,
      { issued: number; used: number; discountAmount: number }
    >();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() - (6 - i) * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyMap.set(key, { issued: 0, used: 0, discountAmount: 0 });
    }

    for (const inst of recentInstances) {
      const key = inst.issuedAt.toISOString().slice(0, 10);
      const day = dailyMap.get(key);
      if (day) {
        day.issued++;
      }
    }

    for (const usage of recentUsage) {
      const key = usage.createdAt.toISOString().slice(0, 10);
      const day = dailyMap.get(key);
      if (day) {
        day.used++;
        day.discountAmount += usage.discountAmount;
      }
    }

    const dailyTrend = Array.from(dailyMap.entries()).map(([date, data]) => ({
      date,
      ...data,
    }));

    return {
      totalCampaigns,
      activeCampaigns,
      totalIssued,
      totalUsed,
      totalDiscountAmount,
      avgUsageRate: Math.round(usageRate * 10000) / 100, // 百分比，保留2位小数
      usageRate: Math.round(usageRate * 10000) / 100, // 兼容旧字段
      dailyTrend,
    };
  }

  /** 单个活动统计 */
  async getCampaignStats(campaignId: string) {
    const campaign = await this.prisma.couponCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('红包活动不存在');
    }

    // 各状态计数
    const statusCounts = await this.prisma.couponInstance.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { id: true },
    });
    const statusMap: Record<string, number> = {};
    for (const sc of statusCounts) {
      statusMap[sc.status] = sc._count.id;
    }

    const usedCount = statusMap['USED'] || 0;
    const expiredCount = statusMap['EXPIRED'] || 0;

    // 总抵扣金额和平均抵扣
    const usageAgg = await this.prisma.couponUsageRecord.aggregate({
      where: { couponInstance: { campaignId } },
      _sum: { discountAmount: true },
      _avg: { discountAmount: true },
      _count: { id: true },
    });

    return {
      campaignId,
      campaignName: campaign.name,
      issuedCount: campaign.issuedCount,
      usedCount,
      expiredCount,
      revokedCount: statusMap['REVOKED'] || 0,
      availableCount: statusMap['AVAILABLE'] || 0,
      reservedCount: statusMap['RESERVED'] || 0,
      totalDiscountAmount: usageAgg._sum.discountAmount || 0,
      usageRate:
        campaign.issuedCount > 0
          ? Math.round((usedCount / campaign.issuedCount) * 10000) / 100
          : 0,
      avgDiscountPerOrder: usageAgg._avg.discountAmount || 0,
    };
  }

  // ========== 私有辅助方法 ==========

  /**
   * 触发事件去重写入（唯一键：userId + triggerType + eventKey）
   * 返回 true 表示首次写入，false 表示重复事件。
   */
  private async insertTriggerEventOnce(
    userId: string,
    triggerType: 'REVIEW' | 'SHARE',
    eventKey: string,
    context?: Record<string, any>,
  ): Promise<boolean> {
    try {
      await this.prisma.couponTriggerEvent.create({
        data: {
          userId,
          triggerType,
          eventKey,
          ...(context ? { context: context as Prisma.InputJsonValue } : {}),
        },
      });
      return true;
    } catch (err: any) {
      const isDuplicate =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002';
      if (isDuplicate) return false;
      throw err;
    }
  }

  /**
   * 检查红包是否满足订单的使用条件
   * 返回 { eligible, reason }
   */
  private checkEligibility(
    inst: {
      minOrderAmount: number;
      campaign: {
        applicableCategories: string[];
        applicableCompanyIds: string[];
      };
    },
    orderAmount: number,
    categoryIds: string[],
    companyIds: string[],
  ): { eligible: boolean; reason: string | null } {
    // 最低消费校验
    if (orderAmount < inst.minOrderAmount) {
      return {
        eligible: false,
        reason: `需最低消费 ${inst.minOrderAmount} 元，当前 ${orderAmount} 元`,
      };
    }

    // 品类约束
    const applicableCats = inst.campaign.applicableCategories;
    if (applicableCats.length > 0) {
      const hasMatch = categoryIds.some((cid) =>
        applicableCats.includes(cid),
      );
      if (!hasMatch) {
        return { eligible: false, reason: '不适用于当前商品品类' };
      }
    }

    // 店铺约束
    const applicableCompanies = inst.campaign.applicableCompanyIds;
    if (applicableCompanies.length > 0) {
      const hasMatch = companyIds.some((cid) =>
        applicableCompanies.includes(cid),
      );
      if (!hasMatch) {
        return { eligible: false, reason: '不适用于当前店铺' };
      }
    }

    return { eligible: true, reason: null };
  }

  /**
   * 计算单张红包的抵扣金额
   */
  private calculateDiscount(
    inst: {
      discountType: string;
      discountValue: number;
      maxDiscountAmount: number | null;
    },
    orderAmount: number,
  ): number {
    let discount: number;

    if (inst.discountType === 'FIXED') {
      discount = inst.discountValue;
    } else {
      // PERCENT：百分比折扣
      discount = (orderAmount * inst.discountValue) / 100;
      // 封顶
      if (inst.maxDiscountAmount && discount > inst.maxDiscountAmount) {
        discount = inst.maxDiscountAmount;
      }
    }

    // 不超过订单金额，保留两位小数避免浮点精度问题
    return Number(Math.min(discount, orderAmount).toFixed(2));
  }

  /**
   * 校验叠加规则
   * 同一 stackGroup 下，如果有 stackable=false 的红包，则只能选一张
   */
  private validateStackRules(
    instances: Array<{
      id: string;
      campaign: { stackable: boolean; stackGroup: string | null };
    }>,
  ) {
    // 按 stackGroup 分组
    const groupMap = new Map<string, typeof instances>();

    for (const inst of instances) {
      const group = inst.campaign.stackGroup || '__default__';
      const list = groupMap.get(group) || [];
      list.push(inst);
      groupMap.set(group, list);
    }

    for (const [group, list] of groupMap) {
      if (list.length <= 1) continue;

      // 检查组内是否有不可叠加的红包
      const nonStackable = list.filter((i) => !i.campaign.stackable);
      if (nonStackable.length > 0) {
        throw new BadRequestException(
          `红包 ${nonStackable[0].id} 不可与同组红包叠加使用（组: ${group === '__default__' ? '默认' : group}）`,
        );
      }
    }
  }
}
