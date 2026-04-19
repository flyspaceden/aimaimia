import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateCompanyDto, InviteStaffDto, UpdateStaffDto, AI_SEARCH_KEYS } from './seller-company.dto';
import { maskName, maskPhone } from '../../../common/security/privacy-mask';
import { PLATFORM_COMPANY_ID } from '../../bonus/engine/constants';
import { CompanyService } from '../../company/company.service';
import { AliyunSmsService } from '../../../common/sms/aliyun-sms.service';

@Injectable()
export class SellerCompanyService {
  private readonly logger = new Logger(SellerCompanyService.name);

  constructor(
    private prisma: PrismaService,
    private companyService: CompanyService,
    private config: ConfigService,
    private aliyunSms: AliyunSmsService,
  ) {}

  // ===================== 企业信息 =====================

  /** 获取企业信息 */
  async getCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        profile: true,
        documents: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!company) throw new NotFoundException('企业不存在');
    const contact = (company.contact || null) as Record<string, unknown> | null;
    return {
      ...company,
      servicePhoneMasked: maskPhone(company.servicePhone),
      contactMasked: contact
        ? {
            ...contact,
            ...(typeof contact.name === 'string' ? { name: maskName(contact.name) } : {}),
            ...(typeof contact.phone === 'string' ? { phone: maskPhone(contact.phone) } : {}),
          }
        : null,
    };
  }

  /** 更新企业信息 */
  async updateCompany(companyId: string, dto: UpdateCompanyDto) {
    // 如果传入了结构化地址，自动拼接 text 字段
    let address = dto.address;
    if (address && (address.province || address.city || address.district || address.detail)) {
      const text = [address.province, address.city, address.district, address.detail]
        .filter(Boolean)
        .join('');
      address = { ...address, text };
    }

    return this.prisma.company.update({
      where: { id: companyId },
      data: {
        name: dto.name,
        shortName: dto.shortName,
        description: dto.description,
        servicePhone: dto.servicePhone,
        serviceWeChat: dto.serviceWeChat,
        contact: dto.contact,
        address,
      },
    });
  }

  /** 更新企业亮点（merge 模式，保护 AI 搜索字段不被覆盖） */
  async updateHighlights(companyId: string, highlights: any) {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.companyProfile.findUnique({
        where: { companyId },
        select: { highlights: true },
      });
      const existing = (profile?.highlights as Record<string, any>) ?? {};
      // 从传入数据中移除 AI 搜索字段，防止企业亮点 Card 覆盖
      const safeHighlights = Object.fromEntries(
        Object.entries(highlights as Record<string, any>).filter(
          ([k]) => !(AI_SEARCH_KEYS as readonly string[]).includes(k),
        ),
      );
      const merged = { ...existing, ...safeHighlights };
      return tx.companyProfile.upsert({
        where: { companyId },
        create: { companyId, highlights: merged },
        update: { highlights: merged },
      });
    }, { isolationLevel: 'Serializable' });
  }

  // ===================== AI 搜索资料 =====================

  /** 获取 AI 搜索资料（仅 companyType，其他字段已迁移到 CompanyTag） */
  async getAiSearchProfile(companyId: string) {
    const profile = await this.prisma.companyProfile.findUnique({
      where: { companyId },
      select: { highlights: true },
    });
    const h = (profile?.highlights as Record<string, any>) ?? {};
    return {
      companyType: h.companyType ?? null,
    };
  }

  /** 更新 AI 搜索资料（仅 companyType，其他字段已迁移到 CompanyTag） */
  async updateAiSearchProfile(companyId: string, dto: { companyType: string }) {
    const aiFields = { companyType: dto.companyType };

    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.companyProfile.findUnique({
        where: { companyId },
        select: { highlights: true },
      });
      const existing = (profile?.highlights as Record<string, any>) ?? {};
      const merged = { ...existing, ...aiFields };

      await tx.companyProfile.upsert({
        where: { companyId },
        create: { companyId, highlights: merged },
        update: { highlights: merged },
      });

      return aiFields;
    }, { isolationLevel: 'Serializable' });
  }

  // ===================== 企业标签 =====================

  async getCompanyTags(companyId: string) {
    const companyTags = await this.prisma.companyTag.findMany({
      where: { companyId },
      orderBy: { sortOrder: 'asc' },
      include: {
        tag: {
          include: { category: { select: { id: true, name: true, code: true, scope: true } } },
        },
      },
    });

    const grouped: Record<string, { categoryId: string; categoryName: string; categoryCode: string; tags: { id: string; name: string }[] }> = {};
    for (const ct of companyTags) {
      const code = ct.tag.category.code;
      if (!grouped[code]) {
        grouped[code] = {
          categoryId: ct.tag.category.id,
          categoryName: ct.tag.category.name,
          categoryCode: code,
          tags: [],
        };
      }
      grouped[code].tags.push({ id: ct.tag.id, name: ct.tag.name });
    }
    return Object.values(grouped);
  }

  async updateCompanyTags(companyId: string, tagIds: string[]) {
    await this.prisma.$transaction(async (tx) => {
      // 验证所有 tagIds 存在且 scope 为 COMPANY（在事务内确保一致性）
      if (tagIds.length > 0) {
        const tags = await tx.tag.findMany({
          where: { id: { in: tagIds } },
          include: { category: { select: { scope: true } } },
        });
        const invalidTags = tags.filter(t => t.category.scope !== 'COMPANY');
        if (invalidTags.length > 0) {
          throw new BadRequestException(`以下标签不适用于企业：${invalidTags.map(t => t.name).join(', ')}`);
        }
        if (tags.length !== tagIds.length) {
          throw new BadRequestException('部分标签 ID 不存在');
        }
      }

      await tx.companyTag.deleteMany({ where: { companyId } });
      if (tagIds.length > 0) {
        await tx.companyTag.createMany({
          data: tagIds.map((tagId, index) => ({ companyId, tagId, sortOrder: index })),
          skipDuplicates: true,
        });
      }
    });

    // 事务完成后失效缓存
    this.companyService.invalidateListCache();

    return this.getCompanyTags(companyId);
  }

  // ===================== 资质文件 =====================

  /** 资质文件列表 */
  async getDocuments(companyId: string) {
    return this.prisma.companyDocument.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 上传资质文件 */
  async addDocument(
    companyId: string,
    data: { type: string; title: string; fileUrl: string; issuer?: string; expiresAt?: string },
  ) {
    return this.prisma.companyDocument.create({
      data: {
        companyId,
        type: data.type as any,
        title: data.title,
        fileUrl: data.fileUrl,
        issuer: data.issuer,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
    });
  }

  // ===================== 员工管理 =====================

  /** 员工列表 */
  async getStaff(companyId: string) {
    return this.prisma.companyStaff.findMany({
      where: { companyId },
      include: {
        user: { include: { profile: { select: { nickname: true, avatarUrl: true } } } },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  /** 邀请员工 */
  async inviteStaff(companyId: string, inviterUserId: string, dto: InviteStaffDto) {
    // F4: 禁止向平台公司邀请员工
    if (companyId === PLATFORM_COMPANY_ID) {
      throw new BadRequestException('平台公司不支持邀请员工');
    }

    // 不能邀请为 OWNER
    if (dto.role === 'OWNER') {
      throw new BadRequestException('不能邀请新的企业主');
    }

    // 通过手机号查找用户，不存在则自动创建
    let identity = await this.prisma.authIdentity.findFirst({
      where: { provider: 'PHONE', identifier: dto.phone },
    });

    if (!identity) {
      // 手机号未注册，自动创建用户（App 未上线前员工无法自行注册）
      const newUser = await this.prisma.user.create({
        data: {
          profile: { create: { nickname: dto.phone } },
          memberProfile: { create: {} },
          authIdentities: {
            create: {
              provider: 'PHONE',
              identifier: dto.phone,
              verified: true,
            },
          },
        },
        include: { authIdentities: { where: { provider: 'PHONE' }, take: 1 } },
      });
      identity = newUser.authIdentities[0];
    }

    // 检查是否已是该企业员工
    const existing = await this.prisma.companyStaff.findUnique({
      where: { userId_companyId: { userId: identity.userId, companyId } },
    });

    if (existing) {
      throw new BadRequestException('该用户已是本企业员工');
    }

    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : null;

    const created = await this.prisma.companyStaff.create({
      data: {
        userId: identity.userId,
        companyId,
        role: dto.role,
        invitedBy: inviterUserId,
        passwordHash,
      },
      include: {
        user: { include: { profile: { select: { nickname: true, avatarUrl: true } } } },
      },
    });

    // C40c6：邀请员工时 fire-and-forget 发通知短信（复用现有验证码模板 SMS_501860621）
    // - 员工看到签名「深圳华海农业科技集团」知道是哪家企业邀请
    // - 发送的 code 同时写入 SmsOtp(purpose=LOGIN)，员工可直接用它登录（5 分钟有效）
    // - 失败不阻塞邀请流程
    void this.sendInviteSms(dto.phone).catch((err) => {
      this.logger.warn(`[InviteStaff] SMS 发送失败不影响邀请: ${(err as Error)?.message}`);
    });

    return created;
  }

  /** 发送邀请短信（内部方法，fire-and-forget） */
  private async sendInviteSms(phone: string) {
    const smsMock = this.config.get('SMS_MOCK', 'true');
    const code = smsMock === 'true' ? '123456' : randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // 写入 SmsOtp 使该 code 可用于登录
    await this.prisma.smsOtp.create({
      data: { phone, codeHash, purpose: 'LOGIN', expiresAt },
    });

    if (smsMock === 'true') {
      this.logger.log(
        `[InviteStaff SMS Mock] 固定 code=${code}（目标 ${maskPhone(phone)}），员工可用此 code 登录`,
      );
    } else {
      await this.aliyunSms.sendVerificationCode(phone, code);
      this.logger.log(
        `[InviteStaff SMS] 已发送（目标 ${maskPhone(phone)}），签名【深圳华海农业科技集团】+ code 5 分钟内可登录`,
      );
    }
  }

  /** 修改员工角色/状态 */
  async updateStaff(companyId: string, staffId: string, dto: UpdateStaffDto) {
    const staff = await this.prisma.companyStaff.findUnique({ where: { id: staffId } });
    if (!staff) throw new NotFoundException('员工不存在');
    if (staff.companyId !== companyId) throw new ForbiddenException('无权操作');

    // OWNER 不能被修改角色或禁用
    if (staff.role === 'OWNER') {
      throw new BadRequestException('不能修改企业主的角色或状态');
    }

    // 不能改为 OWNER
    if (dto.role === 'OWNER') {
      throw new BadRequestException('不能将员工提升为企业主');
    }

    return this.prisma.companyStaff.update({
      where: { id: staffId },
      data: {
        role: dto.role as any,
        status: dto.status as any,
      },
      include: {
        user: { include: { profile: { select: { nickname: true, avatarUrl: true } } } },
      },
    });
  }

  /** 移除员工 */
  async removeStaff(companyId: string, staffId: string) {
    const staff = await this.prisma.companyStaff.findUnique({ where: { id: staffId } });
    if (!staff) throw new NotFoundException('员工不存在');
    if (staff.companyId !== companyId) throw new ForbiddenException('无权操作');

    // OWNER 不可移除
    if (staff.role === 'OWNER') {
      throw new BadRequestException('企业主不可移除');
    }

    // H12修复：使用事务保证 session 失效和员工删除的原子性
    await this.prisma.$transaction(async (tx) => {
      // 先失效该员工所有活跃 session
      await tx.sellerSession.updateMany({
        where: { staffId, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date() },
      });

      await tx.companyStaff.delete({ where: { id: staffId } });
    });

    return { ok: true };
  }
}
