import { Injectable, NotFoundException, BadRequestException, Logger, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusConfigService, BonusConfig } from './engine/bonus-config.service';
import {
  MAX_BFS_ITERATIONS,
  MAX_TREE_DEPTH,
  MAX_ROOT_NODES,
  NORMAL_ROOT_ID,
  PLATFORM_USER_ID,
} from './engine/constants';
import { CouponEngineService } from '../coupon/coupon-engine.service';
import { DigitalAssetService } from '../digital-asset/digital-asset.service';
import { NotificationService } from '../notification/notification.service';
import { pickUniqueReferralCode } from '../../common/utils/referral-code.util';
import { maskPhone } from '../../common/security/privacy-mask';
import { decryptJsonValue } from '../../common/security/encryption';

const APP_WALLET_OWNER_REWARD_ACCOUNT_TYPES = ['VIP_REWARD', 'NORMAL_REWARD', 'INDUSTRY_FUND'];
const APP_WALLET_MEMBER_REWARD_ACCOUNT_TYPES = ['VIP_REWARD', 'NORMAL_REWARD'];
type WithdrawSnapshotSource = 'UNIFIED_POINTS' | 'GROUP_BUY_REBATE_LEGACY';

const REWARD_SOURCE_LABELS: Record<string, string> = {
  ORDER: '订单奖励',
  REFERRAL: '推荐奖励',
  VIP_REFERRAL: 'VIP 推荐奖励',
  VIP_DIRECT_REFERRAL: 'VIP 直推佣金',
  VIP_UPSTREAM: 'VIP 上溯分润',
  VIP_BONUS: 'VIP 分润',
  BROADCAST: '广播分润',
  NORMAL_TREE: '普通树分润',
  NORMAL_BROADCAST: '普通广播分润',
};

function getLedgerScheme(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return null;
  }
  const scheme = (meta as { scheme?: unknown }).scheme;
  return typeof scheme === 'string' && scheme.length > 0 ? scheme : null;
}

function getRewardSourceType(refType: string | null, meta: unknown): string | null {
  return getLedgerScheme(meta) ?? refType;
}

function getKnownRewardSourceLabel(refType: string | null, meta: unknown): string | null {
  const sourceType = getRewardSourceType(refType, meta);
  return sourceType ? REWARD_SOURCE_LABELS[sourceType] ?? null : null;
}

function getRewardSourceLabel(refType: string | null, meta: unknown): string {
  return getKnownRewardSourceLabel(refType, meta) ?? '平台奖励';
}

