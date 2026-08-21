import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { CompanyStatus, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminUpdateCompanyDto, AdminAuditCompanyDto, AdminUpdateHighlightsDto, AdminVerifyDocumentDto, BindOwnerDto, AdminUpdateAiSearchProfileDto, AdminCreateCompanyDto, AdminResetStaffPasswordDto, AdminAddStaffDto, AdminUpdateStaffDto, AdminTransferOwnerDto, AdminUpdateStaffNicknameDto, AdminUpdateStaffPhoneDto } from './dto/admin-company.dto';
import { maskPhone } from '../../../common/security/privacy-mask';
import { CompanyService } from '../../company/company.service';
import { pickUniqueReferralCode } from '../../../common/utils/referral-code.util';

// AI 搜索字段键名（用于 highlights merge 保护，包含历史字段以防旧数据覆盖）
const AI_SEARCH_KEYS = [
  'companyType', 'mainBusiness',
  'industryTags', 'productKeywords', 'productFeatures', 'certifications',
  'serviceAreas', 'supplyModes',
];

type CompanyDeletionBlocker = {
  code: string;
  label: string;
  count: number;
};

type CompanyDeletionCheck = {
  canDelete: boolean;
  company: {
    id: string;
    name: string;
    status: CompanyStatus;
    isPlatform: boolean;
  };
  blockers: CompanyDeletionBlocker[];
};

@Injectable()
export class AdminCompaniesService {
  constructor(
    private prisma: PrismaService,
    private companyService: CompanyService,
  ) {}

