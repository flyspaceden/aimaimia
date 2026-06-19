import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt } from 'crypto';
import { AliyunSmsService } from '../../../common/sms/aliyun-sms.service';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';

type DeliveryAuthRequestMeta = {
  ip?: string;
  userAgent?: string;
};

@Injectable()
export class DeliveryPhoneOtpService {
  private static readonly FAILED_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
  private static readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly logger = new Logger(DeliveryPhoneOtpService.name);

  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly configService: ConfigService,
    private readonly aliyunSmsService: AliyunSmsService,
  ) {}

  async issuePhoneLoginCode(phone: string, _meta: DeliveryAuthRequestMeta = {}) {
    const now = new Date();
    const recentCount = await this.deliveryPrisma.deliveryPhoneOtp.count({
      where: {
        phone,
        purpose: 'LOGIN',
        createdAt: {
          gte: new Date(now.getTime() - 60_000),
        },
      },
    });

    if (recentCount > 0) {
      throw new BadRequestException('请勿频繁获取验证码');
    }

    const code = this.isMockCodeEnabled() ? '123456' : this.generateCode();
    await this.deliveryPrisma.deliveryPhoneOtp.create({
      data: {
        phone,
        purpose: 'LOGIN',
        codeHash: this.hashCode(code),
        expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      },
    });

    if (this.isMockCodeEnabled()) {
      this.logger.log(`[Delivery Buyer SMS Mock] code=${code}`);
      return { ok: true, message: '验证码已发送' };
    }

    try {
      await this.aliyunSmsService.sendVerificationCode(phone, code);
    } catch (error) {
      this.logger.error(`[Delivery Buyer SMS] 发送失败: ${(error as Error).message}`);
    }

    return { ok: true, message: '验证码已发送' };
  }

  async verifyPhoneLoginCode(phone: string, code: string, meta: DeliveryAuthRequestMeta = {}) {
    const now = new Date();
    const codeHash = this.hashCode(code);
    const throttleWindowStart = new Date(
      now.getTime() - DeliveryPhoneOtpService.FAILED_ATTEMPT_WINDOW_MS,
    );

    const matched = await this.deliveryPrisma.$transaction(
      async (tx) => {
        const recentFailedAttempts = await tx.deliveryPhoneOtpAttempt.count({
          where: {
            phone,
            purpose: 'LOGIN',
            success: false,
            createdAt: { gte: throttleWindowStart },
            ...(meta.ip ? { ip: meta.ip } : {}),
          },
        });

        if (recentFailedAttempts >= DeliveryPhoneOtpService.MAX_FAILED_ATTEMPTS) {
          return 'THROTTLED' as const;
        }

        const record = await tx.deliveryPhoneOtp.findFirst({
          where: {
            phone,
            purpose: 'LOGIN',
            codeHash,
            consumedAt: null,
            expiresAt: { gt: now },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (!record) {
          return null;
        }

        const consumed = await tx.deliveryPhoneOtp.updateMany({
          where: {
            id: record.id,
            consumedAt: null,
          },
          data: {
            consumedAt: now,
          },
        });

        return consumed.count > 0 ? record.id : null;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    if (matched === 'THROTTLED') {
      throw new BadRequestException('验证码尝试次数过多，请稍后再试');
    }

    if (matched) {
      await this.recordAttempt(phone, true, meta);
      return;
    }

    if (this.isMockCodeEnabled() && code === '123456') {
      await this.recordAttempt(phone, true, meta);
      return;
    }

    await this.recordAttempt(phone, false, meta, 'INVALID_OR_EXPIRED');
    throw new BadRequestException('验证码错误或已过期');
  }

  private async recordAttempt(
    phone: string,
    success: boolean,
    meta: DeliveryAuthRequestMeta,
    failureReason?: string,
  ) {
    await this.deliveryPrisma.deliveryPhoneOtpAttempt.create({
      data: {
        phone,
        purpose: 'LOGIN',
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        success,
        failureReason: success ? null : failureReason ?? 'UNKNOWN',
      },
    });
  }

  private isMockCodeEnabled() {
    return this.configService.get('DELIVERY_SMS_MOCK') === 'true';
  }

  private generateCode() {
    return `${randomInt(100000, 1000000)}`;
  }

  hashCode(code: string) {
    return createHash('sha256').update(code).digest('hex');
  }
}
