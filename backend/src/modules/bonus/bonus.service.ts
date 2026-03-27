import { Injectable, NotFoundException, BadRequestException, Logger, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusConfigService, BonusConfig } from './engine/bonus-config.service';
import { MIN_WITHDRAW_AMOUNT, MAX_DAILY_WITHDRAWALS, MAX_BFS_ITERATIONS, MAX_TREE_DEPTH, MAX_ROOT_NODES, NORMAL_ROOT_ID } from './engine/constants';
import { CouponEngineService } from '../coupon/coupon-engine.service';

@Injectable()
export class BonusService {
  private readonly logger = new Logger(BonusService.name);

  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
    private couponEngine: CouponEngineService,
  ) {}

  // ========== 会员信息 ==========

  /** 获取会员信息 */
  async getMemberProfile(userId: string) {
    let member = await this.prisma.memberProfile.findUnique({ where: { userId } });
    if (!member) {
      // 自动创建
      member = await this.prisma.memberProfile.create({
        data: {
          userId,
          referralCode: this.generateReferralCode(),
        },
      });
    }

    const vipProgress = await this.prisma.vipProgress.findUnique({ where: { userId } });

    return {
      tier: member.tier,
      referralCode: member.referralCode,
      inviterUserId: member.inviterUserId,
      vipPurchasedAt: member.vipPurchasedAt?.toISOString() || null,
      normalEligible: member.normalEligible,
      vipProgress: vipProgress
        ? {
            selfPurchaseCount: vipProgress.selfPurchaseCount,
            unlockedLevel: vipProgress.unlockedLevel,
          }
        : null,
    };
  }

  /** 使用推荐码（支持换绑：VIP 前允许更换推荐人） */
  async useReferralCode(userId: string, code: string) {
    const inviter = await this.prisma.memberProfile.findUnique({
      where: { referralCode: code },
    });
    if (!inviter) throw new BadRequestException('推荐码无效');
    if (inviter.userId === userId) throw new BadRequestException('不能使用自己的推荐码');

    const result = await this.prisma.$transaction(async (tx) => {
      // 事务内检查 VIP 状态（防并发绕过）
      const currentMember = await tx.memberProfile.findUnique({
        where: { userId },
      });
      if (currentMember?.tier === 'VIP') {
        throw new BadRequestException('已加入 VIP 团队，无法更换推荐人');
      }

      const existing = await tx.referralLink.findUnique({
        where: { inviteeUserId: userId },
      });

      if (existing && existing.inviterUserId === inviter.userId) {
        return { success: true, inviterUserId: inviter.userId, isIdempotent: true };
      }

      if (existing) {
        await tx.referralLink.update({
          where: { inviteeUserId: userId },
          data: {
            inviterUserId: inviter.userId,
            codeUsed: code,
          },
        });
      } else {
        await tx.referralLink.create({
          data: {
            inviterUserId: inviter.userId,
            inviteeUserId: userId,
            codeUsed: code,
          },
        });
      }

      await tx.memberProfile.upsert({
        where: { userId },
        create: {
          userId,
          inviterUserId: inviter.userId,
          referralCode: this.generateReferralCode(),
        },
        update: { inviterUserId: inviter.userId },
      });

      return { success: true, inviterUserId: inviter.userId, isIdempotent: false };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    // 仅非幂等请求时触发 INVITE 红包
    if (!result.isIdempotent) {
      this.couponEngine
        .handleTrigger(inviter.userId, 'INVITE', {
          inviteeUserId: userId,
        })
        .catch((err: any) => {
          this.logger.warn(
            `INVITE 红包触发失败: inviterUserId=${inviter.userId}, inviteeUserId=${userId}, error=${err?.message}`,
          );
        });
    }

    return { success: true, inviterUserId: result.inviterUserId };
  }

  /**
   * 购买 VIP（C09 修复：防止并发重复购买）
   *
   * 将会员等级检查移入事务内部，并在事务中重新查询 MemberProfile，
   * 防止两个并发请求同时通过事务外的检查导致双重扣费和重复树节点。
   * 额外检查 VipPurchase 表中是否已有 PAID 记录作为二次保障，
   * 并捕获 P2002 唯一约束违反作为最终兜底。
   */
  async purchaseVip(userId: string) {
    try {
      // S05修复：Serializable 隔离级别，防止 VIP 树并发插入位置冲突
      await this.prisma.$transaction(async (tx) => {
        // 事务内重新查询会员信息，确保读取最新状态（防止并发竞态）
        const member = await tx.memberProfile.findUnique({ where: { userId } });
        if (member?.tier === 'VIP') {
          throw new BadRequestException('已是 VIP 会员');
        }

        // 二次保障：检查是否已存在 PAID 状态的 VipPurchase 记录
        const existingPurchase = await tx.vipPurchase.findFirst({
          where: { userId, status: 'PAID' },
        });
        if (existingPurchase) {
          this.logger.warn(`用户 ${userId} 已有 PAID 状态的 VipPurchase 记录，拒绝重复购买`);
          throw new BadRequestException('已是 VIP 会员');
        }

        // 创建 VIP 购买记录（遗留路径：价格由 VipPackage 管理，此处 amount=0 仅供兼容）
        const vipPurchase = await tx.vipPurchase.create({
          data: { userId, amount: 0, status: 'PAID', packageId: undefined, referralBonusRate: 0 },
        });

        // 更新会员等级
        const updatedMember = await tx.memberProfile.upsert({
          where: { userId },
          create: {
            userId,
            tier: 'VIP',
            vipPurchasedAt: new Date(),
            referralCode: this.generateReferralCode(),
          },
          update: {
            tier: 'VIP',
            vipPurchasedAt: new Date(),
          },
        });

        // 创建 VIP 进度
        await tx.vipProgress.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });

        // 分配三叉树节点（BFS 插入）
        await this.assignVipTreeNode(tx, userId);

        // ===== 推荐人 VIP 推荐奖励 =====
        const inviterUserId = updatedMember.inviterUserId || member?.inviterUserId;
        const referralBonusRate = vipPurchase.referralBonusRate ?? 0;
        const referralBonus = Math.round(vipPurchase.amount * referralBonusRate * 100) / 100;

        if (inviterUserId && referralBonus > 0) {
          await this.grantVipReferralBonus(tx, inviterUserId, userId, referralBonus, vipPurchase.id);
        }

        // ===== 冻结普通树进度（VIP/Normal 隔离） =====
        const normalProgress = await tx.normalProgress.findUnique({
          where: { userId },
        });
        if (normalProgress && !normalProgress.frozenAt) {
          await tx.normalProgress.update({
            where: { userId },
            data: { frozenAt: new Date() },
          });
          this.logger.log(`用户 ${userId} 成为 VIP，普通树进度已冻结`);
        }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err: any) {
      // 兜底：捕获 P2002 唯一约束违反（并发双提交场景）
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(`用户 ${userId} VIP 购买被唯一约束拦截（并发重复提交）`);
        throw new ConflictException('VIP 购买正在处理中，请勿重复提交');
      }
      // BadRequestException 等业务异常直接抛出
      throw err;
    }

    return this.getMemberProfile(userId);
  }

  /**
   * 支付成功后激活 VIP（Phase 3）
   * 从 purchaseVip() 逻辑提取，但由支付回调触发，使用 orderId 做幂等控制。
   * 整个激活过程在单个 Serializable 事务中完成。
   */
  async activateVipAfterPayment(
    userId: string,
    orderId: string,
    giftOptionId: string,
    amount: number,
    giftSnapshot: Record<string, any>,
    packageId?: string,
    referralBonusRate?: number,
  ) {
    const config = await this.bonusConfig.getConfig();
    let vipPurchaseId: string | null = null;
    let retrying = false;

    try {
      const prepareResult = await this.prisma.$transaction(async (tx) => {
        const existingPurchase = await tx.vipPurchase.findUnique({
          where: { userId },
        });
        if (existingPurchase) {
          if (existingPurchase.orderId && existingPurchase.orderId !== orderId) {
            this.logger.warn(
              `用户 ${userId} 已有关联其他订单的 VipPurchase，跳过本次激活：existingOrderId=${existingPurchase.orderId}, orderId=${orderId}`,
            );
            return { skip: true, vipPurchaseId: existingPurchase.id, retrying: false };
          }

          if (
            existingPurchase.orderId === orderId &&
            ['ACTIVATING', 'RETRYING', 'SUCCESS'].includes(existingPurchase.activationStatus)
          ) {
            return {
              skip: true,
              vipPurchaseId: existingPurchase.id,
              retrying: false,
            };
          }

          const nextStatus =
            existingPurchase.activationStatus === 'FAILED' ? 'RETRYING' : 'PENDING';
          const updated = await tx.vipPurchase.update({
            where: { id: existingPurchase.id },
            data: {
              orderId,
              amount,
              status: 'PAID',
              giftOptionId,
              giftSkuId: null,
              giftSnapshot,
              source: 'APP_VIP_PACKAGE',
              activationStatus:
                existingPurchase.activationStatus === 'SUCCESS' ? 'SUCCESS' : nextStatus,
              activationError: null,
              packageId: packageId ?? null,
              referralBonusRate: referralBonusRate ?? 0,
            },
          });
          return {
            skip: updated.activationStatus === 'SUCCESS',
            vipPurchaseId: updated.id,
            retrying: nextStatus === 'RETRYING',
          };
        }

        const vipPurchase = await tx.vipPurchase.create({
          data: {
            userId,
            orderId,
            amount,
            status: 'PAID',
            giftOptionId,
            giftSkuId: null,
            giftSnapshot,
            source: 'APP_VIP_PACKAGE',
            activationStatus: 'PENDING',
            packageId: packageId ?? null,
            referralBonusRate: referralBonusRate ?? 0,
          },
        });
        return { skip: false, vipPurchaseId: vipPurchase.id, retrying: false };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });

      if (prepareResult.skip) {
        return;
      }
      vipPurchaseId = prepareResult.vipPurchaseId;
      retrying = prepareResult.retrying;

      await this.prisma.$transaction(async (tx) => {
        const casResult = await tx.vipPurchase.updateMany({
          where: {
            id: vipPurchaseId!,
            activationStatus: { in: retrying ? ['FAILED'] : ['PENDING'] },
          },
          data: {
            activationStatus: retrying ? 'RETRYING' : 'ACTIVATING',
            activationError: null,
          },
        });
        if (casResult.count === 0) {
          this.logger.warn(
            `VIP 激活状态已被其他流程接管，跳过本次执行：userId=${userId}, orderId=${orderId}, retrying=${retrying}`,
          );
          return;
        }
        const vipPurchase = await tx.vipPurchase.findUnique({
          where: { id: vipPurchaseId! },
        });
        if (!vipPurchase) {
          throw new BadRequestException('VIP 购买记录不存在');
        }

        // 事务内重新查询会员信息，确保读取最新状态
        const member = await tx.memberProfile.findUnique({ where: { userId } });
        if (member?.tier === 'VIP') {
          await tx.vipPurchase.update({
            where: { id: vipPurchase.id },
            data: { activationStatus: 'SUCCESS', activationError: null },
          });
          this.logger.warn(`用户 ${userId} 已是 VIP，补记激活成功（orderId=${orderId}）`);
          return;
        }

        // 更新会员等级
        const updatedMember = await tx.memberProfile.upsert({
          where: { userId },
          create: {
            userId,
            tier: 'VIP',
            vipPurchasedAt: new Date(),
            referralCode: this.generateReferralCode(),
          },
          update: {
            tier: 'VIP',
            vipPurchasedAt: new Date(),
          },
        });

        // 创建 VIP 进度
        await tx.vipProgress.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });

        // 分配三叉树节点
        await this.assignVipTreeNode(tx, userId);

        // 推荐人 VIP 推荐奖励（按购买金额 × 推荐奖励比例计算）
        const inviterUserId = updatedMember.inviterUserId || member?.inviterUserId;
        const referralBonusRateSnapshot = vipPurchase.referralBonusRate ?? 0;
        const referralBonus = Math.round(vipPurchase.amount * referralBonusRateSnapshot * 100) / 100;
        if (inviterUserId && referralBonus > 0) {
          await this.grantVipReferralBonus(tx, inviterUserId, userId, referralBonus, vipPurchase.id);
        }

        // 冻结普通树进度
        const normalProgress = await tx.normalProgress.findUnique({
          where: { userId },
        });
        if (normalProgress && !normalProgress.frozenAt) {
          await tx.normalProgress.update({
            where: { userId },
            data: { frozenAt: new Date() },
          });
          this.logger.log(`用户 ${userId} 成为 VIP，普通树进度已冻结`);
        }

        // 激活成功
        await tx.vipPurchase.update({
          where: { id: vipPurchase.id },
          data: { activationStatus: 'SUCCESS', activationError: null },
        });

        this.logger.log(`用户 ${userId} VIP 激活成功（orderId=${orderId}）`);
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err: any) {
      // P2002 唯一约束违反 = 并发重复提交，视为幂等成功
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(`用户 ${userId} VIP 激活被唯一约束拦截（并发重复提交）`);
        return;
      }
      // 激活失败，记录错误状态
      try {
        if (vipPurchaseId) {
          await this.prisma.vipPurchase.update({
            where: { id: vipPurchaseId },
            data: {
              activationStatus: 'FAILED',
              activationError: err.message?.slice(0, 500) || 'Unknown error',
            },
          });
        } else {
          this.logger.warn(
            `VIP 激活失败但未拿到 VipPurchase 记录，需人工核查：userId=${userId}, orderId=${orderId}`,
          );
        }
      } catch (updateErr: any) {
        this.logger.error(
          `VIP 激活失败且状态更新也失败（需手动修复）：userId=${userId}, activationErr=${err.message}, updateErr=${updateErr.message}`,
        );
      }
      throw err;
    }
  }

  // ========== VIP 赠品方案 ==========

  /** 获取 VIP 档位列表及各档位赠品方案（前台） */
  async getVipGiftOptions() {
    const packages = await this.prisma.vipPackage.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
      select: {
        id: true,
        price: true,
        sortOrder: true,
        giftOptions: {
          where: { status: 'ACTIVE' },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            title: true,
            subtitle: true,
            coverMode: true,
            coverUrl: true,
            badge: true,
            items: {
              orderBy: { sortOrder: 'asc' },
              select: {
                skuId: true,
                quantity: true,
                sku: {
                  select: {
                    id: true,
                    title: true,
                    price: true,
                    stock: true,
                    status: true,
                    product: {
                      select: {
                        title: true,
                        status: true,
                        media: {
                          where: { type: 'IMAGE' },
                          orderBy: { sortOrder: 'asc' },
                          take: 1,
                          select: { url: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return {
      packages: packages.map((pkg) => ({
        id: pkg.id,
        price: pkg.price,
        sortOrder: pkg.sortOrder,
        giftOptions: pkg.giftOptions.map((opt) => {
          const totalPrice = opt.items.reduce(
            (sum, item) => sum + item.sku.price * item.quantity,
            0,
          );
          const available = opt.items.length > 0 && opt.items.every(
            (item) =>
              item.sku.status === 'ACTIVE' &&
              item.sku.product?.status === 'ACTIVE' &&
              item.sku.stock >= item.quantity,
          );
          return {
            id: opt.id,
            title: opt.title,
            subtitle: opt.subtitle,
            coverMode: opt.coverMode,
            coverUrl: opt.coverUrl,
            badge: opt.badge,
            totalPrice,
            available,
            items: opt.items.map((item) => ({
              skuId: item.skuId,
              productTitle: item.sku.product?.title || '',
              productImage: item.sku.product?.media?.[0]?.url || null,
              skuTitle: item.sku.title,
              price: item.sku.price,
              quantity: item.quantity,
            })),
          };
        }),
      })),
    };
  }

  // ========== 奖励钱包 ==========

  /** 获取奖励钱包（合并 VIP + 普通奖励账户） */
  async getWallet(userId: string) {
    const accounts = await this.prisma.rewardAccount.findMany({
      where: { userId, type: { in: ['VIP_REWARD', 'NORMAL_REWARD'] } },
    });

    const vip = accounts.find((a) => a.type === 'VIP_REWARD');
    const normal = accounts.find((a) => a.type === 'NORMAL_REWARD');

    const vipBalance = vip?.balance ?? 0;
    const vipFrozen = vip?.frozen ?? 0;
    const normalBalance = normal?.balance ?? 0;
    const normalFrozen = normal?.frozen ?? 0;

    return {
      balance: vipBalance + normalBalance,
      frozen: vipFrozen + normalFrozen,
      total: vipBalance + vipFrozen + normalBalance + normalFrozen,
      // 分账户明细
      vip: { balance: vipBalance, frozen: vipFrozen },
      normal: { balance: normalBalance, frozen: normalFrozen },
    };
  }

  /** 获取奖励流水 */
  async getWalletLedger(userId: string, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.rewardLedger.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.rewardLedger.count({ where: { userId } }),
    ]);

    return {
      items: items.map((l) => ({
        id: l.id,
        entryType: l.entryType,
        amount: l.amount,
        status: l.status,
        refType: l.refType,
        meta: l.meta,
        createdAt: l.createdAt.toISOString(),
      })),
      nextPage: skip + pageSize < total ? page + 1 : undefined,
    };
  }

  /** 申请提现（支持 VIP VIP_REWARD 和普通 NORMAL_REWARD 账户） */
  async requestWithdraw(userId: string, dto: { amount: number; channel: string; accountType?: 'VIP_REWARD' | 'NORMAL_REWARD' }) {
    if (dto.amount <= 0) throw new BadRequestException('提现金额必须大于 0');
    // L7修复：最小提现金额限制
    if (dto.amount < MIN_WITHDRAW_AMOUNT) {
      throw new BadRequestException(`最小提现金额为 ${MIN_WITHDRAW_AMOUNT} 元`);
    }

    // 确定提现账户类型：客户端可指定，默认自动选择余额充足的账户
    const validTypes: readonly string[] = ['VIP_REWARD', 'NORMAL_REWARD'];
    let targetType: string;

    if (dto.accountType && validTypes.includes(dto.accountType)) {
      targetType = dto.accountType;
    } else {
      // 自动选择：优先 VIP 账户，不足则尝试普通账户
      const accounts = await this.prisma.rewardAccount.findMany({
        where: { userId, type: { in: ['VIP_REWARD', 'NORMAL_REWARD'] as any } },
      });
      const vipAcc = accounts.find((a) => a.type === 'VIP_REWARD');
      const normalAcc = accounts.find((a) => a.type === 'NORMAL_REWARD');

      if (vipAcc && Math.round(vipAcc.balance * 100) >= Math.round(dto.amount * 100)) {
        targetType = 'VIP_REWARD';
      } else if (normalAcc && Math.round(normalAcc.balance * 100) >= Math.round(dto.amount * 100)) {
        targetType = 'NORMAL_REWARD';
      } else {
        throw new BadRequestException('余额不足');
      }
    }

    const account = await this.prisma.rewardAccount.findUnique({
      where: { userId_type: { userId, type: targetType as any } },
    });
    // L03修复：转换为分（整数）比较，避免浮点精度问题
    if (!account || Math.round(account.balance * 100) < Math.round(dto.amount * 100)) {
      throw new BadRequestException('余额不足');
    }

    const channelMap: Record<string, string> = {
      wechat: 'WECHAT',
      alipay: 'ALIPAY',
      bankcard: 'BANKCARD',
    };

    // M09 修复：提现余额扣减使用 Serializable 隔离级别，防止并发提现超额
    const request = await this.prisma.$transaction(async (tx) => {
      // L7修复：每日提现次数限制（移入事务内，防止并发绕过）
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayCount = await tx.withdrawRequest.count({
        where: { userId, createdAt: { gte: todayStart } },
      });
      if (todayCount >= MAX_DAILY_WITHDRAWALS) {
        throw new BadRequestException(`每日最多提现 ${MAX_DAILY_WITHDRAWALS} 次`);
      }

      // 事务内重新检查余额，防止并发扣减
      const freshAccount = await tx.rewardAccount.findUnique({
        where: { id: account.id },
      });
      // L03修复：事务内同样使用整数比较，避免浮点精度问题
      if (!freshAccount || Math.round(freshAccount.balance * 100) < Math.round(dto.amount * 100)) {
        throw new BadRequestException('余额不足');
      }

      // 冻结金额
      await tx.rewardAccount.update({
        where: { id: account.id },
        data: {
          balance: { decrement: dto.amount },
          frozen: { increment: dto.amount },
        },
      });

      const wr = await tx.withdrawRequest.create({
        data: {
          userId,
          amount: dto.amount,
          channel: (channelMap[dto.channel] || 'WECHAT') as any,
          status: 'REQUESTED',
          accountType: targetType, // 记录提现账户类型，审批/拒绝时使用
        },
      });

      // P0-4: 创建提现流水记录
      await tx.rewardLedger.create({
        data: {
          accountId: account.id,
          userId,
          entryType: 'WITHDRAW',
          amount: dto.amount,
          status: 'FROZEN',
          refType: 'WITHDRAW',
          refId: wr.id,
          meta: { scheme: 'WITHDRAW', channel: dto.channel, accountType: targetType },
        },
      });

      return wr;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    return {
      id: request.id,
      amount: request.amount,
      channel: request.channel,
      status: request.status,
      createdAt: request.createdAt.toISOString(),
    };
  }

  /** 提现记录 */
  async getWithdrawHistory(userId: string) {
    const requests = await this.prisma.withdrawRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return requests.map((r) => ({
      id: r.id,
      amount: r.amount,
      channel: r.channel,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ========== 奖励抵扣 ==========

  /**
   * 获取可用奖励列表（结算页抵扣选择）
   * 从 RewardLedger 中筛选 SETTLED 的 CREDIT 条目，
   * 每条视为一张可用奖励。
   */
  async getAvailableRewards(userId: string) {
    const now = new Date();

    // F5修复：获取可配置奖励有效期
    const config = await this.bonusConfig.getConfig();

    // 查询用户已解锁的可用奖励条目（VIP + 普通奖励账户，entryType=RELEASE, status=AVAILABLE）
    const accounts = await this.prisma.rewardAccount.findMany({
      where: { userId, type: { in: ['VIP_REWARD', 'NORMAL_REWARD'] } },
      select: { id: true, type: true },
    });
    const accountIds = accounts.map((a) => a.id);
    // 建立 accountId → type 映射，用于确定奖励过期天数
    const accountTypeMap = new Map(accounts.map(a => [a.id, a.type]));

    const entries = await this.prisma.rewardLedger.findMany({
      where: {
        userId,
        accountId: { in: accountIds },
        entryType: 'RELEASE',
        status: 'AVAILABLE',
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // 排除已标记为已使用的奖励（meta 中标记 usedForOrder）
    const available = entries.filter((e) => {
      const meta = e.meta as any;
      return !meta?.usedForOrder;
    });

    // 来源映射
    const sourceMap: Record<string, string> = {
      ORDER: '订单奖励',
      REFERRAL: '推荐奖励',
      VIP_REFERRAL: 'VIP 推荐奖励',
      VIP_BONUS: 'VIP 分润',
      BROADCAST: '广播分润',
      NORMAL_TREE: '普通树分润',
      NORMAL_BROADCAST: '普通广播分润',
    };

    return available.map((entry) => {
      // F5修复：根据账户类型使用可配置奖励有效期
      const accountType = accountTypeMap.get(entry.accountId);
      const expiryDays = accountType === 'NORMAL_REWARD'
        ? config.normalRewardExpiryDays
        : config.vipRewardExpiryDays;
      const expireAt = new Date(entry.createdAt);
      expireAt.setDate(expireAt.getDate() + expiryDays);

      const isExpired = expireAt < now;

      return {
        id: entry.id,
        amount: entry.amount,
        sourceType: entry.refType || null,
        source: sourceMap[entry.refType || ''] || '平台奖励',
        minOrderAmount: entry.amount >= 10 ? entry.amount * 5 : 0,
        expireAt: expireAt.toISOString().slice(0, 10),
        status: isExpired ? 'EXPIRED' : 'AVAILABLE',
      };
    });
  }

  // ========== VIP 三叉树 ==========

  /** 获取 VIP 三叉树可视化数据 */
  async getVipTree(userId: string) {
    const member = await this.prisma.memberProfile.findUnique({ where: { userId } });
    if (!member?.vipNodeId) return { node: null, children: [] };

    const myNode = await this.prisma.vipTreeNode.findUnique({
      where: { id: member.vipNodeId },
      include: {
        children: {
          include: {
            children: true, // 2 层深
          },
        },
      },
    });

    if (!myNode) return { node: null, children: [] };

    return {
      node: {
        id: myNode.id,
        rootId: myNode.rootId,
        level: myNode.level,
        position: myNode.position,
        childrenCount: myNode.childrenCount,
      },
      children: myNode.children.map((c) => ({
        id: c.id,
        userId: c.userId,
        level: c.level,
        position: c.position,
        childrenCount: c.childrenCount,
        children: c.children.map((gc) => ({
          id: gc.id,
          userId: gc.userId,
          level: gc.level,
          position: gc.position,
          childrenCount: gc.childrenCount,
        })),
      })),
    };
  }

  // ========== 普通奖励钱包 ==========

  /** 获取普通奖励钱包（NORMAL_REWARD 账户） */
  async getNormalWallet(userId: string) {
    const account = await this.prisma.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'NORMAL_REWARD' } },
    });

    return {
      balance: account?.balance ?? 0,
      frozen: account?.frozen ?? 0,
      total: (account?.balance ?? 0) + (account?.frozen ?? 0),
    };
  }

  /** 获取普通奖励列表（含冻结状态、解锁条件、过期倒计时） */
  async getNormalRewards(userId: string, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;

    const account = await this.prisma.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'NORMAL_REWARD' } },
    });
    if (!account) return { items: [], total: 0, page, pageSize };

    const [items, total] = await Promise.all([
      this.prisma.rewardLedger.findMany({
        where: {
          accountId: account.id,
          userId,
          entryType: { in: ['FREEZE', 'RELEASE'] },
          status: { in: ['FROZEN', 'AVAILABLE'] },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.rewardLedger.count({
        where: {
          accountId: account.id,
          userId,
          entryType: { in: ['FREEZE', 'RELEASE'] },
          status: { in: ['FROZEN', 'AVAILABLE'] },
        },
      }),
    ]);

    const now = new Date();

    return {
      items: items.map((l) => {
        const meta = l.meta as any;
        const expiresAt = meta?.expiresAt ? new Date(meta.expiresAt) : null;
        const requiredLevel = meta?.requiredLevel ?? null;

        return {
          id: l.id,
          amount: l.amount,
          status: l.status,
          entryType: l.entryType,
          // 冻结奖励的解锁条件
          requiredLevel,
          // 过期时间和剩余天数
          expiresAt: expiresAt?.toISOString() ?? null,
          remainingDays: expiresAt
            ? Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000))
            : null,
          sourceOrderId: meta?.sourceOrderId ?? null,
          scheme: meta?.scheme ?? null,
          createdAt: l.createdAt.toISOString(),
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  // ========== 普通用户树可视化 ==========

  /** 获取买家自己的普通树上下文（节点位置、父节点、子节点、面包屑） */
  async getNormalTreeContext(userId: string) {
    const node = await this.prisma.normalTreeNode.findUnique({
      where: { userId },
    });
    if (!node) return { inTree: false, node: null, breadcrumb: [], parent: null, children: [] };

    // 消费进度
    const progress = await this.prisma.normalProgress.findUnique({
      where: { userId },
    });

    // 面包屑（沿 parentId 向上至根节点）
    const breadcrumb: Array<{ level: number; isRoot: boolean }> = [];
    let cur = node;
    const visited = new Set<string>([node.id]);
    let hops = 0;
    while (cur.parentId && hops < 64) {
      if (visited.has(cur.parentId)) break;
      visited.add(cur.parentId);
      hops++;

      const parent = await this.prisma.normalTreeNode.findUnique({ where: { id: cur.parentId } });
      if (!parent) break;
      breadcrumb.unshift({
        level: parent.level,
        isRoot: parent.userId === null,
      });
      if (!parent.userId) break; // 到达系统根节点
      cur = parent;
    }

    // 当前节点信息
    const currentView = {
      level: node.level,
      position: node.position,
      childrenCount: node.childrenCount,
      selfPurchaseCount: progress?.selfPurchaseCount ?? 0,
      frozenAt: progress?.frozenAt?.toISOString() ?? null,
    };

    // 子节点（仅展示基础信息，隐私保护不暴露其他用户详情）
    const childNodes = await this.prisma.normalTreeNode.findMany({
      where: { parentId: node.id },
      orderBy: { position: 'asc' },
    });

    const children = childNodes.map((c) => ({
      level: c.level,
      position: c.position,
      childrenCount: c.childrenCount,
      hasUser: c.userId !== null,
    }));

    return {
      inTree: true,
      node: currentView,
      breadcrumb,
      children,
      treeDepth: node.level,
    };
  }

  // ========== 普通奖励队列（已废弃，保留兼容） ==========

  /** 获取排队状态 */
  async getQueueStatus(userId: string) {
    const queueMember = await this.prisma.normalQueueMember.findFirst({
      where: { userId, active: true },
      include: { bucket: true },
      orderBy: { joinedAt: 'desc' },
    });

    if (!queueMember) return { inQueue: false };

    // 计算前面还有多少人
    const position = await this.prisma.normalQueueMember.count({
      where: {
        bucketId: queueMember.bucketId,
        active: true,
        joinedAt: { lt: queueMember.joinedAt },
      },
    });

    return {
      inQueue: true,
      bucketKey: queueMember.bucket.bucketKey,
      position: position + 1,
      joinedAt: queueMember.joinedAt.toISOString(),
    };
  }

  // ========== 普通树节点分配 ==========

  /**
   * 普通树轮询平衡插入（公开版本，供管理后台等场景调用）
   *
   * 单棵树、单个平台根节点（NORMAL_ROOT），按层级从上到下、从左到右依次填充。
   */
  async assignNormalTreeNode(tx: any, userId: string, config: BonusConfig): Promise<void> {
    const branchFactor = config.normalBranchFactor;

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

    for (let level = 1; level <= MAX_TREE_DEPTH; level++) {
      const nodeCount = await tx.normalTreeNode.count({
        where: { rootId: NORMAL_ROOT_ID, level },
      });
      const parentCount = await tx.normalTreeNode.count({
        where: { rootId: NORMAL_ROOT_ID, level: level - 1 },
      });

      if (parentCount === 0) break;

      const maxNodes = parentCount * branchFactor;

      if (nodeCount < maxNodes) {
        const parentIndex = nodeCount % parentCount;
        const position = Math.floor(nodeCount / parentCount);

        const parentNode = await tx.normalTreeNode.findFirst({
          where: { rootId: NORMAL_ROOT_ID, level: level - 1 },
          orderBy: { createdAt: 'asc' },
          skip: parentIndex,
        });

        if (!parentNode) break;

        await tx.normalTreeNode.update({
          where: { id: parentNode.id },
          data: { childrenCount: { increment: 1 } },
        });

        const newNode = await tx.normalTreeNode.create({
          data: {
            rootId: NORMAL_ROOT_ID,
            userId,
            parentId: parentNode.id,
            level,
            position,
          },
        });

        await tx.memberProfile.updateMany({
          where: { userId },
          data: {
            normalTreeNodeId: newNode.id,
            normalJoinedAt: new Date(),
          },
        });

        await tx.normalProgress.update({
          where: { userId },
          data: { treeNodeId: newNode.id },
        });

        this.logger.log(
          `普通树插入：用户 ${userId} → level=${level}, parentId=${parentNode.id}, position=${position}`,
        );
        return;
      }
    }

    this.logger.error(`普通树已满，无法为用户 ${userId} 分配节点`);
  }

  // ========== VIP 推荐奖励 ==========

  /**
   * 给推荐人发放 VIP 推荐奖励
   *
   * 被推荐用户购买 VIP 后，推荐人立即获得可用奖励。
   * 金额由 VipPurchase 记录中的 amount × referralBonusRate 计算。
   */
  private async grantVipReferralBonus(
    tx: any,
    inviterUserId: string,
    inviteeUserId: string,
    amount: number,
    vipPurchaseId: string,
  ) {
    // 查找或创建推荐人的奖励账户
    const account = await tx.rewardAccount.upsert({
      where: { userId_type: { userId: inviterUserId, type: 'VIP_REWARD' } },
      create: { userId: inviterUserId, type: 'VIP_REWARD', balance: 0, frozen: 0 },
      update: {},
    });

    // 创建奖励流水：直接可用
    await tx.rewardLedger.create({
      data: {
        accountId: account.id,
        userId: inviterUserId,
        entryType: 'RELEASE',
        amount,
        status: 'AVAILABLE',
        refType: 'VIP_REFERRAL',
        refId: vipPurchaseId,
        meta: {
          scheme: 'VIP_REFERRAL',
          sourceUserId: inviteeUserId,
          description: 'VIP 推荐奖励',
        },
      },
    });

    // 增加推荐人奖励余额
    await tx.rewardAccount.update({
      where: { id: account.id },
      data: { balance: { increment: amount } },
    });

    this.logger.log(
      `VIP 推荐奖励：推荐人 ${inviterUserId} 获得 ${amount} 元（被推荐人 ${inviteeUserId} 购买 VIP）`,
    );
  }

  // ========== 私有方法 ==========

  /**
   * 三叉树 BFS 插入（修复版）
   *
   * 有推荐人：在推荐人节点下 BFS 滑落插入
   * 无推荐人：遍历 A1→A2→...→A10 找第一个有空位的系统节点
   */
  private async assignVipTreeNode(tx: any, userId: string) {
    const member = await tx.memberProfile.findUnique({ where: { userId } });

    let parentNode: any = null;
    let rootId: string = '';

    if (member?.inviterUserId) {
      // ===== 有推荐人：在推荐人子树内 BFS 滑落 =====
      const inviterMember = await tx.memberProfile.findUnique({
        where: { userId: member.inviterUserId },
      });

      if (inviterMember?.vipNodeId) {
        const inviterNode = await tx.vipTreeNode.findUnique({
          where: { id: inviterMember.vipNodeId },
        });

        if (inviterNode) {
          if (inviterNode.childrenCount < 3) {
            // 推荐人有空位，直接插入
            parentNode = inviterNode;
            rootId = inviterNode.rootId;
          } else {
            // 推荐人已满，BFS 在推荐人子树内滑落
            const found = await this.bfsInSubtree(tx, inviterNode.id);
            if (found) {
              parentNode = found;
              rootId = inviterNode.rootId;
            }
            // 若 found 为 null（子树全满），parentNode 仍为 null，降级到系统节点
          }
        }
      }
    }

    if (!parentNode) {
      // ===== 无推荐人 / 推荐人无节点：遍历系统节点 A1-A10 =====
      for (let i = 1; i <= 10; i++) {
        const sysRootId = `A${i}`;
        const sysNode = await tx.vipTreeNode.findFirst({
          where: { rootId: sysRootId, level: 0 },
        });
        if (sysNode && sysNode.childrenCount < 3) {
          parentNode = sysNode;
          rootId = sysRootId;
          break;
        }
      }

      // A1-A10 全满 → 找 A11, A12, ...（L8修复：上限 MAX_ROOT_NODES 防止无限循环）
      if (!parentNode) {
        let nextIdx = 11;
        const maxIdx = 10 + MAX_ROOT_NODES;
        while (nextIdx <= maxIdx) {
          const sysRootId = `A${nextIdx}`;
          let sysNode = await tx.vipTreeNode.findFirst({
            where: { rootId: sysRootId, level: 0 },
          });
          if (!sysNode) {
            // 创建新系统根节点
            sysNode = await tx.vipTreeNode.create({
              data: { rootId: sysRootId, userId: null, level: 0, position: 0 },
            });
          }
          if (sysNode.childrenCount < 3) {
            parentNode = sysNode;
            rootId = sysRootId;
            break;
          }
          nextIdx++;
        }
        if (!parentNode) {
          throw new BadRequestException('系统节点已达上限，无法分配VIP位置');
        }
      }
    }

    rootId = rootId || parentNode.rootId;

    // S05修复：先原子 increment childrenCount 并读取新值，再用 newCount-1 作为 position
    // 避免并发读到相同 childrenCount 导致位置冲突
    const updatedParent = await tx.vipTreeNode.update({
      where: { id: parentNode.id },
      data: { childrenCount: { increment: 1 } },
    });

    const newNode = await tx.vipTreeNode.create({
      data: {
        rootId,
        userId,
        parentId: parentNode.id,
        level: parentNode.level + 1,
        position: updatedParent.childrenCount - 1,
      },
    });

    // 更新 MemberProfile 中的 vipNodeId
    await tx.memberProfile.update({
      where: { userId },
      data: { vipNodeId: newNode.id },
    });
  }

  /**
   * 在指定节点的子树内 BFS，找到第一个 childrenCount < 3 的节点
   * 若子树已满，返回 null
   */
  private async bfsInSubtree(tx: any, startNodeId: string): Promise<any | null> {
    // L8修复：BFS 同时限制迭代次数和树深度
    // queue 元素为 [nodeId, depth] 对
    const queue: Array<{ id: string; depth: number }> = [{ id: startNodeId, depth: 0 }];
    let iterations = 0;

    while (queue.length > 0) {
      if (++iterations > MAX_BFS_ITERATIONS) {
        this.logger.warn(`BFS 遍历超过 ${MAX_BFS_ITERATIONS} 次迭代，中止搜索（startNodeId=${startNodeId}）`);
        break;
      }
      const current = queue.shift()!;

      // 超过最大深度则不再向下展开子节点
      if (current.depth >= MAX_TREE_DEPTH) {
        continue;
      }

      const children = await tx.vipTreeNode.findMany({
        where: { parentId: current.id },
        orderBy: { position: 'asc' },
      });

      for (const child of children) {
        if (child.childrenCount < 3) {
          return child;
        }
        queue.push({ id: child.id, depth: current.depth + 1 });
      }
    }

    // 子树已满或超限，返回 null 让调用方降级到系统节点
    return null;
  }

  /** 生成推荐码 */
  private generateReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