  private async assertCompanyMutable(
    db: Prisma.TransactionClient | PrismaService,
    companyId: string,
  ) {
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { id: true, status: true },
    });
    if (!company) throw new NotFoundException('企业不存在');
    if (company.status === CompanyStatus.DELETED) {
      throw new BadRequestException('企业已删除，请先从回收站恢复');
    }
    return company;
  }

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
            memberProfile: { create: { referralCode: await pickUniqueReferralCode(tx) } },
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
    if (status) {
      where.status = status;
    } else {
      where.status = { not: CompanyStatus.DELETED };
    }
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
    if (dto.status === CompanyStatus.DELETED) {
      throw new BadRequestException('请使用企业删除功能');
    }

    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({ where: { id } });
      if (!company) throw new NotFoundException('企业不存在');
      if (company.status === CompanyStatus.DELETED) {
        throw new BadRequestException('企业已删除，请先从回收站恢复');
      }

      // contact 是 Json 列，merge 现有内容以保留未知字段（邮箱/备用电话等未来字段）
      const data: any = { ...dto };
      if (dto.contact) {
        data.contact = { ...((company.contact as Record<string, any>) || {}), ...dto.contact };
      }

      return tx.company.update({
        where: { id },
        data,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private snapshotContainsCompany(itemsSnapshot: unknown, companyId: string): boolean {
    if (!Array.isArray(itemsSnapshot)) return false;
    return itemsSnapshot.some((item) => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Record<string, unknown>;
      return candidate.companyId === companyId
        || (candidate.productSnapshot as Record<string, unknown> | undefined)?.companyId === companyId;
    });
  }

  private async collectDeletionCheck(
    db: Prisma.TransactionClient | PrismaService,
    companyId: string,
  ): Promise<CompanyDeletionCheck> {
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        status: true,
        isPlatform: true,
      },
    });
    if (!company) throw new NotFoundException('企业不存在');

    const blockers: CompanyDeletionBlocker[] = [];
    if (company.isPlatform) {
      blockers.push({ code: 'PLATFORM_COMPANY', label: '平台官方企业不能删除', count: 1 });
      return { canDelete: false, company, blockers };
    }
    if (company.status === CompanyStatus.DELETED) {
      blockers.push({ code: 'ALREADY_DELETED', label: '企业已在回收站中', count: 1 });
      return { canDelete: false, company, blockers };
    }

    const [
      openOrders,
      openAfterSales,
      openRefunds,
      openShipments,
      activeGroupBuys,
      activeGroupBuyInstances,
      activeBookings,
      activeVisitGroups,
      futureActivities,
      frozenIndustryFunds,
      activeCheckoutSessions,
    ] = await Promise.all([
      db.orderItem.count({
        where: {
          companyId,
          deletedAt: null,
          order: {
            deletedAt: null,
            status: { in: ['PENDING_PAYMENT', 'PAID', 'SHIPPED', 'DELIVERED'] },
          },
        },
      }),
      db.afterSaleRequest.count({
        where: {
          status: { notIn: ['REJECTED', 'REFUNDED', 'COMPLETED', 'CLOSED', 'CANCELED'] },
          order: { items: { some: { companyId } } },
        },
      }),
      db.refund.count({
        where: {
          deletedAt: null,
          status: { notIn: ['REJECTED', 'REFUNDED'] },
          order: { items: { some: { companyId } } },
        },
      }),
      db.shipment.count({
        where: { companyId, status: { not: 'DELIVERED' } },
      }),
      db.groupBuyActivity.count({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          OR: [
            { product: { companyId } },
            { items: { some: { product: { companyId } } } },
          ],
        },
      }),
      db.groupBuyInstance.count({
        where: {
          status: { in: ['QUALIFICATION_PENDING', 'SHARING'] },
          activity: {
            OR: [
              { product: { companyId } },
              { items: { some: { product: { companyId } } } },
            ],
          },
        },
      }),
      db.booking.count({
        where: {
          companyId,
          status: { in: ['PENDING', 'APPROVED', 'INVITED', 'JOINED', 'PAID'] },
        },
      }),
      db.group.count({
        where: { companyId, status: { in: ['FORMING', 'INVITING', 'FULL'] } },
      }),
      db.companyActivity.count({
        where: {
          companyId,
          OR: [{ startAt: { gt: new Date() } }, { endAt: { gt: new Date() } }],
        },
      }),
      db.rewardLedger.count({
        where: {
          deletedAt: null,
          status: { in: ['FROZEN', 'RETURN_FROZEN', 'RESERVED'] },
          AND: [
            { meta: { path: ['companyId'], equals: companyId } },
            { meta: { path: ['accountType'], equals: 'INDUSTRY_FUND' } },
          ],
        },
      }),
      db.checkoutSession.findMany({
        // 过期会话即使异步清理尚未改状态，也已不能继续支付，不应永久阻塞企业删除。
        where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
        select: { itemsSnapshot: true },
      }),
    ]);

    const activeCheckouts = activeCheckoutSessions.filter((session) =>
      this.snapshotContainsCompany(session.itemsSnapshot, companyId),
    ).length;

    const candidates: CompanyDeletionBlocker[] = [
      { code: 'OPEN_CHECKOUTS', label: '待支付结算会话', count: activeCheckouts },
      { code: 'OPEN_ORDERS', label: '待履约订单商品', count: openOrders },
      { code: 'OPEN_AFTER_SALES', label: '未完成售后', count: openAfterSales },
      { code: 'OPEN_REFUNDS', label: '未完成退款', count: openRefunds },
      { code: 'OPEN_SHIPMENTS', label: '未签收物流', count: openShipments },
      { code: 'ACTIVE_GROUP_BUYS', label: '进行中团购活动', count: activeGroupBuys },
      { code: 'ACTIVE_GROUP_BUY_INSTANCES', label: '进行中团购分享', count: activeGroupBuyInstances },
      { code: 'ACTIVE_BOOKINGS', label: '未结束企业预约', count: activeBookings },
      { code: 'ACTIVE_VISIT_GROUPS', label: '进行中考察团', count: activeVisitGroups },
      { code: 'FUTURE_ACTIVITIES', label: '未结束企业活动', count: futureActivities },
      { code: 'FROZEN_INDUSTRY_FUNDS', label: '冻结或预留产业基金流水', count: frozenIndustryFunds },
    ];
    blockers.push(...candidates.filter((item) => item.count > 0));
    return { canDelete: blockers.length === 0, company, blockers };
  }

  async getDeletionCheck(companyId: string) {
    return this.collectDeletionCheck(this.prisma, companyId);
  }

  async remove(companyId: string, confirmationName: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const check = await this.collectDeletionCheck(tx, companyId);
      if (confirmationName.trim() !== check.company.name) {
        throw new BadRequestException('请输入完整企业名称以确认删除');
      }
      if (!check.canDelete) {
        throw new ConflictException({
          code: 'COMPANY_DELETE_BLOCKED',
          message: '企业尚有未完成业务，暂不能删除',
          blockers: check.blockers,
        });
      }

      const now = new Date();
      const updated = await tx.company.updateMany({
        where: {
          id: companyId,
          status: check.company.status,
          deletedAt: null,
          isPlatform: false,
        },
        data: {
          status: CompanyStatus.DELETED,
          deletedAt: now,
          deletedFromStatus: check.company.status,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('企业状态已变化，请刷新后重试');
      }

      await tx.sellerSession.deleteMany({
        where: { staff: { companyId } },
      });

      return { ok: true, companyId, deletedAt: now };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    this.companyService.invalidateListCache();
    return result;
  }

  async restore(companyId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          status: true,
          isPlatform: true,
          deletedAt: true,
          deletedFromStatus: true,
        },
      });
      if (!company) throw new NotFoundException('企业不存在');
      if (company.isPlatform) throw new BadRequestException('平台官方企业不支持此操作');
      if (company.status !== CompanyStatus.DELETED || !company.deletedAt) {
        throw new BadRequestException('该企业不在回收站中');
      }

      const restoreStatus = company.deletedFromStatus
        && company.deletedFromStatus !== CompanyStatus.DELETED
        ? company.deletedFromStatus
        : CompanyStatus.PENDING;
      const updated = await tx.company.updateMany({
        where: { id: companyId, status: CompanyStatus.DELETED, deletedAt: company.deletedAt },
        data: {
          status: restoreStatus,
          deletedAt: null,
          deletedFromStatus: null,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('企业状态已变化，请刷新后重试');
      }
      return { ok: true, companyId, status: restoreStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    this.companyService.invalidateListCache();
    return result;
  }

  /** 审核企业 */
  async audit(id: string, dto: AdminAuditCompanyDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCompanyMutable(tx, id);
      return tx.company.update({
        where: { id },
        data: {
          status: dto.status === 'APPROVED'
            ? CompanyStatus.ACTIVE
            : CompanyStatus.BANNED,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
    return this.prisma.$transaction(async (tx) => {
      await this.assertCompanyMutable(tx, companyId);

      // 检查是否已有 OWNER
      const existingOwner = await tx.companyStaff.findFirst({
        where: { companyId, role: 'OWNER' },
      });
      if (existingOwner) throw new BadRequestException('该企业已有创始人');

      // 根据手机号查找用户
      const identity = await tx.authIdentity.findFirst({
        where: { provider: 'PHONE', identifier: dto.phone },
      });
      if (!identity) throw new NotFoundException('未找到该手机号对应的用户');

      // 检查用户是否已在该企业
      const existingStaff = await tx.companyStaff.findUnique({
        where: { userId_companyId: { userId: identity.userId, companyId } },
      });
      if (existingStaff) throw new BadRequestException('该用户已在该企业中');

      // 可选昵称：仅在昵称为空或等于手机号（自动默认值）时覆盖，保护买家已设的自定义昵称
      const nickname = dto.nickname?.trim();
      if (nickname) {
        const profile = await tx.userProfile.findUnique({
          where: { userId: identity.userId },
          select: { nickname: true },
        });
        const current = profile?.nickname?.trim();
        if (!current || current === dto.phone) {
          await tx.userProfile.update({
            where: { userId: identity.userId },
            data: { nickname },
          });
        }
      }

      const created = await tx.companyStaff.create({
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
              authIdentities: (created.user.authIdentities || []).map((ownerIdentity) => ({
                ...ownerIdentity,
                identifierMasked: maskPhone(ownerIdentity.identifier || null),
              })),
              phoneMasked: maskPhone(created.user.authIdentities?.[0]?.identifier || null),
            }
          : created.user,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** 更新企业亮点 */
  async updateHighlights(companyId: string, dto: AdminUpdateHighlightsDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCompanyMutable(tx, companyId);
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

  /** 获取 AI 搜索资料（仅 companyType，其他字段已迁移到 CompanyTag） */
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
    };
  }

  /** 更新 AI 搜索资料（仅 companyType，其他字段已迁移到 CompanyTag） */
  async updateAiSearchProfile(companyId: string, dto: AdminUpdateAiSearchProfileDto) {
    const aiFields: Record<string, any> = {
      companyType: dto.companyType,
    };

    return this.prisma.$transaction(async (tx) => {
      await this.assertCompanyMutable(tx, companyId);
      const profile = await tx.companyProfile.findUnique({ where: { companyId } });
      const existing = (profile?.highlights as Record<string, any>) ?? {};
      const merged = { ...existing, ...aiFields };
      await tx.companyProfile.upsert({
        where: { companyId },
        create: { companyId, highlights: merged },
        update: { highlights: merged },
      });
      return { companyType: dto.companyType };
    }, { isolationLevel: 'Serializable' });
  }

  /** 获取企业标签（按类别分组） */
  async getCompanyTags(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('企业不存在');

    const companyTags = await this.prisma.companyTag.findMany({
      where: { companyId },
      orderBy: { sortOrder: 'asc' },
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
    await this.prisma.$transaction(async (tx) => {
      await this.assertCompanyMutable(tx, companyId);
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

  /** C40c8 管理员兜底重置企业员工密码
   *
   * 场景：员工忘记密码 + 手机号失联的最后通道。
   * - 不验旧密码，管理员直接设新密码
   * - 成功后失效该员工所有 session
   * - OWNER / MANAGER / OPERATOR 均可被重置
   */
  async resetStaffPassword(
    companyId: string,
    staffId: string,
    dto: AdminResetStaffPasswordDto,
  ) {
    const staff = await this.prisma.companyStaff.findUnique({
      where: { id: staffId },
    });
    if (!staff) throw new NotFoundException('员工不存在');
    if (staff.companyId !== companyId) {
      throw new BadRequestException('员工不属于该企业');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    // 事务：同时更新密码 + 失效 session（保证安全一致性）
    await this.prisma.$transaction(async (tx) => {
      await this.assertCompanyMutable(tx, companyId);
      await tx.companyStaff.update({
        where: { id: staffId },
        data: { passwordHash },
      });

      await tx.sellerSession.updateMany({
        where: { staffId, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date() },
      });
    });

    return { ok: true };
  }

  // ===================== C40c9 管理员员工 CRUD + 换 OWNER =====================

  /** 添加员工（经理/运营，不支持创始人） */
  // ⚠️ 架构债（2026-05-27 识别，v1.0 暂不修）：本方法对 isPlatform=true 的平台公司**不挡**——
  //    超管能给 PLATFORM_COMPANY 添加员工，配合 seller-auth 不查 isPlatform，可让该手机号
  //    登录 seller-center 管理平台公司。这与 seller-company.service.ts:254 的 F4
  //    「平台公司不支持邀请员工」逻辑不一致（仅 seller-center 那条路被挡）。
  //    上线后若决定走"方案 A 严格分离"，在此处加 `if (company.isPlatform) throw` 收口。
  async addStaff(companyId: string, dto: AdminAddStaffDto) {
    if (dto.role === 'OWNER' as any) {
      throw new BadRequestException('添加员工仅支持经理或运营，创始人请使用「转让创始人」功能');
    }

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('企业不存在');

    const nickname = dto.nickname?.trim() || undefined;

    return this.prisma.$transaction(async (tx) => {
      await this.assertCompanyMutable(tx, companyId);
      // 通过手机号查 User，不存在则自动创建
      let identity = await tx.authIdentity.findFirst({
        where: { provider: 'PHONE', identifier: dto.phone },
      });

      let userId: string;
      if (identity) {
        userId = identity.userId;
        // 仅在昵称为空或等于手机号（自动默认值）时用管理员输入的昵称覆盖，避免覆盖买家自设昵称
        if (nickname) {
          const profile = await tx.userProfile.findUnique({ where: { userId }, select: { nickname: true } });
          const current = profile?.nickname?.trim();
          if (!current || current === dto.phone) {
            await tx.userProfile.update({ where: { userId }, data: { nickname } });
          }
        }
      } else {
        const newUser = await tx.user.create({
          data: {
            profile: { create: { nickname: nickname || dto.phone } },
            memberProfile: { create: { referralCode: await pickUniqueReferralCode(tx) } },
            authIdentities: {
              create: { provider: 'PHONE', identifier: dto.phone, verified: true },
            },
          },
        });
        userId = newUser.id;
      }

      // 不能重复添加
      const existing = await tx.companyStaff.findUnique({
        where: { userId_companyId: { userId, companyId } },
      });
      if (existing) {
        throw new BadRequestException('该用户已是本企业员工');
      }

      const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : null;

      return tx.companyStaff.create({
        data: {
          userId,
          companyId,
          role: dto.role,
          status: 'ACTIVE',
          passwordHash,
        },
        include: {
          user: {
            select: {
              id: true,
              profile: { select: { nickname: true } },
            },
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** 修改员工角色/状态（OWNER 不可改，走 transfer-owner） */
  async updateStaff(companyId: string, staffId: string, dto: AdminUpdateStaffDto) {
    const staff = await this.prisma.companyStaff.findUnique({
      where: { id: staffId },
    });
    if (!staff) throw new NotFoundException('员工不存在');
    if (staff.companyId !== companyId) {
      throw new BadRequestException('员工不属于该企业');
    }
    if (staff.role === 'OWNER') {
      throw new BadRequestException('创始人不可通过此功能修改，请使用「转让创始人」功能');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.assertCompanyMutable(tx, companyId);
      const updated = await tx.companyStaff.update({
        where: { id: staffId },
        data: {
          ...(dto.role ? { role: dto.role } : {}),
          ...(dto.status ? { status: dto.status } : {}),
        },
      });

      // 禁用员工时强制失效其 session
      if (dto.status === 'DISABLED') {
        await tx.sellerSession.updateMany({
          where: { staffId, expiresAt: { gt: new Date() } },
          data: { expiresAt: new Date() },
        });
      }

      return updated;
    });
  }

  /** 移除员工（OWNER 不可移除） */
  async removeStaff(companyId: string, staffId: string) {
    const staff = await this.prisma.companyStaff.findUnique({
      where: { id: staffId },
    });
    if (!staff) throw new NotFoundException('员工不存在');
    if (staff.companyId !== companyId) {
      throw new BadRequestException('员工不属于该企业');
    }
    if (staff.role === 'OWNER') {
      throw new BadRequestException('创始人不可直接移除，请先使用「转让创始人」功能');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.assertCompanyMutable(tx, companyId);
      // 先失效 session 再删除 staff
      await tx.sellerSession.updateMany({
        where: { staffId, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date() },
      });

      await tx.companyStaff.delete({ where: { id: staffId } });
    });

    return { ok: true };
  }

  /** 换 OWNER（原子事务：老 OWNER 降级/移除 + 新 OWNER 上位） */
  async transferOwner(companyId: string, dto: AdminTransferOwnerDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCompanyMutable(tx, companyId);
      // 1. 查找现任 OWNER
      const oldOwner = await tx.companyStaff.findFirst({
        where: { companyId, role: 'OWNER' },
      });
      if (!oldOwner) {
        throw new NotFoundException('该企业尚无创始人，请使用「绑定创始人」功能直接绑定');
      }

      // 2. 通过手机号找 User，不存在则创建
      let identity = await tx.authIdentity.findFirst({
        where: { provider: 'PHONE', identifier: dto.newOwnerPhone },
      });

      const nickname = dto.nickname?.trim() || undefined;

      let newOwnerUserId: string;
      if (identity) {
        newOwnerUserId = identity.userId;
        // 老用户：仅在昵称为空或等于手机号（自动默认值）时覆盖，保护买家已设的自定义昵称
        if (nickname) {
          const profile = await tx.userProfile.findUnique({
            where: { userId: newOwnerUserId },
            select: { nickname: true },
          });
          const current = profile?.nickname?.trim();
          if (!current || current === dto.newOwnerPhone) {
            await tx.userProfile.update({ where: { userId: newOwnerUserId }, data: { nickname } });
          }
        }
      } else {
        const newUser = await tx.user.create({
          data: {
            profile: { create: { nickname: nickname || dto.newOwnerPhone } },
            memberProfile: { create: { referralCode: await pickUniqueReferralCode(tx) } },
            authIdentities: {
              create: { provider: 'PHONE', identifier: dto.newOwnerPhone, verified: true },
            },
          },
        });
        newOwnerUserId = newUser.id;
      }

      // 不能转给自己
      if (oldOwner.userId === newOwnerUserId) {
        throw new BadRequestException('新创始人不能是当前创始人本人');
      }

      // 3. 处理老 OWNER（session 失效 + 根据 oldOwnerAction 降级或移除）
      await tx.sellerSession.updateMany({
        where: { staffId: oldOwner.id, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date() },
      });

      if (dto.oldOwnerAction === 'REMOVE') {
        await tx.companyStaff.delete({ where: { id: oldOwner.id } });
      } else {
        // DEMOTE_TO_MANAGER
        await tx.companyStaff.update({
          where: { id: oldOwner.id },
          data: { role: 'MANAGER' },
        });
      }

      // 4. 新 OWNER 上位（已是员工则升级；不是则创建）
      const existingStaff = await tx.companyStaff.findUnique({
        where: { userId_companyId: { userId: newOwnerUserId, companyId } },
      });

      let newOwner;
      if (existingStaff) {
        newOwner = await tx.companyStaff.update({
          where: { id: existingStaff.id },
          data: { role: 'OWNER', status: 'ACTIVE' },
        });
      } else {
        newOwner = await tx.companyStaff.create({
          data: {
            userId: newOwnerUserId,
            companyId,
            role: 'OWNER',
            status: 'ACTIVE',
          },
        });
      }

      return {
        ok: true,
        oldOwnerId: oldOwner.id,
        newOwnerId: newOwner.id,
        oldOwnerAction: dto.oldOwnerAction,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** 审核资质文件 */
  async verifyDocument(companyId: string, documentId: string, dto: AdminVerifyDocumentDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCompanyMutable(tx, companyId);
      const doc = await tx.companyDocument.findFirst({
        where: { id: documentId, companyId },
      });
      if (!doc) throw new NotFoundException('资质文件不存在');

      return tx.companyDocument.update({
        where: { id: documentId },
        data: {
          verifyStatus: dto.verifyStatus,
          verifyNote: dto.verifyNote,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // ===================== 员工昵称 / 手机号直接编辑 =====================

  /** 修改员工昵称（全局生效，影响该 User 在所有企业和买家端的显示） */
  async updateStaffNickname(companyId: string, staffId: string, dto: AdminUpdateStaffNicknameDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCompanyMutable(tx, companyId);
      const staff = await tx.companyStaff.findUnique({ where: { id: staffId } });
      if (!staff) throw new NotFoundException('员工不存在');
      if (staff.companyId !== companyId) throw new BadRequestException('员工不属于该企业');

      const nickname = dto.nickname.trim();
      if (!nickname) throw new BadRequestException('昵称不能为空');

      await tx.userProfile.upsert({
        where: { userId: staff.userId },
        create: { userId: staff.userId, nickname },
        update: { nickname },
      });

      return tx.companyStaff.findUnique({
        where: { id: staffId },
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** 修改员工手机号（替换 AuthIdentity.identifier；用户下次用新号登录） */
  async updateStaffPhone(companyId: string, staffId: string, dto: AdminUpdateStaffPhoneDto) {
    const staff = await this.prisma.companyStaff.findUnique({ where: { id: staffId } });
    if (!staff) throw new NotFoundException('员工不存在');
    if (staff.companyId !== companyId) throw new BadRequestException('员工不属于该企业');

    const newPhone = dto.newPhone.trim();

    return this.prisma.$transaction(async (tx) => {
      await this.assertCompanyMutable(tx, companyId);
      // 1. 获取当前 PHONE identity
      const currentIdentity = await tx.authIdentity.findFirst({
        where: { provider: 'PHONE', userId: staff.userId },
      });
      if (!currentIdentity) {
        throw new BadRequestException('该员工没有手机号身份记录');
      }

      // 同号直接返回
      if (currentIdentity.identifier === newPhone) {
        return { ok: true, unchanged: true };
      }

      // 2. 检查新号是否已被其它用户占用
      const conflict = await tx.authIdentity.findFirst({
        where: { provider: 'PHONE', identifier: newPhone },
      });
      if (conflict && conflict.userId !== staff.userId) {
        throw new BadRequestException('该手机号已被其他用户注册');
      }

      const oldPhone = currentIdentity.identifier.trim();

      // 3. 更新 AuthIdentity
      await tx.authIdentity.update({
        where: { id: currentIdentity.id },
        data: { identifier: newPhone, verified: true },
      });

      // 4. 如果当前昵称 = 旧手机号（自动默认值），同步更新为新手机号避免列表错位
      const profile = await tx.userProfile.findUnique({
        where: { userId: staff.userId },
        select: { nickname: true },
      });
      if (profile?.nickname?.trim() === oldPhone) {
        await tx.userProfile.update({
          where: { userId: staff.userId },
          data: { nickname: newPhone },
        });
      }

      return { ok: true, unchanged: false, oldPhone, newPhone };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // ===================== 产业基金（INDUSTRY_FUND）查询 =====================

  /**
   * 查询某商户的产业基金累计/可用/已提现/流水。
   * 按 RewardLedger.meta.companyId 过滤，覆盖 OWNER 变更前后所有历史流水。
   */
  async getIndustryFund(companyId: string, page = 1, pageSize = 20) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true },
    });
    if (!company) {
      throw new NotFoundException('企业不存在');
    }

    // 当前 OWNER（用于展示，仅作为参考；流水按 companyId 过滤不受换 OWNER 影响）
    const ownerStaff = await this.prisma.companyStaff.findFirst({
      where: { companyId, role: 'OWNER', status: 'ACTIVE' },
      select: {
        userId: true,
        user: {
          select: {
            id: true,
            authIdentities: {
              where: { provider: 'PHONE' },
              select: { identifier: true },
              take: 1,
            },
            profile: { select: { nickname: true } },
          },
        },
      },
    });

    const ownerInfo = ownerStaff
      ? {
          userId: ownerStaff.userId,
          nickname: ownerStaff.user?.profile?.nickname || null,
          phone: maskPhone(
            ownerStaff.user?.authIdentities?.[0]?.identifier || '',
          ),
        }
      : null;

    // meta.companyId + meta.accountType=INDUSTRY_FUND 双重过滤
    // （accountType 双重保险：避免提现/调账等可能在同账户上写入的非 INDUSTRY_FUND 流水串入）
    const baseWhere: Prisma.RewardLedgerWhereInput = {
      deletedAt: null,
      AND: [
        { meta: { path: ['companyId'], equals: companyId } },
        { meta: { path: ['accountType'], equals: 'INDUSTRY_FUND' } },
      ],
    };

    const [releasedAgg, withdrawnAgg, availableAgg, frozenAgg, total] =
      await Promise.all([
        // 累计已分配（所有入账）
        this.prisma.rewardLedger.aggregate({
          where: { ...baseWhere, entryType: 'RELEASE' },
          _sum: { amount: true },
        }),
        // 已提现（status=WITHDRAWN 表示提现已完成）
        this.prisma.rewardLedger.aggregate({
          where: { ...baseWhere, status: 'WITHDRAWN' },
          _sum: { amount: true },
        }),
        // 可用余额
        this.prisma.rewardLedger.aggregate({
          where: { ...baseWhere, status: 'AVAILABLE' },
          _sum: { amount: true },
        }),
        // 冻结中（售后退货冻结 + 提现冻结）
        this.prisma.rewardLedger.aggregate({
          where: {
            ...baseWhere,
            status: { in: ['FROZEN', 'RETURN_FROZEN'] },
          },
          _sum: { amount: true },
        }),
        this.prisma.rewardLedger.count({ where: baseWhere }),
      ]);

    const items = await this.prisma.rewardLedger.findMany({
      where: baseWhere,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        userId: true,
        amount: true,
        entryType: true,
        status: true,
        refType: true,
        refId: true,
        meta: true,
        createdAt: true,
      },
    });

    return {
      company,
      owner: ownerInfo,
      summary: {
        totalReleased: releasedAgg._sum.amount ?? 0,
        totalWithdrawn: withdrawnAgg._sum.amount ?? 0,
        available: availableAgg._sum.amount ?? 0,
        frozen: frozenAgg._sum.amount ?? 0,
        ledgerCount: total,
      },
      items,
      total,
      page,
      pageSize,
    };
  }
}
