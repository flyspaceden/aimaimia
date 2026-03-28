import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminUpdateCompanyDto, AdminAuditCompanyDto, AdminUpdateHighlightsDto, AdminVerifyDocumentDto, BindOwnerDto, AdminUpdateAiSearchProfileDto, AdminCreateCompanyDto } from './dto/admin-company.dto';
import { maskPhone } from '../../../common/security/privacy-mask';

const AI_SEARCH_KEYS = [
  'companyType', 'industryTags', 'productKeywords',
  'productFeatures', 'certifications', 'mainBusiness', 'badges',
];

@Injectable()
export class AdminCompaniesService {
  constructor(private prisma: PrismaService) {}

  /** 管理员手动创建企业 */
  async create(dto: AdminCreateCompanyDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. 查找或创建 User（通过 AuthIdentity(PHONE) 匹配）
      const existingIdentity = await tx.authIdentity.findFirst({
        where: {
          provider: 'PHONE',
          identifier: dto.phone,
        },
        include: { user: true },
      });

      let userId: string;

      if (existingIdentity) {
        userId = existingIdentity.userId;
      } else {
        // 创建新用户 + AuthIdentity + UserProfile + MemberProfile
        const newUser = await tx.user.create({
          data: {
            authIdentities: {
              create: {
                provider: 'PHONE',
                identifier: dto.phone,
                verified: true,
              },
            },
            profile: {
              create: {
                nickname: dto.contactName,
              },
            },
            memberProfile: { create: {} },
          },
        });
        userId = newUser.id;
      }

      // 2. 创建企业（status=ACTIVE）
      const description = dto.description
        ? `经营品类：${dto.category}\n${dto.description}`
        : `经营品类：${dto.category}`;

      const company = await tx.company.create({
        data: {
          name: dto.companyName,
          status: 'ACTIVE',
          description,
          contact: {
            name: dto.contactName,
            phone: dto.phone,
          },
        },
      });

      // 3. 创建 CompanyProfile（卖家系统、AI 搜索等功能依赖此记录）
      await tx.companyProfile.create({
        data: { companyId: company.id },
      });

      // 4. 创建企业员工（role=OWNER, status=ACTIVE）
      const staff = await tx.companyStaff.create({
        data: {
          userId,
          companyId: company.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });

      return { companyId: company.id, staffId: staff.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return result;
  }

  /** 企业列表 */
  async findAll(page = 1, pageSize = 20, status?: string, keyword?: string) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (status) where.status = status;
    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { id: keyword },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { products: true } },
        },
      }),
      this.prisma.company.count({ where }),
    ]);

    return {
      items: items.map((c) => {
        const contact = c.contact as Record<string, any> | null;
        return {
          ...c,
          contactName: contact?.name || null,
          contactPhone: maskPhone(contact?.phone || c.servicePhone || null),
          productCount: c._count?.products || 0,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** 企业详情 */
  async findById(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        profile: true,
        documents: true,
        _count: { select: { products: true, bookings: true } },
      },
    });
    if (!company) throw new NotFoundException('企业不存在');
    const contact = company.contact as Record<string, any> | null;
    return {
      ...company,
      contactName: contact?.name || null,
      contactPhone: contact?.phone || company.servicePhone || null,
      contactPhoneMasked: maskPhone(contact?.phone || company.servicePhone || null),
      productCount: company._count?.products || 0,
    };
  }

  /** 更新企业 */
  async update(id: string, dto: AdminUpdateCompanyDto) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('企业不存在');

    return this.prisma.company.update({
      where: { id },
      data: dto,
    });
  }

  /** 审核企业 */
  async audit(id: string, dto: AdminAuditCompanyDto) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('企业不存在');

    return this.prisma.company.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  /** 企业员工列表 */
  async getStaff(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('企业不存在');

    const staffs = await this.prisma.companyStaff.findMany({
      where: { companyId },
      orderBy: { joinedAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            profile: { select: { nickname: true, avatarUrl: true } },
            authIdentities: {
              where: { provider: 'PHONE' },
              select: { identifier: true },
              take: 1,
            },
          },
        },
      },
    });

    return staffs.map((staff) => ({
      ...staff,
      user: staff.user
        ? {
            ...staff.user,
            authIdentities: (staff.user.authIdentities || []).map((identity) => ({
              ...identity,
              identifierMasked: maskPhone(identity.identifier || null),
            })),
            phoneMasked: maskPhone(staff.user.authIdentities?.[0]?.identifier || null),
          }
        : staff.user,
    }));
  }

  /** 绑定企业创始人 */
  async bindOwner(companyId: string, dto: BindOwnerDto) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('企业不存在');

    // 检查是否已有 OWNER
    const existingOwner = await this.prisma.companyStaff.findFirst({
      where: { companyId, role: 'OWNER' },
    });
    if (existingOwner) throw new BadRequestException('该企业已有创始人');

    // 根据手机号查找用户
    const identity = await this.prisma.authIdentity.findFirst({
      where: { provider: 'PHONE', identifier: dto.phone },
    });
    if (!identity) throw new NotFoundException('未找到该手机号对应的用户');

    // 检查用户是否已在该企业
    const existingStaff = await this.prisma.companyStaff.findUnique({
      where: { userId_companyId: { userId: identity.userId, companyId } },
    });
    if (existingStaff) throw new BadRequestException('该用户已在该企业中');

    const created = await this.prisma.companyStaff.create({
      data: {
        userId: identity.userId,
        companyId,
        role: 'OWNER',
        status: 'ACTIVE',
      },
      include: {
        user: {
          select: {
            id: true,
            profile: { select: { nickname: true } },
            authIdentities: {
              where: { provider: 'PHONE' },
              select: { identifier: true },
              take: 1,
            },
          },
        },
      },
    });

    return {
      ...created,
      user: created.user
        ? {
            ...created.user,
            authIdentities: (created.user.authIdentities || []).map((identity) => ({
              ...identity,
              identifierMasked: maskPhone(identity.identifier || null),
            })),
            phoneMasked: maskPhone(created.user.authIdentities?.[0]?.identifier || null),
          }
        : created.user,
    };
  }

  /** 更新企业亮点 */
  async updateHighlights(companyId: string, dto: AdminUpdateHighlightsDto) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('企业不存在');

    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.companyProfile.findUnique({ where: { companyId } });
      const existing = (profile?.highlights as Record<string, any>) ?? {};
      // 从传入数据中移除 AI 搜索字段（防止覆盖）
      const safeHighlights = Object.fromEntries(
        Object.entries(dto.highlights).filter(([k]) => !AI_SEARCH_KEYS.includes(k)),
      );
      const merged = { ...existing, ...safeHighlights };
      return tx.companyProfile.upsert({
        where: { companyId },
        create: { companyId, highlights: merged },
        update: { highlights: merged },
      });
    }, { isolationLevel: 'Serializable' });
  }

  /** 获取企业亮点 */
  async getHighlights(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('企业不存在');

    const profile = await this.prisma.companyProfile.findUnique({
      where: { companyId },
      select: { highlights: true },
    });
    return profile?.highlights || {};
  }

  /** 获取 AI 搜索资料 */
  async getAiSearchProfile(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('企业不存在');

    const profile = await this.prisma.companyProfile.findUnique({
      where: { companyId },
      select: { highlights: true },
    });
    const highlights = (profile?.highlights as Record<string, any>) || {};
    return {
      companyType: highlights.companyType || null,
      industryTags: highlights.industryTags || [],
      productKeywords: highlights.productKeywords || [],
      productFeatures: highlights.productFeatures || [],
      certifications: highlights.certifications || [],
    };
  }

  /** 更新 AI 搜索资料 */
  async updateAiSearchProfile(companyId: string, dto: AdminUpdateAiSearchProfileDto) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('企业不存在');

    // 计算派生字段
    const keywords = dto.productKeywords || [];
    const mainBusiness = [...dto.industryTags, ...keywords].join('、');
    const badges = [
      ...(dto.productFeatures || []),
      ...(dto.certifications || []),
    ].slice(0, 8);

    const aiFields: Record<string, any> = {
      companyType: dto.companyType,
      industryTags: dto.industryTags,
      productKeywords: keywords,
      productFeatures: dto.productFeatures,
      certifications: dto.certifications || [],
      mainBusiness,
      badges,
    };

    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.companyProfile.findUnique({ where: { companyId } });
      const existing = (profile?.highlights as Record<string, any>) ?? {};
      const merged = { ...existing, ...aiFields };
      await tx.companyProfile.upsert({
        where: { companyId },
        create: { companyId, highlights: merged },
        update: { highlights: merged },
      });
      return {
        companyType: dto.companyType,
        industryTags: dto.industryTags,
        productKeywords: keywords,
        productFeatures: dto.productFeatures,
        certifications: dto.certifications || [],
      };
    }, { isolationLevel: 'Serializable' });
  }

  /** 获取企业标签（按类别分组） */
  async getCompanyTags(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('企业不存在');

    const companyTags = await this.prisma.companyTag.findMany({
      where: { companyId },
      include: {
        tag: {
          include: { category: { select: { id: true, name: true, code: true, scope: true } } },
        },
      },
    });

    // 按类别分组返回
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

  /** 更新企业标签（全量替换） */
  async updateCompanyTags(companyId: string, tagIds: string[]) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('企业不存在');

    // 验证所有 tagIds 存在且 scope 为 COMPANY
    if (tagIds.length > 0) {
      const tags = await this.prisma.tag.findMany({
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

    await this.prisma.$transaction([
      this.prisma.companyTag.deleteMany({ where: { companyId } }),
      ...(tagIds.length > 0
        ? [this.prisma.companyTag.createMany({
            data: tagIds.map(tagId => ({ companyId, tagId })),
            skipDuplicates: true,
          })]
        : []),
    ]);

    return this.getCompanyTags(companyId);
  }

  /** 审核资质文件 */
  async verifyDocument(companyId: string, documentId: string, dto: AdminVerifyDocumentDto) {
    const doc = await this.prisma.companyDocument.findFirst({
      where: { id: documentId, companyId },
    });
    if (!doc) throw new NotFoundException('资质文件不存在');

    return this.prisma.companyDocument.update({
      where: { id: documentId },
      data: {
        verifyStatus: dto.verifyStatus,
        verifyNote: dto.verifyNote,
      },
    });
  }
}
