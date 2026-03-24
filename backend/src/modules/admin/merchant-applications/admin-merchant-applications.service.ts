import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RejectMerchantApplicationDto } from '../../merchant-application/dto/reject-merchant-application.dto';

@Injectable()
export class AdminMerchantApplicationsService {
  private readonly logger = new Logger(AdminMerchantApplicationsService.name);

  constructor(private prisma: PrismaService) {}

  // ===================== 列表查询 =====================

  /** 入驻申请列表（分页 + 状态筛选 + 关键词搜索） */
  async findAll(page = 1, pageSize = 20, status?: string, keyword?: string) {
    const skip = (page - 1) * pageSize;
    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (keyword) {
      where.OR = [
        { companyName: { contains: keyword, mode: 'insensitive' } },
        { contactName: { contains: keyword, mode: 'insensitive' } },
        { phone: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.merchantApplication.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.merchantApplication.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  // ===================== 详情查询 =====================

  /** 申请详情 + 同一手机号历史记录 */
  async findById(id: string) {
    const application = await this.prisma.merchantApplication.findUnique({
      where: { id },
    });

    if (!application) {
      throw new NotFoundException('入驻申请不存在');
    }

    // 同一手机号的其他申请记录（排除当前）
    const history = await this.prisma.merchantApplication.findMany({
      where: {
        phone: application.phone,
        id: { not: id },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return { application, history };
  }

  // ===================== 待审核数量（Badge） =====================

  /** 待审核申请数量 */
  async getPendingCount() {
    const count = await this.prisma.merchantApplication.count({
      where: { status: 'PENDING' },
    });
    return { count };
  }

  // ===================== 审批通过 =====================

  /** 审批通过：创建用户/企业/员工/文档，更新申请状态 */
  async approve(id: string, adminId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. 查找申请并验证状态（在事务内，防止 TOCTOU）
      const application = await tx.merchantApplication.findUnique({
        where: { id },
      });

      if (!application) {
        throw new NotFoundException('入驻申请不存在');
      }

      if (application.status !== 'PENDING') {
        throw new ConflictException('该申请已处理，无法重复审批');
      }

      // 2. 查找或创建 User（通过 AuthIdentity(PHONE) 匹配）
      const existingIdentity = await tx.authIdentity.findFirst({
        where: {
          provider: 'PHONE',
          identifier: application.phone,
        },
        include: { user: true },
      });

      let userId: string;

      if (existingIdentity) {
        userId = existingIdentity.userId;
      } else {
        // 创建新用户 + AuthIdentity + UserProfile
        const newUser = await tx.user.create({
          data: {
            authIdentities: {
              create: {
                provider: 'PHONE',
                identifier: application.phone,
                verified: true,
              },
            },
            profile: {
              create: {
                nickname: application.contactName,
              },
            },
          },
        });
        userId = newUser.id;
      }

      // 3. 创建企业（status=ACTIVE）
      const company = await tx.company.create({
        data: {
          name: application.companyName,
          status: 'ACTIVE',
          contact: {
            name: application.contactName,
            phone: application.phone,
            email: application.email,
          },
        },
      });

      // 4. 创建企业员工（role=OWNER, status=ACTIVE）
      await tx.companyStaff.create({
        data: {
          userId,
          companyId: company.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });

      // 5. 创建企业文档（type=LICENSE, verifyStatus=VERIFIED）
      await tx.companyDocument.create({
        data: {
          companyId: company.id,
          type: 'LICENSE',
          title: '营业执照',
          fileUrl: application.licenseFileUrl,
          verifyStatus: 'VERIFIED',
        },
      });

      // 6. 更新申请状态
      const updated = await tx.merchantApplication.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedAt: new Date(),
          reviewedBy: adminId,
          companyId: company.id,
        },
      });

      return { application: updated, companyId: company.id, userId };
    });

    // 7. 事务外：发送通知（占位实现）
    this.logger.log(
      `[通知] 入驻申请已通过 - 申请ID: ${id}, 企业ID: ${result.companyId}, 用户ID: ${result.userId}`,
    );
    this.logger.log(
      `[SMS] 向手机号发送入驻成功短信（占位）`,
    );
    this.logger.log(
      `[Email] 向联系邮箱发送入驻成功邮件（占位）`,
    );

    return result;
  }

  // ===================== 审批拒绝 =====================

  /** 审批拒绝：更新状态 + 记录原因 */
  async reject(id: string, dto: RejectMerchantApplicationDto, adminId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      // 在事务内查找并检查状态（防止 TOCTOU）
      const application = await tx.merchantApplication.findUnique({
        where: { id },
      });

      if (!application) {
        throw new NotFoundException('入驻申请不存在');
      }

      if (application.status !== 'PENDING') {
        throw new ConflictException('该申请已处理，无法重复审批');
      }

      const updated = await tx.merchantApplication.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectReason: dto.reason,
          reviewedAt: new Date(),
          reviewedBy: adminId,
        },
      });

      return updated;
    });

    // 事务外：发送通知（占位实现）
    this.logger.log(
      `[通知] 入驻申请已拒绝 - 申请ID: ${id}, 原因: ${dto.reason}`,
    );
    this.logger.log(
      `[SMS] 向手机号发送入驻拒绝短信（占位）`,
    );

    return { application: result };
  }
}
