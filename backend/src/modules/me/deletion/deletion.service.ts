import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AfterSaleStatus,
  AfterSaleShippingPaymentStatus,
  AuthProvider,
  CheckoutSessionStatus,
  CompanyStaffRole,
  CompanyStaffStatus,
  CouponInstanceStatus,
  FollowType,
  LotteryResult,
  LotteryRecordStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RewardEntryType,
  RewardAccountType,
  RewardLedgerStatus,
  SessionStatus,
  SmsPurpose,
  UserStatus,
  WithdrawStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt } from 'crypto';
import { RedisCoordinatorService } from '../../../common/infra/redis-coordinator.service';
import { AliyunSmsService } from '../../../common/sms/aliyun-sms.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { DigitalAssetService } from '../../digital-asset/digital-asset.service';
import { PLATFORM_USER_ID } from '../../bonus/engine/constants';
import { QueueRewardService } from '../../queue-reward/queue-reward.service';
import { acquireUserWriteLock } from '../../../common/transactions/active-user-write-barrier';
import { AccountDeletionConfirmMethod, ExecuteDeletionDto } from './dto/deletion.dto';

type DeletionBlockerCode =
  | 'IS_COMPANY_OWNER'
  | 'USER_NOT_ACTIVE'
  | 'ACTIVE_CHECKOUT_EXISTS'
  | 'PENDING_PAYMENT_EXISTS'
  | 'PENDING_AFTER_SALE_SHIPPING_PAYMENT_EXISTS'
  | 'WITHDRAW_PROCESSING_EXISTS';

type DeletionBlocker = {
  code: DeletionBlockerCode;
  message: string;
  count: number;
};

type IdentitySnapshot = {
  id: string;
  provider: AuthProvider;
  identifier: string;
  appId: string | null;
  verified: boolean;
};

type RewardSnapshot = {
  id: string;
  userId: string;
  type: string;
  balance: number;
  frozen: number;
};

type CleanupSnapshot = {
  deletionMeta: Prisma.InputJsonObject;
  rewardAccounts: RewardSnapshot[];
  groupBuyRebateAccount: {
    id: string;
    balance: number;
    reserved: number;
  } | null;
  captainAccounts: Array<{
    id: string;
    programCode: string;
    balance: number;
    frozen: number;
  }>;
  primaryIdentity: IdentitySnapshot | null;
  maskedPhone: string | null;
  maskedWechatOpenId: string | null;
};

type DeletionEvidenceContext = {
  ip?: string;
  userAgent?: string;
};

@Injectable()
export class DeletionService {
  private readonly logger = new Logger(DeletionService.name);
  private static readonly OTP_PER_MINUTE = 1;
  private static readonly OTP_PER_HOUR = 5;
  private static readonly OTP_WINDOW_SECONDS = 3_600;
  private static readonly OTP_DB_FALLBACK_MAX_RETRIES = 3;
  private static readonly EXECUTE_MAX_RETRIES = 3;
  private static readonly DELETION_CONFIRM_TEXT = '确认注销';
  private static readonly NOTICE_VERSION = 'account-deletion-immediate-2026-06-04';
  private static readonly BLOCKING_WITHDRAW_STATUSES = [
    WithdrawStatus.REQUESTED,
    WithdrawStatus.PROCESSING,
    WithdrawStatus.APPROVED,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redisCoord: RedisCoordinatorService,
    private readonly aliyunSms: AliyunSmsService,
    private readonly digitalAssetService: DigitalAssetService,
    private readonly queueRewardService?: QueueRewardService,
  ) {}

