import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AfterSaleStatus,
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
import { AccountDeletionConfirmMethod, ExecuteDeletionDto } from './dto/deletion.dto';

type DeletionBlockerCode =
  | 'IS_COMPANY_OWNER'
  | 'USER_NOT_ACTIVE'
  | 'ACTIVE_CHECKOUT_EXISTS'
  | 'PENDING_PAYMENT_EXISTS'
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

    const smsMock = this.config.get('SMS_MOCK', 'true');
    const code = smsMock === 'true' ? '123456' : randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.createOtpWithRateLimit(
      phoneIdentity.identifier,
      codeHash,
      expiresAt,
      SmsPurpose.DELETION,
    );

    const nodeEnv = this.config.get('NODE_ENV', 'development');
    if (smsMock === 'true') {
      if (nodeEnv === 'production') {
        this.logger.warn('[SMS] 生产环境仍使用 Mock 短信（账号注销），请设置 SMS_MOCK=false');
      }
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
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`AD-${userId}`}))`;

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
    const cleanup = await this.buildCleanupSnapshot(tx, userId, dto, evidence);

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
    if (voidLedgerRows.length > 0) {
      await tx.rewardLedger.createMany({ data: voidLedgerRows });
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
        digitalAssetSeedBalance: digitalAssetAccount?.seedAssetBalance ?? 0,
        digitalAssetCreditBalance: digitalAssetAccount?.creditAssetBalance ?? 0,
      },
    };

    return {
      deletionMeta,
      rewardAccounts,
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
