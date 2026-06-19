import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';

@Injectable()
export class DeliveryPhoneOtpService {
  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly configService: ConfigService,
  ) {}

  async verifyPhoneLoginCode(phone: string, code: string) {
    const now = new Date();
    const codeHash = this.hashCode(code);

    const matched = await this.deliveryPrisma.$transaction(
      async (tx) => {
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

    if (matched) {
      return;
    }

    if (this.configService.get('SMS_MOCK', 'true') === 'true' && code === '123456') {
      return;
    }

    throw new BadRequestException('验证码错误或已过期');
  }

  hashCode(code: string) {
    return createHash('sha256').update(code).digest('hex');
  }
}
