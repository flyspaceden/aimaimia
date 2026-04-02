import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * P-5: 定时清理过期验证码
 * 每天凌晨 3 点清理 expiresAt 超过 24 小时的 SmsOtp 记录
 */
@Injectable()
export class OtpCleanupService {
  private readonly logger = new Logger(OtpCleanupService.name);

  constructor(private prisma: PrismaService) {}

  /** M13修复：添加 try-catch 防止 deleteMany 失败崩溃进程 */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCleanup() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    this.logger.log('开始清理过期验证码...');

    try {
      const result = await this.prisma.smsOtp.deleteMany({
        where: { expiresAt: { lt: cutoff } },
      });

      this.logger.log(`已清理 ${result.count} 条过期验证码`);
    } catch (err: any) {
      this.logger.error(
        `清理过期验证码失败: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