  async preview(userId: string) {
    const blockers = await this.getBlockers(userId);
    const [
      profile,
      rewardAccounts,
      couponCount,
      lotteryQuota,
      pendingWithdrawAggregate,
      activeCheckoutCount,
      paidOrders,
      activeAfterSales,
      phoneIdentity,
      digitalAssetAccount,
      groupBuyRebateAccount,
      captainAccounts,
    ] = await Promise.all([
      this.prisma.userProfile.findUnique({
        where: { userId },
        select: { points: true },
      }),
      this.prisma.rewardAccount.findMany({
        where: { userId },
        select: { balance: true, frozen: true },
      }),
      this.prisma.couponInstance.count({
        where: {
          userId,
          status: { in: [CouponInstanceStatus.AVAILABLE, CouponInstanceStatus.RESERVED] },
        },
      }),
      this.prisma.lotteryRecord.count({
        where: {
          userId,
          result: LotteryResult.WON,
          status: { in: [LotteryRecordStatus.WON, LotteryRecordStatus.IN_CART] },
        },
      }),
      this.prisma.withdrawRequest.aggregate({
        where: {
          userId,
          status: { in: DeletionService.BLOCKING_WITHDRAW_STATUSES },
        },
        _sum: { amount: true },
      }),
      this.prisma.checkoutSession.count({
        where: {
          userId,
          status: { in: [CheckoutSessionStatus.ACTIVE, CheckoutSessionStatus.PAID] },
        },
      }),
      this.prisma.order.count({
        where: {
          userId,
          status: { in: [OrderStatus.PAID, OrderStatus.SHIPPED, OrderStatus.DELIVERED] },
        },
      }),
      this.prisma.afterSaleRequest.count({
        where: {
          userId,
          status: {
            notIn: [
              AfterSaleStatus.REJECTED,
              AfterSaleStatus.REFUNDED,
              AfterSaleStatus.COMPLETED,
              AfterSaleStatus.CLOSED,
              AfterSaleStatus.CANCELED,
            ],
          },
        },
      }),
      this.getPhoneIdentity(this.prisma, userId),
      this.prisma.digitalAssetAccount.findUnique({
        where: { userId },
        select: { seedAssetBalance: true, creditAssetBalance: true },
      }),
      this.prisma.groupBuyRebateAccount.findUnique({
        where: { userId },
        select: { balance: true, reserved: true },
      }),
      this.prisma.captainAccount.findMany({
        where: { userId },
        select: { balance: true, frozen: true },
      }),
    ]);

    const { withdrawableRewards, frozenRewards } = this.sumRewards(rewardAccounts);
    const maskedPhone = phoneIdentity ? this.maskPhone(phoneIdentity.identifier) : undefined;

    return {
      canDelete: blockers.length === 0,
      blockers,
      assets: {
        points: profile?.points ?? 0,
        coupons: couponCount,
        withdrawableRewards,
        frozenRewards,
        digitalAssetSeedBalance: digitalAssetAccount?.seedAssetBalance ?? 0,
        digitalAssetCreditBalance: digitalAssetAccount?.creditAssetBalance ?? 0,
        groupBuyRebateBalance: groupBuyRebateAccount?.balance ?? 0,
        groupBuyRebateReserved: groupBuyRebateAccount?.reserved ?? 0,
        captainBalance: this.roundMoney(captainAccounts.reduce(
          (sum, account) => sum + Number(account.balance ?? 0),
          0,
        )),
        captainFrozen: this.roundMoney(captainAccounts.reduce(
          (sum, account) => sum + Number(account.frozen ?? 0),
          0,
        )),
        lotteryQuota,
        pendingWithdrawAmount: pendingWithdrawAggregate._sum.amount ?? 0,
        activeCheckoutCount,
      },
      pending: { paidOrders, activeAfterSales },
      identityVerify: phoneIdentity
        ? AccountDeletionConfirmMethod.SMS
        : AccountDeletionConfirmMethod.WECHAT_MODAL,
      maskedPhone,
    };
  }

  async sendCode(userId: string) {
    const blockers = await this.getBlockers(userId);
    if (blockers.length > 0) {
      throw new ConflictException({ code: 'ACCOUNT_DELETION_BLOCKED', blockers });
    }

    const phoneIdentity = await this.getPhoneIdentity(this.prisma, userId);
    if (!phoneIdentity) {
      throw new BadRequestException({
        code: 'ACCOUNT_DELETION_SMS_UNAVAILABLE',
        message: '当前账号未绑定手机号，请使用微信确认注销',
      });
    }

    const smsMock = this.config.get('SMS_MOCK', 'false');
    const nodeEnv = this.config.get('NODE_ENV', 'development');
    if (smsMock === 'true' && nodeEnv === 'production') {
      throw new ServiceUnavailableException({
        code: 'ACCOUNT_DELETION_SMS_MISCONFIGURED',
        message: '注销短信服务配置异常，请联系客服',
      });
    }
    const code = smsMock === 'true' ? '123456' : randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.createOtpWithRateLimit(
      phoneIdentity.identifier,
      codeHash,
      expiresAt,
      SmsPurpose.DELETION,
    );

    if (smsMock === 'true') {
      this.logger.log(`[SMS Mock] 账号注销验证码=${code}（目标=${this.maskPhone(phoneIdentity.identifier)}）`);
    } else {
      try {
        await this.aliyunSms.sendVerificationCode(phoneIdentity.identifier, code);
        this.logger.log(`[SMS] 账号注销验证码已发送（目标=${this.maskPhone(phoneIdentity.identifier)}）`);
      } catch (err) {
        this.logger.error(
          `[SMS] 账号注销验证码发送失败: ${(err as Error)?.message}`,
          (err as Error)?.stack,
        );
      }
    }

    return { ok: true };
  }

  async execute(userId: string, dto: ExecuteDeletionDto, ip?: string, userAgent?: string) {
    const evidence: DeletionEvidenceContext = { ip, userAgent };
    for (let attempt = 0; attempt < DeletionService.EXECUTE_MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await acquireUserWriteLock(tx, userId);

            const blockers = await this.getBlockers(userId, tx);
            if (blockers.length > 0) {
              throw new ConflictException({ code: 'ACCOUNT_DELETION_BLOCKED', blockers });
            }

            await this.verifyDeletionConfirmation(tx, userId, dto);
            await this.executeIrreversibleCleanup(tx, userId, dto, evidence);

            return { ok: true, message: '账号已注销' };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (err) {
        if (this.isSerializableConflict(err) && attempt < DeletionService.EXECUTE_MAX_RETRIES - 1) {
          await this.sleep(50 + Math.floor(Math.random() * 50) + attempt * 50);
          continue;
        }
        throw err;
      }
    }

    throw new Error('账号注销事务重试异常结束');
  }

