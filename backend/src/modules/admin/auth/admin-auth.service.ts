import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AdminLoginDto,
  AdminLoginByPhoneCodeDto,
  AdminSendCodeDto,
} from './dto/admin-login.dto';
import {
  AdminChangePasswordDto,
  AdminBindPhoneSmsCodeDto,
  AdminChangePhoneDto,
} from './dto/admin-account-security.dto';
import { AdminRefreshDto } from './dto/admin-refresh.dto';
import { maskIp } from '../../../common/security/privacy-mask';
import { CaptchaService } from '../../captcha/captcha.service';
import { AliyunSmsService } from '../../../common/sms/aliyun-sms.service';

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private captchaService: CaptchaService,
    private aliyunSms: AliyunSmsService,
  ) {
    this.jwtSecret = this.config.getOrThrow<string>('ADMIN_JWT_SECRET');
    this.jwtExpiresIn = this.config.get<string>(
      'ADMIN_JWT_EXPIRES_IN',
      '8h',
    );
  }

  /** 管理员登录（账号密码 + 图形验证码） */
  async login(dto: AdminLoginDto, ip?: string, userAgent?: string) {
    // C18：先校验图形验证码（原子 getdel，防止重放）
    const captchaOk = await this.captchaService.verify(
      dto.captchaId,
      dto.captchaCode,
    );
    if (!captchaOk) {
      throw new UnauthorizedException('验证码错误或已过期');
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { username: dto.username },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!admin) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 账号锁定检查
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      const minutes = Math.ceil(
        (admin.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new ForbiddenException(`账号已锁定，请${minutes}分钟后重试`);
    }

    // 账号状态检查
    if (admin.status === 'DISABLED') {
      throw new ForbiddenException('账号已被禁用');
    }

    // 密码验证
    const valid = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!valid) {
      // L12修复：原子递增 loginFailCount，防止并发登录尝试绕过锁定
      await this.prisma.adminUser.update({
        where: { id: admin.id },
        data: { loginFailCount: { increment: 1 } },
      });
      // 原子判断是否达到锁定阈值：仅当 loginFailCount >= 5 时执行锁定
      const locked = await this.prisma.adminUser.updateMany({
        where: { id: admin.id, loginFailCount: { gte: 5 } },
        data: {
          lockedUntil: new Date(Date.now() + 30 * 60 * 1000),
          loginFailCount: 0,
        },
      });
      if (locked.count > 0) {
        throw new ForbiddenException('登录失败次数过多，账号已锁定30分钟');
      }
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 重置登录失败计数
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        loginFailCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip,
      },
    });

    // 记录审计日志
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId: admin.id,
        action: 'LOGIN',
        module: 'auth',
        summary: `管理员 ${admin.username} 登录`,
        ip,
        userAgent,
        isReversible: false,
      },
    });

    return this.issueTokens(admin, ip, userAgent);
  }

  /** 发送短信验证码（管理员手机登录）
   *
   * 方案 A（2026-04-19）：去除图形验证码依赖，改用后端严格速率限制保护：
   * - 单手机号：1 条/分钟、5 条/小时、10 条/日（Serializable 事务防 TOCTOU）
   * - 单 IP：controller 层 @Throttle 3 条/分钟
   * - 时序防枚举 1-3s 随机延迟
   */
  async sendSmsCode(dto: AdminSendCodeDto, ip?: string) {
    const { phone } = dto;

    // 防时序枚举：不论手机号是否存在，都先做随机延迟（1000-3000ms）
    // 在 SMS_MOCK 模式下真实路径本身很快，统一延迟保证两种情况耗时一致
    // 在生产模式下真实 SMS 发送本就 1-3s，此延迟与实际耗时叠加影响极小
    const jitterDelay = 1000 + Math.floor(Math.random() * 2000);
    const jitter = new Promise((resolve) => setTimeout(resolve, jitterDelay));

    // 查找手机号对应的管理员（仅当存在且激活状态才真实发送，避免手机号枚举）
    const admin = await this.prisma.adminUser.findUnique({
      where: { phone },
    });

    let pendingSms: { code: string } | null = null;

    // 即使管理员不存在/禁用也返回通用成功，但只在合法时发送短信
    if (admin && admin.status === 'ACTIVE') {
      const smsMock = this.config.get('SMS_MOCK', 'true');
      const code =
        smsMock === 'true' ? '123456' : randomInt(100000, 1000000).toString();
      const codeHash = await bcrypt.hash(code, 10);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      // Serializable 事务：速率限制 count + OTP 插入原子执行
      // 防 TOCTOU：两个并发请求同手机号时，后者 count 会包含前者写入，被拒
      await this.prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const oneMinuteAgo = new Date(now.getTime() - 60_000);
          const oneHourAgo = new Date(now.getTime() - 3_600_000);
          const dayStart = new Date(now);
          dayStart.setHours(0, 0, 0, 0);

          const [perMinute, perHour, perDay] = await Promise.all([
            tx.smsOtp.count({
              where: { phone, purpose: 'LOGIN', createdAt: { gte: oneMinuteAgo } },
            }),
            tx.smsOtp.count({
              where: { phone, purpose: 'LOGIN', createdAt: { gte: oneHourAgo } },
            }),
            tx.smsOtp.count({
              where: { phone, purpose: 'LOGIN', createdAt: { gte: dayStart } },
            }),
          ]);

          if (perMinute >= 1) {
            throw new HttpException(
              '发送过于频繁，请 1 分钟后再试',
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }
          if (perHour >= 5) {
            throw new HttpException(
              '该手机号 1 小时内发送次数过多，请稍后再试',
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }
          if (perDay >= 10) {
            throw new HttpException(
              '该手机号今日验证码发送次数已达上限',
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }

          await tx.smsOtp.create({
            data: { phone, codeHash, purpose: 'LOGIN', expiresAt },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      pendingSms = { code };
    } else {
      // 不存在或禁用：记录日志但返回通用成功（不做真实发送）
      this.logger.warn(
        `[Admin SMS] 手机号无匹配管理员或账号禁用，忽略发送`,
      );
    }

    // 事务提交后再发实际短信（网络调用不能放事务内）
    if (pendingSms) {
      const smsMock = this.config.get('SMS_MOCK', 'true');
      const nodeEnv = this.config.get('NODE_ENV', 'development');
      if (smsMock === 'true') {
        if (nodeEnv === 'production') {
          this.logger.warn(
            '[Admin SMS] 生产环境仍使用 Mock 短信，请设置 SMS_MOCK=false 并配置真实短信服务',
          );
        }
        this.logger.log(
          `[Admin SMS Mock] 固定验证码=${pendingSms.code}（管理员手机登录）`,
        );
      } else {
        try {
          await this.aliyunSms.sendVerificationCode(phone, pendingSms.code);
        } catch (err) {
          this.logger.error(
            `[Admin SMS] 验证码发送失败: ${(err as Error)?.message}`,
            (err as Error)?.stack,
          );
        }
      }
    }

    // 等待 jitter 完成再返回，使真假手机号的响应时间一致
    await jitter;
    return { ok: true, message: '验证码已发送' };
  }

  /** C18：手机号 + 短信验证码登录 */
  async loginByPhoneCode(
    dto: AdminLoginByPhoneCodeDto,
    ip?: string,
    userAgent?: string,
  ) {
    // 1. 查找并消费验证码（CAS 原子消费）
    const records = await this.prisma.smsOtp.findMany({
      where: {
        phone: dto.phone,
        purpose: 'LOGIN',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (records.length === 0) {
      throw new BadRequestException('验证码无效或已过期');
    }

    let matchedRecord: (typeof records)[number] | null = null;
    for (const record of records) {
      const valid = await bcrypt.compare(dto.code, record.codeHash);
      if (valid) {
        matchedRecord = record;
        break;
      }
    }

    if (!matchedRecord) {
      throw new BadRequestException('验证码错误');
    }

    const cas = await this.prisma.smsOtp.updateMany({
      where: { id: matchedRecord.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (cas.count === 0) {
      throw new BadRequestException('验证码已被使用，请重新获取');
    }

    // 2. 查找管理员
    const admin = await this.prisma.adminUser.findUnique({
      where: { phone: dto.phone },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!admin) {
      throw new UnauthorizedException('手机号未绑定管理员账号');
    }

    // 3. 账号锁定/禁用检查
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      const minutes = Math.ceil(
        (admin.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new ForbiddenException(`账号已锁定，请${minutes}分钟后重试`);
    }
    if (admin.status === 'DISABLED') {
      throw new ForbiddenException('账号已被禁用');
    }

    // 4. 更新登录信息
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        loginFailCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip,
      },
    });

    // 5. 审计日志
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId: admin.id,
        action: 'LOGIN',
        module: 'auth',
        summary: `管理员 ${admin.username} 通过手机验证码登录`,
        ip,
        userAgent,
        isReversible: false,
      },
    });

    return this.issueTokens(admin, ip, userAgent);
  }

  /** 刷新 Token */
  async refresh(dto: AdminRefreshDto) {
    const refreshTokenHash = this.hashToken(dto.refreshToken);
    const now = new Date();

    const session = await this.prisma.adminSession.findFirst({
      where: {
        refreshTokenHash,
        expiresAt: { gt: now },
        // L1修复：检查最大续期上限
        OR: [
          { absoluteExpiresAt: null },
          { absoluteExpiresAt: { gt: now } },
        ],
      },
      include: {
        adminUser: {
          include: {
            userRoles: { include: { role: true } },
          },
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException('刷新令牌已失效');
    }

    // S10延伸修复：CAS 原子失效旧 session，防止并发重复刷新
    const cas = await this.prisma.adminSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash,
        expiresAt: { gt: now },
      },
      data: { expiresAt: now },
    });
    if (cas.count === 0) {
      throw new UnauthorizedException('刷新令牌已失效');
    }

    // L1修复：继承旧 session 的 absoluteExpiresAt，防止无限续期
    return this.issueTokens(
      session.adminUser,
      session.ip,
      session.userAgent,
      session.absoluteExpiresAt,
    );
  }

  /** 登出 */
  async logout(adminUserId: string, ip?: string, userAgent?: string) {
    // 失效该管理员所有活跃 session（保留记录供审计追溯）
    await this.prisma.adminSession.updateMany({
      where: { adminUserId, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });

    // 记录审计日志
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action: 'LOGOUT',
        module: 'auth',
        summary: '管理员登出',
        ip,
        userAgent,
        isReversible: false,
      },
    });

    return { ok: true };
  }

  /** 获取当前管理员信息 */
  async getProfile(adminUserId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!admin) {
      throw new UnauthorizedException('管理员不存在');
    }

    const roles = admin.userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        admin.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.code),
        ),
      ),
    ];

    return {
      id: admin.id,
      username: admin.username,
      realName: admin.realName,
      phone: admin.phone,
      status: admin.status,
      roles,
      permissions,
      lastLoginAt: admin.lastLoginAt,
      lastLoginIp: admin.lastLoginIp,
      lastLoginIpMasked: maskIp(admin.lastLoginIp),
    };
  }

  // ===================== C40c7 账号安全：修改密码 / 修改手机号 =====================

  /** 修改密码：旧密码 + 新密码（校验后强制失效所有 session，用户需重新登录） */
  async changePassword(
    adminUserId: string,
    dto: AdminChangePasswordDto,
    ip?: string,
    userAgent?: string,
  ) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
    });
    if (!admin) throw new NotFoundException('管理员不存在');

    const valid = await bcrypt.compare(dto.oldPassword, admin.passwordHash);
    if (!valid) throw new UnauthorizedException('原密码错误');

    if (dto.oldPassword === dto.newPassword) {
      throw new BadRequestException('新密码不能与原密码相同');
    }

    const newHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: { passwordHash: newHash },
    });

    // 改密后所有 session 失效，前端本次请求完成后需重新登录
    await this.prisma.adminSession.updateMany({
      where: { adminUserId, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });

    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action: 'UPDATE',
        module: 'auth',
        summary: `管理员 ${admin.username} 修改密码`,
        ip,
        userAgent,
        isReversible: false,
      },
    });

    return { ok: true };
  }

  /** 给新手机号发绑定验证码（已登录态调用，purpose=BIND） */
  async sendBindPhoneSmsCode(
    dto: AdminBindPhoneSmsCodeDto,
    adminUserId: string,
  ) {
    const { phone } = dto;

    // 新手机号不能已被其他管理员绑定
    const existing = await this.prisma.adminUser.findUnique({
      where: { phone },
    });
    if (existing && existing.id !== adminUserId) {
      throw new ConflictException('该手机号已被其他管理员绑定');
    }

    const smsMock = this.config.get('SMS_MOCK', 'true');
    const code =
      smsMock === 'true' ? '123456' : randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Serializable 事务：速率限制 + OTP 插入原子执行（防 TOCTOU）
    await this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const oneMinuteAgo = new Date(now.getTime() - 60_000);
        const oneHourAgo = new Date(now.getTime() - 3_600_000);
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);

        const [perMinute, perHour, perDay] = await Promise.all([
          tx.smsOtp.count({
            where: { phone, purpose: 'BIND', createdAt: { gte: oneMinuteAgo } },
          }),
          tx.smsOtp.count({
            where: { phone, purpose: 'BIND', createdAt: { gte: oneHourAgo } },
          }),
          tx.smsOtp.count({
            where: { phone, purpose: 'BIND', createdAt: { gte: dayStart } },
          }),
        ]);

        if (perMinute >= 1) {
          throw new HttpException(
            '发送过于频繁，请 1 分钟后再试',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        if (perHour >= 5) {
          throw new HttpException(
            '该手机号 1 小时内发送次数过多',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        if (perDay >= 10) {
          throw new HttpException(
            '该手机号今日验证码发送次数已达上限',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        await tx.smsOtp.create({
          data: { phone, codeHash, purpose: 'BIND', expiresAt },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (smsMock === 'true') {
      this.logger.log(
        `[Admin Bind SMS Mock] 固定验证码=${code}（目标手机 ${phone}）`,
      );
    } else {
      try {
        await this.aliyunSms.sendVerificationCode(phone, code);
      } catch (err) {
        this.logger.error(
          `[Admin Bind SMS] 验证码发送失败: ${(err as Error)?.message}`,
          (err as Error)?.stack,
        );
      }
    }

    return { ok: true, message: '验证码已发送' };
  }

  /** 修改手机号：双重 SMS 验证（原手机 LOGIN + 新手机 BIND）*/
  async changePhone(
    adminUserId: string,
    dto: AdminChangePhoneDto,
    ip?: string,
    userAgent?: string,
  ) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
    });
    if (!admin) throw new NotFoundException('管理员不存在');
    if (!admin.phone) {
      throw new BadRequestException('当前账号未绑定手机号，请联系超管协助设置');
    }
    if (admin.phone === dto.newPhone) {
      throw new BadRequestException('新手机号与原手机号相同');
    }

    // 原手机验证码：复用已有 /sms/code 端点（purpose=LOGIN）
    await this.verifyAndConsumeOtp(admin.phone, dto.oldPhoneCode, 'LOGIN');

    // 新手机验证码：由 /bind-phone/sms/code 端点生成（purpose=BIND）
    await this.verifyAndConsumeOtp(dto.newPhone, dto.newPhoneCode, 'BIND');

    // 再次检查新手机号未被抢占（并发场景下）
    const existing = await this.prisma.adminUser.findUnique({
      where: { phone: dto.newPhone },
    });
    if (existing && existing.id !== adminUserId) {
      throw new ConflictException('该手机号已被其他管理员绑定');
    }

    const oldPhone = admin.phone;
    await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: { phone: dto.newPhone },
    });

    // 改手机后所有 session 失效（防止老手机持有者继续登录）
    await this.prisma.adminSession.updateMany({
      where: { adminUserId, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });

    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action: 'UPDATE',
        module: 'auth',
        summary: `管理员 ${admin.username} 修改手机号 ${oldPhone} → ${dto.newPhone}`,
        ip,
        userAgent,
        isReversible: false,
      },
    });

    return { ok: true };
  }

  /** 校验并消费 OTP（CAS 原子，失败抛 BadRequestException） */
  private async verifyAndConsumeOtp(
    phone: string,
    code: string,
    purpose: 'LOGIN' | 'BIND',
  ) {
    const records = await this.prisma.smsOtp.findMany({
      where: {
        phone,
        purpose,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const errLabel = purpose === 'BIND' ? '新手机号' : '原手机号';
    if (records.length === 0) {
      throw new BadRequestException(`${errLabel}验证码无效或已过期`);
    }

    let matched: (typeof records)[number] | null = null;
    for (const r of records) {
      if (await bcrypt.compare(code, r.codeHash)) {
        matched = r;
        break;
      }
    }
    if (!matched) {
      throw new BadRequestException(`${errLabel}验证码错误`);
    }

    const cas = await this.prisma.smsOtp.updateMany({
      where: { id: matched.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (cas.count === 0) {
      throw new BadRequestException('验证码已被使用，请重新获取');
    }
  }

  // ---- 内部方法 ----

  private async issueTokens(
    admin: any,
    ip?: string | null,
    userAgent?: string | null,
    inheritedAbsoluteExpiresAt?: Date | null,
  ) {
    const roles = admin.userRoles.map((ur: any) => ur.role.name);

    // 查询权限码写入 JWT（用于前端展示/兼容；服务端权限判定以 PermissionGuard 实时查库为准）
    const rolePermissions = await this.prisma.adminRolePermission.findMany({
      where: {
        role: {
          userRoles: { some: { adminUserId: admin.id } },
        },
      },
      include: { permission: true },
    });
    const permissions = [...new Set(rolePermissions.map((rp) => rp.permission.code))];

    const refreshTokenStr = randomBytes(64).toString('hex');
    const refreshTokenHash = this.hashToken(refreshTokenStr);
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 天

    // L1修复：首次登录设 90 天绝对上限；refresh 时继承旧值，不可重置
    const absoluteExpiresAt = inheritedAbsoluteExpiresAt
      ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const session = await this.prisma.adminSession.create({
      data: {
        adminUserId: admin.id,
        refreshTokenHash,
        ip: ip || null,
        userAgent: userAgent || null,
        expiresAt: refreshExpiresAt,
        absoluteExpiresAt,
      },
    });

    const payload = {
      sub: admin.id,
      type: 'admin' as const,
      roles,
      permissions,
      sessionId: session.id,
    };

    const accessToken = this.jwt.sign(payload as any, {
      secret: this.jwtSecret,
      expiresIn: this.jwtExpiresIn as any,
    });

    return {
      accessToken,
      refreshToken: refreshTokenStr,
      expiresIn: this.jwtExpiresIn,
      admin: {
        id: admin.id,
        username: admin.username,
        realName: admin.realName,
        roles,
      },
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
