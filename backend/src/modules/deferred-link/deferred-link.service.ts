import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DeferredLinkService {
  private readonly logger = new Logger(DeferredLinkService.name);

  constructor(private prisma: PrismaService) {}

  private normalizeUA(ua: string): string {
    // 目标：让"扫码时浏览器 UA"和"App 启动时 RN WebView UA"在同一台设备上归一化为同一字符串，
    // 进而 SHA256 一致命中精确匹配。剥离浏览器引擎/版本特征（Safari/WebView 差异），
    // 保留 OS/设备特征（"iPhone OS 17_2" / "Linux Android 14 Pixel 6"）
    return ua
      // 微信内置浏览器特征
      .replace(/\s*MicroMessenger\/[\d.]+/i, '')
      .replace(/\s*NetType\/\w+/i, '')
      .replace(/\s*Language\/[\w-]+/i, '')
      .replace(/\s*miniProgram\/[\d.]+/i, '')
      // 浏览器引擎/版本（Safari Version vs RN WebView 缺失，Chrome 各家厂商版本不同）
      .replace(/\s*Version\/[\d.]+/i, '')
      .replace(/\s*Chrome\/[\d.]+/i, '')
      .replace(/\s*Safari\/[\d.]+/i, '')
      // Android WebView 多带 Build/UQ1A.xxx 字段，剥掉避免厂商指纹漂移
      .replace(/\s+Build\/[\w.-]+/i, '')
      // 折叠剥离后产生的多余空白
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  }

  private computeFingerprint(ip: string, ua: string, screenInfo: string, language: string): string {
    const normalized = this.normalizeUA(ua);
    const raw = `${ip}|${normalized}|${screenInfo}|${language}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  async create(
    dto: { referralCode: string; userAgent: string; screenWidth: number; screenHeight: number; language?: string },
    ipAddress: string,
  ): Promise<{ cookieId: string }> {
    const member = await this.prisma.memberProfile.findUnique({
      where: { referralCode: dto.referralCode },
    });
    if (!member || member.tier !== 'VIP') {
      throw new BadRequestException('推荐码无效');
    }

    const screenInfo = `${dto.screenWidth}x${dto.screenHeight}`;
    const language = dto.language || '';
    const fingerprint = this.computeFingerprint(ipAddress, dto.userAgent, screenInfo, language);

    const record = await this.prisma.deferredDeepLink.create({
      data: {
        referralCode: dto.referralCode,
        fingerprint,
        ipAddress,
        userAgent: dto.userAgent.slice(0, 500),
        screenInfo,
        language: language || null,
        cookieId: this.generateCookieId(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });

    return { cookieId: record.cookieId };
  }

  async resolve(cookieId: string): Promise<{ referralCode: string | null }> {
    if (!cookieId || cookieId.length > 50) {
      return { referralCode: null };
    }

    const now = new Date();
    // 事务内原子操作：查找 + 标记已消费
    const record = await this.prisma.$transaction(async (tx) => {
      const found = await tx.deferredDeepLink.findUnique({
        where: { cookieId },
      });
      if (!found || found.matched || found.expiresAt < now) {
        return null;
      }
      return tx.deferredDeepLink.update({
        where: { id: found.id },
        data: { matched: true },
      });
    });

    return { referralCode: record?.referralCode ?? null };
  }

  async match(
    dto: { userAgent: string; screenWidth: number; screenHeight: number; language?: string },
    ipAddress: string,
  ): Promise<{ referralCode: string | null }> {
    const screenInfo = `${dto.screenWidth}x${dto.screenHeight}`;
    const language = dto.language || '';
    const fingerprint = this.computeFingerprint(ipAddress, dto.userAgent, screenInfo, language);
    const now = new Date();

    // 事务内原子操作：查找 + 标记已消费
    const record = await this.prisma.$transaction(async (tx) => {
      // 第一优先级：精确指纹匹配
      // findMany take 3 兼做"精确指纹多候选监控"——UA 归一化把指纹降级到
      // OS+设备维度后，同 WiFi+同型号手机+同语言+同屏幕 的精确指纹有概率相同，
      // 多于 1 条候选时 logger.warn 报警，便于排查"拿错码"场景
      const exactCandidates = await tx.deferredDeepLink.findMany({
        where: {
          fingerprint,
          matched: false,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
      });

      if (exactCandidates.length > 1) {
        this.logger.warn(
          `[DDL] 精确指纹多候选：fingerprint=${fingerprint.slice(0, 16)}... ` +
            `count=${exactCandidates.length} picked=${exactCandidates[0].referralCode} ` +
            `（同设备型号+同 WiFi 多人扫码，归一化后指纹碰撞）`,
        );
      }

      if (exactCandidates.length > 0) {
        return tx.deferredDeepLink.update({
          where: { id: exactCandidates[0].id },
          data: { matched: true },
        });
      }

      // 第二优先级：模糊匹配（同 IP + 相同屏幕信息）
      // findMany take 10 兼做"同 IP 多人碰撞监控"——用 findFirst 只能拿到 1 条，
      // 看不到候选数量；3+ 候选意味着公司/家庭/公共 WiFi 多人扫码下载，
      // 按 createdAt DESC 取首条可能不是当前用户实际扫的码（设计文档已知权衡）
      const fuzzyCandidates = await tx.deferredDeepLink.findMany({
        where: {
          ipAddress,
          screenInfo,
          matched: false,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      if (fuzzyCandidates.length >= 3) {
        this.logger.warn(
          `[DDL] 同 IP+屏幕模糊匹配候选过多：ip=${ipAddress} screen=${screenInfo} ` +
            `count=${fuzzyCandidates.length} picked=${fuzzyCandidates[0].referralCode} ` +
            `（可能拿错码，需排查 NAT/公共 WiFi 场景）`,
        );
      }

      if (fuzzyCandidates.length > 0) {
        return tx.deferredDeepLink.update({
          where: { id: fuzzyCandidates[0].id },
          data: { matched: true },
        });
      }

      return null;
    });

    return { referralCode: record?.referralCode ?? null };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpired() {
    const result = await this.prisma.deferredDeepLink.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`清理过期 DeferredDeepLink 记录：${result.count} 条`);
    }
  }

  private generateCookieId(): string {
    return 'ddl_' + randomBytes(18).toString('hex');
  }
}