  private async getBlockers(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<DeletionBlocker[]> {
    const blockers: DeletionBlocker[] = [];

    const [
      user,
      ownerCount,
      activeCheckoutCount,
      pendingPaymentCount,
      pendingPaymentGroupCount,
      pendingAfterSaleShippingPaymentCount,
      withdrawProcessingCount,
    ] = await Promise.all([
      tx.user.findUnique({
        where: { id: userId },
        select: { status: true, deletionExecutedAt: true },
      }),
      tx.companyStaff.count({
        where: { userId, role: CompanyStaffRole.OWNER, status: CompanyStaffStatus.ACTIVE },
      }),
      tx.checkoutSession.count({
        where: { userId, status: { in: [CheckoutSessionStatus.ACTIVE, CheckoutSessionStatus.PAID] } },
      }),
      tx.payment.count({
        where: { status: { in: [PaymentStatus.INIT, PaymentStatus.PENDING] }, order: { userId } },
      }),
      tx.paymentGroup.count({
        where: { userId, status: { in: [PaymentStatus.INIT, PaymentStatus.PENDING] } },
      }),
      tx.afterSaleShippingPayment.count({
        where: {
          afterSale: { userId },
          status: {
            in: [
              AfterSaleShippingPaymentStatus.UNPAID,
              AfterSaleShippingPaymentStatus.PENDING,
            ],
          },
        },
      }),
      tx.withdrawRequest.count({
        where: { userId, status: { in: DeletionService.BLOCKING_WITHDRAW_STATUSES } },
      }),
    ]);

    if (!user || user.status !== UserStatus.ACTIVE || user.deletionExecutedAt) {
      blockers.push({ code: 'USER_NOT_ACTIVE', message: '账号状态不支持注销', count: 1 });
    }
    if (ownerCount > 0) {
      blockers.push({
        code: 'IS_COMPANY_OWNER',
        message: '您是企业创始人，请先转让或注销企业',
        count: ownerCount,
      });
    }
    if (activeCheckoutCount > 0) {
      blockers.push({
        code: 'ACTIVE_CHECKOUT_EXISTS',
        message: '您有正在支付或确认中的订单，请先完成或取消',
        count: activeCheckoutCount,
      });
    }
    if (pendingPaymentCount + pendingPaymentGroupCount > 0) {
      blockers.push({
        code: 'PENDING_PAYMENT_EXISTS',
        message: '您有支付处理中记录，请稍后再试',
        count: pendingPaymentCount + pendingPaymentGroupCount,
      });
    }
    if (pendingAfterSaleShippingPaymentCount > 0) {
      blockers.push({
        code: 'PENDING_AFTER_SALE_SHIPPING_PAYMENT_EXISTS',
        message: '您有退货运费支付正在进行，请先完成、关单或等待支付结果',
        count: pendingAfterSaleShippingPaymentCount,
      });
    }
    if (withdrawProcessingCount > 0) {
      blockers.push({
        code: 'WITHDRAW_PROCESSING_EXISTS',
        message: '您有提现处理中记录，请到账或失败后再注销',
        count: withdrawProcessingCount,
      });
    }

    return blockers;
  }

  private async verifyDeletionConfirmation(
    tx: Prisma.TransactionClient,
    userId: string,
    dto: ExecuteDeletionDto,
  ) {
    if (dto.acknowledgedNotice !== true) {
      throw new BadRequestException({ code: 'ACCOUNT_DELETION_NOTICE_REQUIRED', message: '请先确认注销须知' });
    }

    const phoneIdentity = await this.getPhoneIdentity(tx, userId);

    if (dto.confirmationMethod === AccountDeletionConfirmMethod.SMS) {
      if (!phoneIdentity) {
        throw new BadRequestException({
          code: 'ACCOUNT_DELETION_SMS_UNAVAILABLE',
          message: '当前账号未绑定手机号，请使用微信确认注销',
        });
      }
      await this.verifyDeletionOtpInTx(tx, phoneIdentity.identifier, dto.smsCode);
      return;
    }

    if (dto.confirmationMethod === AccountDeletionConfirmMethod.WECHAT_MODAL) {
      if (phoneIdentity) {
        throw new BadRequestException({
          code: 'ACCOUNT_DELETION_SMS_REQUIRED',
          message: '当前账号已绑定手机号，请使用短信验证码确认注销',
        });
      }
      if (dto.modalConfirmText !== DeletionService.DELETION_CONFIRM_TEXT) {
        throw new BadRequestException({ code: 'WECHAT_CONFIRM_TEXT_INVALID', message: '请输入“确认注销”' });
      }
      const wechatIdentity = await tx.authIdentity.findFirst({
        where: { userId, provider: AuthProvider.WECHAT, verified: true },
        select: { id: true },
      });
      if (!wechatIdentity) {
        throw new BadRequestException({
          code: 'ACCOUNT_DELETION_WECHAT_UNAVAILABLE',
          message: '当前账号未绑定微信，请使用短信验证码确认注销',
        });
      }
      return;
    }

    throw new BadRequestException({ code: 'ACCOUNT_DELETION_CONFIRM_METHOD_INVALID', message: '确认方式无效' });
  }

  private async executeIrreversibleCleanup(
    tx: Prisma.TransactionClient,
    userId: string,
    dto: ExecuteDeletionDto,
    evidence: DeletionEvidenceContext = {},
  ) {
    // 先把队列中该用户作为受益人的内部待结算/已到账红包按来源逐条
    // 作废并回到平台，再快照并清空剩余账户。否则先把 QUEUE_REWARD
    // 余额整体转给平台，未来来源单退款时会把同一笔钱再次记为待追偿。
    await this.queueRewardService
      ?.voidRecipientRewardsForUserDeletionInTransaction(
        tx,
        userId,
      );
    const cleanup = await this.buildCleanupSnapshot(tx, userId, dto, evidence);

    await this.forfeitGroupBuyRebateAssets(tx, userId, cleanup.groupBuyRebateAccount);
    await this.forfeitCaptainAssets(tx, userId, cleanup.captainAccounts);
    await this.terminateUserGrowthPrograms(tx, userId);
    await this.invalidateMiniProgramClientState(tx, userId);

    await tx.rewardLedger.updateMany({
      where: {
        userId,
        status: {
          in: [
            RewardLedgerStatus.AVAILABLE,
            RewardLedgerStatus.FROZEN,
            RewardLedgerStatus.RETURN_FROZEN,
          ],
        },
      },
      data: {
        status: RewardLedgerStatus.VOIDED,
        entryType: RewardEntryType.VOID,
      },
    });

    await tx.rewardAccount.updateMany({
      where: { userId },
      data: { balance: 0, frozen: 0 },
    });

    const voidLedgerRows = cleanup.rewardAccounts
      .filter((account) => account.balance !== 0 || account.frozen !== 0)
      .map((account) => ({
        accountId: account.id,
        userId,
        entryType: RewardEntryType.VOID,
        amount: this.roundMoney(account.balance + account.frozen),
        status: RewardLedgerStatus.VOIDED,
        meta: {
          reason: 'ACCOUNT_DELETION',
          originalBalance: account.balance,
          originalFrozen: account.frozen,
          accountType: account.type,
          destination: 'PLATFORM',
        },
      }));
    const forfeitures = cleanup.rewardAccounts
      .map((account) => ({
        account,
        amount: this.roundMoney(
          Math.max(0, account.balance) +
            Math.max(0, account.frozen),
        ),
      }))
      .filter((item) => item.amount > 0);
    if (voidLedgerRows.length > 0 || forfeitures.length > 0) {
      const platformAccount = forfeitures.length > 0
        ? await tx.rewardAccount.upsert({
            where: {
              userId_type: {
                userId: PLATFORM_USER_ID,
                type: RewardAccountType.PLATFORM_PROFIT,
              },
            },
            update: {},
            create: {
              userId: PLATFORM_USER_ID,
              type: RewardAccountType.PLATFORM_PROFIT,
            },
          })
        : null;
      const platformLedgerRows = platformAccount
        ? forfeitures.map(({ account, amount }) => ({
            accountId: platformAccount.id,
            userId: PLATFORM_USER_ID,
            entryType: RewardEntryType.RELEASE,
            amount,
            status: RewardLedgerStatus.AVAILABLE,
            refType: 'ACCOUNT_DELETION',
            refId: userId,
            idempotencyKey:
              `ACCOUNT_DELETION_PLATFORM:${userId}:${account.id}`,
            meta: {
              scheme: 'ACCOUNT_DELETION_FORFEITURE',
              sourceUserId: userId,
              sourceAccountId: account.id,
              sourceAccountType: account.type,
              originalBalance: account.balance,
              originalFrozen: account.frozen,
              reason: 'ACCOUNT_DELETION',
            },
          }))
        : [];
      await tx.rewardLedger.createMany({
        data: [...voidLedgerRows, ...platformLedgerRows],
      });
      const forfeitedTotal = this.roundMoney(
        forfeitures.reduce(
          (sum, item) => sum + item.amount,
          0,
        ),
      );
      if (platformAccount && forfeitedTotal > 0) {
        await tx.rewardAccount.update({
          where: { id: platformAccount.id },
          data: {
            balance: { increment: forfeitedTotal },
          },
        });
      }
    }

    await this.digitalAssetService.clearAccountAssets(tx, {
      userId,
      reason: 'ACCOUNT_DELETION',
      idempotencyKey: `digital-asset-clear:${userId}:account-deletion`,
    });

    await tx.couponInstance.updateMany({
      where: {
        userId,
        status: { in: [CouponInstanceStatus.AVAILABLE, CouponInstanceStatus.RESERVED] },
      },
      data: {
        status: CouponInstanceStatus.REVOKED,
        usedAt: null,
        usedOrderId: null,
        usedAmount: null,
      },
    });

    await tx.lotteryRecord.updateMany({
      where: {
        userId,
        result: LotteryResult.WON,
        status: { in: [LotteryRecordStatus.WON, LotteryRecordStatus.IN_CART] },
      },
      data: { status: LotteryRecordStatus.EXPIRED },
    });

    await tx.address.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: new Date(), isDefault: false },
    });

    await tx.userProfile.updateMany({
      where: { userId },
      data: {
        nickname: '已注销用户',
        avatarUrl: null,
        gender: null,
        birthday: null,
        city: null,
        interests: [],
        avatarFrameType: null,
        avatarFrameLabel: null,
        avatarFrameExpiresAt: null,
        points: 0,
      },
    });
    await tx.cart.deleteMany({ where: { userId } });
    await tx.follow.deleteMany({
      where: {
        OR: [
          { followerId: userId },
          { followedId: userId, followedType: FollowType.USER },
        ],
      },
    });
    await tx.aiSession.deleteMany({ where: { userId } });
    await tx.inboxMessage.deleteMany({ where: { userId } });
    await tx.taskCompletion.deleteMany({ where: { userId } });
    await tx.checkIn.deleteMany({ where: { userId } });

    await tx.$executeRaw`
      UPDATE "AuthIdentity"
      SET "identifier" = concat('deleted:', "provider", ':', ${userId}, ':', "id"),
          "unionId" = null,
          "meta" = null,
          "verified" = false,
          "updatedAt" = now()
      WHERE "userId" = ${userId}
    `;

    await tx.session.updateMany({
      where: { userId, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.REVOKED, expiresAt: new Date() },
    });

    await tx.user.update({
      where: { id: userId },
      data: { deletionMeta: cleanup.deletionMeta },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.DELETED,
        deletionExecutedAt: new Date(),
        deletionConfirmMethod: dto.confirmationMethod,
      },
    });

    await tx.loginEvent.create({
      data: {
        userId,
        provider: cleanup.primaryIdentity?.provider ?? AuthProvider.PHONE,
        phone: cleanup.maskedPhone,
        wechatOpenId: cleanup.maskedWechatOpenId,
        ip: evidence.ip ?? null,
        userAgent: evidence.userAgent ?? null,
        success: true,
        meta: {
          action: 'DELETION_EXECUTED',
          deletionExecutedAt: new Date().toISOString(),
          confirmationMethod: dto.confirmationMethod,
          noticeVersion: DeletionService.NOTICE_VERSION,
          ip: evidence.ip ?? null,
          userAgent: evidence.userAgent ?? null,
          snapshot: cleanup.deletionMeta.snapshot,
        },
      },
    });
  }

  private async forfeitGroupBuyRebateAssets(
    tx: Prisma.TransactionClient,
    userId: string,
    account: CleanupSnapshot['groupBuyRebateAccount'],
  ): Promise<void> {
    if (!account) return;

    const balance = this.roundMoney(Math.max(0, Number(account.balance ?? 0)));
    const reserved = this.roundMoney(Math.max(0, Number(account.reserved ?? 0)));
    const forfeited = this.roundMoney(balance + reserved);

    await tx.groupBuyRebateLedger.updateMany({
      where: {
        userId,
        status: { in: ['PENDING', 'AVAILABLE', 'RESERVED'] },
        deletedAt: null,
      },
      data: { status: 'VOIDED' },
    });
    await tx.groupBuyRebateAccount.update({
      where: { id: account.id },
      data: { balance: 0, reserved: 0 },
    });
    if (forfeited <= 0) return;

    const platformAccount = await tx.groupBuyRebateAccount.upsert({
      where: { userId: PLATFORM_USER_ID },
      update: {},
      create: { userId: PLATFORM_USER_ID },
    });
    const platformBalanceBefore = this.roundMoney(Number(platformAccount.balance ?? 0));
    await tx.groupBuyRebateLedger.create({
      data: {
        accountId: account.id,
        userId,
        type: 'VOID',
        status: 'COMPLETED',
        amount: -forfeited,
        balanceBefore: balance,
        balanceAfter: 0,
        idempotencyKey: `ACCOUNT_DELETION_GROUP_BUY_VOID:${userId}`,
        refType: 'ACCOUNT_DELETION',
        refId: userId,
        meta: {
          reason: 'ACCOUNT_DELETION',
          originalBalance: balance,
          originalReserved: reserved,
          destination: 'PLATFORM',
        },
      },
    });
    await tx.groupBuyRebateLedger.create({
      data: {
        accountId: platformAccount.id,
        userId: PLATFORM_USER_ID,
        type: 'ADMIN_ADJUST',
        status: 'AVAILABLE',
        amount: forfeited,
        balanceBefore: platformBalanceBefore,
        balanceAfter: this.roundMoney(platformBalanceBefore + forfeited),
        idempotencyKey: `ACCOUNT_DELETION_GROUP_BUY_PLATFORM:${userId}`,
        refType: 'ACCOUNT_DELETION',
        refId: userId,
        meta: {
          scheme: 'ACCOUNT_DELETION_FORFEITURE',
          sourceUserId: userId,
          sourceAccountId: account.id,
        },
      },
    });
    await tx.groupBuyRebateAccount.update({
      where: { id: platformAccount.id },
      data: { balance: { increment: forfeited } },
    });
  }

  private async forfeitCaptainAssets(
    tx: Prisma.TransactionClient,
    userId: string,
    accounts: CleanupSnapshot['captainAccounts'],
  ): Promise<void> {
    await tx.captainCommissionLedger.updateMany({
      where: {
        userId,
        status: { in: ['FROZEN', 'AVAILABLE'] },
        deletedAt: null,
      },
      data: { status: 'VOIDED' },
    });

    for (const account of accounts) {
      const balance = this.roundMoney(Math.max(0, Number(account.balance ?? 0)));
      const frozen = this.roundMoney(Math.max(0, Number(account.frozen ?? 0)));
      const forfeited = this.roundMoney(balance + frozen);
      await tx.captainAccount.update({
        where: { id: account.id },
        data: { balance: 0, frozen: 0 },
      });
      if (forfeited <= 0) continue;

      const platformAccount = await tx.captainAccount.upsert({
        where: {
          userId_programCode: {
            userId: PLATFORM_USER_ID,
            programCode: account.programCode,
          },
        },
        update: {},
        create: {
          userId: PLATFORM_USER_ID,
          programCode: account.programCode,
        },
      });
      const platformBalanceBefore = this.roundMoney(Number(platformAccount.balance ?? 0));
      await tx.captainCommissionLedger.create({
        data: {
          accountId: account.id,
          userId,
          programCode: account.programCode,
          type: 'VOID',
          status: 'VOIDED',
          amount: -forfeited,
          balanceAfter: 0,
          frozenAfter: 0,
          idempotencyKey: `captain:account-deletion:void:${userId}:${account.id}`,
          refType: 'ACCOUNT_DELETION',
          refId: userId,
          meta: {
            reason: 'ACCOUNT_DELETION',
            originalBalance: balance,
            originalFrozen: frozen,
            destination: 'PLATFORM',
          },
        },
      });
      await tx.captainCommissionLedger.create({
        data: {
          accountId: platformAccount.id,
          userId: PLATFORM_USER_ID,
          programCode: account.programCode,
          type: 'ADJUSTMENT',
          status: 'AVAILABLE',
          amount: forfeited,
          balanceAfter: this.roundMoney(platformBalanceBefore + forfeited),
          idempotencyKey: `captain:account-deletion:platform:${userId}:${account.id}`,
          refType: 'ACCOUNT_DELETION',
          refId: userId,
          meta: {
            scheme: 'ACCOUNT_DELETION_FORFEITURE',
            sourceUserId: userId,
            sourceAccountId: account.id,
          },
        },
      });
      await tx.captainAccount.update({
        where: { id: platformAccount.id },
        data: { balance: { increment: forfeited } },
      });
    }
  }

  private async terminateUserGrowthPrograms(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const now = new Date();
    const ownedInstances = await tx.groupBuyInstance.findMany({
      where: { userId },
      select: { id: true },
    });
    const ownedInstanceIds = ownedInstances.map((instance) => instance.id);
    if (ownedInstanceIds.length > 0) {
      await tx.groupBuyCode.updateMany({
        where: {
          instanceId: { in: ownedInstanceIds },
          status: { in: ['PENDING', 'ACTIVE'] },
        },
        data: { status: 'DISABLED', disabledAt: now },
      });
      await tx.groupBuyReferral.updateMany({
        where: {
          instanceId: { in: ownedInstanceIds },
          status: 'CANDIDATE',
        },
        data: {
          status: 'INVALID',
          invalidReason: 'ACCOUNT_DELETION',
          invalidatedAt: now,
        },
      });
      await tx.groupBuyInstance.updateMany({
        where: {
          id: { in: ownedInstanceIds },
          status: { in: ['QUALIFICATION_PENDING', 'SHARING'] },
        },
        data: {
          status: 'TERMINATED',
          terminatedAt: now,
          invalidReason: 'ACCOUNT_DELETION',
        },
      });
    }

    await tx.captainProfile.updateMany({
      where: { userId, status: { not: 'DISABLED' } },
      data: {
        status: 'DISABLED',
        disabledAt: now,
        statusReason: 'ACCOUNT_DELETION',
      },
    });
    await tx.captainRelation.updateMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { buyerUserId: userId },
          { directCaptainUserId: userId },
          { legacyIndirectCaptainUserId: userId },
        ],
      },
      data: { status: 'INACTIVE', endedAt: now },
    });
    await tx.captainMonthlySettlement.updateMany({
      where: {
        captainUserId: userId,
        status: { in: ['DRAFT', 'PENDING_REVIEW', 'APPROVED'] },
      },
      data: {
        status: 'REJECTED',
        rejectReason: 'ACCOUNT_DELETION',
        reviewedAt: now,
      },
    });
  }

  private async invalidateMiniProgramClientState(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const now = new Date();
    await tx.miniProgramScene.deleteMany({ where: { ownerUserId: userId } });
    await tx.miniProgramSubscriptionConsent.updateMany({
      where: { userId, status: 'ACCEPTED' },
      data: { status: 'FILTERED', consumedAt: now },
    });
    await tx.miniProgramSubscriptionOutbox.updateMany({
      where: {
        userId,
        status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
      },
      data: {
        status: 'SKIPPED',
        processedAt: now,
        processingAt: null,
        lastErrorCode: 'ACCOUNT_DELETION',
        lastError: '用户已注销',
      },
    });
  }

  private async buildCleanupSnapshot(
    tx: Prisma.TransactionClient,
    userId: string,
    dto: ExecuteDeletionDto,
    evidence: DeletionEvidenceContext = {},
  ): Promise<CleanupSnapshot> {
    const [
      profile,
      rewardAccounts,
      coupons,
      lotteryRecords,
      pendingWithdrawAggregate,
      activeCheckoutCount,
      paidOrders,
      activeAfterSales,
      user,
      digitalAssetAccount,
      groupBuyRebateAccount,
      captainAccounts,
    ] = await Promise.all([
      tx.userProfile.findUnique({
        where: { userId },
        select: { points: true },
      }),
      tx.rewardAccount.findMany({
        where: { userId },
        select: { id: true, userId: true, type: true, balance: true, frozen: true },
      }),
      tx.couponInstance.findMany({
        where: {
          userId,
          status: { in: [CouponInstanceStatus.AVAILABLE, CouponInstanceStatus.RESERVED] },
        },
        select: { id: true, status: true },
      }),
      tx.lotteryRecord.findMany({
        where: {
          userId,
          result: LotteryResult.WON,
          status: { in: [LotteryRecordStatus.WON, LotteryRecordStatus.IN_CART] },
        },
        select: { id: true, status: true },
      }),
      tx.withdrawRequest.aggregate({
        where: {
          userId,
          status: { in: DeletionService.BLOCKING_WITHDRAW_STATUSES },
        },
        _sum: { amount: true },
      }),
      tx.checkoutSession.count({
        where: {
          userId,
          status: { in: [CheckoutSessionStatus.ACTIVE, CheckoutSessionStatus.PAID] },
        },
      }),
      tx.order.count({
        where: {
          userId,
          status: { in: [OrderStatus.PAID, OrderStatus.SHIPPED, OrderStatus.DELIVERED] },
        },
      }),
      tx.afterSaleRequest.count({
        where: {
          userId,
          status: {
            notIn: [
              AfterSaleStatus.REJECTED,
              AfterSaleStatus.REFUNDED,
              AfterSaleStatus.COMPLETED,
              AfterSaleStatus.CLOSED,
              AfterSaleStatus.CANCELED,
            ],
          },
        },
      }),
      tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          authIdentities: {
            select: { id: true, provider: true, identifier: true, appId: true, verified: true },
          },
        },
      }),
      (tx as any).digitalAssetAccount?.findUnique
        ? (tx as any).digitalAssetAccount.findUnique({
          where: { userId },
          select: {
            cumulativeSpendAmount: true,
            seedAssetBalance: true,
            creditAssetBalance: true,
          },
          })
        : null,
      tx.groupBuyRebateAccount.findUnique({
        where: { userId },
        select: { id: true, balance: true, reserved: true },
      }),
      tx.captainAccount.findMany({
        where: { userId },
        select: {
          id: true,
          programCode: true,
          balance: true,
          frozen: true,
        },
      }),
    ]);

    const { withdrawableRewards, frozenRewards } = this.sumRewards(rewardAccounts);
    const identities = user.authIdentities as IdentitySnapshot[];
    const phoneIdentity = identities.find((identity) => identity.provider === AuthProvider.PHONE) ?? null;
    const wechatIdentity = identities.find((identity) => identity.provider === AuthProvider.WECHAT) ?? null;
    const primaryIdentity = phoneIdentity ?? wechatIdentity ?? identities[0] ?? null;
    const maskedPhone = phoneIdentity ? this.maskPhone(phoneIdentity.identifier) : null;
    const maskedWechatOpenId = wechatIdentity ? this.maskOpaqueId(wechatIdentity.identifier) : null;

    const deletionMeta: Prisma.InputJsonObject = {
      action: 'ACCOUNT_DELETION',
      confirmationMethod: dto.confirmationMethod,
      noticeVersion: DeletionService.NOTICE_VERSION,
      termsVersion: DeletionService.NOTICE_VERSION,
      privacyVersion: DeletionService.NOTICE_VERSION,
      confirmedAt: new Date().toISOString(),
      ip: evidence.ip ?? null,
      userAgent: evidence.userAgent ?? null,
      identities: identities.map((identity) => ({
        provider: identity.provider,
        appId: identity.appId,
        verified: identity.verified,
        maskedIdentifier:
          identity.provider === AuthProvider.PHONE
            ? this.maskPhone(identity.identifier)
            : this.maskOpaqueId(identity.identifier),
      })),
      snapshot: {
        assets: {
          points: profile?.points ?? 0,
          coupons: coupons.length,
          withdrawableRewards,
          frozenRewards,
          groupBuyRebateBalance: groupBuyRebateAccount?.balance ?? 0,
          groupBuyRebateReserved: groupBuyRebateAccount?.reserved ?? 0,
          captainBalance: captainAccounts.reduce(
            (sum, account) => sum + Number(account.balance ?? 0),
            0,
          ),
          captainFrozen: captainAccounts.reduce(
            (sum, account) => sum + Number(account.frozen ?? 0),
            0,
          ),
          lotteryQuota: lotteryRecords.length,
          pendingWithdrawAmount: pendingWithdrawAggregate._sum.amount ?? 0,
          activeCheckoutCount,
          digitalAssets: {
            cumulativeSpendAmount: digitalAssetAccount?.cumulativeSpendAmount ?? 0,
            seedAssetBalance: digitalAssetAccount?.seedAssetBalance ?? 0,
            creditAssetBalance: digitalAssetAccount?.creditAssetBalance ?? 0,
          },
        },
        pending: { paidOrders, activeAfterSales },
        rewardAccounts: rewardAccounts.map((account) => ({
          id: account.id,
          type: account.type,
          balance: account.balance,
          frozen: account.frozen,
        })),
        couponInstanceIds: coupons.map((coupon) => coupon.id),
        lotteryRecordIds: lotteryRecords.map((record) => record.id),
      },
      forfeited: {
        points: profile?.points ?? 0,
        couponCount: coupons.length,
        lotteryQuota: lotteryRecords.length,
        withdrawableRewards,
        frozenRewards,
        groupBuyRebateBalance: groupBuyRebateAccount?.balance ?? 0,
        groupBuyRebateReserved: groupBuyRebateAccount?.reserved ?? 0,
        captainBalance: captainAccounts.reduce(
          (sum, account) => sum + Number(account.balance ?? 0),
          0,
        ),
        captainFrozen: captainAccounts.reduce(
          (sum, account) => sum + Number(account.frozen ?? 0),
          0,
        ),
        digitalAssetSeedBalance: digitalAssetAccount?.seedAssetBalance ?? 0,
        digitalAssetCreditBalance: digitalAssetAccount?.creditAssetBalance ?? 0,
      },
    };

    return {
      deletionMeta,
      rewardAccounts,
      groupBuyRebateAccount,
      captainAccounts,
      primaryIdentity,
      maskedPhone,
      maskedWechatOpenId,
    };
  }

  private async verifyDeletionOtpInTx(
    tx: Prisma.TransactionClient,
    phone: string,
    code: string | undefined,
  ) {
    if (!code) {
      throw new BadRequestException({ code: 'OTP_REQUIRED', message: '请输入验证码' });
    }

    const records = await tx.smsOtp.findMany({
      where: {
        phone,
        purpose: SmsPurpose.DELETION,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (records.length === 0) {
      throw new BadRequestException({ code: 'OTP_EXPIRED', message: '验证码无效或已过期' });
    }

    let matched: (typeof records)[number] | null = null;
    for (const record of records) {
      if (await bcrypt.compare(code, record.codeHash)) {
        matched = record;
        break;
      }
    }

    if (!matched) {
      const result = await this.redisCoord.consumeFixedWindow(
        `deletion:fail:${this.hashKey(phone)}`,
        3,
        300,
      );
      if (result && result.count >= 3) {
        await tx.smsOtp.updateMany({
          where: { phone, purpose: SmsPurpose.DELETION, usedAt: null },
          data: { usedAt: new Date() },
        });
      }
      throw new BadRequestException({ code: 'OTP_INVALID', message: '验证码错误' });
    }

    const cas = await tx.smsOtp.updateMany({
      where: { id: matched.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (cas.count === 0) {
      throw new BadRequestException({ code: 'OTP_USED', message: '验证码已被使用，请重新获取' });
    }
  }

  private async createOtpWithRateLimit(
    target: string,
    codeHash: string,
    expiresAt: Date,
    purpose: SmsPurpose,
  ) {
    const normalized = this.normalizeIdentifier(target);
    const targetKey = this.hashKey(`${purpose}:${normalized}`);

    const minute = await this.redisCoord.consumeFixedWindow(
      `rl:otp:target:${targetKey}:1m`,
      DeletionService.OTP_PER_MINUTE,
      60,
    );
    if (minute && !minute.allowed) {
      throw new HttpException('发送过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }

    const window = await this.redisCoord.consumeFixedWindow(
      `rl:otp:target:${targetKey}:${DeletionService.OTP_WINDOW_SECONDS}s`,
      DeletionService.OTP_PER_HOUR,
      DeletionService.OTP_WINDOW_SECONDS,
    );
    if (window && !window.allowed) {
      throw new HttpException('验证码发送次数已达上限，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (minute || window) {
      await this.prisma.smsOtp.create({
        data: { phone: target, codeHash, purpose, expiresAt },
      });
      return;
    }

    for (let attempt = 0; attempt < DeletionService.OTP_DB_FALLBACK_MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            const now = new Date();
            const oneMinuteAgo = new Date(now.getTime() - 60_000);
            const windowStart = new Date(now.getTime() - DeletionService.OTP_WINDOW_SECONDS * 1000);

            const [perMinute, perWindow] = await Promise.all([
              tx.smsOtp.count({
                where: { phone: target, purpose, createdAt: { gte: oneMinuteAgo } },
              }),
              tx.smsOtp.count({
                where: { phone: target, purpose, createdAt: { gte: windowStart } },
              }),
            ]);

            if (perMinute >= DeletionService.OTP_PER_MINUTE) {
              throw new HttpException('发送过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
            }
            if (perWindow >= DeletionService.OTP_PER_HOUR) {
              throw new HttpException('验证码发送次数已达上限，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
            }

            await tx.smsOtp.create({
              data: { phone: target, codeHash, purpose, expiresAt },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return;
      } catch (err) {
        if (this.isSerializableConflict(err) && attempt < DeletionService.OTP_DB_FALLBACK_MAX_RETRIES - 1) {
          await this.sleep(50 + Math.floor(Math.random() * 50) + attempt * 50);
          continue;
        }
        throw err;
      }
    }
  }

  private getPhoneIdentity(tx: Prisma.TransactionClient | PrismaService, userId: string) {
    return tx.authIdentity.findFirst({
      where: { userId, provider: AuthProvider.PHONE, verified: true },
      select: { id: true, identifier: true, provider: true, appId: true, verified: true },
    });
  }

  private sumRewards(accounts: Array<{ balance: number; frozen: number }>) {
    return accounts.reduce(
      (acc, account) => ({
        withdrawableRewards: this.roundMoney(acc.withdrawableRewards + account.balance),
        frozenRewards: this.roundMoney(acc.frozenRewards + account.frozen),
      }),
      { withdrawableRewards: 0, frozenRewards: 0 },
    );
  }

  private roundMoney(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private maskPhone(phone: string) {
    if (!phone) return null;
    if (phone.length < 7) return '****';
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }

  private maskOpaqueId(value: string) {
    if (!value) return null;
    if (value.length <= 8) return '****';
    return `${value.slice(0, 4)}***${value.slice(-4)}`;
  }

  private normalizeIdentifier(value: string) {
    const text = String(value || '').trim();
    return text.includes('@') ? text.toLowerCase() : text;
  }

  private hashKey(value: string) {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
  }

  private isSerializableConflict(err: unknown) {
    return !!err && typeof err === 'object' && (err as { code?: string }).code === 'P2034';
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