@Injectable()
export class BonusService {
  private readonly logger = new Logger(BonusService.name);

  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
    private couponEngine: CouponEngineService,
    private notificationService: NotificationService,
    private digitalAssetService?: DigitalAssetService,
  ) {}

  // ========== 会员信息 ==========

  private async buildInviterSummary(userId?: string | null) {
    if (!userId) return null;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          profile: { select: { nickname: true } },
          authIdentities: {
            where: { provider: 'PHONE', verified: true },
            select: { identifier: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
      });
      if (!user) return null;

      return {
        userId: user.id,
        nickname: user.profile?.nickname ?? null,
        maskedPhone: maskPhone(user.authIdentities?.[0]?.identifier ?? null),
      };
    } catch (err: any) {
      this.logger.warn(`查询推荐人摘要失败：userId=${userId}, error=${err?.message ?? err}`);
      return null;
    }
  }

  /** 获取会员信息 */
  async getMemberProfile(userId: string) {
    let member = await this.prisma.memberProfile.findUnique({ where: { userId } });
    if (!member) {
      // 普通用户允许先绑定推荐人/查看会员状态，但自己的推荐码只在成为 VIP 时生成并展示。
      member = await this.prisma.memberProfile.create({
        data: {
          userId,
        },
      });
    } else if (member.tier === 'VIP' && !member.referralCode) {
      // 历史遗留兜底：VIP member 存在但 referralCode 为 NULL 时补上。普通会员不补码，
      // 否则会和"非 VIP 没有可用推荐码"的业务口径冲突。
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          member = await this.prisma.memberProfile.update({
            where: { userId },
            data: { referralCode: await pickUniqueReferralCode(this.prisma) },
          });
          break;
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            continue;
          }
          throw err;
        }
      }
      if (!member.referralCode) {
        this.logger.warn(`getMemberProfile VIP lazy 补码失败：userId=${userId}，5 次均遇 @unique 冲突`);
      }
    }

    const [vipProgress, inviter, config, inviteeVipCount] = await Promise.all([
      this.prisma.vipProgress.findUnique({ where: { userId } }),
      this.buildInviterSummary(member.inviterUserId),
      this.bonusConfig.getConfig(),
      this.prisma.memberProfile.count({
        where: { inviterUserId: userId, tier: 'VIP' },
      }),
    ]);

    return {
      tier: member.tier,
      referralCode: member.tier === 'VIP' ? member.referralCode : null,
      inviterUserId: member.inviterUserId,
      inviter,
      inviteeVipCount,
      vipPurchasedAt: member.vipPurchasedAt?.toISOString() || null,
      normalEligible: member.normalEligible,
      vipProgress: vipProgress
        ? {
            selfPurchaseCount: vipProgress.selfPurchaseCount,
            // 不直接返回 vipProgress.unlockedLevel：该字段在数据库里实际是
            // "上次有 FROZEN VIP_UPSTREAM 被释放时的层级戳"，对自购充足
            // 的用户永远是 0，与"已解锁层级"的直觉相反。
            // 真正可展示的"已解锁层级"应按 min(selfPurchaseCount, vipMaxLayers)
            // 计算，见 schema.prisma VipProgress.unlockedLevel 注释。
            unlockedLevel: Math.min(
              Math.max(vipProgress.selfPurchaseCount, 0),
              Math.max(config.vipMaxLayers, 0),
            ),
          }
        : null,
    };
  }

  /** 使用推荐码 */
  async useReferralCode(userId: string, code: string) {
    const inviter = await this.prisma.memberProfile.findUnique({
      where: { referralCode: code },
    });
    if (!inviter) throw new BadRequestException('推荐码无效');
    // 只有 VIP 才能作为推荐人。历史普通用户可能已持有 referralCode，后端仍必须拒绝，
    // 避免被抓包绕过 UI 后绑定到无法承接 VIP 树的普通用户。
    if (inviter.tier !== 'VIP') throw new BadRequestException('推荐码无效');
    if (inviter.userId === userId) throw new BadRequestException('不能使用自己的推荐码');

    const result = await this.prisma.$transaction(async (tx) => {
      // 事务内检查 VIP 状态（防并发绕过）
      const currentMember = await tx.memberProfile.findUnique({
        where: { userId },
      });
      if (currentMember?.tier === 'VIP') {
        throw new BadRequestException('已加入 VIP 团队，无法更换推荐人');
      }
      if (currentMember?.inviterUserId && currentMember.inviterUserId !== inviter.userId) {
        throw new BadRequestException('已绑定推荐关系，不能更换');
      }

      // 已注销 / 非正常状态的推荐人不能再被新用户绑定（账号注销 Task 4）。
      // 历史推荐树/链路保留不动，仅让推荐码对"新绑定"失效。在 Serializable
      // 事务内读取，与注销流程（同样 Serializable 写 status/deletionExecutedAt）
      // 串行化，避免"先查到 ACTIVE、绑定时已注销"的 TOCTOU 缝隙。
      const inviterUser = await tx.user.findUnique({
        where: { id: inviter.userId },
        select: { status: true, deletionExecutedAt: true },
      });
      if (
        !inviterUser ||
        inviterUser.status !== UserStatus.ACTIVE ||
        inviterUser.deletionExecutedAt
      ) {
        throw new BadRequestException('推荐人账号不可用');
      }

      const existingNormalBinding = await tx.normalShareBinding.findUnique({
        where: { inviteeUserId: userId },
      });
      const existing = await tx.referralLink.findUnique({
        where: { inviteeUserId: userId },
      });
      const activeNormalInviter =
        existingNormalBinding?.relationStatus === 'ACTIVE'
          ? existingNormalBinding.effectiveInviterUserId ?? existingNormalBinding.inviterUserId
          : null;

      if (existing && existing.inviterUserId !== inviter.userId) {
        throw new BadRequestException('已绑定推荐关系，不能更换');
      }

      if (activeNormalInviter && activeNormalInviter !== inviter.userId) {
        throw new BadRequestException('已绑定推荐关系，不能更换');
      }

      if (existing || activeNormalInviter) {
        return { success: true, inviterUserId: inviter.userId, isIdempotent: true };
      }

      if (currentMember?.inviterUserId === inviter.userId) {
        return { success: true, inviterUserId: inviter.userId, isIdempotent: true };
      }

      await tx.referralLink.create({
        data: {
          inviterUserId: inviter.userId,
          inviteeUserId: userId,
          codeUsed: code,
        },
      });

      await tx.memberProfile.upsert({
        where: { userId },
        create: {
          userId,
          inviterUserId: inviter.userId,
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

    return {
      success: true,
      inviterUserId: result.inviterUserId,
      inviter: await this.buildInviterSummary(result.inviterUserId),
    };
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
        // CAS 期望状态必须与 prepare tx 已写入的状态对齐：
        // - retrying=true 时 prepare tx 已把 FAILED 改成 RETRYING（L189-202），
        //   所以 CAS 期望 RETRYING，把它推进到 ACTIVATING。
        // - retrying=false 时 prepare tx 让状态停留在 PENDING，
        //   所以 CAS 期望 PENDING，同样推进到 ACTIVATING。
        // 历史 bug：retrying 分支期望 FAILED 导致 CAS 永远命中 0 行，
        // 重试路径永远跳过授奖代码块（推荐人永远拿不到 VIP 推荐奖）。
        const casResult = await tx.vipPurchase.updateMany({
          where: {
            id: vipPurchaseId!,
            activationStatus: { in: retrying ? ['RETRYING'] : ['PENDING'] },
          },
          data: {
            activationStatus: 'ACTIVATING',
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
        // 防御历史遗留：member 存在但 referralCode 为 NULL（早期注册路径漏写）
        // 借此次 VIP 激活顺手补上，避免会员中心"我的专属推荐码"显示为空
        const updateData: Prisma.MemberProfileUpdateInput = {
          tier: 'VIP',
          vipPurchasedAt: new Date(),
        };
        if (member && !member.referralCode) {
          updateData.referralCode = await pickUniqueReferralCode(tx);
        }
        const updatedMember = await tx.memberProfile.upsert({
          where: { userId },
          create: {
            userId,
            tier: 'VIP',
            vipPurchasedAt: new Date(),
            referralCode: await pickUniqueReferralCode(tx),
          },
          update: updateData,
        });

        await this.digitalAssetService?.grantVipActivationAssets(tx, {
          userId,
          vipPurchaseId: vipPurchase.id,
          packageId: vipPurchase.packageId ?? null,
          vipAmount: vipPurchase.amount,
          inviterUserId: updatedMember.inviterUserId || member?.inviterUserId || null,
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
        const referralBonus = Math.floor(vipPurchase.amount * referralBonusRateSnapshot * 100) / 100;
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
      orderBy: [{ price: 'asc' }, { sortOrder: 'asc' }],
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

  private async isSellerOwner(userId: string) {
    const staff = await this.prisma.companyStaff.findFirst({
      where: { userId, role: 'OWNER', status: 'ACTIVE' },
      select: { id: true },
    });
    return !!staff;
  }

  /** 获取奖励钱包（App 读模型：奖励账户 + 团购返利账户） */
  async getWallet(userId: string) {
    const [accounts, isSellerOwner, groupBuyAccount, pendingAggregate] = await Promise.all([
      this.prisma.rewardAccount.findMany({
        where: { userId, type: { in: ['VIP_REWARD', 'NORMAL_REWARD', 'INDUSTRY_FUND'] } },
      }),
      this.isSellerOwner(userId),
      this.prisma.groupBuyRebateAccount.findUnique({
        where: { userId },
      }),
      this.prisma.groupBuyRebateLedger.aggregate({
        where: {
          userId,
          type: 'PENDING_REBATE',
          status: 'PENDING',
          deletedAt: null,
        },
        _sum: { amount: true },
      }),
    ]);

    const vip = accounts.find((a) => a.type === 'VIP_REWARD');
    const normal = accounts.find((a) => a.type === 'NORMAL_REWARD');
    const industry = accounts.find((a) => a.type === 'INDUSTRY_FUND');

    const vipBalance = vip?.balance ?? 0;
    const vipFrozen = vip?.frozen ?? 0;
    const normalBalance = normal?.balance ?? 0;
    const normalFrozen = normal?.frozen ?? 0;
    const industryBalance = isSellerOwner ? industry?.balance ?? 0 : 0;
    const industryFrozen = isSellerOwner ? industry?.frozen ?? 0 : 0;
    const groupBuyBalance = groupBuyAccount?.balance ?? 0;
    const groupBuyReserved = groupBuyAccount?.reserved ?? 0;
    const groupBuyWithdrawn = groupBuyAccount?.withdrawn ?? 0;
    const groupBuyDeducted = groupBuyAccount?.deducted ?? 0;
    const groupBuyPending = pendingAggregate._sum.amount ?? 0;
    const deductibleBalance = vipBalance + normalBalance + groupBuyBalance;
    const balance = deductibleBalance + industryBalance;
    const frozen = vipFrozen + normalFrozen + industryFrozen + groupBuyPending;

    return {
      balance,
      frozen,
      total: balance + frozen,
      deductibleBalance,
      withdrawableBalance: balance,
      isSellerOwner,
      // 分账户明细
      vip: { balance: vipBalance, frozen: vipFrozen },
      normal: { balance: normalBalance, frozen: normalFrozen },
      industryFund: isSellerOwner ? { balance: industryBalance, frozen: industryFrozen } : null,
      groupBuyRebate: {
        balance: groupBuyBalance,
        pending: groupBuyPending,
        reserved: groupBuyReserved,
        withdrawn: groupBuyWithdrawn,
        deducted: groupBuyDeducted,
        total: groupBuyBalance + groupBuyReserved + groupBuyWithdrawn + groupBuyDeducted,
      },
    };
  }

  /** 获取奖励钱包统一流水 */
  async getWalletLedger(userId: string, page = 1, pageSize = 20) {
    const sanitizedPage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    const sanitizedPageSize = Number.isFinite(pageSize)
      ? Math.min(100, Math.max(1, Math.floor(pageSize)))
      : 20;
    const skip = (sanitizedPage - 1) * sanitizedPageSize;
    const take = skip + sanitizedPageSize;
    const isSellerOwner = await this.isSellerOwner(userId);
    const allowedRewardAccountTypes = isSellerOwner
      ? APP_WALLET_OWNER_REWARD_ACCOUNT_TYPES
      : APP_WALLET_MEMBER_REWARD_ACCOUNT_TYPES;
    const rewardWhere: any = {
      userId,
      status: { not: 'RETURN_FROZEN' },
      deletedAt: null,
      account: { type: { in: allowedRewardAccountTypes } },
    };
    const groupBuyWhere = { userId, deletedAt: null };

    const [rewardItems, rewardTotal, groupBuyItems, groupBuyTotal] = await Promise.all([
      this.prisma.rewardLedger.findMany({
        where: rewardWhere,
        orderBy: { createdAt: 'desc' },
        take,
        include: { account: { select: { type: true } } },
      }),
      this.prisma.rewardLedger.count({ where: rewardWhere }),
      this.prisma.groupBuyRebateLedger.findMany({
        where: groupBuyWhere,
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.groupBuyRebateLedger.count({ where: groupBuyWhere }),
    ]);

    const items = [
      ...rewardItems.map((l) => {
        const scheme = getLedgerScheme(l.meta);
        const sourceLabel = scheme ? getKnownRewardSourceLabel(l.refType, l.meta) : null;
        return {
          id: l.id,
          sourceLedgerId: l.id,
          source: 'REWARD',
          accountType: l.account?.type ?? null,
          type: l.entryType,
          entryType: l.entryType,
          status: l.status,
          amount: l.amount,
          balanceAfter: (l as any).balanceAfter,
          refType: l.refType,
          refId: l.refId,
          meta: l.meta,
          ...(scheme ? { scheme } : {}),
          ...(sourceLabel ? { sourceLabel } : {}),
          createdAt: l.createdAt.toISOString(),
        };
      }),
      ...groupBuyItems.map((l) => ({
        id: l.id,
        sourceLedgerId: l.id,
        source: 'GROUP_BUY_REBATE',
        accountType: 'GROUP_BUY_REBATE',
        type: l.type,
        entryType: l.type,
        status: l.status,
        amount: l.amount,
        balanceAfter: l.balanceAfter,
        refType: l.refType,
        refId: l.refId,
        meta: l.meta,
        createdAt: l.createdAt.toISOString(),
      })),
    ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const total = rewardTotal + groupBuyTotal;

    return {
      items: items.slice(skip, skip + sanitizedPageSize),
      nextPage: skip + sanitizedPageSize < total ? sanitizedPage + 1 : undefined,
    };
  }

  /** 提现记录 */
  async getWithdrawHistory(userId: string) {
    const pageSize = 100;
    const limit = 50;
    const visibleRequests: any[] = [];
    let skip = 0;

    while (visibleRequests.length < limit) {
      const requests = await this.prisma.withdrawRequest.findMany({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      });
      if (requests.length === 0) {
        break;
      }

      for (const request of requests) {
        if (!this.isLegacyGroupBuyWithdraw(request)) {
          visibleRequests.push(request);
          if (visibleRequests.length >= limit) {
            break;
          }
        }
      }

      if (requests.length < pageSize) {
        break;
      }
      skip += pageSize;
    }

    return visibleRequests.map((r) => ({
      id: r.id,
      amount: r.amount,
      channel: r.channel,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private isLegacyGroupBuyWithdraw(withdraw: any): boolean {
    const source = this.readWithdrawSnapshotSource(withdraw);
    if (source === 'GROUP_BUY_REBATE_LEGACY') {
      return true;
    }
    if (source === 'UNIFIED_POINTS') {
      return false;
    }
    return withdraw?.accountType === 'GROUP_BUY_REBATE';
  }

  private readWithdrawSnapshotSource(withdraw: any): WithdrawSnapshotSource | null {
    const snapshot = decryptJsonValue<any>(withdraw?.accountSnapshot);
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return null;
    }
    return snapshot.source === 'UNIFIED_POINTS'
      || snapshot.source === 'GROUP_BUY_REBATE_LEGACY'
      ? snapshot.source
      : null;
  }

  // ========== 奖励抵扣 ==========

  /**
   * 获取可用奖励列表（结算页抵扣选择）
   * 从 RewardLedger 中筛选 SETTLED 的 CREDIT 条目，
   * 每条视为一张可用奖励。
   */
  async getAvailableRewards(userId: string) {
    const now = new Date();

    // 查询用户已解锁的可用奖励条目（VIP + 普通奖励账户，entryType=RELEASE, status=AVAILABLE）
    const accounts = await this.prisma.rewardAccount.findMany({
      where: { userId, type: { in: ['VIP_REWARD', 'NORMAL_REWARD'] } },
      select: { id: true, type: true },
    });
    const accountIds = accounts.map((a) => a.id);

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

    return available.map((entry) => {
      const sourceType = getRewardSourceType(entry.refType, entry.meta);
      return {
        id: entry.id,
        amount: entry.amount,
        sourceType,
        source: getRewardSourceLabel(entry.refType, entry.meta),
        minOrderAmount: entry.amount >= 10 ? entry.amount * 5 : 0,
        expireAt: null,
        status: 'AVAILABLE' as const,
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
    const activeRecipient = await this.resolveActiveRewardRecipient(tx, inviterUserId);
    if (!activeRecipient) {
      await this.creditVipReferralBonusToPlatform(
        tx,
        inviterUserId,
        inviteeUserId,
        amount,
        vipPurchaseId,
      );
      this.logger.log(
        `VIP 推荐奖励归平台：推荐人 ${inviterUserId} 已注销/非活跃，金额 ${amount} 元（被推荐人 ${inviteeUserId}）`,
      );
      return;
    }

    // 查找或创建推荐人的奖励账户
    const account = await tx.rewardAccount.upsert({
      where: { userId_type: { userId: activeRecipient, type: 'VIP_REWARD' } },
      create: { userId: activeRecipient, type: 'VIP_REWARD', balance: 0, frozen: 0 },
      update: {},
    });

    // 创建奖励流水：直接可用
    const ledger = await tx.rewardLedger.create({
      data: {
        accountId: account.id,
        userId: activeRecipient,
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
      `VIP 推荐奖励：推荐人 ${activeRecipient} 获得 ${amount} 元（被推荐人 ${inviteeUserId} 购买 VIP）`,
    );

    await this.notificationService.emit({
      eventType: 'reward.credited',
      aggregateType: 'rewardLedger',
      aggregateId: ledger.id,
      idempotencyKey: `reward:${ledger.id}:credited`,
      actor: { kind: 'system' },
      payload: {
        ledgerId: ledger.id,
        userId: activeRecipient,
        amount,
      },
    }, tx as any);
  }

  private async resolveActiveRewardRecipient(tx: any, userId: string): Promise<string | null> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { status: true, deletionExecutedAt: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE || user.deletionExecutedAt) {
      return null;
    }
    return userId;
  }

  private async creditVipReferralBonusToPlatform(
    tx: any,
    skippedInviterUserId: string,
    inviteeUserId: string,
    amount: number,
    vipPurchaseId: string,
  ) {
    let account = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' } },
    });
    if (!account) {
      account = await tx.rewardAccount.create({
        data: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' },
      });
    }

    await tx.rewardLedger.create({
      data: {
        accountId: account.id,
        userId: PLATFORM_USER_ID,
        entryType: 'RELEASE',
        amount,
        status: 'AVAILABLE',
        refType: 'VIP_REFERRAL',
        refId: vipPurchaseId,
        meta: {
          scheme: 'VIP_REFERRAL_FALLBACK',
          reason: 'DELETED_DIRECT_REFERRAL_RECIPIENT',
          sourceUserId: inviteeUserId,
          skippedInviterUserId,
        },
      },
    });

    await tx.rewardAccount.update({
      where: { id: account.id },
      data: { balance: { increment: amount } },
    });
  }

  // ========== 私有方法 ==========

  /**
   * VIP 三叉树推荐子树落位
   *
   * 有推荐人：在推荐人节点直连满后，按层选择当前层 childrenCount 最小节点插入；
   *           若子树搜索返回 null 视为系统异常直接抛出，严禁降级到系统节点。
   * 无推荐人：从 A1 起依次 找/建 第一个有空位（childrenCount<3）的系统根节点，
   *           连续编号无空洞（A3 满则建 A4，依此类推），上限 10 + MAX_ROOT_NODES。
   */
  private async assignVipTreeNode(tx: any, userId: string) {
    const member = await tx.memberProfile.findUnique({ where: { userId } });

    let parentNode: any = null;
    let rootId: string = '';

    if (member?.inviterUserId) {
      // ===== 有推荐人：必须落在推荐人子树内，不允许降级到系统节点 =====
      const inviterMember = await tx.memberProfile.findUnique({
        where: { userId: member.inviterUserId },
      });

      if (!inviterMember?.vipNodeId) {
        // 推荐人自己没有 VIP 树节点，属于数据异常
        throw new InternalServerErrorException(
          '推荐人尚未分配 VIP 树节点，无法在其子树中插入，请联系技术支持',
        );
      }

      const inviterNode = await tx.vipTreeNode.findUnique({
        where: { id: inviterMember.vipNodeId },
      });

      if (!inviterNode) {
        throw new InternalServerErrorException(
          '推荐人 VIP 树节点不存在，请联系技术支持',
        );
      }

      if (inviterNode.childrenCount < 3) {
        // 推荐人有空位，直接插入
        parentNode = inviterNode;
        rootId = inviterNode.rootId;
      } else {
        // 推荐人已满，在推荐人子树内按层找当前层最空节点滑落
        const found = await this.findLeastLoadedNodeByLevelInSubtree(tx, inviterNode.id);
        if (!found) {
          // 子树找不到空位 —— 按业务树无底设计，这是异常而非"降级"的理由
          throw new InternalServerErrorException(
            '无法在推荐人子树中找到 VIP 空位，请联系技术支持',
          );
        }
        parentNode = found;
        rootId = inviterNode.rootId;
      }
    } else {
      // ===== 无推荐人：从 A1 起，依次 找/建 第一个未满（childrenCount<3）的系统根节点 =====
      // 连续编号、无空洞：A1 满→A2，A2 满→A3，A3 满→自动建 A4，依此类推。
      // 系统根节点为虚拟"平台节点"（userId=null），无推荐人 VIP 直接挂在其下，上溯分润归平台。
      // 上限沿用 L8 修复：10 + MAX_ROOT_NODES，硬上限 = (10 + MAX_ROOT_NODES) × 3 个无推荐人 VIP。
      const maxIdx = 10 + MAX_ROOT_NODES;
      for (let i = 1; i <= maxIdx; i++) {
        const sysRootId = `A${i}`;
        let sysNode = await tx.vipTreeNode.findFirst({
          where: { rootId: sysRootId, level: 0 },
        });
        if (!sysNode) {
          // 当前编号根节点不存在 → 自动创建（无推荐人树无底设计）
          sysNode = await tx.vipTreeNode.create({
            data: { rootId: sysRootId, userId: null, level: 0, position: 0 },
          });
        }
        if (sysNode.childrenCount < 3) {
          parentNode = sysNode;
          rootId = sysRootId;
          break;
        }
      }
      if (!parentNode) {
        throw new BadRequestException('系统节点已达上限，无法分配VIP位置');
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
   * 在指定节点的子树内按层查找最空节点
   *
   * 规则：
   * - 每次只比较同一层节点
   * - 当前层存在未满节点时，选择 childrenCount 最小者
   * - childrenCount 相同则沿用树顺序（父节点顺序 + position asc）
   * - 当前层全满才进入下一层
   *
   * 若子树已满，返回 null（C31a：调用方应视为系统异常抛出，不再降级到系统节点）
   *
   * 注：按业务设计三叉树无底，不对深度做限制；仅保留迭代次数上限作为保险丝，
   * 防止数据循环引用等异常造成死循环。
   */
  private async findLeastLoadedNodeByLevelInSubtree(tx: any, startNodeId: string): Promise<any | null> {
    let currentLevelParentIds: string[] = [startNodeId];
    let iterations = 0;

    while (currentLevelParentIds.length > 0) {
      if ((iterations += currentLevelParentIds.length) > MAX_BFS_ITERATIONS) {
        this.logger.warn(`VIP 子树落位遍历超过 ${MAX_BFS_ITERATIONS} 次迭代，中止搜索（startNodeId=${startNodeId}）`);
        break;
      }

      const parentOrder = new Map(currentLevelParentIds.map((id, index) => [id, index]));
      const levelNodes = await tx.vipTreeNode.findMany({
        where: { parentId: { in: currentLevelParentIds } },
        orderBy: { position: 'asc' },
      });

      levelNodes.sort((a: any, b: any) => {
        const parentA = parentOrder.get(a.parentId) ?? Number.MAX_SAFE_INTEGER;
        const parentB = parentOrder.get(b.parentId) ?? Number.MAX_SAFE_INTEGER;
        if (parentA !== parentB) return parentA - parentB;
        if (a.position !== b.position) return a.position - b.position;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

      let best: any | null = null;
      for (const node of levelNodes) {
        if (node.childrenCount >= 3) continue;
        if (!best || node.childrenCount < best.childrenCount) {
          best = node;
        }
      }

      if (best) return best;
      currentLevelParentIds = levelNodes.map((node: any) => node.id);
    }

    return null;
  }

}
