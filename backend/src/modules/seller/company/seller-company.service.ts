import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateCompanyDto, InviteStaffDto, UpdateStaffDto, AI_SEARCH_KEYS } from './seller-company.dto';
import { maskName, maskPhone } from '../../../common/security/privacy-mask';
import { PLATFORM_COMPANY_ID } from '../../bonus/engine/constants';

@Injectable()
export class SellerCompanyService {
  constructor(private prisma: PrismaService) {}

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
    return this.prisma.company.update({
      where: { id: companyId },
      data: {
        name: dto.name,
        shortName: dto.shortName,
        description: dto.description,
        servicePhone: dto.servicePhone,
        serviceWeChat: dto.serviceWeChat,
        contact: dto.contact,
        address: dto.address,
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

  /** 获取 AI 搜索资料（从 highlights 提取结构化字段） */
  async getAiSearchProfile(companyId: string) {
    const profile = await this.prisma.companyProfile.findUnique({
      where: { companyId },
      select: { highlights: true },
    });
    const h = (profile?.highlights as Record<string, any>) ?? {};
    return {
      companyType: h.companyType ?? null,
      industryTags: h.industryTags ?? [],
      productKeywords: h.productKeywords ?? [],
      serviceAreas: h.serviceAreas ?? [],
      productFeatures: h.productFeatures ?? [],
      supplyModes: h.supplyModes ?? [],
      certifications: h.certifications ?? [],
    };
  }

  /** 更新 AI 搜索资料（原子合并到 highlights + 计算派生字段） */
  async updateAiSearchProfile(companyId: string, dto: {
    companyType: string;
    industryTags: string[];
    productKeywords?: string[];
    serviceAreas: string[];
    productFeatures: string[];
    supplyModes?: string[];
    certifications?: string[];
  }) {
    // 清洗 serviceAreas：trim + 去重 + 过滤空串
    const cleanedAreas = [...new Set(
      dto.serviceAreas.map((s) => s.trim()).filter(Boolean),
    )];

    const aiFields = {
      companyType: dto.companyType,
      industryTags: dto.industryTags,
      productKeywords: dto.productKeywords ?? [],
      serviceAreas: cleanedAreas,
      productFeatures: dto.productFeatures,
      supplyModes: dto.supplyModes ?? [],
      certifications: dto.certifications ?? [],
    };

    // 计算派生字段
    const mainBusiness = [
      ...aiFields.industryTags,
      ...aiFields.productKeywords,
    ].join('、');

    const badges = [
      ...aiFields.productFeatures,
      ...aiFields.certifications,
      ...aiFields.supplyModes.slice(0, 2),
      ...aiFields.serviceAreas.slice(0, 2),
    ].slice(0, 8);

    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.companyProfile.findUnique({
        where: { companyId },
        select: { highlights: true },
      });
      const existing = (profile?.highlights as Record<string, any>) ?? {};
      const merged = { ...existing, ...aiFields, mainBusiness, badges };

      await tx.companyProfile.upsert({
        where: { companyId },
        create: { companyId, highlights: merged },
        update: { highlights: merged },
      });

      return aiFields;
    }, { isolationLevel: 'Serializable' });
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

    return this.prisma.companyStaff.create({
      data: {
        userId: identity.userId,
        companyId,
        role: dto.role,
        invitedBy: inviterUserId,
      },
      include: {
        user: { include: { profile: { select: { nickname: true, avatarUrl: true } } } },
      },
    });
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
